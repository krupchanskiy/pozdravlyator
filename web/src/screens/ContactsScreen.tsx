import { useEffect, useState } from "react";
import { googleImportInit, listCategories, listContacts, listContactTags } from "../lib/api";
import type { Category, Contact } from "../lib/types";
import type { GenTarget } from "../App";
import { ContactForm } from "./ContactForm";
import { CategoriesScreen } from "./CategoriesScreen";

type Mode =
  | { kind: "list" }
  | { kind: "new" }
  | { kind: "edit"; contact: Contact }
  | { kind: "categories" };

interface Props {
  onGenerate: (t: GenTarget) => void;
}

export function ContactsScreen({ onGenerate }: Props) {
  const [mode, setMode] = useState<Mode>({ kind: "list" });
  const [contacts, setContacts] = useState<Contact[] | null>(null);
  const [categories, setCategories] = useState<Category[]>([]);
  const [catFilter, setCatFilter] = useState<Set<string>>(new Set());
  const [tagsByContact, setTagsByContact] = useState<Map<string, string[]>>(new Map());
  const [search, setSearch] = useState("");
  const [error, setError] = useState<string | null>(null);

  // Быстрый поиск по имени/«как называть» — фильтрация на клиенте.
  const query = search.trim().toLowerCase();
  const visibleContacts = (contacts ?? []).filter(
    (c) =>
      !query ||
      c.name.toLowerCase().includes(query) ||
      (c.call_name ?? "").toLowerCase().includes(query),
  );

  async function reload() {
    setError(null);
    try {
      const [cs, cats, tags] = await Promise.all([
        listContacts({ categoryIds: catFilter.size ? [...catFilter] : undefined }),
        listCategories(),
        listContactTags(),
      ]);
      setContacts(cs);
      setCategories(cats);
      setTagsByContact(tags);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ошибка загрузки");
    }
  }

  useEffect(() => {
    reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [catFilter]);

  // Чип-фильтр по тегам: мультивыбор, семантика ИЛИ.
  function toggleCatFilter(id: string) {
    setCatFilter((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function importGoogle() {
    setError(null);
    try {
      const redirect = window.location.origin + import.meta.env.BASE_URL;
      const url = await googleImportInit(redirect);
      window.location.href = url; // уходим на согласие Google
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось начать импорт");
    }
  }

  if (mode.kind === "categories") {
    return <CategoriesScreen onBack={() => setMode({ kind: "list" })} />;
  }

  if (mode.kind !== "list") {
    return (
      <ContactForm
        contact={mode.kind === "edit" ? mode.contact : null}
        categories={categories}
        onCancel={() => setMode({ kind: "list" })}
        onSaved={() => {
          setMode({ kind: "list" });
          reload();
        }}
      />
    );
  }

  return (
    <>
      <div className="list-header">
        <h1 className="hello">Контакты</h1>
        <div className="header-actions">
          <button className="btn-secondary small" onClick={() => setMode({ kind: "categories" })}>
            Теги
          </button>
          <button className="btn-secondary small" onClick={importGoogle}>
            Импорт из Google
          </button>
          <button className="btn-primary small" onClick={() => setMode({ kind: "new" })}>
            + Добавить
          </button>
        </div>
      </div>

      <input
        className="input search-input"
        type="search"
        placeholder="Поиск по имени"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
      />

      {categories.length > 0 && (
        <div className="label-pick tag-filter">
          {categories.map((c) => (
            <button
              key={c.id}
              className={catFilter.has(c.id) ? "label-btn active" : "label-btn"}
              onClick={() => toggleCatFilter(c.id)}
            >
              {c.name}
            </button>
          ))}
          {catFilter.size > 0 && (
            <button className="link-btn" onClick={() => setCatFilter(new Set())}>
              Сбросить
            </button>
          )}
        </div>
      )}

      {error && <p className="error">{error}</p>}

      {contacts && contacts.length === 0 && (
        <p className="muted empty">Контактов пока нет. Нажмите «Добавить».</p>
      )}

      {contacts && contacts.length > 0 && visibleContacts.length === 0 && (
        <p className="muted empty">Никого не нашлось по запросу «{search.trim()}».</p>
      )}

      {visibleContacts.length > 0 && (
        <ul className="contact-list">
          {visibleContacts.map((c) => (
            <li key={c.id} className="contact-row">
              <div onClick={() => setMode({ kind: "edit", contact: c })}>
                <div className="contact-name">
                  {c.is_mandatory && <span className="star">★</span>}
                  {c.name}
                </div>
                <div className="contact-sub muted">
                  {[
                    (tagsByContact.get(c.id) ?? []).join(", ") || null,
                    c.closeness ? `близость ${c.closeness}/5` : null,
                    c.address_form ? `на «${c.address_form}»` : null,
                  ]
                    .filter(Boolean)
                    .join(" • ")}
                </div>
              </div>
              <button
                className="btn-primary small mt8"
                onClick={() =>
                  onGenerate({ contactId: c.id, contactName: c.name, eventType: "birthday" })
                }
              >
                Сгенерировать
              </button>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
