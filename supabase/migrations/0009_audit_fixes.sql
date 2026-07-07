-- Правки по итогам аудита (2026-07-07).

------------------------------------------------------------------------------
-- 1) event_type в логе напоминаний: ДР и годовщина одного контакта в один день
--    дедупились как одно событие — второе терялось.
------------------------------------------------------------------------------
alter table public.pzd_reminders_log
  add column if not exists event_type text not null default 'birthday';

------------------------------------------------------------------------------
-- 2) Запрет менять telegram_user_id: RLS позволяла пользователю вписать чужой
--    tg id → напоминания бота ушли бы в чужой чат (chat_id == telegram_user_id).
------------------------------------------------------------------------------
create or replace function public.pzd_users_lock_telegram_id()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.telegram_user_id is distinct from old.telegram_user_id then
    raise exception 'telegram_user_id менять нельзя';
  end if;
  return new;
end;
$$;

drop trigger if exists pzd_users_lock_telegram_id on public.pzd_users;
create trigger pzd_users_lock_telegram_id
  before update on public.pzd_users
  for each row execute function public.pzd_users_lock_telegram_id();

------------------------------------------------------------------------------
-- 3) Фиксируем search_path у pzd-функций (советник безопасности).
------------------------------------------------------------------------------
alter function public.pzd_occurrence_in_year(int, int, int) set search_path = public;
alter function public.pzd_next_occurrence(date, date)       set search_path = public;
alter function public.pzd_events_upcoming(int)              set search_path = public;

------------------------------------------------------------------------------
-- 4) Индексы на неиндексированные FK (contact_id читается каждым прогоном крона).
------------------------------------------------------------------------------
create index if not exists pzd_reminders_log_contact_id_idx
  on public.pzd_reminders_log (contact_id);
create index if not exists pzd_wvs_session_idx
  on public.pzd_wish_vector_suggestions (source_training_session_id);

------------------------------------------------------------------------------
-- 5) RLS initplan: auth.uid() → (select auth.uid()), чтобы не пересчитывать
--    на каждую строку (советник производительности). Логика политик не меняется.
------------------------------------------------------------------------------
drop policy if exists pzd_users_self on public.pzd_users;
create policy pzd_users_self on public.pzd_users
    for all to authenticated
    using (id = (select auth.uid()))
    with check (id = (select auth.uid()));

drop policy if exists pzd_contacts_own on public.pzd_contacts;
create policy pzd_contacts_own on public.pzd_contacts
    for all to authenticated
    using (user_id = (select auth.uid()))
    with check (user_id = (select auth.uid()));

drop policy if exists pzd_contact_categories_own on public.pzd_contact_categories;
create policy pzd_contact_categories_own on public.pzd_contact_categories
    for all to authenticated
    using (user_id = (select auth.uid()))
    with check (user_id = (select auth.uid()));

drop policy if exists pzd_style_examples_own on public.pzd_style_examples;
create policy pzd_style_examples_own on public.pzd_style_examples
    for all to authenticated
    using (user_id = (select auth.uid()))
    with check (user_id = (select auth.uid()));

drop policy if exists pzd_style_settings_own on public.pzd_style_settings;
create policy pzd_style_settings_own on public.pzd_style_settings
    for all to authenticated
    using (user_id = (select auth.uid()))
    with check (user_id = (select auth.uid()));

drop policy if exists pzd_training_sessions_own on public.pzd_training_sessions;
create policy pzd_training_sessions_own on public.pzd_training_sessions
    for all to authenticated
    using (user_id = (select auth.uid()))
    with check (user_id = (select auth.uid()));

drop policy if exists pzd_generations_own on public.pzd_generations;
create policy pzd_generations_own on public.pzd_generations
    for all to authenticated
    using (user_id = (select auth.uid()))
    with check (user_id = (select auth.uid()));

drop policy if exists pzd_reminders_log_own on public.pzd_reminders_log;
create policy pzd_reminders_log_own on public.pzd_reminders_log
    for all to authenticated
    using (user_id = (select auth.uid()))
    with check (user_id = (select auth.uid()));

drop policy if exists pzd_contact_category_links_own on public.pzd_contact_category_links;
create policy pzd_contact_category_links_own on public.pzd_contact_category_links
    for all to authenticated
    using (
        exists (
            select 1 from public.pzd_contacts c
            where c.id = contact_id and c.user_id = (select auth.uid())
        )
    )
    with check (
        exists (
            select 1 from public.pzd_contacts c
            where c.id = contact_id and c.user_id = (select auth.uid())
        )
    );

drop policy if exists pzd_wvs_own on public.pzd_wish_vector_suggestions;
create policy pzd_wvs_own on public.pzd_wish_vector_suggestions
  for all to authenticated
  using (exists (
    select 1 from public.pzd_contact_categories c
    where c.id = category_id and c.user_id = (select auth.uid())
  ))
  with check (exists (
    select 1 from public.pzd_contact_categories c
    where c.id = category_id and c.user_id = (select auth.uid())
  ));
