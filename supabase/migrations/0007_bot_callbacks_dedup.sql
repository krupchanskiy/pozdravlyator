-- Идемпотентность обработки Telegram-callback'ов бота.
-- Медленный webhook (генерация ~13с) провоцирует повторную доставку одного и
-- того же апдейта — без дедупа это даёт дубли генераций. Ключ — callback_query.id
-- (при ретрае Telegram шлёт тот же id).
create table if not exists public.pzd_bot_callbacks (
  callback_id text primary key,
  telegram_user_id bigint not null,
  created_at timestamptz not null default now()
);

-- Таблицу трогает только сервисная роль (обходит RLS). Включаем RLS без политик —
-- дефолтный deny для anon/authenticated.
alter table public.pzd_bot_callbacks enable row level security;

-- Явная запрещающая политика (требование проекта: raw RLS на всех таблицах).
drop policy if exists "pzd_bot_callbacks deny all" on public.pzd_bot_callbacks;
create policy "pzd_bot_callbacks deny all"
  on public.pzd_bot_callbacks
  for all
  to anon, authenticated
  using (false)
  with check (false);
