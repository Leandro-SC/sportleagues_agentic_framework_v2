-- UAT-01: listado de participantes para administración. Se ejecuta con scripts/qa/run-sql-suite.mjs (rollback; no deja datos).
do $$
declare v_t uuid; v_t2 uuid; v_o uuid; v_adm2 uuid; v_p uuid; v_q uuid; v_mem uuid; v_pool uuid; v_res text;
begin
  v_o := pg_temp.mk_user('ap-owner'); v_adm2 := pg_temp.mk_user('ap-admin-other'); v_p := pg_temp.mk_user('ap-player');
  v_q := pg_temp.mk_user('ap-pending'); v_mem := pg_temp.mk_user('ap-member');
  insert into public.tenants(name) values ('AP tenant') returning id into v_t;
  insert into public.tenants(name) values ('AP other') returning id into v_t2;
  insert into public.tenant_entitlements(tenant_id, plan_code) values (v_t, 'free'), (v_t2, 'free');
  insert into public.tenant_memberships(tenant_id, profile_id, role) values (v_t, v_o, 'owner'), (v_t, v_p, 'member'), (v_t, v_q, 'member'), (v_t, v_mem, 'member'), (v_t2, v_adm2, 'owner');
  insert into public.pools(tenant_id, name, status, lock_offset, requires_approval) values (v_t, 'AP pool', 'open', interval '15 minutes', true) returning id into v_pool;
  insert into public.participants(tenant_id, pool_id, profile_id, approval_status, payment_status) values (v_t, v_pool, v_p, 'approved', 'paid'), (v_t, v_pool, v_q, 'pending', 'invited');

  v_res := pg_temp.scalar_as_user(v_o, format($q$select string_agg(display_name || '/' || approval_status || '/' || payment_status, ',' order by display_name) from public.admin_pool_participants(%L)$q$, v_pool));
  perform pg_temp.rec('AP01 el owner ve participantes con nombre, aprobación y pago', v_res = 'OK:ap-pending/pending/invited,ap-player/approved/paid', v_res);
  v_res := pg_temp.as_user(v_mem, format($q$select * from public.admin_pool_participants(%L)$q$, v_pool));
  perform pg_temp.rec('AP02 un miembro no administra: no ve la lista', pg_temp.is_err(v_res, '42501'), v_res);
  v_res := pg_temp.as_user(v_p, format($q$select * from public.admin_pool_participants(%L)$q$, v_pool));
  perform pg_temp.rec('AP03 un participante tampoco', pg_temp.is_err(v_res, '42501'), v_res);
  v_res := pg_temp.as_user(v_adm2, format($q$select * from public.admin_pool_participants(%L)$q$, v_pool));
  perform pg_temp.rec('AP04 el owner de otro tenant no la ve', pg_temp.is_err(v_res, '42501'), v_res);
  v_res := pg_temp.as_user(v_o, format($q$select * from public.admin_pool_participants(%L)$q$, gen_random_uuid()));
  perform pg_temp.rec('AP05 una quiniela inexistente responde igual que no autorizado', pg_temp.is_err(v_res, '42501'), v_res);
  v_res := pg_temp.as_role('anon', format($q$select * from public.admin_pool_participants(%L)$q$, v_pool));
  perform pg_temp.rec('AP06 anon no ejecuta la función', pg_temp.is_err(v_res, '42501'), v_res);
  v_res := pg_temp.scalar_as_user(v_o, format($q$select count(*)::text from public.admin_pool_participants(%L) where display_name like '%%@%%'$q$, v_pool));
  perform pg_temp.rec('AP07 no expone correos', v_res = 'OK:0', v_res);
end $$;
