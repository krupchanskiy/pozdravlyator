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
import { EditContactScreen } from "./screens/EditContactScreen";
import { SettingsScreen } from "./screens/SettingsScreen";
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
  // Карточка контакта поверх любого экрана (клик по имени); refreshKey
  // перемонтирует контент после сохранения, чтобы списки перечитались.
  const [editContactId, setEditContactId] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [showSettings, setShowSettings] = useState(false);
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

  if (showSettings && profile) {
    return (
      <SettingsScreen
        profile={profile}
        onBack={() => setShowSettings(false)}
        onSaved={loadProfile}
      />
    );
  }

  if (editContactId) {
    return (
      <EditContactScreen
        contactId={editContactId}
        onClose={(saved) => {
          setEditContactId(null);
          if (saved) setRefreshKey((k) => k + 1);
        }}
      />
    );
  }

  if (gen) {
    return (
      <GenerateScreen
        contactId={gen.contactId}
        contactName={gen.contactName}
        initialEventType={gen.eventType}
        onBack={() => setGen(null)}
        onEditContact={setEditContactId}
      />
    );
  }

  return (
    <div className="screen">
      <header className="app-header">
        <span className="app-title">Поздравлятор</span>
        <div className="header-btns">
          <button
            className="link-btn icon-btn"
            onClick={() => setShowSettings(true)}
            aria-label="Настройки"
            title="Настройки"
          >
            <svg
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.325.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 0 1 1.37.49l1.296 2.247a1.125 1.125 0 0 1-.26 1.431l-1.003.827c-.293.241-.438.613-.43.992a7.723 7.723 0 0 1 0 .255c-.008.378.137.75.43.991l1.004.827c.424.35.534.955.26 1.43l-1.298 2.247a1.125 1.125 0 0 1-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.47 6.47 0 0 1-.22.128c-.331.183-.581.495-.644.869l-.213 1.281c-.09.543-.56.94-1.11.94h-2.594c-.55 0-1.019-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 0 1-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 0 1-1.369-.49l-1.297-2.247a1.125 1.125 0 0 1 .26-1.431l1.004-.827c.292-.24.437-.613.43-.991a6.932 6.932 0 0 1 0-.255c.007-.38-.138-.751-.43-.992l-1.004-.827a1.125 1.125 0 0 1-.26-1.43l1.297-2.247a1.125 1.125 0 0 1 1.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.086.22-.128.332-.183.582-.495.644-.869l.214-1.28Z"
              />
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z"
              />
            </svg>
          </button>
          <button className="link-btn" onClick={() => supabase.auth.signOut()}>
            Выйти
          </button>
        </div>
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

      <main className="content" key={refreshKey}>
        {tab === "events" && (
          <MainScreen
            firstName={profile?.first_name ?? null}
            onGoContacts={() => setTab("contacts")}
            onGenerate={setGen}
            onEditContact={setEditContactId}
          />
        )}
        {tab === "contacts" && <ContactsScreen onGenerate={setGen} />}
        {tab === "style" && <StyleScreen />}
        {tab === "training" && <TrainingScreen />}
      </main>
    </div>
  );
}
