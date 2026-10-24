-- Integridad de las reglas de puntuación (ADR-023, 2026-10-24). Forward-only; reversión en
-- supabase/proposed/down/20261024000100_scoring_rules_integrity.down.sql.
--
--  S1  Reglas congeladas: una vez alcanzado el primer lock de la quiniela (o publicado cualquier resultado oficial de sus
--      partidos) la versión vigente no puede sustituirse. Antes, `publish_pool_rules` aceptaba cambios a mitad de torneo y
--      `_recalculate_match_scoring` puntuaba cada partido con la regla vigente al publicar su resultado: el ranking mezclaba
--      versiones. Se impone en la RPC y, como defensa, en un trigger de `pool_rules` (también para service_role/propietario).
--  S2  Entitlement del PRD: FREE usa la puntuación estándar (exacto 3 / signo 1); los puntos personalizados exigen PRO.
--      El desempate es elegible en ambos planes.
--  S3  Una quiniela siempre tiene reglas: al abrirse sin versión vigente recibe la estándar (antes puntuaba 0 en silencio).
--      Las quinielas ya abiertas sin reglas reciben la estándar (relleno único de esta migración).
--  S4  Coherencia: `rescore_pool` (solo service_role) re-puntúa con la versión vigente los partidos con resultado; se usa una vez
--      aquí para las quinielas cuyos eventos mezclan versiones. Idempotente por la clave (predicción, revisión, versión).
--  S5  `bonus_rules` no tiene motor: se rechaza cualquier bonificación en lugar de guardarla sin efecto.
--  S6  `pool_rules_policy` permite a la UI de administración saber si puede editar y si puede personalizar.
set local lock_timeout = '5s';
set local statement_timeout = '120s';

-- ---------------------------------------------------------------------------------------------------------------
-- S3 (relleno). Antes de crear el guard: quinielas abiertas alguna vez y sin ninguna versión de reglas.
-- ---------------------------------------------------------------------------------------------------------------
insert into public.pool_rules(tenant_id, pool_id, version, exact_points, outcome_points, tie_breaker, bonus_rules, is_current)
select p.tenant_id, p.id, 1, 3, 1, 'exact_predictions', '[]'::jsonb, true
  from public.pools p
 where p.status <> 'draft'
   and not exists (select 1 from public.pool_rules r where r.pool_id = p.id);

-- ---------------------------------------------------------------------------------------------------------------
-- Ayudas internas
-- ---------------------------------------------------------------------------------------------------------------
create function public._pool_rules_frozen(p_pool_id uuid) returns boolean
language sql security definer set search_path = ''   -- VOLATILE a propósito: _first_lock_passed usa clock_timestamp()
as $$
  select public._first_lock_passed(p_pool_id)
      or exists (select 1 from public.pool_matches pm join public.official_results r on r.match_id = pm.match_id
                  where pm.pool_id = p_pool_id)
$$;
revoke all on function public._pool_rules_frozen(uuid) from public, anon, authenticated;

create function public._tenant_is_pro(p_tenant_id uuid) returns boolean
language sql stable security definer set search_path = ''
as $$ select exists (select 1 from public.tenant_entitlements e where e.tenant_id = p_tenant_id and e.plan_code = 'pro') $$;
revoke all on function public._tenant_is_pro(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------------------------------------------
-- S1/S2/S5. publish_pool_rules: autorizar antes de bloquear (F-01), validar, idempotencia, plan y congelación.
-- ---------------------------------------------------------------------------------------------------------------
create or replace function public.publish_pool_rules(p_pool_id uuid, p_exact_points integer, p_outcome_points integer, p_tie_breaker public.tie_breaker_kind, p_bonus_rules jsonb default '[]'::jsonb)
returns public.pool_rules language plpgsql security definer set search_path = ''
as $$
declare v_tenant uuid; v_next integer; v_cur public.pool_rules; v_rule public.pool_rules;
begin
  if auth.uid() is null then raise exception 'authentication required' using errcode = '28000'; end if;
  select tenant_id into v_tenant from public.pools where id = p_pool_id;                    -- lectura sin bloqueo
  if v_tenant is null or not public.is_tenant_admin(v_tenant) then raise exception 'not authorized' using errcode = '42501'; end if;
  perform 1 from public.pools where id = p_pool_id for update;                                -- el bloqueo solo tras autorizar
  if p_exact_points is null or p_outcome_points is null or p_tie_breaker is null then
    raise exception 'points and tie breaker are required' using errcode = '22023';
  end if;
  if p_exact_points not between 0 and 1000 or p_outcome_points not between 0 and 1000 then
    raise exception 'points must be between 0 and 1000' using errcode = '22023';
  end if;
  if p_exact_points < p_outcome_points then
    raise exception 'exact points cannot be lower than outcome points' using errcode = '22023';
  end if;
  if p_bonus_rules is null or jsonb_typeof(p_bonus_rules) <> 'array' then raise exception 'bonus_rules must be a json array' using errcode = '22023'; end if;
  if jsonb_array_length(p_bonus_rules) > 0 then
    raise exception 'bonus rules are not supported' using errcode = '22023', hint = 'BONUS_RULES_UNSUPPORTED';
  end if;

  select * into v_cur from public.pool_rules where pool_id = p_pool_id and is_current;
  if found and v_cur.exact_points = p_exact_points and v_cur.outcome_points = p_outcome_points and v_cur.tie_breaker = p_tie_breaker then
    return v_cur;                                                                             -- idempotente: nada que versionar
  end if;
  if not public._tenant_is_pro(v_tenant) and (p_exact_points <> 3 or p_outcome_points <> 1) then
    raise exception 'custom scoring requires the pro plan' using errcode = '42501', hint = 'PRO_SCORING_REQUIRED';
  end if;
  if v_cur.id is not null and public._pool_rules_frozen(p_pool_id) then
    raise exception 'scoring rules are frozen after the first lock' using errcode = '42501', hint = 'RULES_FROZEN';
  end if;

  select coalesce(max(version), 0) + 1 into v_next from public.pool_rules where pool_id = p_pool_id;
  update public.pool_rules set is_current = false where pool_id = p_pool_id and is_current;
  insert into public.pool_rules(tenant_id, pool_id, version, exact_points, outcome_points, tie_breaker, bonus_rules, is_current)
    values (v_tenant, p_pool_id, v_next, p_exact_points, p_outcome_points, p_tie_breaker, '[]'::jsonb, true)
    returning * into v_rule;
  return v_rule;
end $$;
revoke all on function public.publish_pool_rules(uuid, integer, integer, public.tie_breaker_kind, jsonb) from public, anon;
grant execute on function public.publish_pool_rules(uuid, integer, integer, public.tie_breaker_kind, jsonb) to authenticated;

-- ---------------------------------------------------------------------------------------------------------------
-- S1 (defensa). pool_rules: filas inmutables salvo retirar la vigente; sin versiones nuevas ni retiros tras congelarse.
-- La primera versión siempre se admite (una quiniela sin reglas no puntúa).
-- ---------------------------------------------------------------------------------------------------------------
create function public.tg_pool_rules_guard() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' then
    if (new.tenant_id, new.pool_id, new.version, new.exact_points, new.outcome_points, new.tie_breaker, new.bonus_rules, new.created_at)
       is distinct from (old.tenant_id, old.pool_id, old.version, old.exact_points, old.outcome_points, old.tie_breaker, old.bonus_rules, old.created_at)
       or (old.is_current = false and new.is_current = true) then
      raise exception 'published pool rules are immutable' using errcode = '42501';
    end if;
    if old.is_current and not new.is_current and public._pool_rules_frozen(old.pool_id) then
      raise exception 'scoring rules are frozen after the first lock' using errcode = '42501', hint = 'RULES_FROZEN';
    end if;
    return new;
  end if;
  if jsonb_array_length(new.bonus_rules) > 0 then
    raise exception 'bonus rules are not supported' using errcode = '22023', hint = 'BONUS_RULES_UNSUPPORTED';
  end if;
  if exists (select 1 from public.pool_rules r where r.pool_id = new.pool_id and r.is_current)
     and public._pool_rules_frozen(new.pool_id) then
    raise exception 'scoring rules are frozen after the first lock' using errcode = '42501', hint = 'RULES_FROZEN';
  end if;
  return new;
end $$;
revoke all on function public.tg_pool_rules_guard() from public, anon, authenticated;
create trigger pool_rules_guard before insert or update on public.pool_rules
  for each row execute function public.tg_pool_rules_guard();

-- ---------------------------------------------------------------------------------------------------------------
-- S3. Al abrirse sin versión vigente, la quiniela recibe la puntuación estándar.
-- ---------------------------------------------------------------------------------------------------------------
create function public.tg_pools_default_rules() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if new.status = 'open' and old.status is distinct from 'open'
     and not exists (select 1 from public.pool_rules r where r.pool_id = new.id and r.is_current) then
    insert into public.pool_rules(tenant_id, pool_id, version, exact_points, outcome_points, tie_breaker, bonus_rules, is_current)
    values (new.tenant_id, new.id, (select coalesce(max(version), 0) + 1 from public.pool_rules where pool_id = new.id),
            3, 1, 'exact_predictions', '[]'::jsonb, true);
  end if;
  return null;
end $$;
revoke all on function public.tg_pools_default_rules() from public, anon, authenticated;
create trigger pools_default_rules after update of status on public.pools
  for each row execute function public.tg_pools_default_rules();

-- ---------------------------------------------------------------------------------------------------------------
-- S4. Re-puntuación coherente con la versión vigente (solo service_role).
-- ---------------------------------------------------------------------------------------------------------------
create function public.rescore_pool(p_pool_id uuid) returns integer
language plpgsql security definer set search_path = ''
as $$
declare v_total integer := 0; m record;
begin
  if coalesce(auth.role(), '') <> 'service_role' and current_user not in ('postgres', 'supabase_admin') then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  for m in select pm.match_id from public.pool_matches pm join public.official_results r on r.match_id = pm.match_id
            where pm.pool_id = p_pool_id order by pm.match_id loop
    v_total := v_total + public._recalculate_match_scoring(m.match_id);
  end loop;
  return v_total;
end $$;
revoke all on function public.rescore_pool(uuid) from public, anon, authenticated;
grant execute on function public.rescore_pool(uuid) to service_role;

do $$
declare p record; v_n integer; v_pools integer := 0; v_events integer := 0;
begin
  for p in
    select distinct pm.pool_id
      from public.scoring_events se
      join public.predictions pr on pr.id = se.prediction_id
      join public.pool_matches pm on pm.id = pr.pool_match_id
      join public.pool_rules ru on ru.pool_id = pm.pool_id and ru.is_current
     where se.rule_version <> ru.version
  loop
    v_n := public.rescore_pool(p.pool_id);
    v_pools := v_pools + 1; v_events := v_events + v_n;
  end loop;
  raise notice 'rescore_pool: % quinielas con versiones mezcladas, % eventos con la versión vigente', v_pools, v_events;
end $$;

-- ---------------------------------------------------------------------------------------------------------------
-- S6. Estado de edición para la UI de administración (solo administradores del tenant).
-- ---------------------------------------------------------------------------------------------------------------
create function public.pool_rules_policy(p_pool_id uuid)
returns table (editable boolean, custom_allowed boolean)
language plpgsql volatile security definer set search_path = ''
as $$
declare v_tenant uuid;
begin
  if auth.uid() is null then raise exception 'authentication required' using errcode = '28000'; end if;
  select tenant_id into v_tenant from public.pools where id = p_pool_id;
  if v_tenant is null or not public.is_tenant_admin(v_tenant) then raise exception 'not authorized' using errcode = '42501'; end if;
  return query select
    not (exists (select 1 from public.pool_rules r where r.pool_id = p_pool_id and r.is_current) and public._pool_rules_frozen(p_pool_id)),
    public._tenant_is_pro(v_tenant);
end $$;
revoke all on function public.pool_rules_policy(uuid) from public, anon;
grant execute on function public.pool_rules_policy(uuid) to authenticated;
