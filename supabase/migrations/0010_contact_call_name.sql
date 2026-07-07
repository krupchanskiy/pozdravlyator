-- «Как называть» — обращение в поздравлении, независимое от формы «ты/вы».
-- Пример: имя «Александр Исаевич», на «вы», но в тексте — «Саша».
alter table public.pzd_contacts add column if not exists call_name text;
