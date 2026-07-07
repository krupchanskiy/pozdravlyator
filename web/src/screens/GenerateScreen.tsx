import { useState } from "react";
import { generateGreeting } from "../lib/api";
import type { EventType } from "../lib/types";
import { EVENT_LABELS } from "../lib/format";

interface Props {
  contactId: string;
  contactName: string;
  initialEventType: EventType;
  onBack: () => void;
}

const EVENT_OPTIONS: EventType[] = ["birthday", "anniversary", "new_year", "mar8", "feb23"];

export function GenerateScreen({ contactId, contactName, initialEventType, onBack }: Props) {
  const [eventType, setEventType] = useState<EventType>(initialEventType);
  const [wishes, setWishes] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const [variants, setVariants] = useState<string[] | null>(null);
  const [copiedIdx, setCopiedIdx] = useState<number | null>(null);

  async function generate() {
    setLoading(true);
    setError(null);
    setWarning(null);
    setVariants(null);
    const res = await generateGreeting(contactId, eventType, wishes.trim() || null);
    setLoading(false);
    if (res.ok) {
      setVariants(res.variants);
      setWarning(res.warning);
    } else {
      // Пожелания пользователя НЕ теряем — они остаются в поле.
      setError(res.message);
    }
  }

  async function copy(text: string, idx: number) {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedIdx(idx);
      setTimeout(() => setCopiedIdx((c) => (c === idx ? null : c)), 1500);
    } catch {
      setError("Не удалось скопировать");
    }
  }

  return (
    <div className="screen">
      <header className="app-header">
        <button className="link-btn" onClick={onBack}>
          ← Назад
        </button>
        <span className="app-title">Поздравление</span>
        <span style={{ width: 48 }} />
      </header>

      <main className="content form">
        <h1 className="hello">{contactName}</h1>

        <label className="field">
          <span>Событие</span>
          <select
            className="input"
            value={eventType}
            onChange={(e) => setEventType(e.target.value as EventType)}
          >
            {EVENT_OPTIONS.map((ev) => (
              <option key={ev} value={ev}>
                {EVENT_LABELS[ev]}
              </option>
            ))}
          </select>
        </label>

        <label className="field">
          <span>Пожелания к тексту (необязательно)</span>
          <textarea
            className="input"
            rows={2}
            placeholder="напр. упомяни наш поход, стиль свободнее, 2–3 абзаца"
            value={wishes}
            onChange={(e) => setWishes(e.target.value)}
          />
        </label>

        <button className="btn-primary" onClick={generate} disabled={loading}>
          {loading ? "Генерируем…" : variants ? "Сгенерировать ещё" : "Сгенерировать"}
        </button>

        {warning && <p className="warn">{warning}</p>}

        {error && (
          <div className="gen-error">
            <p className="error">{error}</p>
            <button className="btn-secondary" onClick={generate} disabled={loading}>
              Повторить
            </button>
          </div>
        )}

        {variants && (
          <ul className="event-list">
            {variants.map((v, i) => (
              <li key={i} className="example-row">
                <div className="example-text">{v}</div>
                <div className="example-actions">
                  <button className="btn-secondary" onClick={() => copy(v, i)}>
                    {copiedIdx === i ? "Скопировано ✓" : "Копировать"}
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </main>
    </div>
  );
}
