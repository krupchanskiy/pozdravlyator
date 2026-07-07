import { useEffect, useState } from "react";
import { getUpcomingEvents } from "../lib/api";
import type { UpcomingEvent } from "../lib/types";
import type { GenTarget } from "../App";
import { EVENT_LABELS, formatDayMonth, formatDaysUntil } from "../lib/format";

interface Props {
  firstName: string | null;
  onGoContacts: () => void;
  onGenerate: (t: GenTarget) => void;
  onEditContact: (contactId: string) => void;
}

// Главный экран — список ближайших событий (/api/events/upcoming).
export function MainScreen({ firstName, onGoContacts, onGenerate, onEditContact }: Props) {
  const [events, setEvents] = useState<UpcomingEvent[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getUpcomingEvents(60)
      .then(setEvents)
      .catch((e) => setError(e instanceof Error ? e.message : "Ошибка загрузки"));
  }, []);

  return (
    <>
      <h1 className="hello">Привет{firstName ? `, ${firstName}` : ""}!</h1>

      {error && <p className="error">{error}</p>}

      {events && events.length === 0 && (
        <section className="card">
          <h2 className="card-title">Ближайшие события</h2>
          <p className="muted empty">
            Пока пусто.{" "}
            <button className="link-btn inline" onClick={onGoContacts}>
              Добавьте контакты
            </button>{" "}
            — и здесь появятся ближайшие дни рождения и праздники.
          </p>
        </section>
      )}

      {events && events.length > 0 && (
        <section className="events">
          <h2 className="card-title">Ближайшие события</h2>
          <ul className="event-list">
            {events.map((e) => (
              <li key={`${e.contact_id}-${e.event_type}`} className="event-row">
                <div className="event-when">
                  <span className="event-date">{formatDayMonth(e.next_date)}</span>
                  <span className="event-rel muted">{formatDaysUntil(e.days_until)}</span>
                </div>
                <div className="event-main">
                  <div
                    className="event-name clickable"
                    title="Открыть карточку контакта"
                    onClick={() => onEditContact(e.contact_id)}
                  >
                    {e.is_mandatory && <span className="star" title="Обязательный">★</span>}
                    {e.name}
                  </div>
                  <div className="event-sub muted">
                    {EVENT_LABELS[e.event_type]}
                    {e.closeness ? ` • близость ${e.closeness}/5` : ""}
                  </div>
                  <button
                    className="btn-primary small mt8"
                    onClick={() =>
                      onGenerate({ contactId: e.contact_id, contactName: e.name, eventType: e.event_type })
                    }
                  >
                    Сгенерировать
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}
