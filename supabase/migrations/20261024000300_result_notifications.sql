-- Notificaciones de resultados dentro de la app (ADR-025, 2026-10-24). Forward-only; reversión en
-- supabase/proposed/down/20261024000300_result_notifications.down.sql.
--
-- Cada jugador inscrito (aprobado y no retirado) recibe un aviso cuando se publica o se corrige el resultado oficial de un partido
-- de sus quinielas, venga del organizador o del proveedor. El aviso muestra solo SU pronóstico y sus puntos, calculados con la regla
-- vigente (congelada tras el primer lock, ADR-023). Es idempotente: una fila por (jugador, quiniela, partido, revisión).
-- Sin proveedor externo: las push del sistema operativo (Web Push/FCM) requieren claves y ADR aparte.
set local lock_timeout = '5s';
set local statement_timeout = '60s';

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  pool_id uuid not null,
  match_id uuid not null,
  kind text not null check (kind in ('result_published', 'result_corrected')),
  result_revision integer not null check (result_revision > 0),
  title text not null check (char_length(title) between 1 and 160),
  body text not null check (char_length(body) between 1 and 300),
  created_at timestamptz not null default now(),
  read_at timestamptz,
  unique (profile_id, pool_id, match_id, result_revision)
);
create index notifications_profile_created_idx on public.notifications (profile_id, created_at desc);
create index notifications_profile_unread_idx on public.notifications (profile_id) where read_at is null;

alter table public.notifications enable row level security;
create policy notifications_select_own on public.notifications for select to authenticated using (profile_id = auth.uid());
revoke all on public.notifications from anon;
revoke insert, update, delete, truncate, references, trigger on public.notifications from authenticated;
grant select on public.notifications to authenticated;

create function public.tg_official_results_notify() returns trigger
language plpgsql security definer set search_path = ''
as $$
declare v_kind text := case when tg_op = 'INSERT' then 'result_published' else 'result_corrected' end;
begin
  if tg_op = 'UPDATE' and new.revision = old.revision and new.home_score = old.home_score and new.away_score = old.away_score then
    return null;   -- cambios sin efecto en el marcador (p. ej. fuente o autor) no notifican
  end if;
  insert into public.notifications(tenant_id, profile_id, pool_id, match_id, kind, result_revision, title, body)
  select pa.tenant_id, pa.profile_id, pm.pool_id, new.match_id, v_kind, new.revision,
         left((case v_kind when 'result_published' then 'Resultado: ' else 'Resultado corregido: ' end)
              || th.name || ' ' || new.home_score || '-' || new.away_score || ' ' || ta.name, 160),
         left(po.name || ' · ' || case
                when po.ticketing_mode = 'tickets' then 'Revisa los puntos de tus tickets.'
                when pr.id is null then 'No registraste pronóstico para este partido.'
                else 'Tu pronóstico ' || pr.home_score || '-' || pr.away_score || ': '
                     || case when pr.home_score = new.home_score and pr.away_score = new.away_score then coalesce(ru.exact_points, 0)
                             when sign(pr.home_score - pr.away_score) = sign(new.home_score - new.away_score) then coalesce(ru.outcome_points, 0)
                             else 0 end || ' pts'
              end, 300)
    from public.pool_matches pm
    join public.pools po on po.id = pm.pool_id and po.status <> 'draft'
    join public.participants pa on pa.pool_id = pm.pool_id and pa.approval_status = 'approved' and pa.withdrawn_at is null
    join public.matches m on m.id = new.match_id
    join public.teams th on th.id = m.home_team_id
    join public.teams ta on ta.id = m.away_team_id
    left join public.pool_rules ru on ru.pool_id = pm.pool_id and ru.is_current
    left join public.predictions pr on pr.pool_match_id = pm.id and pr.participant_id = pa.id and pr.ticket_id is null
   where pm.match_id = new.match_id
  on conflict (profile_id, pool_id, match_id, result_revision) do nothing;
  return null;
end $$;
revoke all on function public.tg_official_results_notify() from public, anon, authenticated;
create trigger official_results_notify after insert or update of home_score, away_score, revision on public.official_results
  for each row execute function public.tg_official_results_notify();

create function public.mark_notifications_read(p_ids uuid[] default null) returns integer
language plpgsql security definer set search_path = ''
as $$
declare v_n integer;
begin
  if auth.uid() is null then raise exception 'authentication required' using errcode = '28000'; end if;
  update public.notifications set read_at = clock_timestamp()
   where profile_id = auth.uid() and read_at is null and (p_ids is null or id = any (p_ids));
  get diagnostics v_n = row_count;
  return v_n;
end $$;
revoke all on function public.mark_notifications_read(uuid[]) from public, anon;
grant execute on function public.mark_notifications_read(uuid[]) to authenticated;

-- Retención: los avisos leídos de más de 180 días se purgan por un proceso de servidor (solo service_role).
create function public.purge_read_notifications(p_older_than interval default interval '180 days') returns integer
language plpgsql security definer set search_path = ''
as $$
declare v_n integer;
begin
  if auth.role() is distinct from 'service_role' then raise exception 'not authorized' using errcode = '42501'; end if;
  if p_older_than < interval '30 days' then raise exception 'retention must be at least 30 days' using errcode = '22023'; end if;
  delete from public.notifications where read_at is not null and created_at < now() - p_older_than;
  get diagnostics v_n = row_count;
  return v_n;
end $$;
revoke all on function public.purge_read_notifications(interval) from public, anon, authenticated;
grant execute on function public.purge_read_notifications(interval) to service_role;

-- Tiempo real (respeta RLS: cada usuario solo recibe sus filas). Si la publicación no existe, la app cae al sondeo.
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    execute 'alter publication supabase_realtime add table public.notifications';
  end if;
end $$;
