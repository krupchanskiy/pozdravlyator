import { useCallback, useEffect, useRef, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "./lib/supabase";
import { getProfile, googleImportRun } from "./lib/api";
import type { Profile } from "./lib/types";
import { TelegramLogin } from "./components/TelegramLogin";
import { TimezoneGate } from "./screens/TimezoneGate";
import { MainScreen } from "./screens/MainScreen";
import { ContactsScreen } from "./screens/ContactsScreen";
import { StyleScreen } from "./screens/StyleScreen";
import { TrainingScreen } from "./screens/TrainingScreen";
import { GenerateScreen } from "./screens/GenerateScreen";
import type { EventType } from "./lib/types";
import "./App.css";

type Tab = "events" | "contacts" | "style" | "training";

export interface GenTarget {
  contactId: string;
  contactName: string;
  eventType: EventType;
}

export default function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<Tab>("events");
  const [gen, setGen] = useState<GenTarget | null>(null);
  const [importMsg, setImportMsg] = useState<string | null>(null);
  const importHandled = useRef(false);

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

  // Возврат из Google OAuth: ?code=... → обмениваем на контакты.
  useEffect(() => {
    if (!session || importHandled.current) return;
    const params = new URLSearchParams(window.location.search);
    const code = params.get("code");
    if (!code) return;
    importHandled.current = true;
    const redirect = window.location.origin + import.meta.env.BASE_URL;
    googleImportRun(code, redirect).then((res) => {
      // Убираем ?code из URL, чтобы код не переиспользовался при перезагрузке.
      window.history.replaceState({}, "", import.meta.env.BASE_URL);
      setTab("contacts");
      setImportMsg(
        "imported" in res
          ? `Импортировано из Google: ${res.imported}`
          : `Ошибка импорта: ${res.error}`,
      );
    });
  }, [session]);

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

  if (gen) {
    return (
      <GenerateScreen
        contactId={gen.contactId}
        contactName={gen.contactName}
        initialEventType={gen.eventType}
        onBack={() => setGen(null)}
      />
    );
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
        <button className={tab === "style" ? "tab active" : "tab"} onClick={() => setTab("style")}>
          Стиль
        </button>
        <button className={tab === "training" ? "tab active" : "tab"} onClick={() => setTab("training")}>
          Тренировка
        </button>
      </nav>

      {importMsg && (
        <div className="import-banner" onClick={() => setImportMsg(null)}>
          {importMsg} <span className="muted">(нажмите, чтобы скрыть)</span>
        </div>
      )}

      <main className="content">
        {tab === "events" && (
          <MainScreen
            firstName={profile?.first_name ?? null}
            onGoContacts={() => setTab("contacts")}
            onGenerate={setGen}
          />
        )}
        {tab === "contacts" && <ContactsScreen onGenerate={setGen} />}
        {tab === "style" && <StyleScreen />}
        {tab === "training" && <TrainingScreen />}
      </main>
    </div>
  );
}
