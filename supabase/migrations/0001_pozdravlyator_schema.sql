-- Поздравлятор — схема данных (раздел 14 ТЗ + дополнение раздела 5a).
-- Живёт в общем проекте PanditJi, поэтому все таблицы с префиксом pzd_,
-- чтобы не конфликтовать с существующими таблицами public.*.
-- RLS включён на всех таблицах, доступ строго по auth.uid().

------------------------------------------------------------------------------
-- users: приложенческий профиль. id совпадает с auth.users(id).
------------------------------------------------------------------------------
create table if not exists public.pzd_users (
    id                uuid primary key references auth.users(id) on delete cascade,
    telegram_user_id  bigint not null unique,
    telegram_username text,
    first_name        text,
    timezone          text not null,                     -- IANA tz, напр. "Europe/Moscow"
    reminder_time     time not null default '09:00',
    created_at        timestamptz not null default now()
);

------------------------------------------------------------------------------
-- contacts
------------------------------------------------------------------------------
create table if not exists public.pzd_contacts (
    id                uuid primary key default gen_random_uuid(),
    user_id           uuid not null references public.pzd_users(id) on delete cascade,
    name              text not null,
    gender            text,                              -- для 8 марта / 23 февраля
    relationship_type text,                              -- друг/коллега/клиент/родственник/знакомый
    closeness         int check (closeness between 1 and 5),
    address_form      text check (address_form in ('ты', 'вы')),
    is_mandatory      boolean not null default false,
    context_notes     text,                              -- свободный текст с фактами
    birthday          date,
    anniversary_date  date,
    anniversary_label text,
    telegram_username text,                              -- опционально, без функционала импорта
    source            text not null default 'manual' check (source in ('manual', 'google_contacts')),
    created_at        timestamptz not null default now()
);

create index if not exists pzd_contacts_user_id_idx  on public.pzd_contacts (user_id);
create index if not exists pzd_contacts_birthday_idx  on public.pzd_contacts (birthday);

------------------------------------------------------------------------------
-- contact_categories + links
------------------------------------------------------------------------------
create table if not exists public.pzd_contact_categories (
    id      uuid primary key default gen_random_uuid(),
    user_id uuid not null references public.pzd_users(id) on delete cascade,
    name    text not null
);

create index if not exists pzd_contact_categories_user_id_idx on public.pzd_contact_categories (user_id);

create table if not exists public.pzd_contact_category_links (
    contact_id  uuid not null references public.pzd_contacts(id) on delete cascade,
    category_id uuid not null references public.pzd_contact_categories(id) on delete cascade,
    primary key (contact_id, category_id)
);

create index if not exists pzd_ccl_category_id_idx on public.pzd_contact_category_links (category_id);

------------------------------------------------------------------------------
-- style_examples
------------------------------------------------------------------------------
create table if not exists public.pzd_style_examples (
    id          uuid primary key default gen_random_uuid(),
    user_id     uuid not null references public.pzd_users(id) on delete cascade,
    text        text not null,
    label       text not null check (label in ('reference', 'ok', 'skip')),
    source_note text,                                    -- откуда добавлено (WhatsApp/SMS/…)
    created_at  timestamptz not null default now()
);

create index if not exists pzd_style_examples_user_id_idx on public.pzd_style_examples (user_id);

------------------------------------------------------------------------------
-- style_settings (мини-опрос)
------------------------------------------------------------------------------
create table if not exists public.pzd_style_settings (
    user_id                   uuid primary key references public.pzd_users(id) on delete cascade,
    emoji_frequency           text check (emoji_frequency in ('often', 'sometimes', 'never')),
    brackets_instead_of_emoji boolean,
    exclamation_style         text check (exclamation_style in ('many', 'single_end', 'avoid')),
    capitalization            text check (capitalization in ('always_correct', 'often_lowercase')),
    length_preference         text check (length_preference in ('short', 'medium', 'long'))
);

------------------------------------------------------------------------------
-- training_sessions (раздел 5a) — создаём до generations из-за FK
------------------------------------------------------------------------------
create table if not exists public.pzd_training_sessions (
    id           uuid primary key default gen_random_uuid(),
    user_id      uuid not null references public.pzd_users(id) on delete cascade,
    event_type   text not null,
    contact_ids  uuid[] not null default '{}',           -- представители, отобранные для сессии
    started_at   timestamptz not null default now(),
    completed_at timestamptz
);

create index if not exists pzd_training_sessions_user_id_idx on public.pzd_training_sessions (user_id);

------------------------------------------------------------------------------
-- generations (+ поля source / training_session_id из раздела 5a)
------------------------------------------------------------------------------
create table if not exists public.pzd_generations (
    id                  uuid primary key default gen_random_uuid(),
    user_id             uuid not null references public.pzd_users(id) on delete cascade,
    contact_id          uuid references public.pzd_contacts(id) on delete cascade,
    event_type          text not null check (event_type in ('birthday', 'new_year', 'mar8', 'feb23', 'anniversary')),
    user_wishes         text,
    variants            jsonb not null,                  -- [{text, feedback:'good'|'bad'|null, bad_reason:text|null}]
    final_text          text,                            -- реально скопированный текст (после правок)
    source              text not null default 'user_initiated'
                        check (source in ('user_initiated', 'reminder_bot', 'training')),
    training_session_id uuid references public.pzd_training_sessions(id) on delete set null,
    created_at          timestamptz not null default now()
);

create index if not exists pzd_generations_user_id_idx    on public.pzd_generations (user_id);
create index if not exists pzd_generations_contact_id_idx on public.pzd_generations (contact_id);
create index if not exists pzd_generations_session_idx    on public.pzd_generations (training_session_id);

------------------------------------------------------------------------------
-- reminders_log
------------------------------------------------------------------------------
create table if not exists public.pzd_reminders_log (
    id          uuid primary key default gen_random_uuid(),
    user_id     uuid not null references public.pzd_users(id) on delete cascade,
    contact_id  uuid references public.pzd_contacts(id) on delete cascade,
    event_date  date not null,
    sent_at     timestamptz not null default now(),
    is_followup boolean not null default false
);

create index if not exists pzd_reminders_log_user_id_idx on public.pzd_reminders_log (user_id);

------------------------------------------------------------------------------
-- Привилегии для роли authenticated (PostgREST переключается на неё).
-- Доступ к строкам далее ограничивает RLS.
------------------------------------------------------------------------------
grant usage on schema public to authenticated;
grant select, insert, update, delete on
    public.pzd_users,
    public.pzd_contacts,
    public.pzd_contact_categories,
    public.pzd_contact_category_links,
    public.pzd_style_examples,
    public.pzd_style_settings,
    public.pzd_training_sessions,
    public.pzd_generations,
    public.pzd_reminders_log
to authenticated;

------------------------------------------------------------------------------
-- RLS: включаем на всех таблицах, доступ строго к своим user_id / auth.uid()
------------------------------------------------------------------------------
alter table public.pzd_users                 enable row level security;
alter table public.pzd_contacts              enable row level security;
alter table public.pzd_contact_categories    enable row level security;
alter table public.pzd_contact_category_links enable row level security;
alter table public.pzd_style_examples        enable row level security;
alter table public.pzd_style_settings        enable row level security;
alter table public.pzd_training_sessions     enable row level security;
alter table public.pzd_generations           enable row level security;
alter table public.pzd_reminders_log         enable row level security;

-- pzd_users: строка = сам пользователь (id = auth.uid())
create policy pzd_users_self on public.pzd_users
    for all to authenticated
    using (id = auth.uid())
    with check (id = auth.uid());

-- Таблицы с прямым user_id
create policy pzd_contacts_own on public.pzd_contacts
    for all to authenticated
    using (user_id = auth.uid())
    with check (user_id = auth.uid());

create policy pzd_contact_categories_own on public.pzd_contact_categories
    for all to authenticated
    using (user_id = auth.uid())
    with check (user_id = auth.uid());

create policy pzd_style_examples_own on public.pzd_style_examples
    for all to authenticated
    using (user_id = auth.uid())
    with check (user_id = auth.uid());

create policy pzd_style_settings_own on public.pzd_style_settings
    for all to authenticated
    using (user_id = auth.uid())
    with check (user_id = auth.uid());

create policy pzd_training_sessions_own on public.pzd_training_sessions
    for all to authenticated
    using (user_id = auth.uid())
    with check (user_id = auth.uid());

create policy pzd_generations_own on public.pzd_generations
    for all to authenticated
    using (user_id = auth.uid())
    with check (user_id = auth.uid());

create policy pzd_reminders_log_own on public.pzd_reminders_log
    for all to authenticated
    using (user_id = auth.uid())
    with check (user_id = auth.uid());

-- Линк-таблица без user_id: владение определяется через контакт
create policy pzd_contact_category_links_own on public.pzd_contact_category_links
    for all to authenticated
    using (
        exists (
            select 1 from public.pzd_contacts c
            where c.id = contact_id and c.user_id = auth.uid()
        )
    )
    with check (
        exists (
            select 1 from public.pzd_contacts c
            where c.id = contact_id and c.user_id = auth.uid()
        )
    );
