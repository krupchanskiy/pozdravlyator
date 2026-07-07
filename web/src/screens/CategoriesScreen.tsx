import { useEffect, useState } from "react";
import {
  analyzeWishVectors,
  createCategory,
  deleteCategory,
  listCategories,
  listWishSuggestions,
  resolveWishSuggestion,
  updateCategoryWishVector,
} from "../lib/api";
import type { Category, WishSuggestion } from "../lib/types";

interface Props {
  onBack: () => void;
}

// Строка категории с редактируемым вектором пожеланий и удалением.
function CategoryRow({ cat, onDeleted }: { cat: Category; onDeleted: () => void }) {
  const [text, setText] = useState(cat.wish_vector ?? "");
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function save() {
    try {
      await updateCategoryWishVector(cat.id, text);
      setStatus("Сохранено ✓");
      setTimeout(() => setStatus(null), 1500);
    } catch {
      setStatus("Ошибка сохранения");
    }
  }

  async function remove() {
    if (!confirm(`Удалить тег «${cat.name}»? Контакты останутся, привязка исчезнет.`)) return;
    setBusy(true);
    try {
      await deleteCategory(cat.id);
      onDeleted();
    } catch {
      setStatus("Ошибка удаления");
      setBusy(false);
    }
  }

  return (
    <div className="card">
      <div className="row-between">
        <div className="card-title" style={{ marginBottom: 0 }}>{cat.name}</div>
        <button className="link-btn danger" onClick={remove} disabled={busy}>
          Удалить
        </button>
      </div>
      <label className="field" style={{ marginTop: 10 }}>
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
  const [newName, setNewName] = useState("");

  async function addCategory() {
    const name = newName.trim();
    if (!name) return;
    setError(null);
    try {
      await createCategory(name);
      setNewName("");
      await reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось создать тег");
    }
  }

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
        <h1 className="hello">Теги</h1>
        <button className="link-btn" onClick={onBack}>
          ← Назад
        </button>
      </div>

      {error && <p className="error">{error}</p>}

      <div className="cat-add">
        <input
          className="input"
          placeholder="Новый тег"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              addCategory();
            }
          }}
        />
        <button className="btn-primary" type="button" onClick={addCategory}>
          Создать
        </button>
      </div>

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
        <p className="muted empty">Тегов пока нет. Создайте первый в поле выше.</p>
      ) : (
        cats.map((c) => <CategoryRow key={c.id} cat={c} onDeleted={reload} />)
      )}
    </div>
  );
}
