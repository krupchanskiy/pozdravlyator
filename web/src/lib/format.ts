import type { EventType } from "./types";

const MONTHS = [
  "января", "февраля", "марта", "апреля", "мая", "июня",
  "июля", "августа", "сентября", "октября", "ноября", "декабря",
];

// "2026-07-16" → "16 июля"
export function formatDayMonth(iso: string): string {
  const [, m, d] = iso.split("-").map(Number);
  return `${d} ${MONTHS[m - 1]}`;
}

// Человеческое "через сколько".
export function formatDaysUntil(days: number): string {
  if (days === 0) return "сегодня";
  if (days === 1) return "завтра";
  if (days >= 2 && days <= 4) return `через ${days} дня`;
  return `через ${days} дней`;
}

export const EVENT_LABELS: Record<EventType, string> = {
  birthday: "День рождения",
  anniversary: "Годовщина",
  new_year: "Новый год",
  mar8: "8 марта",
  feb23: "23 февраля",
};

// Причины «плохо» (раздел 9 ТЗ).
export const BAD_REASONS = [
  "слишком формально",
  "слишком фамильярно",
  "слишком длинно",
  "слишком коротко",
  "не мой стиль",
] as const;
