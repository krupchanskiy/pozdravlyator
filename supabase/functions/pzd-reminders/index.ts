// Edge Function: pzd-reminders
// Рассылает напоминания о сегодняшних событиях (раздел 10 ТЗ) по часовому поясу
// пользователя: основное в reminder_time, повтор в 19:00 если не было реакции
// (максимум 1). Вызывается по крону; для тестов принимает флаги в теле.
//
// Отправляет через Bot API @panditjiji_bot (только sendMessage — с webhook
// PanditJi не конфликтует). chat_id приватного чата == telegram_user_id.

import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const BOT_TOKEN = Deno.env.get("TELEGRAM_BOT_TOKEN")!;
const CRON_SECRET = Deno.env.get("PZD_CRON_SECRET") ?? "";
const TG_API = "https://api.telegram.org";
const FOLLOWUP_HOUR = 19; // повтор в 19:00 локального времени

function isLeap(y: number): boolean {
  return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
}
function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// Локальные дата/время пользователя.
function localParts(tz: string): { date: string; year: number; month: number; day: number; minutes: number } {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hour12: false,
  });
  const p: Record<string, string> = {};
  for (const part of fmt.formatToParts(new Date())) p[part.type] = part.value;
  const year = Number(p.year), month = Number(p.month), day = Number(p.day);
  let hour = Number(p.hour);
  if (hour === 24) hour = 0;
  return { date: `${p.year}-${p.month}-${p.day}`, year, month, day, minutes: hour * 60 + Number(p.minute) };
}

const EVENT_HEADER: Record<string, string> = {
  birthday: "🎂 Сегодня день рождения",
  anniversary: "🎉 Сегодня годовщина",
};

async function sendReminder(
  chatId: number,
  contact: Record<string, unknown>,
  eventType: string,
  isFollowup: boolean,
): Promise<boolean> {
  const rel = (contact.relationship_type as string) || "";
  const closeness = contact.closeness ? `Близость: ${contact.closeness}/5` : "";
  const mandatory = contact.is_mandatory ? "⭐ Обязательный" : "";
  const meta = [rel, closeness, mandatory].filter(Boolean).join(" • ");
  const uname = contact.telegram_username ? ` (@${esc(contact.telegram_username as string)})` : "";
  const addr = contact.address_form ? `Обращение: на «${contact.address_form}»\n` : "";
  const notes = (contact.context_notes as string)?.trim();

  const anniv = eventType === "anniversary" && contact.anniversary_label
    ? ` — ${esc(contact.anniversary_label as string)}`
    : "";

  const text =
    `${isFollowup ? "🔔 Напоминаю: " : ""}${EVENT_HEADER[eventType] ?? "Сегодня событие"}${anniv}\n\n` +
    `<b>${esc(contact.name as string)}</b>${uname}\n` +
    (meta ? `${meta}\n` : "") +
    addr +
    (notes ? `\n«${esc(notes)}»` : "");

  const resp = await fetch(`${TG_API}/bot${BOT_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      parse_mode: "HTML",
      reply_markup: {
        inline_keyboard: [[
          { text: "🎁 Сгенерировать поздравление", callback_data: `pzd:gen:${contact.id}:${eventType}` },
        ]],
      },
    }),
  });
  if (!resp.ok) console.error("sendMessage failed:", resp.status, await resp.text());
  return resp.ok;
}

Deno.serve(async (req) => {
  const db = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // Защита крон-эндпоинта: заголовок x-cron-secret должен совпасть либо с env,
  // либо с секретом из Vault (которым пользуется крон).
  const header = req.headers.get("x-cron-secret") ?? "";
  const { data: vaultSecret } = await db.rpc("pzd_cron_secret_get");
  const allowed = [CRON_SECRET, vaultSecret as string | null].filter(Boolean);
  if (allowed.length && !allowed.includes(header)) {
    return new Response("forbidden", { status: 401 });
  }

  const body: Record<string, unknown> = req.method === "POST" ? await req.json().catch(() => ({})) : {};
  const onlyUser = body.only_user_id as string | undefined;
  const ignoreTime = !!body.ignore_time;
  const ignoreDedup = !!body.ignore_dedup;

  let q = db.from("pzd_users")
    .select("id, telegram_user_id, timezone, reminder_time, reminder_enabled, remind_mandatory_only")
    .eq("reminder_enabled", true);
  if (onlyUser) q = q.eq("id", onlyUser);
  const { data: users } = await q;

  let sent = 0, followups = 0;

  for (const u of users ?? []) {
    const tz = (u.timezone as string) || "UTC";
    const lp = localParts(tz);
    const [rh, rm] = ((u.reminder_time as string) || "09:00").split(":").map(Number);
    const reminderMinutes = rh * 60 + rm;

    const reminderDue = ignoreTime || (lp.minutes >= reminderMinutes && lp.minutes < FOLLOWUP_HOUR * 60);
    const followupDue = ignoreTime ? body.force_pass === "followup" : lp.minutes >= FOLLOWUP_HOUR * 60;

    // Сегодняшние события пользователя.
    const { data: contacts } = await db
      .from("pzd_contacts")
      .select("*")
      .eq("user_id", u.id)
      .or("birthday.not.is.null,anniversary_date.not.is.null");

    const feb28NonLeap = lp.month === 2 && lp.day === 28 && !isLeap(lp.year);
    const events: { contact: Record<string, unknown>; eventType: string }[] = [];
    for (const c of contacts ?? []) {
      if (u.remind_mandatory_only && !c.is_mandatory) continue;
      const check = (dateStr: string | null, type: string) => {
        if (!dateStr) return;
        const [, mm, dd] = dateStr.split("-").map(Number);
        if ((mm === lp.month && dd === lp.day) || (feb28NonLeap && mm === 2 && dd === 29)) {
          events.push({ contact: c, eventType: type });
        }
      };
      check(c.birthday as string | null, "birthday");
      check(c.anniversary_date as string | null, "anniversary");
    }
    if (events.length === 0) continue;

    const chatId = Number(u.telegram_user_id);

    for (const { contact, eventType } of events) {
      // Уже отправленные сегодня записи по этому контакту.
      const { data: logs } = await db
        .from("pzd_reminders_log")
        .select("is_followup")
        .eq("user_id", u.id)
        .eq("contact_id", contact.id)
        .eq("event_date", lp.date);
      const sentMain = (logs ?? []).some((l) => l.is_followup === false);
      const sentFollow = (logs ?? []).some((l) => l.is_followup === true);

      if (body.force_pass !== "followup" && reminderDue && (ignoreDedup || !sentMain)) {
        if (await sendReminder(chatId, contact, eventType, false)) {
          await db.from("pzd_reminders_log").insert({
            user_id: u.id, contact_id: contact.id, event_date: lp.date, is_followup: false,
          });
          sent++;
        }
      } else if (followupDue && sentMain && !sentFollow) {
        // Реакция = была генерация reminder_bot по этому контакту сегодня.
        const { count: reacted } = await db
          .from("pzd_generations")
          .select("id", { count: "exact", head: true })
          .eq("user_id", u.id)
          .eq("contact_id", contact.id)
          .eq("source", "reminder_bot")
          .gte("created_at", `${lp.date}T00:00:00`);
        if (!reacted && await sendReminder(chatId, contact, eventType, true)) {
          await db.from("pzd_reminders_log").insert({
            user_id: u.id, contact_id: contact.id, event_date: lp.date, is_followup: true,
          });
          followups++;
        }
      }
    }
  }

  return new Response(JSON.stringify({ sent, followups }), {
    headers: { "Content-Type": "application/json" },
  });
});
