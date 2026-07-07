import { createClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL as string;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

if (!url || !anonKey) {
  // Явно падаем на старте, чтобы не ловить непонятные ошибки позже.
  throw new Error("Не заданы VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY (см. web/.env.example)");
}

export const supabase = createClient(url, anonKey);

// URL edge-функции авторизации.
export const telegramAuthUrl = `${url}/functions/v1/telegram-auth`;
