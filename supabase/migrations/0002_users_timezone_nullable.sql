-- При первом входе (этап 1) часовой пояс ещё неизвестен — его выбирают
-- в онбординге (этап 2). Делаем колонку nullable, чтобы строка pzd_users
-- создавалась сразу при логине, а timezone заполнялся позже.
alter table public.pzd_users alter column timezone drop not null;
