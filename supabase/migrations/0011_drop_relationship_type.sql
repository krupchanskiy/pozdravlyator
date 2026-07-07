-- Типы отношений упразднены: их роль полностью выполняют теги (решение 2026-07-07).
-- Существующие значения переносим в теги, чтобы не потерять данные.

-- 1) Теги из уникальных значений relationship_type (без учёта регистра),
--    имя — с заглавной буквы.
insert into public.pzd_contact_categories (user_id, name)
select distinct c.user_id,
       upper(left(c.relationship_type, 1)) || substr(c.relationship_type, 2)
from public.pzd_contacts c
where c.relationship_type is not null and trim(c.relationship_type) <> ''
  and not exists (
    select 1 from public.pzd_contact_categories cat
    where cat.user_id = c.user_id
      and lower(cat.name) = lower(c.relationship_type)
  );

-- 2) Привязки контактов к этим тегам.
insert into public.pzd_contact_category_links (contact_id, category_id)
select c.id, cat.id
from public.pzd_contacts c
join public.pzd_contact_categories cat
  on cat.user_id = c.user_id and lower(cat.name) = lower(c.relationship_type)
where c.relationship_type is not null and trim(c.relationship_type) <> ''
on conflict do nothing;

-- 3) Функция событий без relationship_type (меняется сигнатура — пересоздаём).
drop function if exists public.pzd_events_upcoming(int);

-- 4) Сама колонка.
alter table public.pzd_contacts drop column if exists relationship_type;

create function public.pzd_events_upcoming(_days_ahead int default 60)
returns table (
  contact_id        uuid,
  name              text,
  is_mandatory      boolean,
  address_form      text,
  closeness         int,
  telegram_username text,
  context_notes     text,
  event_type        text,
  source_date       date,
  next_date         date,
  days_until        int
)
language plpgsql
stable
security invoker
set search_path = public
as $$
declare
  _today date;
begin
  select (timezone(coalesce(u.timezone, 'UTC'), now()))::date
    into _today
  from public.pzd_users u
  where u.id = auth.uid();

  if _today is null then
    _today := (now())::date;
  end if;

  return query
  with ev as (
    select c.id, c.name, c.is_mandatory, c.address_form,
           c.closeness, c.telegram_username, c.context_notes,
           'birthday'::text as event_type, c.birthday as source_date
    from public.pzd_contacts c
    where c.birthday is not null
    union all
    select c.id, c.name, c.is_mandatory, c.address_form,
           c.closeness, c.telegram_username, c.context_notes,
           'anniversary'::text, c.anniversary_date
    from public.pzd_contacts c
    where c.anniversary_date is not null
  )
  select ev.id, ev.name, ev.is_mandatory, ev.address_form,
         ev.closeness, ev.telegram_username, ev.context_notes,
         ev.event_type, ev.source_date,
         public.pzd_next_occurrence(ev.source_date, _today)                 as next_date,
         (public.pzd_next_occurrence(ev.source_date, _today) - _today)::int as days_until
  from ev
  where (public.pzd_next_occurrence(ev.source_date, _today) - _today) <= _days_ahead
  order by ev.is_mandatory desc, next_date asc, ev.name asc;
end;
$$;

grant execute on function public.pzd_events_upcoming(int) to authenticated;
