-- ═══════════════════════════════════════════════════════════════
--  GabikOS — Apple Health inbox
--
--  Run this in the Supabase SQL editor once, after schema.sql.
--
--  A Shortcut on the iPhone reads Health and posts the numbers here.
--  A Shortcut cannot sign in, so it carries a long random key instead:
--  gabikos_health_push looks the key up, finds whose account it is, and
--  writes one row per day. The key is the only thing it can do — it
--  cannot read anything back, and it cannot touch any other table.
-- ═══════════════════════════════════════════════════════════════

/* ─── The phone's key ─── */
create table if not exists public.gabikos_health_keys (
  user_id      uuid primary key references auth.users(id) on delete cascade,
  key          text not null unique,
  created_at   timestamptz not null default now(),
  last_used_at timestamptz
);

alter table public.gabikos_health_keys enable row level security;

drop policy if exists "own key: read"   on public.gabikos_health_keys;
drop policy if exists "own key: write"  on public.gabikos_health_keys;
drop policy if exists "own key: change" on public.gabikos_health_keys;
drop policy if exists "own key: drop"   on public.gabikos_health_keys;

create policy "own key: read"   on public.gabikos_health_keys for select using (auth.uid() = user_id);
create policy "own key: write"  on public.gabikos_health_keys for insert with check (auth.uid() = user_id);
create policy "own key: change" on public.gabikos_health_keys for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "own key: drop"   on public.gabikos_health_keys for delete using (auth.uid() = user_id);

/* ─── One row per day of readings ─── */
create table if not exists public.gabikos_health_inbox (
  user_id          uuid not null references auth.users(id) on delete cascade,
  day              date not null,
  steps            integer,
  sleep_minutes    integer,
  bedtime          text,           -- 'HH:MM' on the phone's own clock
  wake             text,
  resting_hr       integer,
  weight           numeric(5,1),
  active_energy    integer,
  exercise_minutes integer,
  source           text not null default 'apple-health',
  updated_at       timestamptz not null default now(),
  primary key (user_id, day)
);

alter table public.gabikos_health_inbox enable row level security;

drop policy if exists "own health: read" on public.gabikos_health_inbox;
drop policy if exists "own health: drop" on public.gabikos_health_inbox;

-- Reading and clearing belong to the account. Writing goes through the
-- function below, so a leaked key can add readings but never read them.
create policy "own health: read" on public.gabikos_health_inbox for select using (auth.uid() = user_id);
create policy "own health: drop" on public.gabikos_health_inbox for delete using (auth.uid() = user_id);

/* ─── What the Shortcut calls ─── */
create or replace function public.gabikos_health_push(
  p_key              text,
  p_day              date    default null,
  p_steps            integer default null,
  p_sleep_minutes    integer default null,
  p_bedtime          text    default null,
  p_wake             text    default null,
  p_resting_hr       integer default null,
  p_weight           numeric default null,
  p_active_energy    integer default null,
  p_exercise_minutes integer default null
) returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid;
  v_day  date := coalesce(p_day, (now() at time zone 'utc')::date);
  v_clock text := '^([01][0-9]|2[0-3]):[0-5][0-9]$';
begin
  if p_key is null or length(p_key) < 20 then
    raise exception 'health key missing' using errcode = '28000';
  end if;

  select user_id into v_user from public.gabikos_health_keys where key = p_key;
  if v_user is null then
    raise exception 'health key not recognised' using errcode = '28000';
  end if;

  update public.gabikos_health_keys set last_used_at = now() where user_id = v_user;

  insert into public.gabikos_health_inbox as i (
    user_id, day, steps, sleep_minutes, bedtime, wake,
    resting_hr, weight, active_energy, exercise_minutes, updated_at
  ) values (
    v_user, v_day,
    case when p_steps between 0 and 200000 then p_steps end,
    case when p_sleep_minutes between 1 and 1440 then p_sleep_minutes end,
    case when p_bedtime ~ v_clock then p_bedtime end,
    case when p_wake    ~ v_clock then p_wake    end,
    case when p_resting_hr between 20 and 250 then p_resting_hr end,
    case when p_weight between 1 and 400 then round(p_weight, 1) end,
    case when p_active_energy between 0 and 30000 then p_active_energy end,
    case when p_exercise_minutes between 0 and 1440 then p_exercise_minutes end,
    now()
  )
  on conflict (user_id, day) do update set
    -- A field the phone did not send leaves yesterday's reading alone.
    steps            = coalesce(excluded.steps,            i.steps),
    sleep_minutes    = coalesce(excluded.sleep_minutes,    i.sleep_minutes),
    bedtime          = coalesce(excluded.bedtime,          i.bedtime),
    wake             = coalesce(excluded.wake,             i.wake),
    resting_hr       = coalesce(excluded.resting_hr,       i.resting_hr),
    weight           = coalesce(excluded.weight,           i.weight),
    active_energy    = coalesce(excluded.active_energy,    i.active_energy),
    exercise_minutes = coalesce(excluded.exercise_minutes, i.exercise_minutes),
    updated_at       = now();

  return json_build_object('ok', true, 'day', v_day);
end;
$$;

revoke all on function public.gabikos_health_push(
  text, date, integer, integer, text, text, integer, numeric, integer, integer) from public;
grant execute on function public.gabikos_health_push(
  text, date, integer, integer, text, text, integer, numeric, integer, integer) to anon, authenticated;

create index if not exists gabikos_health_inbox_day_idx on public.gabikos_health_inbox (user_id, day desc);

-- The API layer keeps its own cache of what exists. Without this it can
-- answer "could not find the function" for a minute after you run this
-- file, which looks exactly like the file not having worked.
notify pgrst, 'reload schema';
