-- ============================================================================
-- SaySet · Signup rate limiting  (run once in the Supabase SQL editor)
-- Caps NEW account creation per client IP per UTC day, enforced server-side
-- by /api/signup so it can't be bypassed from the browser.
-- ============================================================================

create table if not exists public.signup_usage (
  ip  text not null,
  day text not null,                 -- 'YYYY-MM-DD' (UTC)
  cnt int  not null default 0,
  primary key (ip, day)
);
alter table public.signup_usage enable row level security;
-- server-only (service role); no anon/authenticated policies.

create or replace function public.bump_signup_usage(p_ip text, p_day text, p_limit int)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare cur int;
begin
  insert into public.signup_usage(ip, day, cnt) values (p_ip, p_day, 0)
    on conflict (ip, day) do nothing;
  select cnt into cur from public.signup_usage
    where ip = p_ip and day = p_day for update;
  if cur >= p_limit then return -1; end if;
  update public.signup_usage set cnt = cnt + 1 where ip = p_ip and day = p_day;
  return cur + 1;
end;
$$;

revoke execute on function public.bump_signup_usage(text, text, int) from public, anon, authenticated;
grant  execute on function public.bump_signup_usage(text, text, int) to service_role;

notify pgrst, 'reload schema';
