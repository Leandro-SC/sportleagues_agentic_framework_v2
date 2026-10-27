-- ADR-032: first-party observability for the isolated Superadmin Control Plane.
-- No Auth email, IP address, JWT, stack trace, request payload or secret is retained.

create table public.platform_user_presence (
  profile_id uuid primary key references public.profiles(id) on delete cascade,
  last_seen_at timestamptz not null default clock_timestamp(),
  route text check (route is null or char_length(route) <= 180),
  updated_at timestamptz not null default clock_timestamp()
);
create index platform_user_presence_seen_idx on public.platform_user_presence(last_seen_at desc);

create table public.platform_client_errors (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  kind text not null check (kind in ('error', 'unhandled-rejection')),
  name text not null check (char_length(name) between 1 and 100),
  message text not null check (char_length(message) <= 300),
  route text check (route is null or char_length(route) <= 180),
  created_at timestamptz not null default clock_timestamp()
);
create index platform_client_errors_recent_idx on public.platform_client_errors(created_at desc);
create index platform_client_errors_profile_recent_idx on public.platform_client_errors(profile_id, created_at desc);

alter table public.platform_user_presence enable row level security;
alter table public.platform_client_errors enable row level security;
revoke all on public.platform_user_presence, public.platform_client_errors from public, anon, authenticated;

create function public.touch_platform_presence(p_route text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare v_route text;
begin
  if auth.uid() is null then raise exception 'authentication required' using errcode = '28000'; end if;
  v_route := case when p_route is null then null else left(regexp_replace(p_route, '[?#].*$', ''), 180) end;
  insert into public.platform_user_presence(profile_id, last_seen_at, route, updated_at)
  values (auth.uid(), clock_timestamp(), v_route, clock_timestamp())
  on conflict (profile_id) do update set last_seen_at = excluded.last_seen_at, route = excluded.route, updated_at = excluded.updated_at;
end $$;

create function public.record_platform_client_error(p_kind text, p_name text, p_message text, p_route text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare v_message text; v_route text;
begin
  if auth.uid() is null then raise exception 'authentication required' using errcode = '28000'; end if;
  if p_kind not in ('error', 'unhandled-rejection') then raise exception 'invalid error kind' using errcode = '22023'; end if;
  -- Defense in depth: the browser scrubs more patterns before invoking this endpoint.
  v_message := left(regexp_replace(coalesce(p_message, ''), '[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\\.[A-Za-z]{2,}', '[email]', 'gi'), 300);
  v_route := case when p_route is null then null else left(regexp_replace(p_route, '[?#].*$', ''), 180) end;
  insert into public.platform_client_errors(profile_id, kind, name, message, route)
  values (auth.uid(), p_kind, left(coalesce(nullif(p_name, ''), 'ClientError'), 100), v_message, v_route);
end $$;

create function public.platform_console_growth_metrics()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v jsonb;
begin
  perform public.platform_console_guard();
  select jsonb_build_object(
    'active_users_now', (select count(*) from public.platform_user_presence where last_seen_at >= clock_timestamp() - interval '5 minutes'),
    'active_users_24h', (select count(*) from public.platform_user_presence where last_seen_at >= clock_timestamp() - interval '24 hours'),
    'new_users_7d', (select count(*) from public.profiles where created_at >= clock_timestamp() - interval '7 days'),
    'new_tenants_30d', (select count(*) from public.tenants where created_at >= clock_timestamp() - interval '30 days'),
    'plan_requests_30d', (select count(*) from public.plan_change_requests where requested_at >= clock_timestamp() - interval '30 days'),
    'client_errors_24h', (select count(*) from public.platform_client_errors where created_at >= clock_timestamp() - interval '24 hours')
  ) into v;
  insert into public.platform_admin_audit_log(actor_id, action, target_type, metadata)
    values (auth.uid(), 'console.growth_metrics.read', 'platform', '{}'::jsonb);
  return v;
end $$;

create function public.platform_console_live_users()
returns table(display_name text, last_seen_at timestamptz, route text, events_24h bigint)
language plpgsql security definer set search_path = '' as $$
begin
  perform public.platform_console_guard();
  return query
    select p.display_name, pr.last_seen_at, pr.route,
      count(a.id) filter (where a.created_at >= clock_timestamp() - interval '24 hours')
    from public.platform_user_presence pr
    join public.profiles p on p.id = pr.profile_id
    left join public.audit_log a on a.actor_id = pr.profile_id
    where pr.last_seen_at >= clock_timestamp() - interval '5 minutes'
    group by p.display_name, pr.last_seen_at, pr.route
    order by pr.last_seen_at desc limit 200;
  insert into public.platform_admin_audit_log(actor_id, action, target_type, metadata)
    values (auth.uid(), 'console.live_users.read', 'platform', '{}'::jsonb);
end $$;

create function public.platform_console_error_log()
returns table(kind text, name text, message text, route text, occurrences bigint, latest_at timestamptz)
language plpgsql security definer set search_path = '' as $$
begin
  perform public.platform_console_guard();
  return query
    select e.kind, e.name, e.message, e.route, count(*), max(e.created_at)
    from public.platform_client_errors e
    where e.created_at >= clock_timestamp() - interval '30 days'
    group by e.kind, e.name, e.message, e.route
    order by max(e.created_at) desc limit 200;
  insert into public.platform_admin_audit_log(actor_id, action, target_type, metadata)
    values (auth.uid(), 'console.error_log.read', 'platform', '{}'::jsonb);
end $$;

revoke all on function public.touch_platform_presence(text), public.record_platform_client_error(text, text, text, text), public.platform_console_growth_metrics(), public.platform_console_live_users(), public.platform_console_error_log() from public, anon;
grant execute on function public.touch_platform_presence(text), public.record_platform_client_error(text, text, text, text), public.platform_console_growth_metrics(), public.platform_console_live_users(), public.platform_console_error_log() to authenticated;
