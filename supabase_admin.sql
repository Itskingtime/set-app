-- ============================================================================
-- SaySet · Admin analytics  (run once in the Supabase SQL editor)
-- 1) api_usage  — one row per AI API call, with tokens + USD cost
-- 2) get_admin_overview() — aggregates users + spend for the owner dashboard
-- ============================================================================

create table if not exists public.api_usage (
  id         bigserial primary key,
  user_id    uuid references auth.users(id) on delete set null,
  endpoint   text not null,                 -- '/api/parse', '/api/coach', '/api/ask', '/api/transcribe'
  model      text,                          -- 'deepseek/deepseek-v4-flash', 'whisper-large-v3', ...
  tokens_in  int,
  tokens_out int,
  cost_usd   numeric(12,6),                 -- actual USD cost (null for Whisper, which is per-second)
  created_at timestamptz not null default now()
);

create index if not exists api_usage_created_idx on public.api_usage(created_at);
create index if not exists api_usage_user_idx    on public.api_usage(user_id);

alter table public.api_usage enable row level security;
-- No anon/authenticated policies: only the server (service role) writes/reads this.

-- One JSON blob with everything the owner dashboard needs.
-- SECURITY DEFINER so it can read auth.users; locked to the service role below.
create or replace function public.get_admin_overview()
returns jsonb
language sql
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'generated_at',   now(),
    'total_users',    (select count(*) from auth.users),
    'new_users_7d',   (select count(*) from auth.users where created_at > now() - interval '7 days'),
    'new_users_30d',  (select count(*) from auth.users where created_at > now() - interval '30 days'),
    'active_7d',      (select count(distinct user_id) from public.api_usage
                         where created_at > now() - interval '7 days' and user_id is not null),
    'total_workouts', (select count(*) from public.workouts),
    'cost_30d',       coalesce((select sum(cost_usd) from public.api_usage where created_at > now() - interval '30 days'), 0),
    'cost_all',       coalesce((select sum(cost_usd) from public.api_usage), 0),
    'tokens_in_30d',  coalesce((select sum(tokens_in)  from public.api_usage where created_at > now() - interval '30 days'), 0),
    'tokens_out_30d', coalesce((select sum(tokens_out) from public.api_usage where created_at > now() - interval '30 days'), 0),
    'calls_30d',      (select count(*) from public.api_usage where created_at > now() - interval '30 days'),
    'calls_by_endpoint', coalesce((
        select jsonb_object_agg(endpoint, c)
        from (select endpoint, count(*) c from public.api_usage
              where created_at > now() - interval '30 days' group by endpoint) t), '{}'::jsonb),
    'cost_by_day', coalesce((
        select jsonb_agg(jsonb_build_object('day', d, 'cost', c, 'calls', n) order by d)
        from (select created_at::date d, coalesce(sum(cost_usd),0) c, count(*) n
              from public.api_usage
              where created_at > now() - interval '30 days' group by 1) t), '[]'::jsonb),
    'users', coalesce((
        select jsonb_agg(j order by j->>'created_at' desc)
        from (
          select jsonb_build_object(
            'email',       u.email,
            'created_at',  u.created_at,
            'last_active', u.last_sign_in_at,
            'sex',         u.raw_user_meta_data->>'sex',
            'age',         u.raw_user_meta_data->>'age',
            'weight_kg',   u.raw_user_meta_data->>'weight_kg',
            'height_cm',   u.raw_user_meta_data->>'height_cm',
            'workouts', (select count(*) from public.workouts w where w.user_id = u.id),
            'ai_calls', (select count(*) from public.api_usage a where a.user_id = u.id),
            'spend',    coalesce((select sum(cost_usd) from public.api_usage a where a.user_id = u.id), 0)
          ) as j
          from auth.users u
          order by u.created_at desc
          limit 200
        ) sub), '[]'::jsonb)
  );
$$;

-- Lock the function down: only the server's service role may call it.
revoke execute on function public.get_admin_overview() from public, anon, authenticated;
grant  execute on function public.get_admin_overview() to service_role;

notify pgrst, 'reload schema';
