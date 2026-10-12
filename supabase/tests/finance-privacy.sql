-- Finanzas privadas por administrador (Encargo §5, ADR-014 D8, ADR-008). Suite SQL clase B (transacción con rollback).
-- Ejecutar: node scripts/qa/run-sql-suite.mjs supabase/tests/finance-privacy.sql [--with-migration supabase/proposed/20261022000100_security_followups.sql]
-- Sin la migración propuesta debe FALLAR en F06/F07/F13b/F26 (línea base de los hallazgos F-01 y F-04); con ella, PASS completo.
-- Datos 100 % sintéticos (usuarios @example.test creados por el helper); nada persiste.
do $$
declare
  v_ta uuid; v_tb uuid; v_oa uuid; v_aa uuid; v_p1 uuid; v_p2 uuid; v_p3 uuid; v_mx uuid; v_fin uuid; v_ob uuid; v_pb uuid; v_out uuid; v_pad uuid;
  v_pa1 uuid; v_pa2 uuid; v_pb1 uuid; v_part1 uuid; v_part2 uuid; v_part3 uuid; v_partb uuid;
  v_r text; v_n bigint; v_before bigint; v_status text; v_bad text;
begin
  v_oa := pg_temp.mk_user('fp-ownerA'); v_aa := pg_temp.mk_user('fp-adminA'); v_p1 := pg_temp.mk_user('fp-p1'); v_p2 := pg_temp.mk_user('fp-p2');
  v_p3 := pg_temp.mk_user('fp-p3'); v_mx := pg_temp.mk_user('fp-memberA'); v_fin := pg_temp.mk_user('fp-finance'); v_ob := pg_temp.mk_user('fp-ownerB');
  v_pb := pg_temp.mk_user('fp-pB'); v_out := pg_temp.mk_user('fp-outsider'); v_pad := pg_temp.mk_user('fp-platform');
  insert into public.tenants(name) values ('FP tenant A') returning id into v_ta;
  insert into public.tenants(name) values ('FP tenant B') returning id into v_tb;
  insert into public.tenant_entitlements(tenant_id, plan_code) values (v_ta, 'pro'), (v_tb, 'pro');
  insert into public.tenant_memberships(tenant_id, profile_id, role) values
    (v_ta, v_oa, 'owner'), (v_ta, v_aa, 'admin'), (v_ta, v_p1, 'member'), (v_ta, v_p2, 'member'), (v_ta, v_p3, 'member'), (v_ta, v_mx, 'member'), (v_ta, v_fin, 'member'),
    (v_tb, v_ob, 'owner'), (v_tb, v_pb, 'member');
  insert into public.pools(tenant_id, name, status, lock_offset) values (v_ta, 'FP pool A1', 'draft', interval '15 minutes') returning id into v_pa1;
  insert into public.pools(tenant_id, name, status, lock_offset) values (v_ta, 'FP pool A2', 'draft', interval '15 minutes') returning id into v_pa2;
  insert into public.pools(tenant_id, name, status, lock_offset) values (v_tb, 'FP pool B1', 'draft', interval '15 minutes') returning id into v_pb1;
  insert into public.pool_staff(tenant_id, pool_id, profile_id, role) values (v_ta, v_pa1, v_fin, 'pool_finance');
  insert into public.participants(tenant_id, pool_id, profile_id, approval_status, payment_status) values (v_ta, v_pa1, v_p1, 'approved', 'paid') returning id into v_part1;
  insert into public.participants(tenant_id, pool_id, profile_id, approval_status, payment_status) values (v_ta, v_pa1, v_p2, 'approved', 'pending') returning id into v_part2;
  insert into public.participants(tenant_id, pool_id, profile_id, approval_status, payment_status) values (v_ta, v_pa2, v_p3, 'approved', 'invited') returning id into v_part3;
  insert into public.participants(tenant_id, pool_id, profile_id, approval_status, payment_status) values (v_tb, v_pb1, v_pb, 'approved', 'paid') returning id into v_partb;
  insert into public.platform_admins(user_id) values (v_pad);

  -- ---- Lectura directa por RLS (consultas) ------------------------------------------------------------------------------
  v_r := pg_temp.scalar_as_user(v_aa, 'select count(*) from public.participants');
  perform pg_temp.rec('F01 admin A ve solo los 3 participantes de su tenant', v_r = 'OK:3', v_r);
  v_r := pg_temp.scalar_as_user(v_aa, format('select count(*) from public.participants where id = %L', v_partb));
  perform pg_temp.rec('F02 admin A no lee el participante de B por id', v_r = 'OK:0', v_r);
  v_r := pg_temp.scalar_as_user(v_aa, format('select count(*) from public.participants where tenant_id = %L or pool_id = %L', v_tb, v_pb1));
  perform pg_temp.rec('F03 admin A no lista pagos/participantes de la quiniela de B (por tenant ni por pool)', v_r = 'OK:0', v_r);
  v_r := pg_temp.scalar_as_user(v_ob, 'select count(*) from public.participants');
  perform pg_temp.rec('F05 owner B ve solo su participante', v_r = 'OK:1', v_r);
  v_r := pg_temp.scalar_as_user(v_p1, 'select count(*) from public.participants');
  perform pg_temp.rec('F06 un participante solo ve su propia fila (no los pagos de otros)', v_r = 'OK:1', v_r);
  v_r := pg_temp.scalar_as_user(v_p1, format('select count(*) from public.participants where id = %L', v_part2));
  perform pg_temp.rec('F07 un participante no lee el estado de pago de otro participante (misma quiniela)', v_r = 'OK:0', v_r);
  v_r := pg_temp.scalar_as_user(v_p1, format('select payment_status::text from public.participants where id = %L', v_part1));
  perform pg_temp.rec('F08 un participante sí lee su propio estado de pago', v_r = 'OK:paid', v_r);
  v_r := pg_temp.scalar_as_user(v_mx, 'select count(*) from public.participants');
  perform pg_temp.rec('F09 un miembro sin participación no ve ningún pago', v_r = 'OK:0', v_r);
  v_r := pg_temp.scalar_as_user(v_out, 'select count(*) from public.participants');
  perform pg_temp.rec('F10 un usuario sin membresía no ve nada', v_r = 'OK:0', v_r);
  v_r := pg_temp.scalar_as_user(v_fin, format('select count(*) from public.participants where pool_id = %L', v_pa1));
  perform pg_temp.rec('F11a personal pool_finance ve los pagos de SU quiniela', v_r = 'OK:2', v_r);
  v_r := pg_temp.scalar_as_user(v_fin, format('select count(*) from public.participants where pool_id = %L', v_pa2));
  perform pg_temp.rec('F11b ... y no los de otra quiniela del mismo tenant (sin acceso global)', v_r = 'OK:0', v_r);
  v_r := pg_temp.scalar_as_user(v_pad, 'select count(*) from public.participants');
  perform pg_temp.rec('F12 un platform_admin sin membresía no obtiene lectura financiera (ADR-008)', v_r = 'OK:0', v_r);
  v_r := pg_temp.as_role('anon', 'select payment_status from public.participants');
  perform pg_temp.rec('F13 anon no obtiene filas de participants', pg_temp.is_err(v_r, '42501') or v_r = 'OK:0', v_r);
  perform pg_temp.rec('F13b anon no tiene ni el privilegio SELECT sobre participants/audit_log (defensa en profundidad)',
    not has_table_privilege('anon', 'public.participants', 'select') and not has_table_privilege('anon', 'public.audit_log', 'select'), '');

  -- ---- Escritura --------------------------------------------------------------------------------------------------------
  v_r := pg_temp.as_user(v_p1, format($q$update public.participants set payment_status = 'pending' where id = %L$q$, v_part1));
  perform pg_temp.rec('F20 un participante no cambia su propio estado de pago por SQL directo', pg_temp.is_err(v_r, '42501'), v_r);
  v_r := pg_temp.as_user(v_p1, format($q$insert into public.participants(tenant_id, pool_id, profile_id, payment_status) values (%L, %L, %L, 'paid')$q$, v_ta, v_pa2, v_p1));
  perform pg_temp.rec('F21 un participante no se inserta como pagado por SQL directo', pg_temp.is_err(v_r, '42501'), v_r);
  v_r := pg_temp.as_user(v_p1, format('delete from public.participants where id = %L', v_part1));
  perform pg_temp.rec('F22 un participante no borra su fila', pg_temp.is_err(v_r, '42501'), v_r);
  v_r := pg_temp.as_user(v_aa, format($q$update public.participants set payment_status = 'paid' where id = %L$q$, v_part2));
  perform pg_temp.rec('F23 ni el administrador escribe por SQL directo (solo por RPC auditada)', pg_temp.is_err(v_r, '42501'), v_r);
  v_r := pg_temp.as_user(v_p1, format($q$select public.set_participant_payment_status(%L, 'paid')$q$, v_part1));
  perform pg_temp.rec('F24 un participante no usa la RPC de pago (ni sobre su propia fila)', pg_temp.is_err(v_r, '42501'), v_r);
  v_r := pg_temp.as_user(v_aa, format($q$select public.set_participant_payment_status(%L, 'pending')$q$, v_partb));
  select payment_status::text into v_status from public.participants where id = v_partb;
  perform pg_temp.rec('F25 admin A no edita el pago de un participante de B por RPC con id ajeno (y el valor no cambia)', pg_temp.is_err(v_r, '42501') and v_status = 'paid', v_r || ' status=' || v_status);
  v_r := pg_temp.as_user(v_aa, format($q$select public.set_participant_payment_status(%L, 'pending')$q$, gen_random_uuid()));
  perform pg_temp.rec('F26 un id inexistente responde igual que uno ajeno (42501): sin oráculo de existencia', pg_temp.is_err(v_r, '42501'), v_r);
  v_r := pg_temp.as_user(v_aa, format($q$select public.approve_participant(%L)$q$, v_partb));
  perform pg_temp.rec('F28 admin A no aprueba participantes de B', pg_temp.is_err(v_r, '42501'), v_r);
  v_r := pg_temp.as_role('anon', format($q$select public.set_participant_payment_status(%L, 'paid')$q$, v_part2));
  perform pg_temp.rec('F29 anon no ejecuta la RPC de pago', pg_temp.is_err(v_r, '42501'), v_r);
  v_r := pg_temp.as_user(v_pad, format($q$select public.set_participant_payment_status(%L, 'paid')$q$, v_part2));
  perform pg_temp.rec('F30 un platform_admin no edita pagos de un tenant ajeno', pg_temp.is_err(v_r, '42501'), v_r);
  v_r := pg_temp.as_user(v_fin, format($q$select public.set_participant_payment_status(%L, 'paid')$q$, v_part2));
  perform pg_temp.rec('F31 el personal pool_finance (no admin del tenant) aún no escribe pagos: límite documentado, sin escalada', pg_temp.is_err(v_r, '42501'), v_r);
  v_r := pg_temp.as_user(v_aa, format($q$select public.manage_pool('create', null, %L, 'FP intruso', 15, false)$q$, v_tb));
  perform pg_temp.rec('F32 admin A no crea quinielas en el tenant B (tenant del cliente no autoriza)', pg_temp.is_err(v_r, '42501'), v_r);
  select count(*) into v_before from public.audit_log where tenant_id = v_ta;
  v_r := pg_temp.as_user(v_aa, format($q$select public.set_participant_payment_status(%L, 'paid')$q$, v_part2));
  select payment_status::text into v_status from public.participants where id = v_part2;
  perform pg_temp.rec('F27 admin A sí edita el pago de SU participante por RPC', pg_temp.is_ok(v_r) and v_status = 'paid', v_r || ' status=' || v_status);
  select count(*) into v_n from public.audit_log where tenant_id = v_ta;
  perform pg_temp.rec('F27b el cambio de pago queda auditado en el tenant A', v_n > v_before, v_before::text || '->' || v_n::text);

  -- ---- Auditoría --------------------------------------------------------------------------------------------------------
  select count(*) into v_n from public.audit_log where tenant_id = v_tb;
  perform pg_temp.rec('F40pre existen entradas de auditoría del tenant B (precondición)', v_n > 0, v_n::text);
  v_r := pg_temp.scalar_as_user(v_aa, format('select count(*) from public.audit_log where tenant_id = %L', v_tb));
  perform pg_temp.rec('F40 admin A no lee la auditoría de B', v_r = 'OK:0', v_r);
  v_r := pg_temp.scalar_as_user(v_aa, format('select count(*) from public.audit_log where tenant_id = %L', v_ta));
  perform pg_temp.rec('F43 admin A sí lee la auditoría de su tenant (sanidad)', v_r ~ '^OK:[1-9]', v_r);
  v_r := pg_temp.scalar_as_user(v_p1, 'select count(*) from public.audit_log');
  perform pg_temp.rec('F41 un participante no lee auditoría', v_r = 'OK:0', v_r);
  v_r := pg_temp.scalar_as_user(v_pad, 'select count(*) from public.audit_log');
  perform pg_temp.rec('F45 un platform_admin sin membresía no lee la auditoría del tenant', v_r = 'OK:0', v_r);
  v_r := pg_temp.as_role('anon', 'select id from public.audit_log');
  perform pg_temp.rec('F42 anon no obtiene filas de auditoría', pg_temp.is_err(v_r, '42501') or v_r = 'OK:0', v_r);
  v_r := pg_temp.as_user(v_aa, format($q$update public.audit_log set action = 'x' where tenant_id = %L$q$, v_ta));
  perform pg_temp.rec('F44a el administrador no altera la auditoría', pg_temp.is_err(v_r, '42501'), v_r);
  v_r := pg_temp.as_user(v_aa, format('delete from public.audit_log where tenant_id = %L', v_ta));
  perform pg_temp.rec('F44b el administrador no borra la auditoría', pg_temp.is_err(v_r, '42501'), v_r);

  -- ---- RPC de lectura agregada y superficie SECURITY DEFINER ------------------------------------------------------------
  v_r := pg_temp.scalar_as_user(v_p1, format('select count(*) from public.my_points_summary() where pool_id <> %L', v_pa1));
  perform pg_temp.rec('F50 my_points_summary no devuelve quinielas ajenas', v_r = 'OK:0', v_r);
  v_r := pg_temp.as_user(v_aa, format('select * from public.pool_leaderboard(%L, null)', v_pb1));
  perform pg_temp.rec('F51 admin A no consulta el ranking de una quiniela de B', pg_temp.is_err(v_r, '42501'), v_r);
  select string_agg(p.proname, ',') into v_bad from pg_proc p
   where p.pronamespace = 'public'::regnamespace and p.proname in ('pool_leaderboard', 'my_points_summary', 'my_pool_stats', 'pool_ticket_leaderboard', 'list_my_tickets', 'pool_points_evolution')
     and (pg_get_function_result(p.oid) ilike '%pay%' or pg_get_function_result(p.oid) ilike '%financ%');
  perform pg_temp.rec('F52 ningún RPC de ranking/estadística/tickets devuelve campos de pago', v_bad is null, coalesce(v_bad, ''));
  select string_agg(p.proname, ',' order by p.proname) into v_bad from pg_proc p
   where p.pronamespace = 'public'::regnamespace and p.prokind = 'f'
     and (pg_get_function_result(p.oid) ilike '%payment%' or p.prorettype in ('public.participants'::regtype, 'public.audit_log'::regtype))
     and p.proname not in ('approve_participant', 'set_participant_payment_status',   -- administrador (autoriza is_tenant_admin)
                           'join_pool', 'withdraw_participation');                    -- devuelven solo la fila del propio llamante (profile_id = auth.uid())
  perform pg_temp.rec('F53 solo 2 RPC de administrador y 2 RPC de fila propia devuelven filas de participants', v_bad is null, coalesce(v_bad, ''));
  select count(*) into v_n from (
    select 1 from pg_views where schemaname = 'public' and definition ilike '%payment_status%'
    union all select 1 from pg_matviews where schemaname = 'public' and definition ilike '%payment_status%') x;
  perform pg_temp.rec('F54 ninguna vista (ni materializada) expone payment_status', v_n = 0, v_n::text);
  perform pg_temp.rec('F55 los clientes no tienen INSERT/UPDATE/DELETE sobre participants (ni payment_status)',
    not has_table_privilege('authenticated', 'public.participants', 'insert') and not has_table_privilege('authenticated', 'public.participants', 'update')
    and not has_table_privilege('authenticated', 'public.participants', 'delete') and not has_column_privilege('authenticated', 'public.participants', 'payment_status', 'update'), '');
  select count(*) into v_n from information_schema.columns where table_schema = 'public' and table_name in ('tickets', 'pool_rounds') and column_name ilike '%pay%';
  perform pg_temp.rec('F56 tickets/pool_rounds (Etapa 1 gratuita) no contienen datos de pago', v_n = 0, v_n::text);
  select count(*) into v_n from pg_proc p where p.pronamespace = 'public'::regnamespace and has_function_privilege('anon', p.oid, 'execute');
  perform pg_temp.rec('F61 anon no ejecuta ninguna función de public', v_n = 0, v_n::text);
end $$;
