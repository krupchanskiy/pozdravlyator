-- Настройки напоминаний (раздел 10 ТЗ).
alter table public.pzd_users add column if not exists reminder_enabled boolean not null default true;
alter table public.pzd_users add column if not exists remind_mandatory_only boolean not null default false;
