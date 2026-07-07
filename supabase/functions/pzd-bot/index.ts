// Edge Function: pzd-bot
// Обработчик Telegram-обновлений Поздравлятора. Реагирует ТОЛЬКО на callback_data
// с префиксом "pzd:" — остальное не наше (роутинг общего бота — см. развилку с PanditJi).
//   pzd:gen:<contact_id>:<event_type>  — сгенерировать 3 варианта (source=reminder_bot)
//   pzd:fb:<gen_id>:<idx>:good|bad     — оценка варианта
//   pzd:cp:<gen_id>:<idx>              — «копировать» = сохранить как отправленный (finalize)
//
// Генерация переиспользует /api/generate (внутренний вызов с минтом сессии
// пользователя), а не дублирует логику.

import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const BOT_TOKEN = Deno.env.get("TELEGRAM_BOT_TOKEN")!;
const WEBHOOK_SECRET = Deno.env.get("PZD_WEBHOOK_SECRET") ?? "";
// Секрет и адрес вебхука PanditJi — для проброса «не наших» обновлений.
const PANDITJI_SECRET = Deno.env.get("TELEGRAM_WEBHOOK_SECRET") ?? "";
const PANDITJI_WEBHOOK_URL = `${SUPABASE_URL}/functions/v1/telegram-webhook`;
const SELF_WEBHOOK_URL = `${SUPABASE_URL}/functions/v1/pzd-bot`;
const ALLOWED_UPDATES = ["message", "edited_message", "callback_query"];
const TG_API = "https://api.telegram.org";
// Разбор свободного текста «добавь контакт» через Claude.
const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY") ?? "";
const CLAUDE_API = "https://api.anthropic.com/v1/messages";
const CLAUDE_MODEL = "claude-sonnet-5";
const ANTHROPIC_VERSION = "2023-06-01";
const APP_URL = "https://krupchanskiy.github.io/pozdravlyator/";
const MONTHS_RU = [
  "января", "февраля", "марта", "апреля", "мая", "июня",
  "июля", "августа", "сентября", "октября", "ноября", "декабря",
];

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
async function tg(method: string, payload: unknown): Promise<Response> {
  return await fetch(`${TG_API}/bot${BOT_TOKEN}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

// Минт короткой сессии пользователя (email не отправляется) — чтобы вызвать
// /api/generate под RLS этого пользователя, переиспользуя ту же логику.
async function mintToken(admin: ReturnType<typeof createClient>, email: string): Promise<string | null> {
  const { data: link } = await admin.auth.admin.generateLink({ type: "magiclink", email });
  const otp = link?.properties?.email_otp;
  if (!otp) return null;
  const anon = createClient(SUPABASE_URL, ANON_KEY, { auth: { persistSession: false } });
  const { data: v } = await anon.auth.verifyOtp({ email, token: otp, type: "email" });
  return v?.session?.access_token ?? null;
}

Deno.serve(async (req) => {
  const url = new URL(req.url);

  // --- Админ-действия по вебхуку (диспетчер общего бота) ---
  if (req.method === "GET") {
    if (!WEBHOOK_SECRET || url.searchParams.get("secret") !== WEBHOOK_SECRET) {
      return new Response("forbidden", { status: 401 });
    }
    const action = url.searchParams.get("action");
    if (action === "set_webhook") {
      // Направляем вебхук бота на этот диспетчер.
      const resp = await tg("setWebhook", {
        url: SELF_WEBHOOK_URL,
        secret_token: WEBHOOK_SECRET,
        allowed_updates: ALLOWED_UPDATES,
      });
      return new Response(await resp.text(), { status: resp.status });
    }
    if (action === "restore") {
      // Откат: вернуть вебхук на PanditJi с его секретом.
      const resp = await tg("setWebhook", {
        url: PANDITJI_WEBHOOK_URL,
        secret_token: PANDITJI_SECRET,
        allowed_updates: ALLOWED_UPDATES,
      });
      return new Response(await resp.text(), { status: resp.status });
    }
    const info = await fetch(`${TG_API}/bot${BOT_TOKEN}/getWebhookInfo`);
    return new Response(await info.text(), { status: info.status });
  }

  if (req.method !== "POST") return new Response("ok");
  // Проверка секрета вебхука.
  if (WEBHOOK_SECRET && req.headers.get("X-Telegram-Bot-Api-Secret-Token") !== WEBHOOK_SECRET) {
    return new Response("forbidden", { status: 401 });
  }

  const raw = await req.text();
  const update = JSON.parse(raw || "{}");
  const cq = update.callback_query;
  const msg = update.message;
  const cqData: string = cq?.data ?? "";

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // 1) Наш callback (pzd:) — генерация/оценка/удаление контакта.
  if (cq && cqData.startsWith("pzd:")) {
    // Идемпотентность: каждый callback обрабатываем один раз (медленный
    // обработчик провоцирует повторную доставку того же апдейта).
    const { data: dedup } = await admin
      .from("pzd_bot_callbacks")
      .upsert({ callback_id: cq.id, telegram_user_id: Number(cq.from.id) },
        { onConflict: "callback_id", ignoreDuplicates: true })
      .select("callback_id");
    if (!dedup || dedup.length === 0) {
      await tg("answerCallbackQuery", { callback_query_id: cq.id });
      return new Response("ok");
    }
    // Быстрый ACK: 200 сразу, работа — в фоне.
    EdgeRuntime.waitUntil(handleCallback(admin, cq, cqData));
    return new Response("ok");
  }

  // 2) Текстовое сообщение с ключевым словом («ДР», «День рождения»,
  //    «добавь/новый контакт») от ЗАРЕГИСТРИРОВАННОГО пользователя Поздравлятора
  //    → добавляем контакт. Сообщения чужих пользователей не трогаем — они уйдут
  //    в PanditJi (иначе сломали бы его для тех, кто Поздравлятором не пользуется).
  const text: string = (msg?.text ?? "").trim();
  if (msg && text && matchAddCommand(text)) {
    const { data: user } = await admin
      .from("pzd_users").select("id").eq("telegram_user_id", Number(msg.from.id)).maybeSingle();
    if (user) {
      const key = `msg:${msg.chat.id}:${msg.message_id}`;
      const { data: dedup } = await admin
        .from("pzd_bot_callbacks")
        .upsert({ callback_id: key, telegram_user_id: Number(msg.from.id) },
          { onConflict: "callback_id", ignoreDuplicates: true })
        .select("callback_id");
      if (!dedup || dedup.length === 0) return new Response("ok");
      EdgeRuntime.waitUntil(handleAddContact(admin, msg, text, user.id as string));
      return new Response("ok");
    }
  }

  // 3) Всё остальное — прозрачно в вебхук PanditJi (его секрет).
  try {
    await fetch(PANDITJI_WEBHOOK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Telegram-Bot-Api-Secret-Token": PANDITJI_SECRET },
      body: raw,
    });
  } catch (e) {
    console.error("Проброс в PanditJi не удался:", (e as Error).message);
  }
  return new Response("ok");
});

// Обработка нашего callback'а (в фоне после быстрого ACK).
async function handleCallback(
  admin: ReturnType<typeof createClient>,
  cq: Record<string, any>,
  data: string,
): Promise<void> {
  const tgUserId = Number(cq.from.id);
  const chatId = Number(cq.message?.chat?.id ?? tgUserId);
  const { data: user } = await admin
    .from("pzd_users")
    .select("id, telegram_user_id")
    .eq("telegram_user_id", tgUserId)
    .maybeSingle();
  if (!user) {
    await tg("answerCallbackQuery", { callback_query_id: cq.id, text: "Профиль не найден" });
    return;
  }
  const uid = user.id as string;
  const email = `tg${tgUserId}@pozdravlyator.telegram`;

  const parts = data.split(":"); // pzd:<action>:...
  const action = parts[1];

  if (action === "gen") {
    const contactId = parts[2];
    const eventType = parts[3];
    await tg("answerCallbackQuery", { callback_query_id: cq.id, text: "Генерирую…" });

    const token = await mintToken(admin, email);
    if (!token) {
      await tg("sendMessage", { chat_id: chatId, text: "Не удалось начать генерацию, попробуйте позже." });
      return;
    }
    // Переиспользуем /api/generate (та же логика), source=reminder_bot.
    const genResp = await fetch(`${SUPABASE_URL}/functions/v1/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ contact_id: contactId, event_type: eventType, count: 3, source: "reminder_bot" }),
    });
    const gen = await genResp.json();
    if (gen.error || !Array.isArray(gen.variants)) {
      await tg("sendMessage", { chat_id: chatId, text: `Ошибка генерации: ${gen.message ?? gen.error ?? "?"}` });
      return;
    }
    if (gen.warning) await tg("sendMessage", { chat_id: chatId, text: `⚠️ ${gen.warning}` });

    const genId = gen.generation_id;
    for (let i = 0; i < gen.variants.length; i++) {
      await tg("sendMessage", {
        chat_id: chatId,
        text: `<b>Вариант ${i + 1}</b>\n\n${esc(gen.variants[i])}`,
        parse_mode: "HTML",
        reply_markup: {
          inline_keyboard: [[
            { text: "👍", callback_data: `pzd:fb:${genId}:${i}:good` },
            { text: "👎", callback_data: `pzd:fb:${genId}:${i}:bad` },
            { text: "📋 Копировать", callback_data: `pzd:cp:${genId}:${i}` },
          ]],
        },
      });
    }
    return;
  }

  if (action === "fb") {
    const genId = parts[2], idx = Number(parts[3]), verdict = parts[4];
    const { data: g } = await admin
      .from("pzd_generations")
      .select("variants")
      .eq("id", genId)
      .eq("user_id", uid)
      .maybeSingle();
    if (g) {
      const variants = (g.variants ?? []) as Record<string, unknown>[];
      if (variants[idx]) variants[idx] = { ...variants[idx], feedback: verdict };
      await admin.from("pzd_generations").update({ variants }).eq("id", genId).eq("user_id", uid);
    }
    await tg("answerCallbackQuery", {
      callback_query_id: cq.id,
      text: verdict === "good" ? "👍 Спасибо!" : "👎 Учту",
    });
    return;
  }

  if (action === "cp") {
    const genId = parts[2], idx = Number(parts[3]);
    const { data: g } = await admin
      .from("pzd_generations")
      .select("variants")
      .eq("id", genId)
      .eq("user_id", uid)
      .maybeSingle();
    const variants = (g?.variants ?? []) as { text: string }[];
    if (variants[idx]) {
      await admin
        .from("pzd_generations")
        .update({ final_text: variants[idx].text, final_variant_index: idx })
        .eq("id", genId)
        .eq("user_id", uid);
    }
    await tg("answerCallbackQuery", {
      callback_query_id: cq.id,
      text: "Выделите текст варианта и скопируйте 📋",
      show_alert: true,
    });
    return;
  }

  // Отмена только что добавленного через текст контакта.
  if (action === "delc") {
    const contactId = parts[2];
    await admin.from("pzd_contacts").delete().eq("id", contactId).eq("user_id", uid);
    await tg("answerCallbackQuery", { callback_query_id: cq.id, text: "Контакт удалён" });
    if (cq.message) {
      await tg("editMessageText", {
        chat_id: chatId,
        message_id: cq.message.message_id,
        text: "❌ Контакт удалён.",
      });
    }
    return;
  }

  await tg("answerCallbackQuery", { callback_query_id: cq.id });
}

// --- Добавление контакта из свободного текста ---

// Ключевые слова-триггеры в начале сообщения (регистронезависимо, с границей,
// чтобы «др» не срабатывало на «друг»). Намеренно узкие и «про людей/ДР», чтобы
// не перехватывать сообщения к PanditJi (напр. про календарь).
const ADD_KEYWORDS = ["день рождения", "новый контакт", "добавь контакт", "добавить контакт", "др"];
function matchAddCommand(text: string): boolean {
  const lower = text.toLowerCase();
  for (const kw of ADD_KEYWORDS) {
    if (lower.startsWith(kw)) {
      const after = lower[kw.length];
      if (after === undefined || !/[a-zа-яё]/.test(after)) return true;
    }
  }
  return false;
}

interface ParsedContact {
  name: string | null;
  relationship_type: string | null;
  closeness: number | null;
  address_form: string | null;
  gender: string | null;
  context_notes: string | null;
  is_mandatory: boolean;
  birthday_month: number | null;
  birthday_day: number | null;
  birthday_year: number | null;
  anniversary_month: number | null;
  anniversary_day: number | null;
  anniversary_year: number | null;
  anniversary_label: string | null;
}

// Разбор свободного текста в структуру контакта через Claude.
// БЕЗ output_config json_schema: constrained-decoding с множеством опциональных
// nullable-полей у Claude патологически зависает. Просим чистый JSON текстом.
async function parseContact(text: string): Promise<ParsedContact | null> {
  if (!ANTHROPIC_API_KEY) return null;
  const system =
    "Ты извлекаешь данные о человеке из свободного русского текста для записной книжки " +
    "поздравлений. Верни ТОЛЬКО JSON-объект (без пояснений, без markdown) со СТРОГО такими ключами:\n" +
    "{\n" +
    '  "name": строка — имя человека (не сам пользователь),\n' +
    '  "relationship_type": строка|null — тип отношений (коллега, друг, родственник...),\n' +
    '  "closeness": целое 1..5|null — только если явно понятно,\n' +
    '  "address_form": "ты"|"вы"|null — только если явно понятно,\n' +
    '  "gender": "male"|"female"|null — только если явно сказано; по имени НЕ угадывай,\n' +
    '  "context_notes": строка|null — факты, интересы, привычки (без имени/даты/типа отношений),\n' +
    '  "is_mandatory": true|false — true только если явно отмечена важность,\n' +
    '  "birthday_month": целое 1..12|null, "birthday_day": целое 1..31|null, "birthday_year": целое|null,\n' +
    '  "anniversary_month": целое|null, "anniversary_day": целое|null, "anniversary_year": целое|null,\n' +
    '  "anniversary_label": строка|null — что за годовщина (свадьба, знакомство...)\n' +
    "}\n" +
    "«27 апреля» → birthday_month=4, birthday_day=27. Год только если явно указан. " +
    "Чего нет в тексте — ставь null.";
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 25_000);
  try {
    const resp = await fetch(CLAUDE_API, {
      method: "POST",
      signal: controller.signal,
      headers: {
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": ANTHROPIC_VERSION,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: CLAUDE_MODEL,
        max_tokens: 500,
        thinking: { type: "disabled" },
        system,
        messages: [{ role: "user", content: text }],
      }),
    });
    if (!resp.ok) {
      console.error("Claude parse вернул", resp.status, await resp.text());
      return null;
    }
    const data = await resp.json();
    const block = (data.content ?? []).find((b: { type: string }) => b.type === "text");
    const rawText = (block?.text ?? "") as string;
    const start = rawText.indexOf("{");
    const end = rawText.lastIndexOf("}");
    if (start < 0 || end <= start) return null;
    return JSON.parse(rawText.slice(start, end + 1)) as ParsedContact;
  } catch (e) {
    console.error("Ошибка разбора контакта:", (e as Error).message);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}
// Собирает YYYY-MM-DD; при отсутствии года — нейтральный 2000 (високосный,
// чтобы 29 февраля не терялось). День рождения отображается без года.
function buildDate(m: number | null, d: number | null, y: number | null): string | null {
  if (!m || !d) return null;
  return `${y ?? 2000}-${pad2(m)}-${pad2(d)}`;
}

async function handleAddContact(
  admin: ReturnType<typeof createClient>,
  msg: Record<string, any>,
  text: string,
  uid: string,
): Promise<void> {
  const chatId = Number(msg.chat.id);
  const parsed = await parseContact(text);
  if (!parsed || !parsed.name?.trim()) {
    await tg("sendMessage", {
      chat_id: chatId,
      text: "Не смог разобрать имя. Пример: «ДР Иван Иванов, 27 апреля, коллега, любит кактусы».",
    });
    return;
  }

  const birthday = buildDate(parsed.birthday_month, parsed.birthday_day, parsed.birthday_year);
  const anniversary = buildDate(parsed.anniversary_month, parsed.anniversary_day, parsed.anniversary_year);
  const closeness = parsed.closeness && parsed.closeness >= 1 && parsed.closeness <= 5 ? parsed.closeness : null;
  const addressForm = parsed.address_form === "ты" || parsed.address_form === "вы" ? parsed.address_form : null;
  const gender = parsed.gender === "male" || parsed.gender === "female" ? parsed.gender : null;

  const { data: inserted, error } = await admin
    .from("pzd_contacts")
    .insert({
      user_id: uid,
      name: parsed.name.trim(),
      relationship_type: parsed.relationship_type?.trim() || null,
      closeness,
      address_form: addressForm,
      gender,
      is_mandatory: !!parsed.is_mandatory,
      context_notes: parsed.context_notes?.trim() || null,
      birthday,
      anniversary_date: anniversary,
      anniversary_label: parsed.anniversary_label?.trim() || null,
      source: "telegram_bot",
    })
    .select("id")
    .single();
  if (error || !inserted) {
    await tg("sendMessage", { chat_id: chatId, text: `Не удалось сохранить: ${error?.message ?? "?"}` });
    return;
  }

  const lines = ["✅ Добавил контакт:", `<b>${esc(parsed.name.trim())}</b>`];
  if (birthday && parsed.birthday_month && parsed.birthday_day) {
    lines.push(
      `🎂 ${parsed.birthday_day} ${MONTHS_RU[parsed.birthday_month - 1]}` +
        (parsed.birthday_year ? ` ${parsed.birthday_year}` : ""),
    );
  }
  if (anniversary && parsed.anniversary_month && parsed.anniversary_day) {
    lines.push(
      `🎉 ${parsed.anniversary_label ? esc(parsed.anniversary_label) + ": " : ""}` +
        `${parsed.anniversary_day} ${MONTHS_RU[parsed.anniversary_month - 1]}`,
    );
  }
  const meta = [
    parsed.relationship_type?.trim() || null,
    closeness ? `близость ${closeness}/5` : null,
    addressForm ? `на «${addressForm}»` : null,
    parsed.is_mandatory ? "⭐ обязательный" : null,
  ].filter(Boolean).join(" • ");
  if (meta) lines.push(esc(meta));
  if (parsed.context_notes?.trim()) lines.push(`«${esc(parsed.context_notes.trim())}»`);
  lines.push(`\nИзменить можно в приложении: ${APP_URL}`);

  await tg("sendMessage", {
    chat_id: chatId,
    text: lines.join("\n"),
    parse_mode: "HTML",
    disable_web_page_preview: true,
    reply_markup: { inline_keyboard: [[{ text: "❌ Отменить", callback_data: `pzd:delc:${inserted.id}` }]] },
  });
}
