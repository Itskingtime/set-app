-- ============================================================================
-- SaySet · AI usage quota  (run once in the Supabase SQL editor)
-- Limits the AI coach + "Ask" features to 5 insights per user per UTC day.
-- coach + ask share ONE pool, so it's 5 total AI calls per user per day.
-- ============================================================================

create table if not exists public.ai_usage (
  user_id uuid not null references auth.users(id) on delete cascade,
  day     text not null,                 -- 'YYYY-MM-DD' (UTC)
  cnt     int  not null default 0,
  primary key (user_id, day)
);

alter table public.ai_usage enable row level security;
-- No anon/authenticated policies on purpose: only the server (service role)
-- and the SECURITY DEFINER functions below ever touch this table.

-- Atomically reserve one slot for (user, day).
-- Returns the new count (1..p_limit), or -1 if already at the daily limit.
create or replace function public.bump_ai_usage(p_user uuid, p_day text, p_limit int)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare cur int;
begin
  insert into public.ai_usage(user_id, day, cnt) values (p_user, p_day, 0)
    on conflict (user_id, day) do nothing;

  select cnt into cur from public.ai_usage
    where user_id = p_user and day = p_day
    for update;

  if cur >= p_limit then
    return -1;
  end if;

  update public.ai_usage set cnt = cnt + 1
    where user_id = p_user and day = p_day;
  return cur + 1;
end;
$$;

-- Give a slot back when the downstream AI call fails (so errors don't burn quota).
create or replace function public.refund_ai_usage(p_user uuid, p_day text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.ai_usage set cnt = greatest(0, cnt - 1)
    where user_id = p_user and day = p_day;
end;
$$;

-- Lock the functions down: only the server's service role may call them
-- (clients can never bump someone else's — or their own — usage directly).
revoke execute on function public.bump_ai_usage(uuid, text, int) from public, anon, authenticated;
revoke execute on function public.refund_ai_usage(uuid, text)    from public, anon, authenticated;
grant  execute on function public.bump_ai_usage(uuid, text, int) to service_role;
grant  execute on function public.refund_ai_usage(uuid, text)    to service_role;

-- Make PostgREST pick up the new functions immediately.
notify pgrst, 'reload schema';
