import { useEffect, useState } from "react";
import {
  analyzeWishVectors,
  listCategories,
  listWishSuggestions,
  resolveWishSuggestion,
  updateCategoryWishVector,
} from "../lib/api";
import type { Category, WishSuggestion } from "../lib/types";

interface Props {
  onBack: () => void;
}

// Строка категории с редактируемым вектором пожеланий.
function CategoryRow({ cat }: { cat: Category }) {
  const [text, setText] = useState(cat.wish_vector ?? "");
  const [status, setStatus] = useState<string | null>(null);

  async function save() {
    try {
      await updateCategoryWishVector(cat.id, text);
      setStatus("Сохранено ✓");
      setTimeout(() => setStatus(null), 1500);
    } catch {
      setStatus("Ошибка сохранения");
    }
  }

  return (
    <div className="card">
      <div className="card-title">{cat.name}</div>
      <label className="field">
        <span>Общее пожелание для этой группы</span>
        <textarea
          className="input"
          rows={2}
          placeholder="напр. милости духовного учителя, вдохновения в практике"
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
      </label>
      <div className="example-actions">
        <button className="btn-primary small" onClick={save}>
          Сохранить
        </button>
        {status && <span className="muted" style={{ fontSize: 13 }}>{status}</span>}
      </div>
    </div>
  );
}

// Карточка предложения: принять / изменить и принять / отклонить.
function SuggestionCard({ sug, onResolved }: { sug: WishSuggestion; onResolved: () => void }) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(sug.suggested_text);
  const [busy, setBusy] = useState(false);

  async function resolve(action: "accept" | "edit" | "reject") {
    setBusy(true);
    try {
      await resolveWishSuggestion(sug, action, text);
      onResolved();
    } catch {
      setBusy(false);
    }
  }

  return (
    <li className="example-row">
      <div className="muted" style={{ fontSize: 13 }}>
        Предложение для группы «{sug.category_name}»:
      </div>
      {editing ? (
        <textarea className="input" rows={3} value={text} onChange={(e) => setText(e.target.value)} />
      ) : (
        <div className="example-text">{sug.suggested_text}</div>
      )}
      <div className="example-actions">
        {editing ? (
          <>
            <button className="btn-primary" disabled={busy} onClick={() => resolve("edit")}>
              Принять правку
            </button>
            <button className="btn-secondary" onClick={() => setEditing(false)}>
              Отмена
            </button>
          </>
        ) : (
          <>
            <button className="btn-primary" disabled={busy} onClick={() => resolve("accept")}>
              Принять
            </button>
            <button className="btn-secondary" onClick={() => setEditing(true)}>
              Изменить и принять
            </button>
            <button className="btn-danger" disabled={busy} onClick={() => resolve("reject")}>
              Отклонить
            </button>
          </>
        )}
      </div>
    </li>
  );
}

export function CategoriesScreen({ onBack }: Props) {
  const [cats, setCats] = useState<Category[]>([]);
  const [suggestions, setSuggestions] = useState<WishSuggestion[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [analyzeMsg, setAnalyzeMsg] = useState<string | null>(null);

  async function reload() {
    setError(null);
    try {
      const [c, s] = await Promise.all([listCategories(), listWishSuggestions()]);
      setCats(c);
      setSuggestions(s);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ошибка загрузки");
    }
  }

  useEffect(() => {
    reload();
  }, []);

  async function checkSuggestions() {
    setAnalyzing(true);
    setAnalyzeMsg(null);
    try {
      const n = await analyzeWishVectors();
      setAnalyzeMsg(n > 0 ? `Новых предложений: ${n}` : "Новых предложений нет");
      await reload();
    } catch {
      setAnalyzeMsg("Ошибка анализа");
    } finally {
      setAnalyzing(false);
    }
  }

  return (
    <div className="form">
      <div className="row-between">
        <h1 className="hello">Категории</h1>
        <button className="link-btn" onClick={onBack}>
          ← Назад
        </button>
      </div>

      {error && <p className="error">{error}</p>}

      <button className="btn-secondary" onClick={checkSuggestions} disabled={analyzing}>
        {analyzing ? "Анализируем…" : "Проверить предложения"}
      </button>
      {analyzeMsg && <p className="muted">{analyzeMsg}</p>}

      {suggestions.length > 0 && (
        <section className="events">
          <h2 className="card-title">Предложения по векторам</h2>
          <ul className="event-list">
            {suggestions.map((s) => (
              <SuggestionCard key={s.id} sug={s} onResolved={reload} />
            ))}
          </ul>
        </section>
      )}

      {cats.length === 0 ? (
        <p className="muted empty">Категорий пока нет. Создайте их в карточке контакта.</p>
      ) : (
        cats.map((c) => <CategoryRow key={c.id} cat={c} />)
      )}
    </div>
  );
}
