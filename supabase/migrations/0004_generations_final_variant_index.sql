-- Индекс варианта, который пользователь взял за основу при копировании/правке.
-- Нужен, чтобы построить пару «было (сгенерировано) → стало (отправлено)» для few-shot.
alter table public.pzd_generations add column if not exists final_variant_index int;
