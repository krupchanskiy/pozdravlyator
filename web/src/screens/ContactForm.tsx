import { useEffect, useState } from "react";
import {
  createCategory,
  createContact,
  deleteContact,
  getContactCategoryIds,
  updateContact,
} from "../lib/api";
import type { Category, Contact, ContactInput } from "../lib/types";
import { RELATIONSHIP_TYPES } from "../lib/types";

interface Props {
  contact: Contact | null; // null → создание
  categories: Category[];
  onCancel: () => void;
  onSaved: () => void;
}

function emptyInput(): ContactInput {
  return {
    name: "",
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
      next.has(id) ? next.delete(id) : next.add(id);
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
      setError(e instanceof Error ? e.message : "Не удалось создать категорию");
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
        <span>Категории</span>
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
          {cats.length === 0 && <span className="muted">Категорий пока нет</span>}
        </div>
        <div className="cat-add">
          <input
            className="input"
            placeholder="Новая категория"
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
    </div>
  );
}
