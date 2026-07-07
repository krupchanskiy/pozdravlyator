export type AddressForm = "ты" | "вы";
export type Gender = "male" | "female";
export type ContactSource = "manual" | "google_contacts" | "telegram_bot";

export interface Contact {
  id: string;
  user_id: string;
  name: string;
  call_name: string | null; // как называть в тексте («Саша»), независимо от «ты/вы»
  gender: Gender | null;
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
  wish_vector: string | null;
}

export type WishSuggestionStatus = "pending" | "accepted" | "edited" | "rejected";

export interface WishSuggestion {
  id: string;
  category_id: string;
  category_name: string;
  suggested_text: string;
  status: WishSuggestionStatus;
  created_at: string;
}

export type EventType = "birthday" | "new_year" | "mar8" | "feb23" | "anniversary";

export interface UpcomingEvent {
  contact_id: string;
  name: string;
  is_mandatory: boolean;
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
  reminder_enabled: boolean;
  remind_mandatory_only: boolean;
}

// --- Стиль ---

export type StyleLabel = "reference" | "ok" | "skip";

export interface StyleExample {
  id: string;
  user_id: string;
  text: string;
  label: StyleLabel;
  source_note: string | null;
  created_at: string;
}

export interface StyleSettings {
  user_id: string;
  emoji_frequency: "often" | "sometimes" | "never" | null;
  brackets_instead_of_emoji: boolean | null;
  exclamation_style: "many" | "single_end" | "avoid" | null;
  capitalization: "always_correct" | "often_lowercase" | null;
  length_preference: "short" | "medium" | "long" | null;
}

export type StyleSettingsInput = Omit<StyleSettings, "user_id">;

// --- Тренировка (раздел 5a) ---

export interface TrainingSession {
  id: string;
  user_id: string;
  event_type: EventType;
  contact_ids: string[];
  started_at: string;
  completed_at: string | null;
}

export interface TrainingSummary {
  total: number;
  good: number;
  bad: number;
  edited: number;
  reasons: { reason: string; count: number }[];
}
