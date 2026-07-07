import { useState } from "react";
import { appendContactFact, finalizeGeneration, generateGreeting, submitFeedback } from "../lib/api";
import type { EventType } from "../lib/types";
import { BAD_REASONS, EVENT_LABELS } from "../lib/format";

interface Props {
  contactId: string;
  contactName: string;
  initialEventType: EventType;
  onBack: () => void;
  onEditContact: (contactId: string) => void;
}

const EVENT_OPTIONS: EventType[] = ["birthday", "anniversary", "new_year", "mar8", "feb23"];

// --- Карточка одного варианта: фидбек + правка перед копированием ---
function VariantCard({
  text,
  index,
  generationId,
}: {
  text: string;
  index: number;
  generationId: string | null;
}) {
  const [state, setState] = useState<"idle" | "bad" | "editing">("idle");
  const [reason, setReason] = useState<string>("");
  const [comment, setComment] = useState("");
  const [editText, setEditText] = useState(text);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function good() {
    if (!generationId) return;
    try {
      await submitFeedback(generationId, index, "good", null);
      setStatus("👍 Отмечено");
    } catch {
      setError("Не удалось сохранить оценку");
    }
  }

  async function sendBad() {
    if (!generationId || !reason) return;
    const full = comment.trim() ? `${reason}: ${comment.trim()}` : reason;
    try {
      await submitFeedback(generationId, index, "bad", full);
      setState("idle");
      setStatus("👎 Причина сохранена");
    } catch {
      setError("Не удалось сохранить оценку");
    }
  }

  async function copyFinal() {
    try {
      await navigator.clipboard.writeText(editText);
    } catch {
      /* clipboard может быть недоступен — не критично */
    }
    if (generationId) {
      try {
        await finalizeGeneration(generationId, index, editText);
      } catch {
        setError("Не удалось сохранить итоговый текст");
        return;
      }
    }
    setState("idle");
    setStatus(
      editText.trim() === text.trim() ? "Скопировано ✓" : "Скопировано (правка сохранена) ✓",
    );
  }

  return (
    <li className="example-row">
      {state === "editing" ? (
        <>
          <span className="muted" style={{ fontSize: 13 }}>
            Отредактируйте перед копированием — правка сохранится как обучающий сигнал:
          </span>
          <textarea
            className="input"
            rows={4}
            value={editText}
            onChange={(e) => setEditText(e.target.value)}
          />
          <div className="example-actions">
            <button className="btn-primary" onClick={copyFinal}>
              Скопировать
            </button>
            <button className="btn-secondary" onClick={() => setState("idle")}>
              Отмена
            </button>
          </div>
        </>
      ) : (
        <>
          <div className="example-text">{text}</div>
          {status && <span className="muted" style={{ fontSize: 13 }}>{status}</span>}
          {error && <span className="error" style={{ fontSize: 13 }}>{error}</span>}
          <div className="example-actions">
            <button className="btn-secondary" onClick={good}>
              👍 Хорошо
            </button>
            <button className="btn-secondary" onClick={() => setState("bad")}>
              👎 Плохо
            </button>
            <button
              className="btn-primary"
              onClick={() => {
                setEditText(text);
                setState("editing");
              }}
            >
              Копировать
            </button>
          </div>
        </>
      )}

      {state === "bad" && (
        <div className="bad-form">
          <div className="label-pick">
            {BAD_REASONS.map((r) => (
              <button
                key={r}
                className={reason === r ? "label-btn active" : "label-btn"}
                onClick={() => setReason(r)}
              >
                {r}
              </button>
            ))}
          </div>
          <textarea
            className="input"
            rows={2}
            placeholder="Комментарий (необязательно)"
            value={comment}
            onChange={(e) => setComment(e.target.value)}
          />
          <div className="example-actions">
            <button className="btn-primary" onClick={sendBad} disabled={!reason}>
              Отправить
            </button>
            <button className="btn-secondary" onClick={() => setState("idle")}>
              Отмена
            </button>
          </div>
        </div>
      )}
    </li>
  );
}

export function GenerateScreen({ contactId, contactName, initialEventType, onBack, onEditContact }: Props) {
  const [eventType, setEventType] = useState<EventType>(initialEventType);
  const [wishes, setWishes] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const [variants, setVariants] = useState<string[] | null>(null);
  const [generationId, setGenerationId] = useState<string | null>(null);
  // Долговечные факты из пожеланий: предложение дописать в карточку (раздел 6a-подход:
  // никаких молчаливых изменений — только с подтверждением).
  const [facts, setFacts] = useState<string[]>([]);
  const [factStatus, setFactStatus] = useState<Record<string, "added" | "dismissed" | "error">>({});

  async function generate() {
    setLoading(true);
    setError(null);
    setWarning(null);
    setVariants(null);
    setFacts([]);
    setFactStatus({});
    const res = await generateGreeting(contactId, eventType, wishes.trim() || null);
    setLoading(false);
    if (res.ok) {
      setVariants(res.variants);
      setWarning(res.warning);
      setGenerationId(res.generationId);
      setFacts(res.suggestedFacts);
    } else {
      // Пожелания пользователя НЕ теряем — они остаются в поле.
      setError(res.message);
    }
  }

  async function addFact(fact: string) {
    try {
      await appendContactFact(contactId, fact);
      setFactStatus((s) => ({ ...s, [fact]: "added" }));
    } catch {
      setFactStatus((s) => ({ ...s, [fact]: "error" }));
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
        <h1
          className="hello clickable"
          title="Открыть карточку контакта"
          onClick={() => onEditContact(contactId)}
        >
          {contactName}
        </h1>

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

        {variants && facts.length > 0 && (
          <section className="card">
            <h2 className="card-title">💡 Запомнить в карточке {contactName}?</h2>
            <ul className="summary-list">
              {facts.map((f) => (
                <li key={f} className="fact-row">
                  <span className="fact-text">«{f}»</span>
                  {factStatus[f] === "added" && <span className="muted">Добавлено ✓</span>}
                  {factStatus[f] === "dismissed" && <span className="muted">Пропущено</span>}
                  {factStatus[f] === "error" && <span className="error">Ошибка сохранения</span>}
                  {!factStatus[f] && (
                    <span className="example-actions" style={{ marginTop: 0 }}>
                      <button className="btn-primary small" onClick={() => addFact(f)}>
                        Добавить
                      </button>
                      <button
                        className="btn-secondary small"
                        onClick={() => setFactStatus((s) => ({ ...s, [f]: "dismissed" }))}
                      >
                        Не надо
                      </button>
                    </span>
                  )}
                </li>
              ))}
            </ul>
          </section>
        )}

        {variants && (
          <ul className="event-list">
            {variants.map((v, i) => (
              <VariantCard key={`${generationId}-${i}`} text={v} index={i} generationId={generationId} />
            ))}
          </ul>
        )}
      </main>
    </div>
  );
}
