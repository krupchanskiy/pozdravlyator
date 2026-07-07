import { supabase } from "./supabase";
import type {
  Category,
  Contact,
  ContactInput,
  EventType,
  Profile,
  StyleExample,
  StyleLabel,
  StyleSettings,
  StyleSettingsInput,
  TrainingSession,
  TrainingSummary,
  UpcomingEvent,
  WishSuggestion,
} from "./types";

// --- Профиль пользователя ---

export async function getProfile(): Promise<Profile | null> {
  const { data, error } = await supabase
    .from("pzd_users")
    .select(
      "id, telegram_user_id, telegram_username, first_name, timezone, reminder_time, reminder_enabled, remind_mandatory_only",
    )
    .maybeSingle();
  if (error) throw error;
  return data;
}

export async function updateTimezone(timezone: string): Promise<void> {
  const { data: auth } = await supabase.auth.getUser();
  const uid = auth.user?.id;
  if (!uid) throw new Error("Нет сессии");
  const { error } = await supabase.from("pzd_users").update({ timezone }).eq("id", uid);
  if (error) throw error;
}

// Настройки напоминаний + часовой пояс (раздел 10).
export interface UserSettingsInput {
  timezone: string;
  reminder_time: string; // HH:MM
  reminder_enabled: boolean;
  remind_mandatory_only: boolean;
}

export async function updateUserSettings(input: UserSettingsInput): Promise<void> {
  const { data: auth } = await supabase.auth.getUser();
  const uid = auth.user?.id;
  if (!uid) throw new Error("Нет сессии");
  const { error } = await supabase.from("pzd_users").update(input).eq("id", uid);
  if (error) throw error;
}

// --- Категории ---

export async function listCategories(): Promise<Category[]> {
  const { data, error } = await supabase
    .from("pzd_contact_categories")
    .select("id, user_id, name, wish_vector")
    .order("name");
  if (error) throw error;
  return data ?? [];
}

export async function createCategory(name: string): Promise<Category> {
  const { data: auth } = await supabase.auth.getUser();
  const uid = auth.user?.id;
  if (!uid) throw new Error("Нет сессии");
  const { data, error } = await supabase
    .from("pzd_contact_categories")
    .insert({ user_id: uid, name })
    .select("id, user_id, name, wish_vector")
    .single();
  if (error) throw error;
  return data;
}

// Удаление категории: связи с контактами и предложения вектора уходят каскадом,
// сами контакты не трогаются.
export async function deleteCategory(id: string): Promise<void> {
  const { error } = await supabase.from("pzd_contact_categories").delete().eq("id", id);
  if (error) throw error;
}

// --- Групповой вектор пожеланий (раздел 6a) ---

export async function updateCategoryWishVector(categoryId: string, wishVector: string): Promise<void> {
  const { error } = await supabase
    .from("pzd_contact_categories")
    .update({ wish_vector: wishVector.trim() || null })
    .eq("id", categoryId);
  if (error) throw error;
}

export async function listWishSuggestions(): Promise<WishSuggestion[]> {
  const { data, error } = await supabase
    .from("pzd_wish_vector_suggestions")
    .select("id, category_id, suggested_text, status, created_at, pzd_contact_categories(name)")
    .eq("status", "pending")
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []).map((s) => ({
    id: s.id as string,
    category_id: s.category_id as string,
    category_name:
      (s.pzd_contact_categories as { name?: string } | null)?.name ?? "категория",
    suggested_text: s.suggested_text as string,
    status: s.status as WishSuggestion["status"],
    created_at: s.created_at as string,
  }));
}

// Принять / отредактировать-принять / отклонить предложение.
export async function resolveWishSuggestion(
  suggestion: WishSuggestion,
  action: "accept" | "edit" | "reject",
  editedText?: string,
): Promise<void> {
  const nowIso = new Date().toISOString();
  if (action === "reject") {
    const { error } = await supabase
      .from("pzd_wish_vector_suggestions")
      .update({ status: "rejected", resolved_at: nowIso })
      .eq("id", suggestion.id);
    if (error) throw error;
    return;
  }
  // accept / edit → обновляем вектор категории.
  const vector = action === "edit" ? (editedText ?? "").trim() : suggestion.suggested_text;
  const { error: catErr } = await supabase
    .from("pzd_contact_categories")
    .update({ wish_vector: vector })
    .eq("id", suggestion.category_id);
  if (catErr) throw catErr;
  const { error } = await supabase
    .from("pzd_wish_vector_suggestions")
    .update({ status: action === "edit" ? "edited" : "accepted", resolved_at: nowIso })
    .eq("id", suggestion.id);
  if (error) throw error;
}

export async function analyzeWishVectors(trainingSessionId?: string): Promise<number> {
  const { data, error } = await supabase.functions.invoke("wish-vector-analyze", {
    body: trainingSessionId ? { training_session_id: trainingSessionId } : {},
  });
  if (error) return 0;
  return (data?.created as number) ?? 0;
}

// --- Контакты ---

export interface ContactFilters {
  categoryIds?: string[]; // мультивыбор тегов, семантика ИЛИ
}

export async function listContacts(filters: ContactFilters = {}): Promise<Contact[]> {
  const { data, error } = await supabase.from("pzd_contacts").select("*").order("name");
  if (error) throw error;
  let contacts = (data ?? []) as Contact[];

  // Фильтр по тегам (ИЛИ: контакт попадает, если состоит хотя бы в одном) —
  // через таблицу связей.
  if (filters.categoryIds && filters.categoryIds.length > 0) {
    const { data: links, error: linkErr } = await supabase
      .from("pzd_contact_category_links")
      .select("contact_id")
      .in("category_id", filters.categoryIds);
    if (linkErr) throw linkErr;
    const allowed = new Set((links ?? []).map((l) => l.contact_id as string));
    contacts = contacts.filter((c) => allowed.has(c.id));
  }
  return contacts;
}

// Карта контакт → имена тегов (подписи в списке, группировка тренировки).
export async function listContactTags(): Promise<Map<string, string[]>> {
  const { data, error } = await supabase
    .from("pzd_contact_category_links")
    .select("contact_id, pzd_contact_categories(name)");
  if (error) throw error;
  const map = new Map<string, string[]>();
  const rows = (data ?? []) as unknown as { contact_id: string; pzd_contact_categories: { name: string } | null }[];
  for (const row of rows) {
    const name = row.pzd_contact_categories?.name;
    if (!name) continue;
    const arr = map.get(row.contact_id) ?? [];
    arr.push(name);
    map.set(row.contact_id, arr);
  }
  return map;
}

// Один контакт по id (для открытия карточки кликом по имени с любого экрана).
export async function getContact(id: string): Promise<Contact | null> {
  const { data, error } = await supabase.from("pzd_contacts").select("*").eq("id", id).maybeSingle();
  if (error) throw error;
  return data as Contact | null;
}

export async function getContactCategoryIds(contactId: string): Promise<string[]> {
  const { data, error } = await supabase
    .from("pzd_contact_category_links")
    .select("category_id")
    .eq("contact_id", contactId);
  if (error) throw error;
  return (data ?? []).map((l) => l.category_id as string);
}

export async function createContact(input: ContactInput, categoryIds: string[]): Promise<Contact> {
  const { data: auth } = await supabase.auth.getUser();
  const uid = auth.user?.id;
  if (!uid) throw new Error("Нет сессии");

  const { data, error } = await supabase
    .from("pzd_contacts")
    .insert({ ...normalize(input), user_id: uid, source: "manual" })
    .select("*")
    .single();
  if (error) throw error;
  await setContactCategories(data.id, categoryIds);
  return data as Contact;
}

export async function updateContact(
  id: string,
  input: ContactInput,
  categoryIds: string[],
): Promise<Contact> {
  const { data, error } = await supabase
    .from("pzd_contacts")
    .update(normalize(input))
    .eq("id", id)
    .select("*")
    .single();
  if (error) throw error;
  await setContactCategories(id, categoryIds);
  return data as Contact;
}

export async function deleteContact(id: string): Promise<void> {
  const { error } = await supabase.from("pzd_contacts").delete().eq("id", id);
  if (error) throw error;
}

// Пересобирает связи контакта с категориями (удаляет старые, вставляет новые).
async function setContactCategories(contactId: string, categoryIds: string[]): Promise<void> {
  const { error: delErr } = await supabase
    .from("pzd_contact_category_links")
    .delete()
    .eq("contact_id", contactId);
  if (delErr) throw delErr;
  if (categoryIds.length === 0) return;
  const rows = categoryIds.map((category_id) => ({ contact_id: contactId, category_id }));
  const { error: insErr } = await supabase.from("pzd_contact_category_links").insert(rows);
  if (insErr) throw insErr;
}

// Пустые строки → null (чтобы не писать "" в nullable-поля).
function normalize(input: ContactInput): ContactInput {
  const out = { ...input } as Record<string, unknown>;
  for (const k of Object.keys(out)) {
    if (out[k] === "") out[k] = null;
  }
  return out as ContactInput;
}

// --- Ближайшие события (/api/events/upcoming) ---

export async function getUpcomingEvents(daysAhead = 60): Promise<UpcomingEvent[]> {
  const { data, error } = await supabase.rpc("pzd_events_upcoming", { _days_ahead: daysAhead });
  if (error) throw error;
  return (data ?? []) as UpcomingEvent[];
}

// --- Примеры стиля (/api/style-examples) ---

export async function listStyleExamples(): Promise<StyleExample[]> {
  const { data, error } = await supabase
    .from("pzd_style_examples")
    .select("*")
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as StyleExample[];
}

export async function createStyleExample(
  text: string,
  label: StyleLabel,
  sourceNote: string | null,
): Promise<StyleExample> {
  const { data: auth } = await supabase.auth.getUser();
  const uid = auth.user?.id;
  if (!uid) throw new Error("Нет сессии");
  const { data, error } = await supabase
    .from("pzd_style_examples")
    .insert({ user_id: uid, text, label, source_note: sourceNote })
    .select("*")
    .single();
  if (error) throw error;
  return data as StyleExample;
}

export async function updateStyleExample(
  id: string,
  patch: Partial<Pick<StyleExample, "text" | "label" | "source_note">>,
): Promise<void> {
  const { error } = await supabase.from("pzd_style_examples").update(patch).eq("id", id);
  if (error) throw error;
}

export async function deleteStyleExample(id: string): Promise<void> {
  const { error } = await supabase.from("pzd_style_examples").delete().eq("id", id);
  if (error) throw error;
}

// --- Мини-опрос стиля (/api/style-settings) ---

export async function getStyleSettings(): Promise<StyleSettings | null> {
  const { data, error } = await supabase.from("pzd_style_settings").select("*").maybeSingle();
  if (error) throw error;
  return data as StyleSettings | null;
}

export async function saveStyleSettings(input: StyleSettingsInput): Promise<void> {
  const { data: auth } = await supabase.auth.getUser();
  const uid = auth.user?.id;
  if (!uid) throw new Error("Нет сессии");
  const { error } = await supabase
    .from("pzd_style_settings")
    .upsert({ user_id: uid, ...input }, { onConflict: "user_id" });
  if (error) throw error;
}

// --- Генерация поздравлений (/api/generate) ---

export type GenerateResult =
  | {
      ok: true;
      variants: string[];
      warning: string | null;
      generationId: string | null;
      suggestedFacts: string[]; // долговечные факты из пожеланий — предложить в карточку
    }
  | { ok: false; message: string; retriable: boolean };

export interface GenerateOptions {
  count?: number; // 1 для тренировки, 3 в боевом режиме
  source?: "user_initiated" | "training";
  trainingSessionId?: string | null;
}

export async function generateGreeting(
  contactId: string,
  eventType: EventType,
  userWishes: string | null,
  opts: GenerateOptions = {},
): Promise<GenerateResult> {
  const { data, error } = await supabase.functions.invoke("generate", {
    body: {
      contact_id: contactId,
      event_type: eventType,
      user_wishes: userWishes,
      count: opts.count,
      source: opts.source,
      training_session_id: opts.trainingSessionId ?? null,
    },
  });
  if (error) {
    // Платформенная/сетевая ошибка (не наш обработанный кейс).
    return { ok: false, message: "Не удалось связаться с сервером. Попробуйте ещё раз.", retriable: true };
  }
  if (data?.error) {
    return { ok: false, message: data.message ?? "Ошибка генерации", retriable: Boolean(data.retriable) };
  }
  return {
    ok: true,
    variants: data.variants,
    warning: data.warning,
    generationId: data.generation_id,
    suggestedFacts: Array.isArray(data.suggested_facts) ? data.suggested_facts : [],
  };
}

// Дозапись подтверждённого факта в заметки контакта (с новой строки).
export async function appendContactFact(contactId: string, fact: string): Promise<void> {
  const { data, error } = await supabase
    .from("pzd_contacts")
    .select("context_notes")
    .eq("id", contactId)
    .single();
  if (error) throw error;
  const cur = (data.context_notes as string | null)?.trim();
  const next = cur ? `${cur}\n${fact}` : fact;
  const { error: e2 } = await supabase
    .from("pzd_contacts")
    .update({ context_notes: next })
    .eq("id", contactId);
  if (e2) throw e2;
}

// POST /api/generate/:id/feedback — 👍/👎 + причина по конкретному варианту.
export async function submitFeedback(
  generationId: string,
  variantIndex: number,
  feedback: "good" | "bad",
  badReason: string | null,
): Promise<void> {
  const { data, error } = await supabase
    .from("pzd_generations")
    .select("variants")
    .eq("id", generationId)
    .single();
  if (error) throw error;
  const variants = (data.variants ?? []) as Record<string, unknown>[];
  if (variants[variantIndex]) {
    variants[variantIndex] = { ...variants[variantIndex], feedback, bad_reason: badReason };
  }
  const { error: e2 } = await supabase
    .from("pzd_generations")
    .update({ variants })
    .eq("id", generationId);
  if (e2) throw e2;
}

// История поздравлений по контакту (для карточки контакта, раздел 11).
export interface GenerationHistoryItem {
  id: string;
  event_type: EventType;
  variants: { text: string; feedback?: string | null; bad_reason?: string | null }[];
  final_text: string | null;
  final_variant_index: number | null;
  source: string;
  created_at: string;
}

// Показываем только генерации хотя бы с одним 👍-вариантом — оценка ставится
// уже после генерации, поэтому фильтруем на чтении (это же автоматически
// «не добавляет» неотмеченные и плохие в историю и для будущих генераций).
function hasGoodVariant(item: GenerationHistoryItem): boolean {
  return item.variants.some((v) => v.feedback === "good");
}

export async function listContactGenerations(contactId: string): Promise<GenerationHistoryItem[]> {
  const { data, error } = await supabase
    .from("pzd_generations")
    .select("id, event_type, variants, final_text, final_variant_index, source, created_at")
    .eq("contact_id", contactId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return ((data ?? []) as GenerationHistoryItem[]).filter(hasGoodVariant);
}

// POST /api/generate/:id/finalize — итоговый (отредактированный) текст.
export async function finalizeGeneration(
  generationId: string,
  variantIndex: number,
  finalText: string,
): Promise<void> {
  const { error } = await supabase
    .from("pzd_generations")
    .update({ final_text: finalText, final_variant_index: variantIndex })
    .eq("id", generationId);
  if (error) throw error;
}

// --- Импорт из Google Contacts (/api/contacts/import/google) ---

export async function googleImportInit(redirectUri: string): Promise<string> {
  const { data, error } = await supabase.functions.invoke("google-contacts-import", {
    body: { action: "init", redirect_uri: redirectUri },
  });
  if (error) throw new Error("Ошибка связи с сервером");
  if (data?.error) throw new Error(data.message ?? data.error);
  return data.auth_url as string;
}

export async function googleImportRun(
  code: string,
  redirectUri: string,
): Promise<{ imported: number } | { error: string }> {
  const { data, error } = await supabase.functions.invoke("google-contacts-import", {
    body: { action: "import", code, redirect_uri: redirectUri },
  });
  if (error) return { error: "Ошибка связи с сервером" };
  if (data?.error) return { error: data.message ?? data.error };
  return { imported: data.imported as number };
}

// --- Тренировка (раздел 5a) ---

export async function startTrainingSession(
  eventType: EventType,
  contactIds: string[],
): Promise<string> {
  const { data: auth } = await supabase.auth.getUser();
  const uid = auth.user?.id;
  if (!uid) throw new Error("Нет сессии");
  const { data, error } = await supabase
    .from("pzd_training_sessions")
    .insert({ user_id: uid, event_type: eventType, contact_ids: contactIds })
    .select("id")
    .single();
  if (error) throw error;
  return data.id as string;
}

// История завершённых тренировочных сессий (раздел 11).
export async function listTrainingSessions(): Promise<TrainingSession[]> {
  const { data, error } = await supabase
    .from("pzd_training_sessions")
    .select("*")
    .not("completed_at", "is", null)
    .order("completed_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as TrainingSession[];
}

export async function completeTrainingSession(sessionId: string): Promise<void> {
  const { error } = await supabase
    .from("pzd_training_sessions")
    .update({ completed_at: new Date().toISOString() })
    .eq("id", sessionId);
  if (error) throw error;
}

export async function getTrainingSummary(sessionId: string): Promise<TrainingSummary> {
  const { data, error } = await supabase
    .from("pzd_generations")
    .select("variants, final_text")
    .eq("training_session_id", sessionId);
  if (error) throw error;

  let good = 0;
  let bad = 0;
  let edited = 0;
  const reasonCounts = new Map<string, number>();

  for (const g of data ?? []) {
    const variants = (g.variants ?? []) as { text: string; feedback?: string; bad_reason?: string }[];
    const v = variants[0];
    if (v?.feedback === "good") good++;
    if (v?.feedback === "bad") {
      bad++;
      // Базовая причина — текст до двоеточия (без комментария).
      const base = (v.bad_reason ?? "").split(":")[0].trim();
      if (base) reasonCounts.set(base, (reasonCounts.get(base) ?? 0) + 1);
    }
    const finalText = g.final_text as string | null;
    if (finalText && v && finalText.trim() !== v.text.trim()) edited++;
  }

  const reasons = [...reasonCounts.entries()]
    .map(([reason, count]) => ({ reason, count }))
    .sort((a, b) => b.count - a.count);

  return { total: (data ?? []).length, good, bad, edited, reasons };
}
