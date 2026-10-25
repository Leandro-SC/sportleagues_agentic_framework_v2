-- ADR-027: consentimiento versionado, catálogo comercial editable y solicitudes manuales de PRO.
-- No procesa pagos ni cambia entitlements automáticamente.

create type public.legal_document_code as enum ('terms', 'privacy');
create type public.plan_change_request_status as enum ('pending', 'approved', 'rejected', 'cancelled');

create table public.legal_document_versions (
  document_code public.legal_document_code primary key,
  version text not null check (version ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'),
  published_at timestamptz not null default now()
);
insert into public.legal_document_versions(document_code, version) values ('terms', '2026-10-24'), ('privacy', '2026-10-24');

create table public.legal_acceptances (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references auth.users(id) on delete cascade,
  document_code public.legal_document_code not null,
  document_version text not null check (document_version ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'),
  accepted_at timestamptz not null default clock_timestamp(),
  unique(profile_id, document_code, document_version)
);
create index legal_acceptances_profile_idx on public.legal_acceptances(profile_id, accepted_at desc);
alter table public.legal_document_versions enable row level security;
alter table public.legal_acceptances enable row level security;
create policy legal_versions_public_read on public.legal_document_versions for select using (true);
create policy legal_acceptances_select_own on public.legal_acceptances for select to authenticated using (profile_id = auth.uid());
revoke all on public.legal_document_versions, public.legal_acceptances from anon, authenticated;
grant select on public.legal_document_versions to anon, authenticated;
grant select on public.legal_acceptances to authenticated;

create function public.legal_acceptance_status()
returns boolean language sql stable security definer set search_path = '' as $$
  select auth.uid() is not null and not exists (
    select 1 from public.legal_document_versions d
    where not exists (
      select 1 from public.legal_acceptances a
      where a.profile_id = auth.uid() and a.document_code = d.document_code and a.document_version = d.version
    )
  )
$$;

create function public.accept_legal_documents(p_terms_version text, p_privacy_version text)
returns boolean language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'authentication required' using errcode = '28000'; end if;
  if not exists (select 1 from public.legal_document_versions where document_code = 'terms' and version = p_terms_version)
     or not exists (select 1 from public.legal_document_versions where document_code = 'privacy' and version = p_privacy_version) then
    raise exception 'legal document version is no longer current' using errcode = '22023';
  end if;
  insert into public.legal_acceptances(profile_id, document_code, document_version)
  values (v_uid, 'terms', p_terms_version), (v_uid, 'privacy', p_privacy_version)
  on conflict (profile_id, document_code, document_version) do nothing;
  return public.legal_acceptance_status();
end $$;
revoke all on function public.legal_acceptance_status(), public.accept_legal_documents(text, text) from public, anon;
grant execute on function public.legal_acceptance_status(), public.accept_legal_documents(text, text) to authenticated;

create table public.plan_offers (
  offer_code text primary key check (offer_code ~ '^[a-z0-9_]{3,40}$'),
  plan_code public.plan_code not null references public.plans(code) on delete restrict,
  scope text not null check (scope in ('organization', 'single_pool')),
  price_minor integer not null check (price_minor >= 0),
  currency char(3) not null check (currency ~ '^[A-Z]{3}$'),
  billing_period text not null check (billing_period in ('month', 'year', 'one_time')),
  benefits jsonb not null check (jsonb_typeof(benefits) = 'array'),
  is_public boolean not null default true,
  updated_at timestamptz not null default now()
);
insert into public.plan_offers(offer_code, plan_code, scope, price_minor, currency, billing_period, benefits) values
 ('free', 'free', 'organization', 0, 'PEN', 'month', '["1 quiniela activa", "Hasta 10 participantes", "Reglas estándar", "Branding SportLeagues"]'),
 ('pro_monthly', 'pro', 'organization', 1990, 'PEN', 'month', '["Quinielas y participantes ampliados", "Logo, banner y colores propios", "Reglas configurables", "Soporte prioritario"]'),
 ('pro_annual', 'pro', 'organization', 19900, 'PEN', 'year', '["Todos los beneficios PRO", "Pago anual con 2 meses de ahorro", "Precio promocional de lanzamiento"]'),
 ('pro_single_pool', 'pro', 'single_pool', 990, 'PEN', 'month', '["Beneficios PRO para una sola quiniela", "Logo y colores para esa quiniela", "Ideal para una competencia puntual"]');
alter table public.plan_offers enable row level security;
create policy plan_offers_public_read on public.plan_offers for select using (is_public);
revoke all on public.plan_offers from anon, authenticated;
grant select on public.plan_offers to anon, authenticated;

create function public.update_plan_offer(p_offer_code text, p_price_minor integer, p_currency text, p_billing_period text, p_benefits jsonb, p_is_public boolean default true)
returns public.plan_offers language plpgsql security definer set search_path = '' as $$
declare r public.plan_offers;
begin
  if not public.is_platform_admin() then raise exception 'not authorized' using errcode = '42501'; end if;
  update public.plan_offers set price_minor = p_price_minor, currency = upper(p_currency)::char(3), billing_period = p_billing_period,
    benefits = p_benefits, is_public = p_is_public, updated_at = clock_timestamp() where offer_code = p_offer_code returning * into r;
  if not found then raise exception 'plan offer not found' using errcode = '22023'; end if;
  return r;
end $$;
revoke all on function public.update_plan_offer(text, integer, text, text, jsonb, boolean) from public, anon;
grant execute on function public.update_plan_offer(text, integer, text, text, jsonb, boolean) to authenticated;

create table public.plan_change_requests (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  requester_id uuid not null references auth.users(id) on delete restrict,
  offer_code text not null references public.plan_offers(offer_code),
  requested_plan public.plan_code not null references public.plans(code),
  pool_id uuid references public.pools(id) on delete restrict,
  status public.plan_change_request_status not null default 'pending',
  requested_at timestamptz not null default clock_timestamp(), reviewed_at timestamptz, reviewed_by uuid references auth.users(id), review_note text,
  check ((status = 'pending' and reviewed_at is null and reviewed_by is null) or (status in ('approved','rejected') and reviewed_at is not null and reviewed_by is not null) or status = 'cancelled')
);
create unique index plan_change_one_pending on public.plan_change_requests(tenant_id, offer_code, coalesce(pool_id, '00000000-0000-0000-0000-000000000000'::uuid)) where status = 'pending';
alter table public.plan_change_requests enable row level security;
create policy plan_change_requests_select_scoped on public.plan_change_requests for select to authenticated using (
  requester_id = auth.uid() or public.is_tenant_admin(tenant_id) or public.is_platform_admin()
);
revoke all on public.plan_change_requests from anon, authenticated;
grant select on public.plan_change_requests to authenticated;

create function public.request_plan_change(p_tenant_id uuid, p_offer_code text, p_pool_id uuid default null)
returns public.plan_change_requests language plpgsql security definer set search_path = '' as $$
declare r public.plan_change_requests; v_plan public.plan_code; v_scope text;
begin
  if auth.uid() is null then raise exception 'authentication required' using errcode = '28000'; end if;
  if not public.legal_acceptance_status() then raise exception 'legal acceptance required' using errcode = '42501'; end if;
  if not public.is_tenant_admin(p_tenant_id) then raise exception 'not authorized' using errcode = '42501'; end if;
  select plan_code, scope into v_plan, v_scope from public.plan_offers where offer_code = p_offer_code and is_public;
  if v_plan is null or v_plan = 'free' then raise exception 'requested offer is unavailable' using errcode = '22023'; end if;
  if (v_scope = 'single_pool' and (p_pool_id is null or not exists (select 1 from public.pools where id = p_pool_id and tenant_id = p_tenant_id)))
     or (v_scope = 'organization' and p_pool_id is not null) then raise exception 'offer scope does not match the selected quiniela' using errcode = '22023'; end if;
  insert into public.plan_change_requests(tenant_id, requester_id, offer_code, requested_plan, pool_id) values (p_tenant_id, auth.uid(), p_offer_code, v_plan, p_pool_id)
  on conflict (tenant_id, offer_code, coalesce(pool_id, '00000000-0000-0000-0000-000000000000'::uuid)) where status = 'pending' do update set requested_at = public.plan_change_requests.requested_at
  returning * into r;
  return r;
end $$;
revoke all on function public.request_plan_change(uuid, text, uuid) from public, anon;
grant execute on function public.request_plan_change(uuid, text, uuid) to authenticated;
