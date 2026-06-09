-- ============================================================================
-- SaySet · Landing demo limit  (run once in the Supabase SQL editor)
-- Per-IP daily cap for the unauthenticated "try it" endpoint (/api/demo).
-- ============================================================================

create table if not exists public.demo_usage (
  ip text not null, day text not null, cnt int not null default 0,
  primary key (ip, day)
);
alter table public.demo_usage enable row level security;
-- server-only (service role); no anon/authenticated policies.

create or replace function public.bump_demo_usage(p_ip text, p_day text, p_limit int)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare cur int;
begin
  insert into public.demo_usage(ip, day, cnt) values (p_ip, p_day, 0)
    on conflict (ip, day) do nothing;
  select cnt into cur from public.demo_usage where ip = p_ip and day = p_day for update;
  if cur >= p_limit then return -1; end if;
  update public.demo_usage set cnt = cnt + 1 where ip = p_ip and day = p_day;
  return cur + 1;
end;
$$;

revoke execute on function public.bump_demo_usage(text, text, int) from public, anon, authenticated;
grant  execute on function public.bump_demo_usage(text, text, int) to service_role;

notify pgrst, 'reload schema';
