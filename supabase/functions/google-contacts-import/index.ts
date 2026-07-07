// Edge Function: google-contacts-import
// Импорт контактов из Google People API (раздел 8 ТЗ).
// verify_jwt=true — работает от имени залогиненного пользователя, вставка под RLS.
//
// Действия (body.action):
//   'init'   → возвращает URL Google OAuth (scope contacts.readonly).
//   'import' → { code, redirect_uri }: обмен кода на токен, запрос People API,
//              парсинг, вставка контактов с source='google_contacts'.
//              Дубли НЕ сливаются (по ТЗ — ручной процесс): просто вставляем новые строки.
//   'import' + { _mock_connections } → тестовый прогон парсинга/вставки без Google.
//
// Секреты — только из окружения: GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET
// (уже заданы в проекте), SUPABASE_URL / SUPABASE_ANON_KEY.

import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const GOOGLE_CLIENT_ID = Deno.env.get("GOOGLE_CLIENT_ID") ?? "";
const GOOGLE_CLIENT_SECRET = Deno.env.get("GOOGLE_CLIENT_SECRET") ?? "";

const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const PEOPLE_URL =
  "https://people.googleapis.com/v1/people/me/connections?personFields=names,birthdays,genders&pageSize=1000";
const SCOPE = "https://www.googleapis.com/auth/contacts.readonly";

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

// --- Тип части ответа People API ---
interface Person {
  names?: { displayName?: string }[];
  birthdays?: { date?: { year?: number; month?: number; day?: number } }[];
  genders?: { value?: string }[];
}

interface ContactRow {
  name: string;
  birthday: string | null;
  gender: string | null;
  source: "google_contacts";
}

// Чистый парсер: People API connections → строки контактов.
// Импортируем только тех, у кого есть дата рождения (раздел 8 ТЗ).
export function peopleToContacts(connections: Person[]): ContactRow[] {
  const rows: ContactRow[] = [];
  for (const p of connections ?? []) {
    const name = p.names?.[0]?.displayName?.trim();
    if (!name) continue;

    const bd = p.birthdays?.find((b) => b.date?.month && b.date?.day)?.date;
    if (!bd) continue; // без даты рождения не импортируем

    const year = bd.year ?? 2000; // People API часто без года; для событий важны месяц/день
    const birthday = `${String(year).padStart(4, "0")}-${String(bd.month).padStart(2, "0")}-${String(bd.day).padStart(2, "0")}`;

    const gRaw = p.genders?.[0]?.value;
    const gender = gRaw === "male" || gRaw === "female" ? gRaw : null;

    rows.push({ name, birthday, gender, source: "google_contacts" });
  }
  return rows;
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

  const authHeader = req.headers.get("Authorization") ?? "";
  const db = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data: userData } = await db.auth.getUser();
  const uid = userData.user?.id;
  if (!uid) return json({ error: "unauthorized" }, 401);

  const action = payload.action as string;

  // --- init: URL для перехода в Google OAuth ---
  if (action === "init") {
    if (!GOOGLE_CLIENT_ID) return json({ error: "google_not_configured" }, 500);
    const redirectUri = payload.redirect_uri as string;
    if (!redirectUri) return json({ error: "bad_request", message: "Нет redirect_uri" }, 400);
    const url = new URL(GOOGLE_AUTH_URL);
    url.searchParams.set("client_id", GOOGLE_CLIENT_ID);
    url.searchParams.set("redirect_uri", redirectUri);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("scope", SCOPE);
    url.searchParams.set("access_type", "online");
    url.searchParams.set("prompt", "consent");
    url.searchParams.set("state", uid);
    return json({ auth_url: url.toString() });
  }

  // --- import: получить контакты и вставить ---
  if (action === "import") {
    let connections: Person[];

    // Тестовый сид (детерминированная демонстрация парсинга/вставки).
    if (Array.isArray(payload._mock_connections)) {
      connections = payload._mock_connections as Person[];
    } else {
      // Боевой путь: обмен кода на токен + запрос People API.
      const code = payload.code as string;
      const redirectUri = payload.redirect_uri as string;
      if (!code || !redirectUri) {
        return json({ error: "bad_request", message: "Нет code/redirect_uri" }, 400);
      }
      if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET) {
        return json({ error: "google_not_configured" }, 500);
      }

      const tokenResp = await fetch(GOOGLE_TOKEN_URL, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "authorization_code",
          code,
          client_id: GOOGLE_CLIENT_ID,
          client_secret: GOOGLE_CLIENT_SECRET,
          redirect_uri: redirectUri,
        }),
      });
      if (!tokenResp.ok) {
        const text = await tokenResp.text();
        console.error("Google token exchange failed:", tokenResp.status, text);
        return json({ error: "token_exchange_failed", message: "Не удалось обменять код Google." }, 200);
      }
      const tokens = (await tokenResp.json()) as { access_token: string };

      const peopleResp = await fetch(PEOPLE_URL, {
        headers: { Authorization: `Bearer ${tokens.access_token}` },
      });
      if (!peopleResp.ok) {
        const text = await peopleResp.text();
        console.error("People API failed:", peopleResp.status, text);
        return json({ error: "people_api_failed", message: "Не удалось получить контакты из Google." }, 200);
      }
      const peopleData = (await peopleResp.json()) as { connections?: Person[] };
      connections = peopleData.connections ?? [];
    }

    const rows = peopleToContacts(connections);
    if (rows.length === 0) return json({ imported: 0, message: "Контактов с датой рождения не найдено." });

    // Вставляем БЕЗ слияния с существующими (дубли по имени решает пользователь вручную).
    const toInsert = rows.map((r) => ({ ...r, user_id: uid }));
    const { data: inserted, error } = await db.from("pzd_contacts").insert(toInsert).select("id");
    if (error) {
      console.error("Ошибка вставки контактов:", error.message);
      return json({ error: "db_error", message: error.message }, 500);
    }
    return json({ imported: inserted?.length ?? 0 });
  }

  return json({ error: "bad_action" }, 400);
});
