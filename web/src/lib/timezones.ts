// Курируемый список часовых поясов (IANA). Акцент на РФ/СНГ + основные мировые.
export interface TzOption {
  id: string;   // IANA tz
  label: string;
}

export const TIMEZONES: TzOption[] = [
  { id: "Europe/Kaliningrad", label: "Калининград (UTC+2)" },
  { id: "Europe/Moscow", label: "Москва, Санкт-Петербург (UTC+3)" },
  { id: "Europe/Samara", label: "Самара (UTC+4)" },
  { id: "Asia/Yekaterinburg", label: "Екатеринбург (UTC+5)" },
  { id: "Asia/Omsk", label: "Омск (UTC+6)" },
  { id: "Asia/Krasnoyarsk", label: "Красноярск (UTC+7)" },
  { id: "Asia/Irkutsk", label: "Иркутск (UTC+8)" },
  { id: "Asia/Yakutsk", label: "Якутск (UTC+9)" },
  { id: "Asia/Vladivostok", label: "Владивосток (UTC+10)" },
  { id: "Asia/Magadan", label: "Магадан (UTC+11)" },
  { id: "Asia/Kamchatka", label: "Камчатка (UTC+12)" },
  { id: "Europe/Kyiv", label: "Киев (UTC+2/+3)" },
  { id: "Europe/Minsk", label: "Минск (UTC+3)" },
  { id: "Asia/Almaty", label: "Алматы (UTC+5)" },
  { id: "Asia/Tashkent", label: "Ташкент (UTC+5)" },
  { id: "Asia/Tbilisi", label: "Тбилиси (UTC+4)" },
  { id: "Asia/Yerevan", label: "Ереван (UTC+4)" },
  { id: "Asia/Baku", label: "Баку (UTC+4)" },
  { id: "Asia/Kolkata", label: "Индия — Дели, Мумбаи (UTC+5:30)" },
  { id: "Europe/London", label: "Лондон (UTC+0/+1)" },
  { id: "Europe/Berlin", label: "Берлин, Париж (UTC+1/+2)" },
  { id: "America/New_York", label: "Нью-Йорк (UTC−5/−4)" },
  { id: "America/Los_Angeles", label: "Лос-Анджелес (UTC−8/−7)" },
  { id: "UTC", label: "UTC" },
];

// Попытка угадать TZ браузера для дефолтного выбора.
export function guessBrowserTz(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "Europe/Moscow";
  } catch {
    return "Europe/Moscow";
  }
}
