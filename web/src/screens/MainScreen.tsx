import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";

interface Props {
  userId: string;
}

// Главный экран (этап 1): пока пустой — список ближайших событий появится на этапе 2.
export function MainScreen({ userId }: Props) {
  const [firstName, setFirstName] = useState<string | null>(null);

  useEffect(() => {
    supabase
      .from("pzd_users")
      .select("first_name")
      .eq("id", userId)
      .maybeSingle()
      .then(({ data }) => setFirstName(data?.first_name ?? null));
  }, [userId]);

  return (
    <div className="screen">
      <header className="app-header">
        <span className="app-title">Поздравлятор</span>
        <button className="link-btn" onClick={() => supabase.auth.signOut()}>
          Выйти
        </button>
      </header>

      <main className="content">
        <h1 className="hello">Привет{firstName ? `, ${firstName}` : ""}!</h1>
        <section className="card">
          <h2 className="card-title">Ближайшие события</h2>
          <p className="muted empty">
            Пока пусто. Добавьте контакты — и здесь появятся ближайшие дни рождения и праздники.
          </p>
        </section>
      </main>
    </div>
  );
}
