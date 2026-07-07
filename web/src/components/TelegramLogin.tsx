import { useEffect, useRef, useState } from "react";
import { supabase, telegramAuthUrl } from "../lib/supabase";

// Данные, которые присылает Telegram Login Widget в callback.
export interface TelegramUser {
  id: number;
  first_name?: string;
  last_name?: string;
  username?: string;
  photo_url?: string;
  auth_date: number;
  hash: string;
}

const BOT_USERNAME = import.meta.env.VITE_TELEGRAM_BOT_USERNAME as string;
const ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

export function TelegramLogin() {
  const containerRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    // Глобальный callback, на который ссылается атрибут data-onauth виджета.
    (window as unknown as Record<string, unknown>).onTelegramAuth = async (user: TelegramUser) => {
      setBusy(true);
      setError(null);
      try {
        const resp = await fetch(telegramAuthUrl, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            apikey: ANON_KEY,
            Authorization: `Bearer ${ANON_KEY}`,
          },
          body: JSON.stringify(user),
        });
        const body = await resp.json();
        if (!resp.ok) throw new Error(body?.error ?? "auth_failed");

        const { error: sessErr } = await supabase.auth.setSession({
          access_token: body.access_token,
          refresh_token: body.refresh_token,
        });
        if (sessErr) throw sessErr;
        // onAuthStateChange в App подхватит новую сессию и перерисует экран.
      } catch (e) {
        setError(e instanceof Error ? e.message : "Не удалось войти");
        setBusy(false);
      }
    };

    if (!BOT_USERNAME) {
      setError("Не задан VITE_TELEGRAM_BOT_USERNAME");
      return;
    }

    // StrictMode в dev монтирует эффект дважды — не вставляем виджет повторно.
    if (containerRef.current && containerRef.current.childElementCount > 0) return;

    const script = document.createElement("script");
    script.src = "https://telegram.org/js/telegram-widget.js?22";
    script.async = true;
    script.setAttribute("data-telegram-login", BOT_USERNAME);
    script.setAttribute("data-size", "large");
    script.setAttribute("data-radius", "12");
    script.setAttribute("data-onauth", "onTelegramAuth(user)");
    script.setAttribute("data-request-access", "write");
    containerRef.current?.appendChild(script);
  }, []);

  return (
    <div className="tg-login">
      <div ref={containerRef} />
      {busy && <p className="muted">Входим…</p>}
      {error && <p className="error">Ошибка входа: {error}</p>}
    </div>
  );
}
