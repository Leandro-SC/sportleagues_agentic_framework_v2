-- Corrección de H1 (carrera detectada por scripts/qa/remediation/concurrency.mjs, caso LOCK/c5). Forward-only.
-- Defecto: en tg_matches_after_update el UPDATE pool_matches SET lock_at = clock_timestamp() calculaba el instante ANTES de que
-- heap_update esperara a los guardados que ya sostenían FOR SHARE sobre la fila. Un guardado en curso se aceptaba con un
-- instante posterior al lock_at registrado (ventana de decenas de ms) mientras los pronósticos ya podían revelarse.
-- Corrección: tomar primero FOR UPDATE sobre las filas (espera a los lectores FOR SHARE y bloquea a los nuevos) y calcular el
-- reloj después, con la fila ya bloqueada. El mismo orden de bloqueo (pm por id) que el resto de rutas.
set local lock_timeout = '5s';
set local statement_timeout = '120s';

create or replace function public.tg_matches_after_update() returns trigger
language plpgsql security definer set search_path = ''
as $$
declare r record; v_new timestamptz;
begin
  if new.status <> 'scheduled' and old.status = 'scheduled' then
    perform 1 from public.pool_matches pm
      where pm.match_id = new.id and pm.lock_at > clock_timestamp()
      order by pm.id
        for update of pm;
    update public.pool_matches pm
       set lock_at = clock_timestamp()   -- evaluado con la fila ya bloqueada: ningún guardado en vuelo puede quedar después de este instante
     where pm.match_id = new.id and pm.lock_at > clock_timestamp();
  end if;
  if new.starts_at is distinct from old.starts_at then
    for r in
      select pm.id, p.lock_offset
        from public.pool_matches pm
        join public.pools p on p.id = pm.pool_id and p.tenant_id = pm.tenant_id
       where pm.match_id = new.id and pm.lock_at > clock_timestamp()
       order by pm.id
         for update of pm
    loop
      v_new := new.starts_at - r.lock_offset;
      if v_new <= clock_timestamp() then
        if auth.role() = 'service_role' then
          v_new := clock_timestamp();   -- el partido se adelantó: se bloquea ahora, sin revelar nada antes
        else
          raise exception 'schedule change would lock or reveal the match immediately' using errcode = '42501';
        end if;
      end if;
      update public.pool_matches set lock_at = v_new where id = r.id and lock_at is distinct from v_new;
    end loop;
  end if;
  return null;
end $$;
revoke all on function public.tg_matches_after_update() from public, anon, authenticated;
