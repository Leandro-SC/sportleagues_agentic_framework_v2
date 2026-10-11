-- REPRODUCCIÓN H1/H2 — SOLO PARA UNA BASE DESCARTABLE (Supabase local: `npx supabase start`, migraciones + seed de Fase 03).
-- NO EJECUTAR EN QA NI EN PRODUCCIÓN. Está pendiente de autorización del usuario (informe §9-A).
-- Todo ocurre dentro de una transacción con ROLLBACK. Usa solo el seed sintético de supabase/seed/phase-03-development.sql:
--   Owner A (11111111-…) es owner del Tenant A y participante aprobado de Pool A (lock_offset 15 min); Match …030 / pool_match …040.
-- Resultado esperado HOY (vulnerable): los NOTICE «VULNERABLE: …» aparecen. Tras R1/R2 deben ser «PROTEGIDO: …».
begin;

-- Preparación como propietario: partido a 30 min del inicio (aún abierto con offset 15) y otro participante con pronóstico.
update public.matches set starts_at = now() + interval '30 minutes', status = 'scheduled'
 where id = 'aaaaaaaa-0000-0000-0000-000000000030';

select set_config('request.jwt.claims', '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}', true);
set local role authenticated;

do $$
declare
  v_seen_before int; v_seen_after int; v_rows int; v_reopened boolean := false; v_left int;
begin
  -- H1a: adelantar el lock (offset 60 > 30 min restantes) revela pronósticos ajenos mientras él los puede leer.
  select count(*) into v_seen_before from public.predictions where pool_match_id = 'aaaaaaaa-0000-0000-0000-000000000040';
  begin
    perform public.manage_pool('update', 'aaaaaaaa-0000-0000-0000-000000000001', null, 'Pool A', 60, false);
    select count(*) into v_seen_after from public.predictions where pool_match_id = 'aaaaaaaa-0000-0000-0000-000000000040';
    raise notice '%: lectura antes=% después de subir lock_offset=% (ajenos visibles antes del lock original)',
      case when v_seen_after > v_seen_before then 'VULNERABLE' else 'PROTEGIDO' end, v_seen_before, v_seen_after;
    -- H1b: volver a bajar el offset reabre la edición tras haber visto los pronósticos ajenos.
    perform public.manage_pool('update', 'aaaaaaaa-0000-0000-0000-000000000001', null, 'Pool A', 15, false);
    begin
      perform public.save_prediction('aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000030', 9, 9);
      v_reopened := true;
    exception when others then v_reopened := false; end;
    raise notice '%: edición reabierta tras revelar = %', case when v_reopened then 'VULNERABLE' else 'PROTEGIDO' end, v_reopened;
  exception when others then
    raise notice 'PROTEGIDO: manage_pool rechazó el cambio (%)', sqlerrm;
  end;

  -- H1c: reabrir un partido mutando matches directamente.
  begin
    update public.matches set starts_at = now() + interval '1 day', status = 'scheduled'
     where id = 'aaaaaaaa-0000-0000-0000-000000000030';
    get diagnostics v_rows = row_count;
    raise notice '%: UPDATE directo en matches afectó % fila(s)', case when v_rows > 0 then 'VULNERABLE' else 'PROTEGIDO' end, v_rows;
  exception when others then
    raise notice 'PROTEGIDO: UPDATE en matches rechazado (%)', sqlerrm;
  end;

  -- H2: borrar pool_matches arrastra predicciones y scoring_events.
  begin
    delete from public.pool_matches where id = 'aaaaaaaa-0000-0000-0000-000000000040';
    get diagnostics v_rows = row_count;
    reset role;
    select count(*) into v_left from public.predictions where pool_match_id = 'aaaaaaaa-0000-0000-0000-000000000040';
    raise notice '%: DELETE en pool_matches afectó % fila(s); predicciones restantes del partido = %',
      case when v_rows > 0 and v_left = 0 then 'VULNERABLE' else 'PROTEGIDO' end, v_rows, v_left;
  exception when others then
    raise notice 'PROTEGIDO: DELETE en pool_matches rechazado (%)', sqlerrm;
  end;
end $$;

rollback;

-- Comprobación de privilegios (H4–H6, H9): válida también contra QA porque solo lee catálogos.
select c.relname, r.rolname,
       has_table_privilege(r.rolname, c.oid, 'TRUNCATE')   as truncate_priv,
       has_table_privilege(r.rolname, c.oid, 'REFERENCES') as references_priv,
       has_table_privilege(r.rolname, c.oid, 'TRIGGER')    as trigger_priv
from pg_class c join pg_namespace n on n.oid = c.relnamespace and n.nspname = 'public'
cross join (values ('anon'), ('authenticated')) r(rolname)
where c.relkind = 'r' and (has_table_privilege(r.rolname, c.oid, 'TRUNCATE') or has_table_privilege(r.rolname, c.oid, 'REFERENCES') or has_table_privilege(r.rolname, c.oid, 'TRIGGER'))
order by 1, 2;
