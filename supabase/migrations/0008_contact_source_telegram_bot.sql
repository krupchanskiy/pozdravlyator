-- Источник контакта, добавленного через Telegram-бота свободным текстом.
alter table public.pzd_contacts drop constraint if exists pzd_contacts_source_check;
alter table public.pzd_contacts add constraint pzd_contacts_source_check
  check (source = any (array['manual'::text, 'google_contacts'::text, 'telegram_bot'::text]));
