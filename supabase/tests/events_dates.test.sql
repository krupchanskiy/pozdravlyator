-- Тест логики дат ближайших событий (этап 2).
-- Детерминированный: проверяет pzd_occurrence_in_year / pzd_next_occurrence,
-- в т.ч. edge case 29 февраля → 28 февраля в невисокосный год.
-- Запуск: прогнать через execute_sql. Последняя колонка pass должна быть true везде.

with checks(name, expected, actual) as (
  values
    -- 29 февраля в невисокосный год → 28 февраля
    ('29.02 невисокосный 2027 → 28.02', '2027-02-28',
       public.pzd_occurrence_in_year(2, 29, 2027)::text),
    ('29.02 невисокосный 2026 → 28.02', '2026-02-28',
       public.pzd_occurrence_in_year(2, 29, 2026)::text),
    -- 29 февраля в високосный год → остаётся 29.02
    ('29.02 високосный 2028 → 29.02', '2028-02-29',
       public.pzd_occurrence_in_year(2, 29, 2028)::text),
    -- ближайшее 29.02 от 27.02.2027 (невисокосный) → 28.02.2027
    ('next(29.02) от 2027-02-27 → 28.02.2027', '2027-02-28',
       public.pzd_next_occurrence(date '2000-02-29', date '2027-02-27')::text),
    -- от 01.03.2027 ближайшее 29.02 → следующий високосный 29.02.2028
    ('next(29.02) от 2027-03-01 → 29.02.2028', '2028-02-29',
       public.pzd_next_occurrence(date '2000-02-29', date '2027-03-01')::text),
    -- обычный ДР, уже прошёл в этом году → следующий год
    ('next(05.01) от 2026-06-01 → 2027', '2027-01-05',
       public.pzd_next_occurrence(date '1990-01-05', date '2026-06-01')::text),
    -- обычный ДР ещё впереди в этом году
    ('next(31.12) от 2026-06-01 → в этом году', '2026-12-31',
       public.pzd_next_occurrence(date '1990-12-31', date '2026-06-01')::text),
    -- ДР сегодня → сегодня (days_until = 0)
    ('next(01.03) от 2026-03-01 → сегодня', '2026-03-01',
       public.pzd_next_occurrence(date '1980-03-01', date '2026-03-01')::text)
)
select name, expected, actual, (expected = actual) as pass
from checks
order by pass, name;
