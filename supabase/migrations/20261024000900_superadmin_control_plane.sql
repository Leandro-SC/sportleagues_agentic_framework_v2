-- ADR-028: global read model for the isolated superadmin console.
-- No global table receives a client grant; every endpoint checks the live platform role.
create table public.platform_admin_audit_log (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid not null references auth.users(id) on delete restrict,
  action text not null check (char_length(action) between 3 and 100),
  target_type text not null check (char_length(target_type) between 3 and 100),
  target_id uuid,
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  created_at timestamptz not null default clock_timestamp()
);
alter table public.platform_admin_audit_log enable row level security;
revoke all on public.platform_admin_audit_log from anon, authenticated;
create index platform_admin_audit_created_idx on public.platform_admin_audit_log(created_at desc);

create function public.platform_console_guard() returns void language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null or not public.is_platform_admin() then raise exception 'not authorized' using errcode = '42501'; end if;
end $$;

create function public.platform_console_overview() returns jsonb language plpgsql security definer set search_path = '' as $$
declare v jsonb;
begin
  perform public.platform_console_guard();
  select jsonb_build_object(
    'tenants', (select count(*) from public.tenants),
    'users', (select count(*) from public.profiles),
    'pools', (select count(*) from public.pools),
    'open_pools', (select count(*) from public.pools where status = 'open'),
    'matches', (select count(*) from public.matches),
    'results', (select count(*) from public.official_results),
    'audit_events_24h', (select count(*) from public.audit_log where created_at >= clock_timestamp() - interval '24 hours'),
    'pending_plan_requests', (select count(*) from public.plan_change_requests where status = 'pending')
  ) into v;
  insert into public.platform_admin_audit_log(actor_id, action, target_type, metadata) values (auth.uid(), 'console.overview.read', 'platform', '{}'::jsonb);
  return v;
end $$;

create function public.platform_console_tenants(p_query text default null)
returns table(tenant_id uuid, name text, plan_code public.plan_code, pools bigint, participants bigint, created_at timestamptz)
language plpgsql security definer set search_path = '' as $$
begin
  perform public.platform_console_guard();
  return query select t.id, t.name, e.plan_code, count(distinct p.id), count(distinct pt.id), t.created_at
    from public.tenants t join public.tenant_entitlements e on e.tenant_id = t.id
    left join public.pools p on p.tenant_id = t.id left join public.participants pt on pt.tenant_id = t.id
    where nullif(trim(p_query), '') is null or t.name ilike '%' || trim(p_query) || '%'
    group by t.id, t.name, e.plan_code, t.created_at order by t.created_at desc limit 200;
end $$;

create function public.platform_console_plan_requests()
returns table(id uuid, tenant_name text, offer_code text, status text, requested_at timestamptz)
language plpgsql security definer set search_path = '' as $$
begin
  perform public.platform_console_guard();
  return query select r.id, t.name, r.offer_code, r.status::text, r.requested_at
    from public.plan_change_requests r join public.tenants t on t.id = r.tenant_id
    order by r.requested_at desc limit 200;
end $$;

create function public.platform_console_offers()
returns table(offer_code text, plan_code public.plan_code, scope text, price_minor integer, currency char(3), billing_period text, benefits jsonb, is_public boolean)
language plpgsql security definer set search_path = '' as $$
begin
  perform public.platform_console_guard();
  return query select o.offer_code, o.plan_code, o.scope, o.price_minor, o.currency, o.billing_period, o.benefits, o.is_public
    from public.plan_offers o order by o.price_minor, o.offer_code;
end $$;

create or replace function public.update_plan_offer(p_offer_code text, p_price_minor integer, p_currency text, p_billing_period text, p_benefits jsonb, p_is_public boolean default true)
returns public.plan_offers language plpgsql security definer set search_path = '' as $$
declare r public.plan_offers;
begin
  perform public.platform_console_guard();
  update public.plan_offers set price_minor = p_price_minor, currency = upper(p_currency)::char(3), billing_period = p_billing_period,
    benefits = p_benefits, is_public = p_is_public, updated_at = clock_timestamp() where offer_code = p_offer_code returning * into r;
  if not found then raise exception 'plan offer not found' using errcode = '22023'; end if;
  insert into public.platform_admin_audit_log(actor_id, action, target_type, metadata)
    values (auth.uid(), 'plan_offer.updated', 'plan_offer', jsonb_build_object('offer_code', r.offer_code, 'price_minor', r.price_minor, 'currency', r.currency, 'billing_period', r.billing_period, 'is_public', r.is_public));
  return r;
end $$;

revoke all on function public.platform_console_guard(), public.platform_console_overview(), public.platform_console_tenants(text), public.platform_console_plan_requests(), public.platform_console_offers() from public, anon;
grant execute on function public.platform_console_overview(), public.platform_console_tenants(text), public.platform_console_plan_requests(), public.platform_console_offers() to authenticated;
revoke all on function public.update_plan_offer(text, integer, text, text, jsonb, boolean) from public, anon;
grant execute on function public.update_plan_offer(text, integer, text, text, jsonb, boolean) to authenticated;
