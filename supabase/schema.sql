-- ═══════════════════════════════════════════════════════════════
--  GabikOS — database schema
--
--  Run this once in your Supabase project:
--    Dashboard → SQL Editor → New query → paste → Run
--
--  It is safe to run more than once.
-- ═══════════════════════════════════════════════════════════════

-- One row per user per slice of state (tasks, habits, notes, …).
-- Sharding this way keeps each row small and means an edit on one device
-- can only ever collide with an edit to the SAME area on another.
create table if not exists public.gabikos_state (
  user_id    uuid        not null references auth.users (id) on delete cascade,
  slice      text        not null,
  payload    jsonb       not null default '{}'::jsonb,
  device     text,
  updated_at timestamptz not null default now(),
  primary key (user_id, slice)
);

comment on table public.gabikos_state is
  'GabikOS per-user application state, one row per domain slice.';

-- Only ever your own rows. This is what makes the publishable key safe to
-- ship in the client: without a valid session it can read and write nothing.
alter table public.gabikos_state enable row level security;

drop policy if exists "read own state"   on public.gabikos_state;
drop policy if exists "insert own state" on public.gabikos_state;
drop policy if exists "update own state" on public.gabikos_state;
drop policy if exists "delete own state" on public.gabikos_state;

create policy "read own state"   on public.gabikos_state
  for select using (auth.uid() = user_id);
create policy "insert own state" on public.gabikos_state
  for insert with check (auth.uid() = user_id);
create policy "update own state" on public.gabikos_state
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "delete own state" on public.gabikos_state
  for delete using (auth.uid() = user_id);

-- Look-ups are always "my rows", so index that.
create index if not exists gabikos_state_user_idx
  on public.gabikos_state (user_id);

-- Live updates between your devices. Ignored if it is already added.
do $$
begin
  alter publication supabase_realtime add table public.gabikos_state;
exception
  when duplicate_object then null;
  when undefined_object then null;
end $$;

-- Realtime sends the changed row, and row-level security applies to it too.
alter table public.gabikos_state replica identity full;
