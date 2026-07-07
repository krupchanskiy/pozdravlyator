import { useEffect, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "./lib/supabase";
import { TelegramLogin } from "./components/TelegramLogin";
import { MainScreen } from "./screens/MainScreen";
import "./App.css";

export default function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setLoading(false);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => {
      setSession(s);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  if (loading) {
    return <div className="screen center muted">Загрузка…</div>;
  }

  if (!session) {
    return (
      <div className="screen center login-screen">
        <div className="login-box">
          <h1 className="brand">Поздравлятор</h1>
          <p className="muted">
            Персональные поздравления в вашем стиле. Войдите через Telegram, чтобы начать.
          </p>
          <TelegramLogin />
        </div>
      </div>
    );
  }

  return <MainScreen userId={session.user.id} />;
}
