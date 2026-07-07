import { useEffect, useState } from "react";
import {
  createCategory,
  createContact,
  deleteContact,
  getContactCategoryIds,
  listContactGenerations,
  updateContact,
} from "../lib/api";
import type { GenerationHistoryItem } from "../lib/api";
import type { Category, Contact, ContactInput } from "../lib/types";
import { RELATIONSHIP_TYPES } from "../lib/types";
import { EVENT_LABELS, formatDate } from "../lib/format";

const SOURCE_LABELS: Record<string, string> = {
  user_initiated: "вручную",
  reminder_bot: "из бота",
  training: "тренировка",
};

// Текст, который в итоге пошёл в дело: финальный → отмеченный «хорошо» → первый.
function historyText(g: GenerationHistoryItem): string {
  if (g.final_text) return g.final_text;
  if (g.final_variant_index != null && g.variants[g.final_variant_index]) {
    return g.variants[g.final_variant_index].text;
  }
  return g.variants.find((v) => v.feedback === "good")?.text ?? g.variants[0]?.text ?? "";
}

// История поздравлений по контакту (раздел 11).
function GreetingHistory({ contactId }: { contactId: string }) {
  const [items, setItems] = useState<GenerationHistoryItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    listContactGenerations(contactId)
      .then(setItems)
      .catch((e) => setError(e instanceof Error ? e.message : "Ошибка загрузки истории"));
  }, [contactId]);

  return (
    <section className="events">
      <h2 className="card-title">История поздравлений{items ? ` (${items.length})` : ""}</h2>
      {error && <p className="error">{error}</p>}
      {items && items.length === 0 && (
        <p className="muted empty">Поздравлений для этого контакта ещё не было.</p>
      )}
      {items && items.length > 0 && (
        <ul className="event-list">
          {items.map((g) => (
            <li key={g.id} className="example-row">
              <div className="muted" style={{ fontSize: 13 }}>
                {EVENT_LABELS[g.event_type] ?? g.event_type} • {formatDate(g.created_at)}
                {" • "}
                {SOURCE_LABELS[g.source] ?? g.source}
                {g.final_text && " • отправлено"}
              </div>
              <div className="example-text">{historyText(g)}</div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

interface Props {
  contact: Contact | null; // null → создание
  categories: Category[];
  onCancel: () => void;
  onSaved: () => void;
}

function emptyInput(): ContactInput {
  return {
    name: "",
    call_name: null,
    gender: null,
    relationship_type: null,
    closeness: null,
    address_form: null,
    is_mandatory: false,
    context_notes: null,
    birthday: null,
    anniversary_date: null,
    anniversary_label: null,
    telegram_username: null,
  };
}

export function ContactForm({ contact, categories, onCancel, onSaved }: Props) {
  const [form, setForm] = useState<ContactInput>(
    contact ? { ...contact } : emptyInput(),
  );
  const [cats, setCats] = useState<Category[]>(categories);
  const [selectedCats, setSelectedCats] = useState<Set<string>>(new Set());
  const [newCat, setNewCat] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (contact) {
      getContactCategoryIds(contact.id)
        .then((ids) => setSelectedCats(new Set(ids)))
        .catch(() => {});
    }
  }, [contact]);

  function set<K extends keyof ContactInput>(key: K, value: ContactInput[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  function toggleCat(id: string) {
    setSelectedCats((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function addCategory() {
    const name = newCat.trim();
    if (!name) return;
    try {
      const cat = await createCategory(name);
      setCats((c) => [...c, cat]);
      setSelectedCats((prev) => new Set(prev).add(cat.id));
      setNewCat("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось создать тег");
    }
  }

  async function save() {
    if (!form.name.trim()) {
      setError("Укажите имя");
      return;
    }
    setSaving(true);
    setError(null);
    const catIds = [...selectedCats];
    try {
      if (contact) await updateContact(contact.id, form, catIds);
      else await createContact(form, catIds);
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось сохранить");
      setSaving(false);
    }
  }

  async function remove() {
    if (!contact) return;
    if (!confirm(`Удалить контакт «${contact.name}»?`)) return;
    setSaving(true);
    try {
      await deleteContact(contact.id);
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось удалить");
      setSaving(false);
    }
  }

  return (
    <div className="form">
      <div className="row-between">
        <h1 className="hello">{contact ? "Контакт" : "Новый контакт"}</h1>
        <button className="link-btn" onClick={onCancel}>
          Отмена
        </button>
      </div>

      <label className="field">
        <span>Имя *</span>
        <input className="input" value={form.name} onChange={(e) => set("name", e.target.value)} />
      </label>

      <label className="field">
        <span>Пол</span>
        <select
          className="input"
          value={form.gender ?? ""}
          onChange={(e) => set("gender", (e.target.value || null) as ContactInput["gender"])}
        >
          <option value="">—</option>
          <option value="male">Мужской</option>
          <option value="female">Женский</option>
        </select>
      </label>

      <label className="field">
        <span>Тип отношений</span>
        <input
          className="input"
          list="rel-types"
          value={form.relationship_type ?? ""}
          onChange={(e) => set("relationship_type", e.target.value || null)}
        />
        <datalist id="rel-types">
          {RELATIONSHIP_TYPES.map((r) => (
            <option key={r} value={r} />
          ))}
        </datalist>
      </label>

      <label className="field">
        <span>Близость</span>
        <select
          className="input"
          value={form.closeness ?? ""}
          onChange={(e) => set("closeness", e.target.value ? Number(e.target.value) : null)}
        >
          <option value="">—</option>
          {[1, 2, 3, 4, 5].map((n) => (
            <option key={n} value={n}>
              {n}/5
            </option>
          ))}
        </select>
      </label>

      <label className="field">
        <span>Обращение</span>
        <select
          className="input"
          value={form.address_form ?? ""}
          onChange={(e) => set("address_form", (e.target.value || null) as ContactInput["address_form"])}
        >
          <option value="">—</option>
          <option value="ты">на «ты»</option>
          <option value="вы">на «вы»</option>
        </select>
      </label>

      <label className="field">
        <span>Как называть</span>
        <input
          className="input"
          placeholder="напр. Саша — даже если на «вы»"
          value={form.call_name ?? ""}
          onChange={(e) => set("call_name", e.target.value || null)}
        />
      </label>

      <label className="field-check">
        <input
          type="checkbox"
          checked={form.is_mandatory}
          onChange={(e) => set("is_mandatory", e.target.checked)}
        />
        <span>Обязательно поздравить</span>
      </label>

      <label className="field">
        <span>День рождения</span>
        <input
          className="input"
          type="date"
          value={form.birthday ?? ""}
          onChange={(e) => set("birthday", e.target.value || null)}
        />
      </label>

      <label className="field">
        <span>Годовщина (дата)</span>
        <input
          className="input"
          type="date"
          value={form.anniversary_date ?? ""}
          onChange={(e) => set("anniversary_date", e.target.value || null)}
        />
      </label>

      <label className="field">
        <span>Годовщина (что за событие)</span>
        <input
          className="input"
          placeholder="напр. свадьба, знакомство"
          value={form.anniversary_label ?? ""}
          onChange={(e) => set("anniversary_label", e.target.value || null)}
        />
      </label>

      <label className="field">
        <span>Telegram username</span>
        <input
          className="input"
          placeholder="без @"
          value={form.telegram_username ?? ""}
          onChange={(e) => set("telegram_username", e.target.value || null)}
        />
      </label>

      <label className="field">
        <span>Контекст, факты, общие истории</span>
        <textarea
          className="input"
          rows={4}
          value={form.context_notes ?? ""}
          onChange={(e) => set("context_notes", e.target.value || null)}
        />
      </label>

      <div className="field">
        <span>Теги</span>
        <div className="cat-list">
          {cats.map((c) => (
            <label key={c.id} className="cat-chip">
              <input
                type="checkbox"
                checked={selectedCats.has(c.id)}
                onChange={() => toggleCat(c.id)}
              />
              <span>{c.name}</span>
            </label>
          ))}
          {cats.length === 0 && <span className="muted">Тегов пока нет</span>}
        </div>
        <div className="cat-add">
          <input
            className="input"
            placeholder="Новый тег"
            value={newCat}
            onChange={(e) => setNewCat(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                addCategory();
              }
            }}
          />
          <button className="btn-secondary" type="button" onClick={addCategory}>
            Создать
          </button>
        </div>
      </div>

      {error && <p className="error">{error}</p>}

      <div className="form-actions">
        <button className="btn-primary" onClick={save} disabled={saving}>
          {saving ? "Сохраняем…" : "Сохранить"}
        </button>
        {contact && (
          <button className="btn-danger" onClick={remove} disabled={saving}>
            Удалить
          </button>
        )}
      </div>

      {contact && <GreetingHistory contactId={contact.id} />}
    </div>
  );
}
