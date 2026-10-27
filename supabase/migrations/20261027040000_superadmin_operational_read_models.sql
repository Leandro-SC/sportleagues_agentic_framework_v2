-- ADR-030: audited, least-privilege operational read models for the isolated Control Plane.
-- Deliberately excludes auth emails, notification bodies, arbitrary metadata and destructive controls.

create function public.platform_console_users(p_query text default null)
returns table(profile_id uuid, display_name text, memberships bigint, pools bigint, created_at timestamptz)
language plpgsql security definer set search_path = '' as $$
begin
  perform public.platform_console_guard();
  return query
    select p.id, p.display_name, count(distinct tm.id), count(distinct pa.id), p.created_at
    from public.profiles p
    left join public.tenant_memberships tm on tm.profile_id = p.id and tm.is_active
    left join public.participants pa on pa.profile_id = p.id and pa.withdrawn_at is null
    where p_query is null or p.display_name ilike '%' || left(p_query, 80) || '%'
    group by p.id, p.display_name, p.created_at
    order by p.created_at desc limit 200;
  insert into public.platform_admin_audit_log(actor_id, action, target_type, metadata)
    values (auth.uid(), 'console.users.read', 'platform', '{}'::jsonb);
end $$;

create function public.platform_console_sport_operations()
returns table(tenant_name text, tournament_name text, match_id uuid, home_team text, away_team text, starts_at timestamptz, status text, result text)
language plpgsql security definer set search_path = '' as $$
begin
  perform public.platform_console_guard();
  return query
    select te.name, tr.name, m.id, h.name, a.name, m.starts_at, m.status::text,
      case when r.id is null then null else r.home_score::text || '-' || r.away_score::text end
    from public.matches m
    join public.tenants te on te.id = m.tenant_id
    join public.tournaments tr on tr.id = m.tournament_id and tr.tenant_id = m.tenant_id
    join public.teams h on h.id = m.home_team_id and h.tenant_id = m.tenant_id
    join public.teams a on a.id = m.away_team_id and a.tenant_id = m.tenant_id
    left join public.official_results r on r.match_id = m.id
    order by case when m.status = 'live' then 0 when m.starts_at >= clock_timestamp() then 1 else 2 end, m.starts_at asc
    limit 200;
  insert into public.platform_admin_audit_log(actor_id, action, target_type, metadata)
    values (auth.uid(), 'console.sport_operations.read', 'platform', '{}'::jsonb);
end $$;

create function public.platform_console_activity()
returns table(source text, tenant_name text, action text, entity_type text, created_at timestamptz)
language plpgsql security definer set search_path = '' as $$
begin
  perform public.platform_console_guard();
  return query
    select * from (
      select 'tenant'::text, t.name, a.action, a.entity_type, a.created_at
      from public.audit_log a join public.tenants t on t.id = a.tenant_id
      union all
      select 'platform'::text, null::text, a.action, a.target_type, a.created_at
      from public.platform_admin_audit_log a
    ) activity
    order by created_at desc limit 200;
  insert into public.platform_admin_audit_log(actor_id, action, target_type, metadata)
    values (auth.uid(), 'console.activity.read', 'platform', '{}'::jsonb);
end $$;

create function public.platform_console_monitor()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v jsonb;
begin
  perform public.platform_console_guard();
  select jsonb_build_object(
    'matches_live', (select count(*) from public.matches where status = 'live'),
    'matches_next_24h', (select count(*) from public.matches where starts_at >= clock_timestamp() and starts_at < clock_timestamp() + interval '24 hours'),
    'unread_notifications', (select count(*) from public.notifications where read_at is null),
    'catalog_jobs_failed_24h', (select count(*) from public.catalog_import_jobs where status in ('failed', 'rate_limited') and started_at >= clock_timestamp() - interval '24 hours'),
    'fixture_sync_events_24h', (select count(*) from public.fixture_sync_log where created_at >= clock_timestamp() - interval '24 hours')
  ) into v;
  insert into public.platform_admin_audit_log(actor_id, action, target_type, metadata)
    values (auth.uid(), 'console.monitor.read', 'platform', '{}'::jsonb);
  return v;
end $$;

revoke all on function public.platform_console_users(text), public.platform_console_sport_operations(), public.platform_console_activity(), public.platform_console_monitor() from public, anon;
grant execute on function public.platform_console_users(text), public.platform_console_sport_operations(), public.platform_console_activity(), public.platform_console_monitor() to authenticated;
