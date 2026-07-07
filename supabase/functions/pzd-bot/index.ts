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
  const data: string = cq?.data ?? "";
  // Не наше обновление — прозрачно проксируем в вебхук PanditJi (его секрет).
  if (!cq || !data.startsWith("pzd:")) {
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
  }

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // Идемпотентность: обрабатываем каждый callback ровно один раз. Медленный
  // обработчик (генерация ~13с) провоцирует повторную доставку того же апдейта.
  const { data: dedup } = await admin
    .from("pzd_bot_callbacks")
    .upsert(
      { callback_id: cq.id, telegram_user_id: Number(cq.from.id) },
      { onConflict: "callback_id", ignoreDuplicates: true },
    )
    .select("callback_id");
  if (!dedup || dedup.length === 0) {
    // Дубликат доставки — просто закрываем «часики» и выходим.
    await tg("answerCallbackQuery", { callback_query_id: cq.id });
    return new Response("ok");
  }

  // Быстрый ACK: отвечаем 200 сразу, тяжёлую работу выполняем в фоне, чтобы
  // webhook не считался «медленным» и не ретраился.
  EdgeRuntime.waitUntil(handleCallback(admin, cq, data));
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

  await tg("answerCallbackQuery", { callback_query_id: cq.id });
}
