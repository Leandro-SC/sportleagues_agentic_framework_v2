-- Recuperación de 20261024000100_scoring_rules_integrity: restaura publish_pool_rules de 20260912000100 y retira guardas y ayudas.
-- No se borran datos: las versiones estándar rellenadas y los eventos de re-puntuación permanecen (el ranking ya toma la versión
-- más reciente por predicción). Retirarlos alteraría la tabla publicada; si hiciera falta, es una decisión de producto aparte.
set local lock_timeout = '5s';

drop function if exists public.pool_rules_policy(uuid);
drop function if exists public.rescore_pool(uuid);
drop trigger if exists pools_default_rules on public.pools;
drop function if exists public.tg_pools_default_rules();
drop trigger if exists pool_rules_guard on public.pool_rules;
drop function if exists public.tg_pool_rules_guard();

create or replace function public.publish_pool_rules(p_pool_id uuid, p_exact_points integer, p_outcome_points integer, p_tie_breaker public.tie_breaker_kind, p_bonus_rules jsonb default '[]'::jsonb) returns public.pool_rules language plpgsql security definer set search_path = public, auth as $$
declare v_tenant_id uuid; v_next_version integer; v_rule public.pool_rules;
begin
  if auth.uid() is null then raise exception 'authentication required' using errcode = '28000'; end if;
  select tenant_id into v_tenant_id from public.pools where id = p_pool_id for update;
  if v_tenant_id is null then raise exception 'pool not found' using errcode = '22023'; end if;
  if not public.is_tenant_admin(v_tenant_id) then raise exception 'not authorized' using errcode = '42501'; end if;
  if p_exact_points < 0 or p_outcome_points < 0 then raise exception 'points must be non-negative' using errcode = '22023'; end if;
  if jsonb_typeof(p_bonus_rules) <> 'array' then raise exception 'bonus_rules must be a json array' using errcode = '22023'; end if;
  select coalesce(max(version), 0) + 1 into v_next_version from public.pool_rules where pool_id = p_pool_id;
  update public.pool_rules set is_current = false where pool_id = p_pool_id and is_current;
  insert into public.pool_rules(tenant_id, pool_id, version, exact_points, outcome_points, tie_breaker, bonus_rules, is_current)
    values (v_tenant_id, p_pool_id, v_next_version, p_exact_points, p_outcome_points, p_tie_breaker, p_bonus_rules, true)
    returning * into v_rule;
  return v_rule;
end $$;
revoke all on function public.publish_pool_rules(uuid, integer, integer, public.tie_breaker_kind, jsonb) from public, anon;
grant execute on function public.publish_pool_rules(uuid, integer, integer, public.tie_breaker_kind, jsonb) to authenticated;

drop function if exists public._tenant_is_pro(uuid);
drop function if exists public._pool_rules_frozen(uuid);
