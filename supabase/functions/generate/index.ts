// Edge Function: generate
// Генерирует 3 варианта поздравления через Claude API (claude-sonnet-5),
// собирая промпт из эталонных примеров, настроек стиля и контекста контакта.
// Вызывается залогиненным пользователем (verify_jwt=true) — данные читаются
// под RLS от его имени.
//
// Секреты — только из окружения:
//   ANTHROPIC_API_KEY  — ключ Claude API
//   SUPABASE_URL / SUPABASE_ANON_KEY — инжектятся платформой.

import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY") ?? "";

const MODEL = "claude-sonnet-5";
const ANTHROPIC_VERSION = "2023-06-01";
const REQUEST_TIMEOUT_MS = 45_000;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

const EVENT_LABELS: Record<string, string> = {
  birthday: "День рождения",
  new_year: "Новый год",
  mar8: "8 марта",
  feb23: "23 февраля",
  anniversary: "Годовщина",
};

// Человекочитаемое описание настроек стиля для промпта.
function styleDescription(s: Record<string, unknown> | null): string {
  if (!s) return "особые настройки стиля не заданы";
  const parts: string[] = [];
  const emoji: Record<string, string> = { often: "часто", sometimes: "иногда", never: "никогда" };
  const excl: Record<string, string> = { many: "много", single_end: "один в конце", avoid: "избегает" };
  const cap: Record<string, string> = { always_correct: "всегда правильно", often_lowercase: "часто с маленькой буквы" };
  const len: Record<string, string> = { short: "коротко", medium: "средне", long: "развёрнуто" };
  if (s.emoji_frequency) parts.push(`эмодзи: ${emoji[s.emoji_frequency as string]}`);
  if (s.brackets_instead_of_emoji != null) {
    parts.push(s.brackets_instead_of_emoji ? "вместо эмодзи использует скобки ))" : "скобки )) не использует");
  }
  if (s.exclamation_style) parts.push(`восклицательные знаки: ${excl[s.exclamation_style as string]}`);
  if (s.capitalization) parts.push(`заглавные буквы: ${cap[s.capitalization as string]}`);
  if (s.length_preference) parts.push(`длина: ${len[s.length_preference as string]}`);
  return parts.length ? parts.join("; ") : "особые настройки стиля не заданы";
}

// Сборка system + user промптов.
function buildPrompt(
  contact: Record<string, unknown>,
  settings: Record<string, unknown> | null,
  referenceExamples: string[],
  okCount: number,
  editPairs: { before: string; after: string }[],
  wishVectors: string[],
  eventType: string,
  userWishes: string | null,
  count: number,
) {
  const nWord = count === 1 ? "1 вариант" : `${count} разных варианта`;
  let refBlock = "";
  if (referenceExamples.length) {
    refBlock =
      "\n\nЭталонные примеры того, как пишет пользователь (ориентируйся на тон и стиль, НЕ копируй дословно):\n" +
      referenceExamples.map((t, i) => `${i + 1}. «${t}»`).join("\n");
    if (okCount > 0) refBlock += `\n\nЕщё ${okCount} обычных примеров задают общий тон.`;
  }

  // Few-shot по правкам: что сгенерировали → как пользователь на самом деле отправил.
  let editBlock = "";
  if (editPairs.length) {
    editBlock =
      "\n\nКак пользователь правит сгенерированное (важный сигнал — учитывай эти правки; было → стало):\n" +
      editPairs
        .map((p, i) => `${i + 1}. Было: «${p.before}»\n   Стало: «${p.after}»`)
        .join("\n");
  }

  const system =
    "Ты пишешь поздравления ОТ ЛИЦА пользователя, в точности повторяя его личный стиль письма.\n" +
    "Правила:\n" +
    "- Пиши на русском.\n" +
    "- Строго соблюдай форму обращения (на «ты» или на «вы»), указанную в контексте.\n" +
    "- Не выдумывай факты, которых нет в контексте. Если фактов мало — пиши искренне, но без конкретики.\n" +
    "- Подражай стилю пользователя по эталонным примерам и настройкам, но не копируй примеры дословно.\n" +
    `- Верни РОВНО ${nWord} поздравления.\n\n` +
    `Стиль пользователя: ${styleDescription(settings)}.` +
    refBlock +
    editBlock;

  const genderMap: Record<string, string> = { male: "мужчина", female: "женщина" };
  const eventLabel = EVENT_LABELS[eventType] ?? eventType;
  const anniv = contact.anniversary_label ? ` (${contact.anniversary_label})` : "";

  // Групповые вектора пожеланий — наравне с фактами о контакте (раздел 6a).
  const wishBlock = wishVectors.length
    ? `- Общие пожелания для групп этого контакта (учитывай наравне с фактами): ${wishVectors.join("; ")}\n`
    : "";

  const user =
    "Контекст получателя:\n" +
    `- Имя: ${contact.name}\n` +
    `- Тип отношений: ${contact.relationship_type ?? "не указан"}\n` +
    `- Близость: ${contact.closeness ?? "?"}/5\n` +
    `- Обращение: на «${contact.address_form ?? "ты"}»\n` +
    `- Пол: ${contact.gender ? genderMap[contact.gender as string] : "не указан"}\n` +
    `- Факты о человеке: ${(contact.context_notes as string)?.trim() || "фактов нет"}\n` +
    wishBlock +
    `\nСобытие: ${eventLabel}${anniv}\n` +
    `Пожелания пользователя к тексту: ${userWishes?.trim() || "нет"}\n\n` +
    `Напиши ${nWord} поздравления.`;

  return { system, user };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  let payload: Record<string, unknown>;
  try {
    payload = await req.json();
  } catch {
    return json({ error: "invalid_json" }, 400);
  }

  // Моковые сценарии для демонстрации обработки ошибок (без реального вызова Claude).
  if (payload._simulate === "timeout") {
    return json({
      error: "timeout",
      retriable: true,
      message: "Claude API не ответил вовремя. Попробуйте ещё раз.",
    });
  }
  if (payload._simulate === "rate_limit") {
    return json({
      error: "rate_limit",
      retriable: true,
      message: "Слишком много запросов к Claude API. Подождите немного и повторите.",
    });
  }

  if (!ANTHROPIC_API_KEY) {
    console.error("ANTHROPIC_API_KEY не задан в окружении функции");
    return json({ error: "server_misconfigured", message: "Ключ Claude API не настроен." }, 500);
  }

  const contactId = payload.contact_id as string;
  const eventType = (payload.event_type as string) ?? "birthday";
  const userWishes = (payload.user_wishes as string) ?? null;
  // Тренировка (раздел 5a): 1 вариант, source='training', привязка к сессии.
  const count = Math.min(3, Math.max(1, Number(payload.count) || 3));
  const source = ["user_initiated", "reminder_bot", "training"].includes(payload.source as string)
    ? (payload.source as string)
    : "user_initiated";
  const trainingSessionId = (payload.training_session_id as string) ?? null;
  if (!contactId) return json({ error: "bad_request", message: "Не указан contact_id" }, 400);

  const authHeader = req.headers.get("Authorization") ?? "";
  const db = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { data: userData } = await db.auth.getUser();
  const uid = userData.user?.id;
  if (!uid) return json({ error: "unauthorized" }, 401);

  // Контакт (RLS гарантирует, что он принадлежит пользователю).
  const { data: contact, error: cErr } = await db
    .from("pzd_contacts")
    .select("*")
    .eq("id", contactId)
    .maybeSingle();
  if (cErr) return json({ error: "db_error", message: cErr.message }, 500);
  if (!contact) return json({ error: "contact_not_found" }, 404);

  // Эталонные примеры (последние по времени) + счётчик обычных.
  const { data: refs } = await db
    .from("pzd_style_examples")
    .select("text")
    .eq("label", "reference")
    .order("created_at", { ascending: false })
    .limit(5);
  const referenceExamples = (refs ?? []).map((r) => r.text as string);

  const { count: okCount } = await db
    .from("pzd_style_examples")
    .select("id", { count: "exact", head: true })
    .eq("label", "ok");

  const { data: settings } = await db.from("pzd_style_settings").select("*").maybeSingle();

  // Групповые вектора пожеланий категорий контакта (раздел 6a).
  const { data: catLinks } = await db
    .from("pzd_contact_category_links")
    .select("pzd_contact_categories(wish_vector)")
    .eq("contact_id", contactId);
  const wishVectors = ((catLinks ?? []) as { pzd_contact_categories?: { wish_vector?: string } }[])
    .map((l) => l.pzd_contact_categories?.wish_vector?.trim())
    .filter((v): v is string => !!v);

  // Последние правки пользователя (сгенерировано → отправлено) как few-shot.
  const { data: gens } = await db
    .from("pzd_generations")
    .select("variants, final_text, final_variant_index")
    .not("final_text", "is", null)
    .order("created_at", { ascending: false })
    .limit(5);

  const editPairs: { before: string; after: string }[] = [];
  for (const g of gens ?? []) {
    const variants = (g.variants ?? []) as { text: string; feedback?: string }[];
    let base: string | null = null;
    if (g.final_variant_index != null && variants[g.final_variant_index as number]) {
      base = variants[g.final_variant_index as number].text;
    } else {
      base = variants.find((v) => v.feedback === "good")?.text ?? variants[0]?.text ?? null;
    }
    const finalText = g.final_text as string;
    if (base && finalText && base.trim() !== finalText.trim()) {
      editPairs.push({ before: base, after: finalText });
    }
    if (editPairs.length >= 3) break;
  }

  const { system, user } = buildPrompt(
    contact,
    settings,
    referenceExamples,
    okCount ?? 0,
    editPairs,
    wishVectors,
    eventType,
    userWishes,
    count,
  );

  // Предупреждение о нехватке данных (раздел 9 ТЗ).
  const warning = !(contact.context_notes as string)?.trim()
    ? "Мало данных о контакте — поздравление может получиться общим. Добавьте факты в карточку контакта."
    : null;

  // --- Вызов Claude API с таймаутом ---
  const schema = {
    type: "object",
    properties: {
      variants: {
        type: "array",
        items: { type: "string", description: "Текст одного варианта поздравления" },
      },
    },
    required: ["variants"],
    additionalProperties: false,
  };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  let resp: Response;
  try {
    resp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      signal: controller.signal,
      headers: {
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": ANTHROPIC_VERSION,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 2000,
        thinking: { type: "disabled" },
        system,
        messages: [{ role: "user", content: user }],
        output_config: { format: { type: "json_schema", schema } },
      }),
    });
  } catch (e) {
    clearTimeout(timer);
    // AbortError = таймаут; иначе — сетевая ошибка.
    const isTimeout = e instanceof Error && e.name === "AbortError";
    console.error("Ошибка запроса к Claude:", (e as Error).message);
    return json({
      error: isTimeout ? "timeout" : "network_error",
      retriable: true,
      message: isTimeout
        ? "Claude API не ответил вовремя. Попробуйте ещё раз."
        : "Не удалось связаться с Claude API. Попробуйте ещё раз.",
    });
  }
  clearTimeout(timer);

  if (resp.status === 429) {
    const retryAfter = resp.headers.get("retry-after");
    return json({
      error: "rate_limit",
      retriable: true,
      message: `Слишком много запросов к Claude API${retryAfter ? ` (повтор через ${retryAfter}с)` : ""}. Подождите немного и повторите.`,
    });
  }
  if (!resp.ok) {
    const text = await resp.text();
    console.error(`Claude API вернул ${resp.status}:`, text);
    return json({
      error: "api_error",
      retriable: resp.status >= 500,
      message: "Ошибка Claude API. Попробуйте ещё раз.",
    }, 200);
  }

  const data = await resp.json();
  if (data.stop_reason === "refusal") {
    return json({ error: "refusal", retriable: false, message: "Claude отклонил запрос." });
  }

  // Достаём JSON-текст из ответа.
  const textBlock = (data.content ?? []).find((b: { type: string }) => b.type === "text");
  let variants: string[] = [];
  try {
    const parsed = JSON.parse(textBlock?.text ?? "{}");
    variants = Array.isArray(parsed.variants) ? parsed.variants.slice(0, count) : [];
  } catch {
    console.error("Не удалось распарсить ответ Claude:", textBlock?.text);
  }
  if (variants.length === 0) {
    return json({ error: "empty_result", retriable: true, message: "Claude вернул пустой результат. Попробуйте ещё раз." });
  }

  // Сохраняем генерацию (под RLS, user_id = auth.uid()).
  const variantsJson = variants.map((text) => ({ text, feedback: null, bad_reason: null }));
  const { data: gen, error: gErr } = await db
    .from("pzd_generations")
    .insert({
      user_id: uid,
      contact_id: contactId,
      event_type: eventType,
      user_wishes: userWishes,
      variants: variantsJson,
      source,
      training_session_id: trainingSessionId,
    })
    .select("id")
    .single();
  if (gErr) {
    console.error("Ошибка сохранения генерации:", gErr.message);
    // Генерация удалась — отдаём её даже если запись не легла.
  }

  const result: Record<string, unknown> = { variants, warning, generation_id: gen?.id ?? null };
  if (payload._debug) result.debug_prompt = { system, user };
  return json(result);
});
