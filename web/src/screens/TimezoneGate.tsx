import { useState } from "react";
import { TIMEZONES, guessBrowserTz } from "../lib/timezones";
import { updateTimezone } from "../lib/api";

interface Props {
  onDone: () => void;
}

// Онбординг-шаг: выбор часового пояса (раздел 11, шаг 2). Показывается,
// пока timezone у пользователя не задан.
export function TimezoneGate({ onDone }: Props) {
  const guess = guessBrowserTz();
  const initial = TIMEZONES.some((t) => t.id === guess) ? guess : "Europe/Moscow";
  const [tz, setTz] = useState(initial);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setSaving(true);
    setError(null);
    try {
      await updateTimezone(tz);
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось сохранить");
      setSaving(false);
    }
  }

  return (
    <div className="screen center">
      <div className="login-box">
        <h1 className="brand">Часовой пояс</h1>
        <p className="muted">
          По нему считаются напоминания и ближайшие события. Можно поменять позже в настройках.
        </p>
        <select className="input" value={tz} onChange={(e) => setTz(e.target.value)}>
          {TIMEZONES.map((t) => (
            <option key={t.id} value={t.id}>
              {t.label}
            </option>
          ))}
        </select>
        <button className="btn-primary" onClick={save} disabled={saving}>
          {saving ? "Сохраняем…" : "Продолжить"}
        </button>
        {error && <p className="error">{error}</p>}
      </div>
    </div>
  );
}
