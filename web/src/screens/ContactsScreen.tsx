import { useEffect, useState } from "react";
import { listCategories, listContacts } from "../lib/api";
import type { Category, Contact } from "../lib/types";
import { RELATIONSHIP_TYPES } from "../lib/types";
import type { GenTarget } from "../App";
import { ContactForm } from "./ContactForm";

type Mode = { kind: "list" } | { kind: "new" } | { kind: "edit"; contact: Contact };

interface Props {
  onGenerate: (t: GenTarget) => void;
}

export function ContactsScreen({ onGenerate }: Props) {
  const [mode, setMode] = useState<Mode>({ kind: "list" });
  const [contacts, setContacts] = useState<Contact[] | null>(null);
  const [categories, setCategories] = useState<Category[]>([]);
  const [catFilter, setCatFilter] = useState("");
  const [relFilter, setRelFilter] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function reload() {
    setError(null);
    try {
      const [cs, cats] = await Promise.all([
        listContacts({
          categoryId: catFilter || undefined,
          relationshipType: relFilter || undefined,
        }),
        listCategories(),
      ]);
      setContacts(cs);
      setCategories(cats);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ошибка загрузки");
    }
  }

  useEffect(() => {
    reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [catFilter, relFilter]);

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
      <div className="row-between">
        <h1 className="hello">Контакты</h1>
        <button className="btn-primary small" onClick={() => setMode({ kind: "new" })}>
          + Добавить
        </button>
      </div>

      <div className="filters">
        <select className="input" value={relFilter} onChange={(e) => setRelFilter(e.target.value)}>
          <option value="">Все типы отношений</option>
          {RELATIONSHIP_TYPES.map((r) => (
            <option key={r} value={r}>
              {r}
            </option>
          ))}
        </select>
        <select className="input" value={catFilter} onChange={(e) => setCatFilter(e.target.value)}>
          <option value="">Все категории</option>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </div>

      {error && <p className="error">{error}</p>}

      {contacts && contacts.length === 0 && (
        <p className="muted empty">Контактов пока нет. Нажмите «Добавить».</p>
      )}

      {contacts && contacts.length > 0 && (
        <ul className="contact-list">
          {contacts.map((c) => (
            <li key={c.id} className="contact-row">
              <div onClick={() => setMode({ kind: "edit", contact: c })}>
                <div className="contact-name">
                  {c.is_mandatory && <span className="star">★</span>}
                  {c.name}
                </div>
                <div className="contact-sub muted">
                  {[c.relationship_type, c.closeness ? `близость ${c.closeness}/5` : null, c.address_form ? `на «${c.address_form}»` : null]
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
