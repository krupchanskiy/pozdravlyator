import { useState } from "react";
import { updateUserSettings } from "../lib/api";
import { TIMEZONES } from "../lib/timezones";
import type { Profile } from "../lib/types";

interface Props {
  profile: Profile;
  onBack: () => void;
  onSaved: () => void; // перезагрузить профиль в App после сохранения
}

// Час повторного напоминания в pzd-reminders (FOLLOWUP_HOUR = 19).
const FOLLOWUP_TIME = "19:00";

// Экран настроек (раздел 10 ТЗ): напоминания в Telegram + часовой пояс.
export function SettingsScreen({ profile, onBack, onSaved }: Props) {
  const [enabled, setEnabled] = useState(profile.reminder_enabled);
  // Postgres time приходит как HH:MM:SS — для input type="time" нужен HH:MM.
  const [time, setTime] = useState((profile.reminder_time || "09:00").slice(0, 5));
  const [mandatoryOnly, setMandatoryOnly] = useState(profile.remind_mandatory_only);
  const [tz, setTz] = useState(profile.timezone ?? "Europe/Moscow");
  const [saving, setSaving] = useState(false);
  const [savedTick, setSavedTick] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Часовой пояс пользователя может отсутствовать в курируемом списке —
  // тогда показываем его отдельным пунктом, чтобы select не «съел» значение.
  const tzOptions = TIMEZONES.some((t) => t.id === tz)
    ? TIMEZONES
    : [{ id: tz, label: tz }, ...TIMEZONES];

  async function save() {
    setSaving(true);
    setError(null);
    try {
      await updateUserSettings({
        timezone: tz,
        reminder_time: time,
        reminder_enabled: enabled,
        remind_mandatory_only: mandatoryOnly,
      });
      onSaved();
      setSavedTick(true);
      setTimeout(() => setSavedTick(false), 2000);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось сохранить");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="screen">
      <header className="app-header">
        <button className="link-btn" onClick={onBack}>
          ← Назад
        </button>
        <span className="app-title">Настройки</span>
        <span style={{ width: 48 }} />
      </header>

      <main className="content form">
        <section className="card">
          <h2 className="card-title">Напоминания в Telegram</h2>
          <div className="survey">
            <label className="field-check">
              <input
                type="checkbox"
                checked={enabled}
                onChange={(e) => setEnabled(e.target.checked)}
              />
              <span>Присылать напоминания о событиях</span>
            </label>

            <label className="field">
              <span>Время напоминания</span>
              <input
                className="input"
                type="time"
                value={time}
                onChange={(e) => setTime(e.target.value)}
                disabled={!enabled}
              />
            </label>

            <div className="survey-row">
              <span className="survey-label">По каким контактам</span>
              <div className="seg">
                <button
                  className={!mandatoryOnly ? "seg-btn active" : "seg-btn"}
                  onClick={() => setMandatoryOnly(false)}
                  disabled={!enabled}
                >
                  все контакты
                </button>
                <button
                  className={mandatoryOnly ? "seg-btn active" : "seg-btn"}
                  onClick={() => setMandatoryOnly(true)}
                  disabled={!enabled}
                >
                  только обязательные ★
                </button>
              </div>
            </div>

            {enabled && (
              <p className="muted settings-hint">
                Если вы не отреагировали на напоминание, в {FOLLOWUP_TIME} придёт повтор.
                {time >= FOLLOWUP_TIME &&
                  " При времени напоминания 19:00 и позже повтора не будет."}
              </p>
            )}
          </div>
        </section>

        <section className="card">
          <h2 className="card-title">Часовой пояс</h2>
          <div className="survey">
            <p className="muted settings-hint">
              По нему считаются напоминания и ближайшие события.
            </p>
            <select className="input" value={tz} onChange={(e) => setTz(e.target.value)}>
              {tzOptions.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.label}
                </option>
              ))}
            </select>
          </div>
        </section>

        <button className="btn-primary" onClick={save} disabled={saving}>
          {saving ? "Сохраняем…" : savedTick ? "Сохранено ✓" : "Сохранить"}
        </button>
        {error && <p className="error">{error}</p>}
      </main>
    </div>
  );
}
