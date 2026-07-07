-- Групповой вектор пожеланий (раздел 6a ТЗ).
alter table public.pzd_contact_categories add column if not exists wish_vector text;

create table if not exists public.pzd_wish_vector_suggestions (
  id                         uuid primary key default gen_random_uuid(),
  category_id                uuid not null references public.pzd_contact_categories(id) on delete cascade,
  suggested_text             text not null,
  source_training_session_id uuid references public.pzd_training_sessions(id) on delete set null,
  status                     text not null default 'pending'
                             check (status in ('pending', 'accepted', 'edited', 'rejected')),
  created_at                 timestamptz not null default now(),
  resolved_at                timestamptz
);
create index if not exists pzd_wvs_category_idx on public.pzd_wish_vector_suggestions (category_id);

grant select, insert, update, delete on public.pzd_wish_vector_suggestions to authenticated;
alter table public.pzd_wish_vector_suggestions enable row level security;

create policy pzd_wvs_own on public.pzd_wish_vector_suggestions
  for all to authenticated
  using (exists (select 1 from public.pzd_contact_categories c where c.id = category_id and c.user_id = auth.uid()))
  with check (exists (select 1 from public.pzd_contact_categories c where c.id = category_id and c.user_id = auth.uid()));
