import { useCallback, useEffect, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "./lib/supabase";
import { getProfile } from "./lib/api";
import type { Profile } from "./lib/types";
import { TelegramLogin } from "./components/TelegramLogin";
import { TimezoneGate } from "./screens/TimezoneGate";
import { MainScreen } from "./screens/MainScreen";
import { ContactsScreen } from "./screens/ContactsScreen";
import "./App.css";

type Tab = "events" | "contacts";

export default function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<Tab>("events");

  const loadProfile = useCallback(async () => {
    try {
      setProfile(await getProfile());
    } catch {
      setProfile(null);
    }
  }, []);

  useEffect(() => {
    supabase.auth.getSession().then(async ({ data }) => {
      setSession(data.session);
      if (data.session) await loadProfile();
      setLoading(false);
    });
    const { data: sub } = supabase.auth.onAuthStateChange(async (_e, s) => {
      setSession(s);
      if (s) await loadProfile();
      else setProfile(null);
    });
    return () => sub.subscription.unsubscribe();
  }, [loadProfile]);

  if (loading) return <div className="screen center muted">Загрузка…</div>;

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

  if (profile && !profile.timezone) {
    return <TimezoneGate onDone={loadProfile} />;
  }

  return (
    <div className="screen">
      <header className="app-header">
        <span className="app-title">Поздравлятор</span>
        <button className="link-btn" onClick={() => supabase.auth.signOut()}>
          Выйти
        </button>
      </header>

      <nav className="tabs">
        <button className={tab === "events" ? "tab active" : "tab"} onClick={() => setTab("events")}>
          События
        </button>
        <button className={tab === "contacts" ? "tab active" : "tab"} onClick={() => setTab("contacts")}>
          Контакты
        </button>
      </nav>

      <main className="content">
        {tab === "events" ? (
          <MainScreen firstName={profile?.first_name ?? null} onGoContacts={() => setTab("contacts")} />
        ) : (
          <ContactsScreen />
        )}
      </main>
    </div>
  );
}
