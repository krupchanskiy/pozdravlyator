// Edge Function: wish-vector-analyze
// Анализирует одобренные/отредактированные поздравления по контактам категории
// и, если есть повторяющаяся тема пожелания, создаёт предложение к вектору
// категории (pzd_wish_vector_suggestions, status='pending'). Раздел 6a ТЗ.
//
// Точки запуска: конец тренировочной сессии (body.training_session_id)
// или ручная кнопка «Проверить предложения» (без сессии — вся история).
// verify_jwt=true, данные под RLS.

import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY") ?? "";
const MODEL = "claude-sonnet-5";
const MIN_TEXTS = 2; // минимум одобренных текстов в категории, чтобы искать тему

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

// Анализ текстов через Claude → { has_theme, suggested_text }.
async function analyzeTexts(categoryName: string, texts: string[]): Promise<{ has_theme: boolean; suggested_text: string }> {
  const schema = {
    type: "object",
    properties: {
      has_theme: { type: "boolean" },
      suggested_text: { type: "string" },
    },
    required: ["has_theme", "suggested_text"],
    additionalProperties: false,
  };
  const system =
    `Ты анализируешь поздравления, которые пользователь одобрил или реально отправил контактам группы «${categoryName}».\n` +
    "Найди общую повторяющуюся тему пожелания, специфичную именно для этой группы " +
    "(НЕ банальную «здоровья и счастья»). Верни:\n" +
    "- has_theme: true, если есть явная повторяющаяся тема, иначе false.\n" +
    "- suggested_text: короткое пожелание-дополнение к вектору группы (напр. «милости духовного учителя, вдохновения в практике»). " +
    "Если темы нет — пустая строка.";
  const user = "Тексты поздравлений:\n" + texts.map((t, i) => `${i + 1}. «${t}»`).join("\n");

  const resp = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 500,
      thinking: { type: "disabled" },
      system,
      messages: [{ role: "user", content: user }],
      output_config: { format: { type: "json_schema", schema } },
    }),
  });
  if (!resp.ok) {
    console.error("Claude analyze failed:", resp.status, await resp.text());
    return { has_theme: false, suggested_text: "" };
  }
  const data = await resp.json();
  const block = (data.content ?? []).find((b: { type: string }) => b.type === "text");
  try {
    const parsed = JSON.parse(block?.text ?? "{}");
    return { has_theme: !!parsed.has_theme, suggested_text: String(parsed.suggested_text ?? "").trim() };
  } catch {
    return { has_theme: false, suggested_text: "" };
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  if (!ANTHROPIC_API_KEY) return json({ error: "server_misconfigured" }, 500);

  let payload: Record<string, unknown> = {};
  try {
    payload = await req.json();
  } catch { /* тело необязательно */ }
  const trainingSessionId = (payload.training_session_id as string) ?? null;

  const authHeader = req.headers.get("Authorization") ?? "";
  const db = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data: userData } = await db.auth.getUser();
  const uid = userData.user?.id;
  if (!uid) return json({ error: "unauthorized" }, 401);

  // Категории-кандидаты: из контактов сессии (если задана) либо все категории пользователя.
  let categories: { id: string; name: string }[] = [];
  if (trainingSessionId) {
    const { data: ts } = await db
      .from("pzd_training_sessions")
      .select("contact_ids")
      .eq("id", trainingSessionId)
      .maybeSingle();
    const contactIds = (ts?.contact_ids ?? []) as string[];
    if (contactIds.length) {
      const { data: links } = await db
        .from("pzd_contact_category_links")
        .select("category_id, pzd_contact_categories(id, name)")
        .in("contact_id", contactIds);
      const seen = new Set<string>();
      for (const l of (links ?? []) as { pzd_contact_categories?: { id: string; name: string } }[]) {
        const c = l.pzd_contact_categories;
        if (c && !seen.has(c.id)) {
          seen.add(c.id);
          categories.push(c);
        }
      }
    }
  } else {
    const { data: cats } = await db.from("pzd_contact_categories").select("id, name");
    categories = (cats ?? []) as { id: string; name: string }[];
  }

  const created: { category_id: string; suggested_text: string }[] = [];

  for (const cat of categories) {
    // Уже есть висящее предложение по категории — не дублируем.
    const { data: pend } = await db
      .from("pzd_wish_vector_suggestions")
      .select("id")
      .eq("category_id", cat.id)
      .eq("status", "pending")
      .limit(1);
    if (pend && pend.length) continue;

    // Контакты категории.
    const { data: links } = await db
      .from("pzd_contact_category_links")
      .select("contact_id")
      .eq("category_id", cat.id);
    const contactIds = (links ?? []).map((l) => l.contact_id as string);
    if (contactIds.length === 0) continue;

    // Одобренные/отправленные тексты по этим контактам.
    const { data: gens } = await db
      .from("pzd_generations")
      .select("variants, final_text")
      .in("contact_id", contactIds);
    const texts: string[] = [];
    for (const g of gens ?? []) {
      const finalText = g.final_text as string | null;
      if (finalText) {
        texts.push(finalText);
        continue;
      }
      const variants = (g.variants ?? []) as { text: string; feedback?: string }[];
      const good = variants.find((v) => v.feedback === "good");
      if (good) texts.push(good.text);
    }
    if (texts.length < MIN_TEXTS) continue;

    const { has_theme, suggested_text } = await analyzeTexts(cat.name, texts);
    if (!has_theme || !suggested_text) continue;

    const { error: insErr } = await db.from("pzd_wish_vector_suggestions").insert({
      category_id: cat.id,
      suggested_text,
      source_training_session_id: trainingSessionId,
      status: "pending",
    });
    if (insErr) {
      console.error("Ошибка вставки предложения:", insErr.message);
      continue;
    }
    created.push({ category_id: cat.id, suggested_text });
  }

  return json({ created: created.length, suggestions: created });
});
