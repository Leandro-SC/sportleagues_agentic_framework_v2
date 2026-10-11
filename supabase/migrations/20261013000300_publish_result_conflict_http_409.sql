-- Hallazgo del E2E real (scripts/qa/e2e/mvp-flow.mjs, RES5): un conflicto de revisión levantado con SQLSTATE 40001 deja la petición
-- REST colgada hasta "upstream request timeout" (el gateway/pooler trata 40001 como fallo reintentable). Se usa el SQLSTATE
-- personalizado de PostgREST PT409 (HTTP 409 Conflict). Misma lógica de ADR-012; solo cambia el código del conflicto. Forward-only.
set local lock_timeout = '5s';
set local statement_timeout = '120s';

create or replace function public.publish_official_result(p_match_id uuid, p_home_score integer, p_away_score integer, p_expected_revision integer)
returns public.official_results language plpgsql security definer set search_path = ''
as $$
declare v_uid uuid := auth.uid(); m public.matches; r public.official_results;
begin
  if v_uid is null then raise exception 'authentication required' using errcode = '28000'; end if;
  if p_home_score is null or p_away_score is null or p_home_score < 0 or p_away_score < 0 then
    raise exception 'scores must be non-negative' using errcode = '22023';
  end if;
  if p_expected_revision is null or p_expected_revision < 0 then raise exception 'expected revision is required' using errcode = '22023'; end if;
  select * into m from public.matches where id = p_match_id for update;
  if not found then raise exception 'match not found' using errcode = '22023'; end if;
  if not public.is_tenant_admin(m.tenant_id) then raise exception 'not authorized' using errcode = '42501'; end if;
  select * into r from public.official_results where match_id = m.id for update;
  if not found then
    if p_expected_revision <> 0 then raise exception 'revision conflict' using errcode = 'PT409'; end if;
    if m.starts_at > clock_timestamp() then raise exception 'the match has not started' using errcode = '22023'; end if;
    insert into public.official_results(tenant_id, match_id, home_score, away_score, revision, published_by)
      values (m.tenant_id, m.id, p_home_score, p_away_score, 1, v_uid) returning * into r;
  else
    if p_expected_revision <> r.revision then raise exception 'revision conflict' using errcode = 'PT409'; end if;
    if (r.home_score, r.away_score) is distinct from (p_home_score, p_away_score) then
      update public.official_results set home_score = p_home_score, away_score = p_away_score, revision = r.revision + 1,
             published_by = v_uid, published_at = clock_timestamp()
       where id = r.id returning * into r;
    end if;   -- mismo marcador: repetición idempotente, sin nueva revisión
  end if;
  if m.status <> 'final' then update public.matches set status = 'final', updated_at = now() where id = m.id; end if;
  perform public._recalculate_match_scoring(m.id);
  return r;
end $$;
