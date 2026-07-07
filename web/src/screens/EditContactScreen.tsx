import { useEffect, useState } from "react";
import { getContact, listCategories } from "../lib/api";
import type { Category, Contact } from "../lib/types";
import { ContactForm } from "./ContactForm";

interface Props {
  contactId: string;
  onClose: (saved: boolean) => void; // saved=true → списки на экранах надо обновить
}

// Полноэкранная карточка контакта: открывается кликом по имени с любого экрана
// (главный, генерация). Загружает контакт и теги, рендерит обычную форму.
export function EditContactScreen({ contactId, onClose }: Props) {
  const [contact, setContact] = useState<Contact | null>(null);
  const [categories, setCategories] = useState<Category[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([getContact(contactId), listCategories()])
      .then(([c, cats]) => {
        if (!c) {
          setError("Контакт не найден");
          return;
        }
        setContact(c);
        setCategories(cats);
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Ошибка загрузки"));
  }, [contactId]);

  return (
    <div className="screen">
      <main className="content">
        {error && (
          <>
            <p className="error">{error}</p>
            <button className="btn-secondary" onClick={() => onClose(false)}>
              ← Назад
            </button>
          </>
        )}
        {!contact && !error && <p className="muted">Загрузка…</p>}
        {contact && (
          <ContactForm
            contact={contact}
            categories={categories}
            onCancel={() => onClose(false)}
            onSaved={() => onClose(true)}
          />
        )}
      </main>
    </div>
  );
}
