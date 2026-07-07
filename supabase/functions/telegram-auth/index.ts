// Edge Function: telegram-auth
// Принимает данные Telegram Login Widget, проверяет HMAC-подпись бота,
// заводит/находит auth-пользователя и приложенческую строку pzd_users,
// возвращает клиенту сессию Supabase (access_token + refresh_token).
//
// Секреты — только из окружения:
//   TELEGRAM_BOT_TOKEN            — токен @panditjiji_bot (задаётся через `supabase secrets set`)
//   SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY / SUPABASE_ANON_KEY — инжектятся платформой.

import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const BOT_TOKEN = Deno.env.get("TELEGRAM_BOT_TOKEN") ?? "";

// Данные виджета старше суток считаем протухшими.
const MAX_AUTH_AGE_SECONDS = 86_400;

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

// Константное по времени сравнение hex-строк.
function timingSafeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function toHex(buf: ArrayBuffer): string {
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// Проверка подписи Telegram Login Widget:
// secret_key = SHA256(bot_token); hash = HMAC_SHA256(data_check_string, secret_key)
async function verifyTelegramAuth(
  data: Record<string, string>,
  botToken: string,
): Promise<boolean> {
  const { hash, ...fields } = data;
  if (!hash) return false;

  const dataCheckString = Object.keys(fields)
    .sort()
    .map((k) => `${k}=${fields[k]}`)
    .join("\n");

  const enc = new TextEncoder();
  const secretKey = await crypto.subtle.digest("SHA-256", enc.encode(botToken));
  const key = await crypto.subtle.importKey(
    "raw",
    secretKey,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(dataCheckString));
  return timingSafeEqualHex(toHex(sig), hash.toLowerCase());
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  if (!BOT_TOKEN) {
    console.error("TELEGRAM_BOT_TOKEN не задан в окружении функции");
    return json({ error: "server_misconfigured" }, 500);
  }

  let payload: Record<string, unknown>;
  try {
    payload = await req.json();
  } catch {
    return json({ error: "invalid_json" }, 400);
  }

  // Виджет присылает поля строками; нормализуем в строки для проверки подписи.
  const data: Record<string, string> = {};
  for (const [k, v] of Object.entries(payload)) {
    if (v === null || v === undefined) continue;
    data[k] = String(v);
  }

  const ok = await verifyTelegramAuth(data, BOT_TOKEN);
  if (!ok) return json({ error: "bad_signature" }, 401);

  const authDate = Number(data.auth_date ?? 0);
  const nowSec = Math.floor(Date.now() / 1000);
  if (!authDate || nowSec - authDate > MAX_AUTH_AGE_SECONDS) {
    return json({ error: "auth_expired" }, 401);
  }

  const telegramUserId = Number(data.id);
  if (!Number.isFinite(telegramUserId)) return json({ error: "bad_telegram_id" }, 400);

  const telegramUsername = data.username ?? null;
  const firstName = data.first_name ?? null;
  // Детерминированный технический email для auth-пользователя (реально не используется).
  const email = `tg${telegramUserId}@pozdravlyator.telegram`;

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // 1. Ищем существующего пользователя по telegram_user_id (service role обходит RLS).
  let userId: string | null = null;
  const { data: existing, error: findErr } = await admin
    .from("pzd_users")
    .select("id")
    .eq("telegram_user_id", telegramUserId)
    .maybeSingle();

  if (findErr) {
    console.error("Ошибка поиска pzd_users:", findErr.message);
    return json({ error: "db_error" }, 500);
  }

  if (existing) {
    userId = existing.id;
    // Освежаем username/first_name на случай изменений.
    await admin
      .from("pzd_users")
      .update({ telegram_username: telegramUsername, first_name: firstName })
      .eq("id", userId);
  } else {
    // 2. Создаём auth-пользователя.
    const { data: created, error: createErr } = await admin.auth.admin.createUser({
      email,
      email_confirm: true,
      user_metadata: {
        provider: "telegram",
        telegram_user_id: telegramUserId,
        telegram_username: telegramUsername,
        first_name: firstName,
      },
    });
    if (createErr || !created?.user) {
      console.error("Ошибка createUser:", createErr?.message);
      return json({ error: "auth_create_failed" }, 500);
    }
    userId = created.user.id;

    // 3. Приложенческая строка pzd_users (timezone заполнится в онбординге).
    const { error: insErr } = await admin.from("pzd_users").insert({
      id: userId,
      telegram_user_id: telegramUserId,
      telegram_username: telegramUsername,
      first_name: firstName,
    });
    if (insErr) {
      console.error("Ошибка insert pzd_users:", insErr.message);
      return json({ error: "db_error" }, 500);
    }
  }

  // 4. Выпускаем сессию Supabase через одноразовый OTP (email не отправляется).
  const { data: linkData, error: linkErr } = await admin.auth.admin.generateLink({
    type: "magiclink",
    email,
  });
  if (linkErr || !linkData?.properties?.email_otp) {
    console.error("Ошибка generateLink:", linkErr?.message);
    return json({ error: "session_failed" }, 500);
  }

  const anon = createClient(SUPABASE_URL, ANON_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data: verified, error: verifyErr } = await anon.auth.verifyOtp({
    email,
    token: linkData.properties.email_otp,
    type: "email",
  });
  if (verifyErr || !verified?.session) {
    console.error("Ошибка verifyOtp:", verifyErr?.message);
    return json({ error: "session_failed" }, 500);
  }

  return json({
    access_token: verified.session.access_token,
    refresh_token: verified.session.refresh_token,
    user: { id: userId, first_name: firstName, telegram_username: telegramUsername },
  });
});
