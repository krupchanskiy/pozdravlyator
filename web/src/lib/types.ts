export type AddressForm = "ты" | "вы";
export type Gender = "male" | "female";
export type ContactSource = "manual" | "google_contacts";

export interface Contact {
  id: string;
  user_id: string;
  name: string;
  gender: Gender | null;
  relationship_type: string | null;
  closeness: number | null;
  address_form: AddressForm | null;
  is_mandatory: boolean;
  context_notes: string | null;
  birthday: string | null;          // YYYY-MM-DD
  anniversary_date: string | null;  // YYYY-MM-DD
  anniversary_label: string | null;
  telegram_username: string | null;
  source: ContactSource;
  created_at: string;
}

// Поля, которые пользователь редактирует в форме.
export type ContactInput = Omit<Contact, "id" | "user_id" | "source" | "created_at">;

export interface Category {
  id: string;
  user_id: string;
  name: string;
}

export type EventType = "birthday" | "new_year" | "mar8" | "feb23" | "anniversary";

export interface UpcomingEvent {
  contact_id: string;
  name: string;
  is_mandatory: boolean;
  relationship_type: string | null;
  address_form: AddressForm | null;
  closeness: number | null;
  telegram_username: string | null;
  context_notes: string | null;
  event_type: EventType;
  source_date: string;
  next_date: string;
  days_until: number;
}

export interface Profile {
  id: string;
  telegram_user_id: number;
  telegram_username: string | null;
  first_name: string | null;
  timezone: string | null;
  reminder_time: string;
}

// Стандартные типы отношений (relationship_type — свободный текст, это лишь подсказки).
export const RELATIONSHIP_TYPES = [
  "друг",
  "коллега",
  "клиент",
  "родственник",
  "знакомый",
] as const;
