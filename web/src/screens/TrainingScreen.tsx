import { useEffect, useRef, useState } from "react";
import {
  analyzeWishVectors,
  completeTrainingSession,
  finalizeGeneration,
  generateGreeting,
  getTrainingSummary,
  listContacts,
  listTrainingSessions,
  startTrainingSession,
  submitFeedback,
} from "../lib/api";
import type { EventType, TrainingSession, TrainingSummary } from "../lib/types";
import { pickRepresentatives, TRAINING_LIMIT } from "../lib/training";
import type { Representative } from "../lib/training";
import { BAD_REASONS, EVENT_LABELS, formatDate } from "../lib/format";

const EVENT_OPTIONS: EventType[] = ["birthday", "new_year", "mar8", "feb23", "anniversary"];

// --- Шаг по одному представителю: 1 вариант + фидбек ---
function RepStep({
  rep,
  eventType,
  sessionId,
  index,
  total,
  onNext,
}: {
  rep: Representative;
  eventType: EventType;
  sessionId: string;
  index: number;
  total: number;
  onNext: () => void;
}) {
  const [loading, setLoading] = useState(true);
  const [variant, setVariant] = useState<string | null>(null);
  const [generationId, setGenerationId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<"idle" | "bad" | "editing">("idle");
  const [reason, setReason] = useState("");
  const [comment, setComment] = useState("");
  const [editText, setEditText] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const didRun = useRef(false);

  useEffect(() => {
    if (didRun.current) return; // защита от двойного вызова в StrictMode
    didRun.current = true;
    (async () => {
      setLoading(true);
      const res = await generateGreeting(rep.contact.id, eventType, null, {
        count: 1,
        source: "training",
        trainingSessionId: sessionId,
      });
      setLoading(false);
      if (res.ok) {
        setVariant(res.variants[0] ?? "");
        setEditText(res.variants[0] ?? "");
        setGenerationId(res.generationId);
      } else {
        setError(res.message);
      }
    })();
  }, [rep.contact.id, eventType, sessionId]);

  async function good() {
    if (generationId) await submitFeedback(generationId, 0, "good", null);
    setStatus("👍 Отмечено");
  }
  async function sendBad() {
    if (!generationId || !reason) return;
    const full = comment.trim() ? `${reason}: ${comment.trim()}` : reason;
    await submitFeedback(generationId, 0, "bad", full);
    setMode("idle");
    setStatus("👎 Причина сохранена");
  }
  async function saveEdit() {
    if (generationId) await finalizeGeneration(generationId, 0, editText);
    setMode("idle");
    setStatus("Правка сохранена ✓");
  }

  return (
    <div className="form">
      <p className="muted">
        {index + 1} из {total}
      </p>
      <h1 className="hello">{rep.contact.name}</h1>
      <p className="muted" style={{ marginTop: -12 }}>
        {rep.groupLabel}
      </p>

      {loading && <p className="muted">Генерируем вариант…</p>}
      {error && <p className="error">{error}</p>}

      {variant !== null && !loading && (
        <div className="example-row">
          {mode === "editing" ? (
            <>
              <textarea
                className="input"
                rows={4}
                value={editText}
                onChange={(e) => setEditText(e.target.value)}
              />
              <div className="example-actions">
                <button className="btn-primary" onClick={saveEdit}>
                  Сохранить правку
                </button>
                <button className="btn-secondary" onClick={() => setMode("idle")}>
                  Отмена
                </button>
              </div>
            </>
          ) : (
            <>
              <div className="example-text">{variant}</div>
              {status && <span className="muted" style={{ fontSize: 13 }}>{status}</span>}
              <div className="example-actions">
                <button className="btn-secondary" onClick={good}>
                  👍
                </button>
                <button className="btn-secondary" onClick={() => setMode("bad")}>
                  👎
                </button>
                <button className="btn-secondary" onClick={() => setMode("editing")}>
                  Править
                </button>
              </div>
            </>
          )}

          {mode === "bad" && (
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
                <button className="btn-secondary" onClick={() => setMode("idle")}>
                  Отмена
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      <button className="btn-primary" onClick={onNext} disabled={loading}>
        {index + 1 < total ? "Дальше" : "Завершить"}
      </button>
    </div>
  );
}

// --- Строка истории: разворачивается и подгружает summary сессии ---
function SessionHistoryItem({ session }: { session: TrainingSession }) {
  const [open, setOpen] = useState(false);
  const [summary, setSummary] = useState<TrainingSummary | null>(null);
  const [loading, setLoading] = useState(false);

  async function toggle() {
    const next = !open;
    setOpen(next);
    if (next && !summary) {
      setLoading(true);
      try {
        setSummary(await getTrainingSummary(session.id));
      } finally {
        setLoading(false);
      }
    }
  }

  return (
    <li className="example-row">
      <button className="link-btn" style={{ textAlign: "left", padding: 0 }} onClick={toggle}>
        {open ? "▾" : "▸"} {EVENT_LABELS[session.event_type]} •{" "}
        {formatDate(session.completed_at ?? session.started_at)} •{" "}
        {session.contact_ids.length} контакт(ов)
      </button>
      {open && loading && <p className="muted">Загружаем итоги…</p>}
      {open && summary && (
        <ul className="summary-list">
          <li>Оценено: <b>{summary.total}</b></li>
          <li>👍 {summary.good} • 👎 {summary.bad} • правок: {summary.edited}</li>
          {summary.reasons.length > 0 && (
            <li className="muted">
              Причины отказа: {summary.reasons.map((r) => `${r.reason} (${r.count})`).join(", ")}
            </li>
          )}
        </ul>
      )}
    </li>
  );
}

export function TrainingScreen() {
  const [phase, setPhase] = useState<"setup" | "run" | "summary">("setup");
  const [eventType, setEventType] = useState<EventType>("birthday");
  const [reps, setReps] = useState<Representative[]>([]);
  const [totalGroups, setTotalGroups] = useState(0);
  const [capped, setCapped] = useState(false);
  const [picked, setPicked] = useState(false);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [index, setIndex] = useState(0);
  const [summary, setSummary] = useState<TrainingSummary | null>(null);
  const [suggestionsCreated, setSuggestionsCreated] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [sessions, setSessions] = useState<TrainingSession[]>([]);

  // История прошлых тренировок — перезагружаем при каждом входе в setup.
  useEffect(() => {
    if (phase !== "setup") return;
    listTrainingSessions().then(setSessions).catch(() => {});
  }, [phase]);

  async function pick() {
    setError(null);
    try {
      const contacts = await listContacts();
      const sel = pickRepresentatives(contacts);
      setReps(sel.reps);
      setTotalGroups(sel.totalGroups);
      setCapped(sel.capped);
      setPicked(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ошибка загрузки контактов");
    }
  }

  async function start() {
    setError(null);
    try {
      const id = await startTrainingSession(
        eventType,
        reps.map((r) => r.contact.id),
      );
      setSessionId(id);
      setIndex(0);
      setPhase("run");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось запустить тренировку");
    }
  }

  async function next() {
    if (index + 1 < reps.length) {
      setIndex(index + 1);
      return;
    }
    // Последний — завершаем и показываем summary.
    if (sessionId) {
      try {
        await completeTrainingSession(sessionId);
        setSummary(await getTrainingSummary(sessionId));
        // Анализ вектора пожеланий по затронутым категориям (раздел 6a).
        setSuggestionsCreated(await analyzeWishVectors(sessionId));
      } catch (e) {
        setError(e instanceof Error ? e.message : "Ошибка завершения");
      }
    }
    setPhase("summary");
  }

  function reset() {
    setPhase("setup");
    setPicked(false);
    setReps([]);
    setSessionId(null);
    setIndex(0);
    setSummary(null);
  }

  if (phase === "run" && sessionId && reps[index]) {
    return (
      <RepStep
        key={index}
        rep={reps[index]}
        eventType={eventType}
        sessionId={sessionId}
        index={index}
        total={reps.length}
        onNext={next}
      />
    );
  }

  if (phase === "summary" && summary) {
    return (
      <>
        <h1 className="hello">Тренировка завершена</h1>
        <section className="card">
          <h2 className="card-title">Итоги</h2>
          <ul className="summary-list">
            <li>Оценено вариантов: <b>{summary.total}</b></li>
            <li>👍 Хорошо: <b>{summary.good}</b></li>
            <li>👎 Плохо: <b>{summary.bad}</b></li>
            <li>Отредактировано: <b>{summary.edited}</b></li>
          </ul>
          {summary.reasons.length > 0 && (
            <>
              <h2 className="card-title" style={{ marginTop: 14 }}>Частые причины отказа</h2>
              <ul className="summary-list">
                {summary.reasons.map((r) => (
                  <li key={r.reason}>
                    {r.reason} — <b>{r.count}</b>
                  </li>
                ))}
              </ul>
            </>
          )}
        </section>
        {suggestionsCreated > 0 && (
          <p className="warn mt8">
            Появились новые предложения по векторам групп ({suggestionsCreated}) — посмотрите в
            «Контакты → Теги».
          </p>
        )}
        <button className="btn-primary mt8" onClick={reset}>
          Готово
        </button>
      </>
    );
  }

  // phase setup
  return (
    <>
      <h1 className="hello">Тренировка стиля</h1>
      <p className="muted empty">
        Система подберёт по одному контакту на каждый тип отношений и обращение, сгенерирует по
        одному поздравлению — оцените или поправьте, чтобы обучить свой стиль.
      </p>

      <label className="field mt8">
        <span>Тип события</span>
        <select
          className="input"
          value={eventType}
          onChange={(e) => {
            setEventType(e.target.value as EventType);
            setPicked(false);
          }}
        >
          {EVENT_OPTIONS.map((ev) => (
            <option key={ev} value={ev}>
              {EVENT_LABELS[ev]}
            </option>
          ))}
        </select>
      </label>

      <button className="btn-secondary mt8" onClick={pick}>
        Подобрать представителей
      </button>

      {error && <p className="error">{error}</p>}

      {picked && (
        <div className="mt8">
          {capped && (
            <p className="warn">
              Групп отношений: {totalGroups}. За одну сессию тренируем не больше {TRAINING_LIMIT} —
              взяли первые {TRAINING_LIMIT}, остальные разберите в следующей сессии.
            </p>
          )}
          {reps.length === 0 ? (
            <p className="muted empty">
              Нет контактов для подбора. Сначала добавьте контакты во вкладке «Контакты».
            </p>
          ) : (
            <>
              <h2 className="card-title mt8">Представители ({reps.length})</h2>
              <ul className="contact-list">
                {reps.map((r) => (
                  <li key={r.contact.id} className="contact-row">
                    <div className="contact-name">{r.contact.name}</div>
                    <div className="contact-sub muted">{r.groupLabel}</div>
                  </li>
                ))}
              </ul>
              <button className="btn-primary mt8" onClick={start}>
                Начать тренировку
              </button>
            </>
          )}
        </div>
      )}

      {sessions.length > 0 && (
        <section className="events">
          <h2 className="card-title">История тренировок ({sessions.length})</h2>
          <ul className="event-list">
            {sessions.map((s) => (
              <SessionHistoryItem key={s.id} session={s} />
            ))}
          </ul>
        </section>
      )}
    </>
  );
}
