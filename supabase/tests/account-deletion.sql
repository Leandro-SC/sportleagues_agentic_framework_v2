-- ADR-026: eliminación de cuenta. Se ejecuta con scripts/qa/run-sql-suite.mjs (transacción con rollback; no deja datos).
do $$
declare v_t uuid; v_o uuid; v_p uuid; v_q uuid; v_pool uuid; v_res text; v_n integer;
begin
  v_o := pg_temp.mk_user('ad-owner'); v_p := pg_temp.mk_user('ad-player'); v_q := pg_temp.mk_user('ad-other');
  insert into public.tenants(name) values ('AD tenant') returning id into v_t;
  insert into public.tenant_entitlements(tenant_id, plan_code) values (v_t, 'free');
  insert into public.tenant_memberships(tenant_id, profile_id, role) values (v_t, v_o, 'owner'), (v_t, v_p, 'member'), (v_t, v_q, 'member');
  insert into public.pools(tenant_id, name, status, lock_offset) values (v_t, 'AD pool', 'open', interval '15 minutes') returning id into v_pool;
  insert into public.participants(tenant_id, pool_id, profile_id, approval_status, payment_status) values (v_t, v_pool, v_p, 'approved', 'paid');

  v_res := pg_temp.scalar_as_user(v_p, 'select coalesce(array_to_string(public.account_deletion_blockers(), '','' ), '''')');
  perform pg_temp.rec('AD01 un jugador no tiene impedimentos', v_res = 'OK:', v_res);
  v_res := pg_temp.scalar_as_user(v_o, 'select array_to_string(public.account_deletion_blockers(), '','')');
  perform pg_temp.rec('AD02 el owner debe transferir la organización antes', v_res = 'OK:ADMINISTERS_ORGANIZATION', v_res);
  v_res := pg_temp.as_role('anon', 'select public.account_deletion_blockers()');
  perform pg_temp.rec('AD03 anon no consulta impedimentos', pg_temp.is_err(v_res, '42501'), v_res);

  v_res := pg_temp.as_user(v_p, format($q$select public.anonymize_account(%L)$q$, v_p));
  perform pg_temp.rec('AD04 un usuario no ejecuta la anonimización directamente', pg_temp.is_err(v_res, '42501'), v_res);
  v_res := pg_temp.as_role('service_role', format($q$select public.anonymize_account(%L)$q$, v_o));
  perform pg_temp.rec('AD05 la anonimización rechaza cuentas que administran', pg_temp.is_err(v_res, '42501', 'ADMINISTERS_ORGANIZATION'), v_res);

  v_res := pg_temp.as_role('service_role', format($q$select public.anonymize_account(%L)$q$, v_p));
  perform pg_temp.rec('AD06 service_role anonimiza al jugador', pg_temp.is_ok(v_res), v_res);
  select display_name || '/' || (deleted_at is not null)::text into v_res from public.profiles where id = v_p;
  perform pg_temp.rec('AD07 el perfil queda como «Usuario eliminado» con fecha de baja', v_res = 'Usuario eliminado/true', v_res);
  select count(*) into v_n from public.tenant_memberships where profile_id = v_p and is_active;
  perform pg_temp.rec('AD08 sus membresías quedan inactivas', v_n = 0, 'activas=' || v_n);
  select count(*) into v_n from public.participants where profile_id = v_p;
  perform pg_temp.rec('AD09 su historial competitivo se conserva (sin borrado en cascada)', v_n = 1, 'filas=' || v_n);
  select count(*) into v_n from public.audit_log where tenant_id = v_t and action = 'account.deleted' and entity_id = v_p and metadata ? 'reason' and not metadata ? 'email';
  perform pg_temp.rec('AD10 queda un registro de auditoría sin PII', v_n = 1, 'filas=' || v_n);
  v_res := pg_temp.as_role('service_role', format($q$select public.anonymize_account(%L)$q$, v_p));
  perform pg_temp.rec('AD11 repetir es inocuo', pg_temp.is_ok(v_res), v_res);
  v_res := pg_temp.as_role('service_role', format($q$select public.anonymize_account(%L)$q$, gen_random_uuid()));
  perform pg_temp.rec('AD12 un perfil inexistente se rechaza', pg_temp.is_err(v_res, '22023'), v_res);
  select display_name into v_res from public.profiles where id = v_q;
  perform pg_temp.rec('AD13 no afecta a otros usuarios', v_res = left('ad-other', 40), v_res);
end $$;
