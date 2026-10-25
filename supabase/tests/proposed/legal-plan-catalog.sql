-- ADR-027 smoke/security suite. Corre en rollback con 20261024000700.
do $$
declare u uuid; o uuid; t uuid; r text;
begin
  u := pg_temp.mk_user('lp-user'); o := pg_temp.mk_user('lp-owner');
  insert into public.tenants(name) values ('LP tenant') returning id into t;
  insert into public.tenant_entitlements(tenant_id, plan_code) values (t, 'free');
  insert into public.tenant_memberships(tenant_id, profile_id, role) values (t, o, 'owner');
  r := pg_temp.scalar_as_user(u, 'select public.legal_acceptance_status()::text');
  perform pg_temp.rec('LP01 no aceptado inicialmente', r = 'OK:false', r);
  r := pg_temp.scalar_as_user(u, $q$select public.accept_legal_documents('2026-10-24','2026-10-24')::text$q$);
  perform pg_temp.rec('LP02 acepta las versiones vigentes', r = 'OK:true', r);
  r := pg_temp.scalar_as_user(u, 'select public.legal_acceptance_status()::text');
  perform pg_temp.rec('LP03 queda vigente tras aceptar', r = 'OK:true', r);
  r := pg_temp.scalar_as_user(o, $q$select count(*)::text from public.plan_offers where is_public$q$);
  perform pg_temp.rec('LP04 ofertas públicas visibles', r = 'OK:4', r);
  r := pg_temp.as_user(o, format($q$select public.request_plan_change(%L, 'pro_monthly', null)$q$, t));
  perform pg_temp.rec('LP05 no solicita plan sin aceptar legal', pg_temp.is_err(r, '42501'), r);
  perform pg_temp.as_user(o, $q$select public.accept_legal_documents('2026-10-24','2026-10-24')$q$);
  r := pg_temp.scalar_as_user(o, format($q$select requested_plan::text from public.request_plan_change(%L, 'pro_monthly', null)$q$, t));
  perform pg_temp.rec('LP06 owner solicita PRO sin cambiar entitlement', r = 'OK:pro', r);
end $$;
