import { supabase } from "./supabase";
import type { Category, Contact, ContactInput, Profile, UpcomingEvent } from "./types";

// --- Профиль пользователя ---

export async function getProfile(): Promise<Profile | null> {
  const { data, error } = await supabase
    .from("pzd_users")
    .select("id, telegram_user_id, telegram_username, first_name, timezone, reminder_time")
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

// --- Категории ---

export async function listCategories(): Promise<Category[]> {
  const { data, error } = await supabase
    .from("pzd_contact_categories")
    .select("id, user_id, name")
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
    .select("id, user_id, name")
    .single();
  if (error) throw error;
  return data;
}

// --- Контакты ---

export interface ContactFilters {
  categoryId?: string;
  relationshipType?: string;
}

export async function listContacts(filters: ContactFilters = {}): Promise<Contact[]> {
  let query = supabase.from("pzd_contacts").select("*").order("name");
  if (filters.relationshipType) query = query.eq("relationship_type", filters.relationshipType);

  const { data, error } = await query;
  if (error) throw error;
  let contacts = (data ?? []) as Contact[];

  // Фильтр по категории — через таблицу связей.
  if (filters.categoryId) {
    const { data: links, error: linkErr } = await supabase
      .from("pzd_contact_category_links")
      .select("contact_id")
      .eq("category_id", filters.categoryId);
    if (linkErr) throw linkErr;
    const allowed = new Set((links ?? []).map((l) => l.contact_id as string));
    contacts = contacts.filter((c) => allowed.has(c.id));
  }
  return contacts;
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
