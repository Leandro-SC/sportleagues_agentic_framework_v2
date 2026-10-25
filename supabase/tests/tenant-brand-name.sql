-- ADR-024: nombre de plataforma del organizador. Se ejecuta con scripts/qa/run-sql-suite.mjs (transacción con rollback; no deja datos).
do $$
declare v_t uuid; v_t2 uuid; v_o uuid; v_adm uuid; v_mem uuid; v_out uuid; v_res text; v_n integer;
begin
  v_o := pg_temp.mk_user('bn-owner'); v_adm := pg_temp.mk_user('bn-admin'); v_mem := pg_temp.mk_user('bn-mem'); v_out := pg_temp.mk_user('bn-out');
  insert into public.tenants(name) values ('BN tenant') returning id into v_t;
  insert into public.tenants(name) values ('BN other') returning id into v_t2;
  insert into public.tenant_entitlements(tenant_id, plan_code) values (v_t, 'free'), (v_t2, 'pro');
  insert into public.tenant_memberships(tenant_id, profile_id, role) values (v_t, v_o, 'owner'), (v_t, v_adm, 'admin'), (v_t, v_mem, 'member'), (v_t2, v_out, 'owner');

  v_res := pg_temp.scalar_as_user(v_o, format($q$select brand_name from public.set_tenant_brand_name(%L, '  Quinielas   Silva ')$q$, v_t));
  perform pg_temp.rec('BN01 el owner FREE fija el nombre (espacios normalizados)', v_res = 'OK:Quinielas Silva', v_res);
  v_res := pg_temp.scalar_as_user(v_adm, format($q$select brand_name from public.set_tenant_brand_name(%L, 'Liga Silva')$q$, v_t));
  perform pg_temp.rec('BN02 un admin del tenant también puede cambiarlo', v_res = 'OK:Liga Silva', v_res);
  v_res := pg_temp.scalar_as_user(v_mem, format($q$select brand_name from public.tenant_branding where tenant_id = %L$q$, v_t));
  perform pg_temp.rec('BN03 un jugador (miembro) ve el nombre', v_res = 'OK:Liga Silva', v_res);
  v_res := pg_temp.scalar_as_user(v_out, format($q$select count(*)::text from public.tenant_branding where tenant_id = %L$q$, v_t));
  perform pg_temp.rec('BN04 un usuario de otro tenant no lo ve', v_res = 'OK:0', v_res);
  v_res := pg_temp.as_user(v_mem, format($q$select public.set_tenant_brand_name(%L, 'Hackeado')$q$, v_t));
  perform pg_temp.rec('BN05 un miembro no lo cambia', pg_temp.is_err(v_res, '42501'), v_res);
  v_res := pg_temp.as_user(v_out, format($q$select public.set_tenant_brand_name(%L, 'Ajeno')$q$, v_t));
  perform pg_temp.rec('BN06 el owner de otro tenant no lo cambia', pg_temp.is_err(v_res, '42501'), v_res);
  v_res := pg_temp.as_role('anon', format($q$select public.set_tenant_brand_name(%L, 'Anon')$q$, v_t));
  perform pg_temp.rec('BN07 anon no ejecuta la RPC', pg_temp.is_err(v_res, '42501'), v_res);
  v_res := pg_temp.as_user(v_o, format($q$select public.set_tenant_brand_name(%L, 'X')$q$, v_t));
  perform pg_temp.rec('BN08 menos de 2 caracteres se rechaza', pg_temp.is_err(v_res, '22023', 'BRAND_NAME_INVALID'), v_res);
  v_res := pg_temp.as_user(v_o, format($q$select public.set_tenant_brand_name(%L, %L)$q$, v_t, repeat('a', 61)));
  perform pg_temp.rec('BN09 más de 60 caracteres se rechaza', pg_temp.is_err(v_res, '22023', 'BRAND_NAME_INVALID'), v_res);
  v_res := pg_temp.as_user(v_o, format($q$select public.set_tenant_brand_name(%L, 'Entra a https://phish.example')$q$, v_t));
  perform pg_temp.rec('BN10 enlaces no se admiten', pg_temp.is_err(v_res, '22023', 'BRAND_NAME_INVALID'), v_res);
  v_res := pg_temp.as_user(v_o, format($q$select public.set_tenant_brand_name(%L, E'Liga\nSilva')$q$, v_t));
  perform pg_temp.rec('BN11 el salto de línea se normaliza a espacio', pg_temp.is_ok(v_res) and (select brand_name from public.tenant_branding where tenant_id = v_t) = 'Liga Silva', v_res);
  begin
    update public.tenant_branding set brand_name = E'con\tcontrol' where tenant_id = v_t;
    perform pg_temp.rec('BN12 la tabla rechaza caracteres de control por DML directo', false, 'update aceptado');
  exception when check_violation then
    perform pg_temp.rec('BN12 la tabla rechaza caracteres de control por DML directo', true, sqlstate);
  end;
  v_res := pg_temp.scalar_as_user(v_o, format($q$select coalesce(brand_name, '<null>') from public.set_tenant_brand_name(%L, '   ')$q$, v_t));
  perform pg_temp.rec('BN13 vacío quita el nombre', v_res = 'OK:<null>', v_res);
  select count(*) into v_n from public.audit_log where tenant_id = v_t and entity_type = 'tenant_branding';
  perform pg_temp.rec('BN14 cada cambio real queda auditado (alta, cambio y borrado; normalizar al mismo valor no audita)', v_n = 3, 'filas=' || v_n);
  -- El nombre no altera los colores PRO ni al revés
  v_res := pg_temp.scalar_as_user(v_out, format($q$select brand_name from public.set_tenant_brand_name(%L, 'Pro Club')$q$, v_t2));
  v_res := pg_temp.as_user(v_out, format($q$select public.update_tenant_branding(%L, '#ff0055', null)$q$, v_t2));
  v_res := pg_temp.scalar_as_user(v_out, format($q$select brand_name || '/' || primary_color from public.tenant_branding where tenant_id = %L$q$, v_t2));
  perform pg_temp.rec('BN15 guardar colores PRO conserva el nombre', v_res = 'OK:Pro Club/#ff0055', v_res);
end $$;
