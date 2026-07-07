import { useEffect, useState } from "react";
import {
  createStyleExample,
  deleteStyleExample,
  getStyleSettings,
  listStyleExamples,
  saveStyleSettings,
  updateStyleExample,
} from "../lib/api";
import type { StyleExample, StyleLabel, StyleSettingsInput } from "../lib/types";

const LABELS: { id: StyleLabel; icon: string; title: string }[] = [
  { id: "reference", icon: "★", title: "Эталон" },
  { id: "ok", icon: "✓", title: "Ок" },
  { id: "skip", icon: "✗", title: "Пропустить" },
];

// Вопросы мини-опроса (раздел 12).
const SURVEY: {
  key: keyof StyleSettingsInput;
  label: string;
  options: { value: string | boolean; text: string }[];
}[] = [
  {
    key: "emoji_frequency",
    label: "Эмодзи",
    options: [
      { value: "often", text: "часто" },
      { value: "sometimes", text: "иногда" },
      { value: "never", text: "никогда" },
    ],
  },
  {
    key: "brackets_instead_of_emoji",
    label: "Скобки )) вместо эмодзи",
    options: [
      { value: true, text: "да" },
      { value: false, text: "нет" },
    ],
  },
  {
    key: "exclamation_style",
    label: "Восклицательные знаки",
    options: [
      { value: "many", text: "много" },
      { value: "single_end", text: "один в конце" },
      { value: "avoid", text: "избегаю" },
    ],
  },
  {
    key: "capitalization",
    label: "Заглавные буквы",
    options: [
      { value: "always_correct", text: "всегда правильно" },
      { value: "often_lowercase", text: "часто с маленькой" },
    ],
  },
  {
    key: "length_preference",
    label: "Длина поздравлений",
    options: [
      { value: "short", text: "коротко" },
      { value: "medium", text: "средне" },
      { value: "long", text: "развёрнуто" },
    ],
  },
];

const EMPTY_SETTINGS: StyleSettingsInput = {
  emoji_frequency: null,
  brackets_instead_of_emoji: null,
  exclamation_style: null,
  capitalization: null,
  length_preference: null,
};

export function StyleScreen() {
  const [examples, setExamples] = useState<StyleExample[]>([]);
  const [settings, setSettings] = useState<StyleSettingsInput>(EMPTY_SETTINGS);
  const [error, setError] = useState<string | null>(null);

  // Форма добавления примера
  const [newText, setNewText] = useState("");
  const [newNote, setNewNote] = useState("");
  const [newLabel, setNewLabel] = useState<StyleLabel>("reference");

  // Инлайн-редактирование текста примера
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingText, setEditingText] = useState("");

  const [savedTick, setSavedTick] = useState(false);

  async function reloadExamples() {
    try {
      setExamples(await listStyleExamples());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ошибка загрузки примеров");
    }
  }

  useEffect(() => {
    // Первичная загрузка: примеры + сохранённый опрос.
    (async () => {
      setError(null);
      try {
        const [ex, st] = await Promise.all([listStyleExamples(), getStyleSettings()]);
        setExamples(ex);
        if (st) {
          const { user_id: _omit, ...rest } = st;
          void _omit;
          setSettings(rest);
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : "Ошибка загрузки");
      }
    })();
  }, []);

  async function addExample() {
    if (!newText.trim()) return;
    try {
      await createStyleExample(newText.trim(), newLabel, newNote.trim() || null);
      setNewText("");
      setNewNote("");
      setNewLabel("reference");
      reloadExamples();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось добавить");
    }
  }

  async function changeLabel(ex: StyleExample, label: StyleLabel) {
    try {
      await updateStyleExample(ex.id, { label });
      setExamples((list) => list.map((e) => (e.id === ex.id ? { ...e, label } : e)));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось изменить метку");
    }
  }

  async function saveEdit(ex: StyleExample) {
    try {
      await updateStyleExample(ex.id, { text: editingText });
      setExamples((list) => list.map((e) => (e.id === ex.id ? { ...e, text: editingText } : e)));
      setEditingId(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось сохранить");
    }
  }

  async function remove(ex: StyleExample) {
    if (!confirm("Удалить пример?")) return;
    try {
      await deleteStyleExample(ex.id);
      setExamples((list) => list.filter((e) => e.id !== ex.id));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось удалить");
    }
  }

  async function saveSurvey() {
    try {
      await saveStyleSettings(settings);
      setSavedTick(true);
      setTimeout(() => setSavedTick(false), 2000);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось сохранить опрос");
    }
  }

  return (
    <>
      <h1 className="hello">Стиль письма</h1>
      {error && <p className="error">{error}</p>}

      {/* Мини-опрос */}
      <section className="card">
        <h2 className="card-title">Опрос стиля</h2>
        <div className="survey">
          {SURVEY.map((q) => (
            <div className="survey-row" key={String(q.key)}>
              <span className="survey-label">{q.label}</span>
              <div className="seg">
                {q.options.map((o) => {
                  const active = settings[q.key] === o.value;
                  return (
                    <button
                      key={String(o.value)}
                      className={active ? "seg-btn active" : "seg-btn"}
                      onClick={() =>
                        setSettings((s) => ({ ...s, [q.key]: o.value } as StyleSettingsInput))
                      }
                    >
                      {o.text}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
        <button className="btn-primary" onClick={saveSurvey}>
          {savedTick ? "Сохранено ✓" : "Сохранить опрос"}
        </button>
      </section>

      {/* Добавление примера */}
      <section className="card">
        <h2 className="card-title">Добавить пример поздравления</h2>
        <textarea
          className="input"
          rows={3}
          placeholder="Вставьте своё поздравление (из WhatsApp, SMS, откуда угодно)"
          value={newText}
          onChange={(e) => setNewText(e.target.value)}
        />
        <input
          className="input mt8"
          placeholder="Откуда (заметка, необязательно)"
          value={newNote}
          onChange={(e) => setNewNote(e.target.value)}
        />
        <div className="label-pick mt8">
          {LABELS.map((l) => (
            <button
              key={l.id}
              className={newLabel === l.id ? "label-btn active" : "label-btn"}
              onClick={() => setNewLabel(l.id)}
            >
              {l.icon} {l.title}
            </button>
          ))}
        </div>
        <button className="btn-primary mt8" onClick={addExample}>
          Добавить пример
        </button>
      </section>

      {/* Список примеров */}
      <section className="events">
        <h2 className="card-title">Мои примеры ({examples.length})</h2>
        {examples.length === 0 && <p className="muted empty">Примеров пока нет.</p>}
        <ul className="event-list">
          {examples.map((ex) => (
            <li key={ex.id} className="example-row">
              {editingId === ex.id ? (
                <>
                  <textarea
                    className="input"
                    rows={3}
                    value={editingText}
                    onChange={(e) => setEditingText(e.target.value)}
                  />
                  <div className="form-actions">
                    <button className="btn-primary" onClick={() => saveEdit(ex)}>
                      Сохранить
                    </button>
                    <button className="btn-secondary" onClick={() => setEditingId(null)}>
                      Отмена
                    </button>
                  </div>
                </>
              ) : (
                <>
                  <div className="example-text">{ex.text}</div>
                  {ex.source_note && <div className="muted example-note">{ex.source_note}</div>}
                  <div className="label-pick">
                    {LABELS.map((l) => (
                      <button
                        key={l.id}
                        className={ex.label === l.id ? "label-btn active" : "label-btn"}
                        onClick={() => changeLabel(ex, l.id)}
                      >
                        {l.icon} {l.title}
                      </button>
                    ))}
                  </div>
                  <div className="example-actions">
                    <button
                      className="link-btn"
                      onClick={() => {
                        setEditingId(ex.id);
                        setEditingText(ex.text);
                      }}
                    >
                      Изменить
                    </button>
                    <button className="link-btn danger" onClick={() => remove(ex)}>
                      Удалить
                    </button>
                  </div>
                </>
              )}
            </li>
          ))}
        </ul>
      </section>
    </>
  );
}
