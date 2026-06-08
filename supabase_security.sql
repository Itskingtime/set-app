-- ============================================================================
-- SaySet · Security hardening  (run once in the Supabase SQL editor)
-- 1) voice_usage  — per-user daily cap for the voice pipeline (parse+transcribe)
-- 2) RLS lockdown — make sure every user table is owner-scoped
-- 3) Verification — read-only checks you can eyeball at the end
-- ============================================================================

-- 1) Voice-logging quota -----------------------------------------------------
create table if not exists public.voice_usage (
  user_id uuid not null references auth.users(id) on delete cascade,
  day     text not null,                 -- 'YYYY-MM-DD' (UTC)
  cnt     int  not null default 0,
  primary key (user_id, day)
);
alter table public.voice_usage enable row level security;
-- server-only (service role); no anon/authenticated policies.

create or replace function public.bump_voice_usage(p_user uuid, p_day text, p_limit int)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare cur int;
begin
  insert into public.voice_usage(user_id, day, cnt) values (p_user, p_day, 0)
    on conflict (user_id, day) do nothing;
  select cnt into cur from public.voice_usage
    where user_id = p_user and day = p_day for update;
  if cur >= p_limit then return -1; end if;
  update public.voice_usage set cnt = cnt + 1 where user_id = p_user and day = p_day;
  return cur + 1;
end;
$$;

revoke execute on function public.bump_voice_usage(uuid, text, int) from public, anon, authenticated;
grant  execute on function public.bump_voice_usage(uuid, text, int) to service_role;

-- 2) RLS lockdown on the user-owned tables -----------------------------------
-- Idempotent: enables RLS and (re)creates an owner-only policy so a signed-in
-- user can only read/write their OWN rows. Safe to run repeatedly; only touches
-- tables that actually exist and have a user_id column.
do $$
declare t text;
begin
  foreach t in array array['workouts','bodyweight_log','routines'] loop
    if to_regclass('public.'||t) is not null then
      execute format('alter table public.%I enable row level security', t);
      execute format('drop policy if exists %I on public.%I', t||'_owner', t);
      execute format(
        'create policy %I on public.%I for all to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id)',
        t||'_owner', t);
    end if;
  end loop;
end $$;

notify pgrst, 'reload schema';

-- 3) Verification (read-only) -------------------------------------------------
-- (a) Every user table should show rowsecurity = true:
select tablename, rowsecurity
from pg_tables
where schemaname = 'public'
  and tablename in ('workouts','bodyweight_log','routines','push_subscriptions',
                    'ai_usage','api_usage','voice_usage')
order by tablename;

-- (b) Review the policies in place (each user table should be owner-scoped):
select tablename, policyname, cmd, qual
from pg_policies
where schemaname = 'public'
order by tablename, policyname;
