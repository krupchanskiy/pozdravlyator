-- Серверная логика ближайших событий (раздел 7, 11 ТЗ) + edge case 29 февраля.
-- Всё с префиксом pzd_, чтобы не конфликтовать с PanditJi.

------------------------------------------------------------------------------
-- Дата события в конкретном году с обработкой 29 февраля.
-- Для 29.02 в невисокосный год возвращаем 28 февраля (рекомендация ТЗ, раздел 7).
------------------------------------------------------------------------------
create or replace function public.pzd_occurrence_in_year(_month int, _day int, _year int)
returns date
language plpgsql
immutable
as $$
declare
  d date;
begin
  if _month = 2 and _day = 29 then
    begin
      d := make_date(_year, 2, 29);          -- високосный — оставляем 29.02
    exception when others then
      d := make_date(_year, 2, 28);          -- невисокосный — 28.02
    end;
  else
    d := make_date(_year, _month, _day);
  end if;
  return d;
end;
$$;

------------------------------------------------------------------------------
-- Ближайшая будущая дата события (>= _today) по дате _d (день/месяц из неё).
------------------------------------------------------------------------------
create or replace function public.pzd_next_occurrence(_d date, _today date)
returns date
language plpgsql
immutable
as $$
declare
  m    int := extract(month from _d)::int;
  dd   int := extract(day   from _d)::int;
  cand date;
begin
  cand := public.pzd_occurrence_in_year(m, dd, extract(year from _today)::int);
  if cand < _today then
    cand := public.pzd_occurrence_in_year(m, dd, extract(year from _today)::int + 1);
  end if;
  return cand;
end;
$$;

------------------------------------------------------------------------------
-- /api/events/upcoming — ближайшие персональные события пользователя.
-- SECURITY INVOKER: RLS на pzd_contacts/pzd_users сама ограничивает доступ
-- строкой auth.uid(). «Сегодня» считается в часовом поясе пользователя.
-- Сортировка: обязательные — в топе (раздел 11), затем по дате.
------------------------------------------------------------------------------
create or replace function public.pzd_events_upcoming(_days_ahead int default 60)
returns table (
  contact_id        uuid,
  name              text,
  is_mandatory      boolean,
  relationship_type text,
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
as $$
declare
  _today date;
begin
  -- сегодняшняя дата в TZ пользователя (fallback UTC, если не задан)
  select (timezone(coalesce(u.timezone, 'UTC'), now()))::date
    into _today
  from public.pzd_users u
  where u.id = auth.uid();

  if _today is null then
    _today := (now())::date;
  end if;

  return query
  with ev as (
    select c.id, c.name, c.is_mandatory, c.relationship_type, c.address_form,
           c.closeness, c.telegram_username, c.context_notes,
           'birthday'::text as event_type, c.birthday as source_date
    from public.pzd_contacts c
    where c.birthday is not null
    union all
    select c.id, c.name, c.is_mandatory, c.relationship_type, c.address_form,
           c.closeness, c.telegram_username, c.context_notes,
           'anniversary'::text, c.anniversary_date
    from public.pzd_contacts c
    where c.anniversary_date is not null
  )
  select ev.id, ev.name, ev.is_mandatory, ev.relationship_type, ev.address_form,
         ev.closeness, ev.telegram_username, ev.context_notes,
         ev.event_type, ev.source_date,
         public.pzd_next_occurrence(ev.source_date, _today)                as next_date,
         (public.pzd_next_occurrence(ev.source_date, _today) - _today)::int as days_until
  from ev
  where (public.pzd_next_occurrence(ev.source_date, _today) - _today) <= _days_ahead
  order by ev.is_mandatory desc, next_date asc, ev.name asc;
end;
$$;

grant execute on function public.pzd_occurrence_in_year(int, int, int) to authenticated;
grant execute on function public.pzd_next_occurrence(date, date)       to authenticated;
grant execute on function public.pzd_events_upcoming(int)              to authenticated;
