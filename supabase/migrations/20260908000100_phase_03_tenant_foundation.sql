-- Phase 03: forward-only tenant foundation. Run on an empty Supabase database.
create extension if not exists pgcrypto;

create type public.tenant_role as enum ('owner', 'admin', 'member');
create type public.plan_code as enum ('free', 'pro');
create type public.pool_status as enum ('draft', 'open', 'paused', 'archived');
create type public.match_status as enum ('scheduled', 'live', 'final');
create type public.participant_approval_status as enum ('pending', 'approved');
create type public.participant_payment_status as enum ('paid', 'pending', 'invited');
create type public.tie_breaker_kind as enum ('exact_predictions', 'prediction_submitted_at');

create function public.set_updated_at() returns trigger language plpgsql set search_path = public as $$ begin new.updated_at = now(); return new; end $$;

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null check (char_length(display_name) between 1 and 80),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table public.plans (code public.plan_code primary key, created_at timestamptz not null default now());
insert into public.plans(code) values ('free'), ('pro');
create table public.tenants (
  id uuid primary key default gen_random_uuid(), name text not null check (char_length(name) between 1 and 120), timezone text not null default 'UTC' check (timezone ~ '^[A-Za-z_]+/[A-Za-z_]+$|^UTC$'), created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table public.tenant_memberships (
  id uuid primary key default gen_random_uuid(), tenant_id uuid not null references public.tenants(id) on delete cascade, profile_id uuid not null references public.profiles(id) on delete cascade, role public.tenant_role not null, is_active boolean not null default true, created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique (tenant_id, profile_id), unique (id, tenant_id)
);
create table public.tenant_entitlements (
  tenant_id uuid primary key references public.tenants(id) on delete cascade, plan_code public.plan_code not null references public.plans(code), created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table public.tenant_branding (
  tenant_id uuid primary key references public.tenants(id) on delete cascade, primary_color text, secondary_color text, logo_asset_id uuid, banner_asset_id uuid, created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table public.pools (
  id uuid primary key default gen_random_uuid(), tenant_id uuid not null references public.tenants(id) on delete cascade, name text not null check (char_length(name) between 1 and 120), status public.pool_status not null default 'draft', lock_offset interval not null default interval '0 minutes' check (lock_offset >= interval '0 minutes'), requires_approval boolean not null default false, created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique (id, tenant_id)
);
create table public.pool_rules (
  id uuid primary key default gen_random_uuid(), tenant_id uuid not null, pool_id uuid not null, version integer not null check (version > 0), exact_points integer not null check (exact_points >= 0), outcome_points integer not null check (outcome_points >= 0), tie_breaker public.tie_breaker_kind not null, bonus_rules jsonb not null default '[]'::jsonb check (jsonb_typeof(bonus_rules) = 'array'), is_current boolean not null default true, created_at timestamptz not null default now(), unique (pool_id, version), unique (id, tenant_id), foreign key (pool_id, tenant_id) references public.pools(id, tenant_id) on delete cascade
);
create unique index pool_rules_one_current_per_pool on public.pool_rules(pool_id) where is_current;
create table public.pool_join_codes (
  id uuid primary key default gen_random_uuid(), tenant_id uuid not null, pool_id uuid not null, code char(6) not null unique check (code ~ '^[A-Z0-9]{6}$'), is_enabled boolean not null default true, expires_at timestamptz, created_at timestamptz not null default now(), foreign key (pool_id, tenant_id) references public.pools(id, tenant_id) on delete cascade
);
create table public.tournaments (
  id uuid primary key default gen_random_uuid(), tenant_id uuid not null references public.tenants(id) on delete cascade, name text not null check (char_length(name) between 1 and 120), created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique (id, tenant_id)
);
create table public.teams (
  id uuid primary key default gen_random_uuid(), tenant_id uuid not null references public.tenants(id) on delete cascade, name text not null check (char_length(name) between 1 and 120), crest_asset_path text, created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique (id, tenant_id), unique (tenant_id, name)
);
create table public.rounds (
  id uuid primary key default gen_random_uuid(), tenant_id uuid not null, tournament_id uuid not null, name text not null check (char_length(name) between 1 and 120), sort_order integer not null check (sort_order >= 0), created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique (id, tenant_id), unique (tournament_id, sort_order), foreign key (tournament_id, tenant_id) references public.tournaments(id, tenant_id) on delete cascade
);
create table public.matches (
  id uuid primary key default gen_random_uuid(), tenant_id uuid not null, tournament_id uuid not null, round_id uuid not null, home_team_id uuid not null, away_team_id uuid not null, starts_at timestamptz not null, status public.match_status not null default 'scheduled', created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique (id, tenant_id), check (home_team_id <> away_team_id), foreign key (tournament_id, tenant_id) references public.tournaments(id, tenant_id), foreign key (round_id, tenant_id) references public.rounds(id, tenant_id), foreign key (home_team_id, tenant_id) references public.teams(id, tenant_id), foreign key (away_team_id, tenant_id) references public.teams(id, tenant_id)
);
create table public.pool_matches (
  id uuid primary key default gen_random_uuid(), tenant_id uuid not null, pool_id uuid not null, match_id uuid not null, created_at timestamptz not null default now(), unique (id, tenant_id, pool_id), unique (pool_id, match_id), foreign key (pool_id, tenant_id) references public.pools(id, tenant_id) on delete cascade, foreign key (match_id, tenant_id) references public.matches(id, tenant_id) on delete cascade
);
create table public.participants (
  id uuid primary key default gen_random_uuid(), tenant_id uuid not null, pool_id uuid not null, profile_id uuid not null, approval_status public.participant_approval_status not null default 'pending', payment_status public.participant_payment_status not null default 'invited', created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique (pool_id, profile_id), unique (id, tenant_id, pool_id), foreign key (pool_id, tenant_id) references public.pools(id, tenant_id) on delete cascade, foreign key (tenant_id, profile_id) references public.tenant_memberships(tenant_id, profile_id)
);
create table public.predictions (
  id uuid primary key default gen_random_uuid(), tenant_id uuid not null, pool_id uuid not null, pool_match_id uuid not null, participant_id uuid not null, home_score integer not null check (home_score >= 0), away_score integer not null check (away_score >= 0), created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique (participant_id, pool_match_id), foreign key (pool_match_id, tenant_id, pool_id) references public.pool_matches(id, tenant_id, pool_id) on delete cascade, foreign key (participant_id, tenant_id, pool_id) references public.participants(id, tenant_id, pool_id) on delete cascade
);
alter table public.predictions add unique (id, tenant_id);
create table public.official_results (
  id uuid primary key default gen_random_uuid(), tenant_id uuid not null, match_id uuid not null, home_score integer not null check (home_score >= 0), away_score integer not null check (away_score >= 0), revision integer not null default 1 check (revision > 0), published_by uuid not null references public.profiles(id), published_at timestamptz not null default now(), unique (match_id), unique (match_id, revision), foreign key (match_id, tenant_id) references public.matches(id, tenant_id) on delete cascade
);
create table public.scoring_events (
  id uuid primary key default gen_random_uuid(), tenant_id uuid not null, prediction_id uuid not null, result_revision integer not null check (result_revision > 0), rule_version integer not null check (rule_version > 0), points integer not null, created_at timestamptz not null default now(), unique (prediction_id, result_revision, rule_version), foreign key (prediction_id, tenant_id) references public.predictions(id, tenant_id) on delete cascade
);
create table public.team_ratings (
  id uuid primary key default gen_random_uuid(), tenant_id uuid not null, team_id uuid not null, rating numeric(10,4) not null, model_version text not null, calculated_at timestamptz not null default now(), foreign key (team_id, tenant_id) references public.teams(id, tenant_id) on delete cascade
);
create table public.model_predictions (
  id uuid primary key default gen_random_uuid(), tenant_id uuid not null, match_id uuid not null, model_version text not null, home_lambda numeric(10,4) not null check (home_lambda >= 0), away_lambda numeric(10,4) not null check (away_lambda >= 0), score_matrix jsonb not null, calculated_at timestamptz not null default now(), foreign key (match_id, tenant_id) references public.matches(id, tenant_id) on delete cascade
);
create table public.branding_assets (
  id uuid primary key default gen_random_uuid(), tenant_id uuid not null references public.tenants(id) on delete cascade, storage_path text not null unique check (storage_path ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}$'), mime_type text not null check (mime_type in ('image/png', 'image/jpeg', 'image/webp')), byte_size bigint not null check (byte_size > 0), created_at timestamptz not null default now(), unique (id, tenant_id)
);
alter table public.tenant_branding add constraint tenant_branding_logo_fk foreign key (logo_asset_id, tenant_id) references public.branding_assets(id, tenant_id);
alter table public.tenant_branding add constraint tenant_branding_banner_fk foreign key (banner_asset_id, tenant_id) references public.branding_assets(id, tenant_id);
create table public.audit_log (
  id uuid primary key default gen_random_uuid(), tenant_id uuid not null references public.tenants(id) on delete cascade, actor_id uuid references public.profiles(id), action text not null check (char_length(action) between 1 and 100), entity_type text not null check (char_length(entity_type) between 1 and 100), entity_id uuid, metadata jsonb not null default '{}'::jsonb, created_at timestamptz not null default now()
);

create index tenant_memberships_profile_tenant_idx on public.tenant_memberships(profile_id, tenant_id) where is_active;
create index pools_tenant_status_idx on public.pools(tenant_id, status);
create index pool_join_codes_lookup_idx on public.pool_join_codes(code) where is_enabled;
create index rounds_tenant_tournament_idx on public.rounds(tenant_id, tournament_id, sort_order);
create index matches_tenant_round_start_idx on public.matches(tenant_id, round_id, starts_at);
create index pool_matches_pool_idx on public.pool_matches(pool_id, match_id);
create index participants_tenant_profile_idx on public.participants(tenant_id, profile_id, pool_id);
create index predictions_pool_match_idx on public.predictions(tenant_id, pool_match_id);
create index official_results_tenant_match_idx on public.official_results(tenant_id, match_id);
create index scoring_events_tenant_prediction_idx on public.scoring_events(tenant_id, prediction_id);
create index team_ratings_tenant_team_idx on public.team_ratings(tenant_id, team_id, calculated_at desc);
create index model_predictions_tenant_match_idx on public.model_predictions(tenant_id, match_id, calculated_at desc);
create index audit_log_tenant_created_idx on public.audit_log(tenant_id, created_at desc);

create function public.is_tenant_member(p_tenant_id uuid) returns boolean language sql stable security definer set search_path = public, auth as $$ select exists (select 1 from public.tenant_memberships m where m.tenant_id = p_tenant_id and m.profile_id = auth.uid() and m.is_active) $$;
create function public.is_tenant_admin(p_tenant_id uuid) returns boolean language sql stable security definer set search_path = public, auth as $$ select exists (select 1 from public.tenant_memberships m where m.tenant_id = p_tenant_id and m.profile_id = auth.uid() and m.is_active and m.role in ('owner', 'admin')) $$;
create function public.can_read_prediction(p_tenant_id uuid, p_participant_id uuid, p_pool_match_id uuid) returns boolean language sql stable security definer set search_path = public, auth as $$ select exists (select 1 from public.participants p where p.id = p_participant_id and p.tenant_id = p_tenant_id and p.profile_id = auth.uid()) or exists (select 1 from public.participants viewer join public.pool_matches pm on pm.pool_id = viewer.pool_id and pm.tenant_id = viewer.tenant_id join public.matches m on m.id = pm.match_id and m.tenant_id = pm.tenant_id join public.pools pool on pool.id = pm.pool_id and pool.tenant_id = pm.tenant_id where viewer.tenant_id = p_tenant_id and viewer.profile_id = auth.uid() and viewer.approval_status = 'approved' and pm.id = p_pool_match_id and now() >= m.starts_at - pool.lock_offset) $$;
create function public.storage_tenant_id(p_name text) returns uuid language plpgsql immutable set search_path = public as $$ begin if p_name ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/' then return split_part(p_name, '/', 1)::uuid; end if; return null; end $$;
revoke all on function public.is_tenant_member(uuid), public.is_tenant_admin(uuid), public.can_read_prediction(uuid, uuid, uuid), public.storage_tenant_id(text) from public;
grant execute on function public.is_tenant_member(uuid), public.is_tenant_admin(uuid), public.can_read_prediction(uuid, uuid, uuid), public.storage_tenant_id(text) to authenticated;

create function public.join_pool(p_code text) returns public.participants language plpgsql security definer set search_path = public, auth as $$ declare v_code public.pool_join_codes; v_participant public.participants; v_user uuid := auth.uid(); begin if v_user is null then raise exception 'authentication required' using errcode = '28000'; end if; select * into v_code from public.pool_join_codes where code = upper(p_code) and is_enabled and (expires_at is null or expires_at > now()) for update; if not found then raise exception 'join code is invalid or expired' using errcode = '22023'; end if; if not exists (select 1 from public.pools where id = v_code.pool_id and tenant_id = v_code.tenant_id and status = 'open') then raise exception 'pool is not open' using errcode = '22023'; end if; insert into public.tenant_memberships(tenant_id, profile_id, role) values (v_code.tenant_id, v_user, 'member') on conflict (tenant_id, profile_id) do nothing; select * into v_participant from public.participants where tenant_id = v_code.tenant_id and pool_id = v_code.pool_id and profile_id = v_user; if found then return v_participant; end if; if exists (select 1 from public.tenant_entitlements e where e.tenant_id = v_code.tenant_id and e.plan_code = 'free') and (select count(*) from public.participants where tenant_id = v_code.tenant_id and pool_id = v_code.pool_id) >= 10 then raise exception 'free participant limit reached' using errcode = '22023'; end if; insert into public.participants(tenant_id, pool_id, profile_id, approval_status, payment_status) select v_code.tenant_id, v_code.pool_id, v_user, case when p.requires_approval then 'pending' else 'approved' end, 'invited' from public.pools p where p.id = v_code.pool_id and p.tenant_id = v_code.tenant_id returning * into v_participant; return v_participant; end $$;
create function public.save_prediction(p_pool_id uuid, p_match_id uuid, p_home_score integer, p_away_score integer) returns public.predictions language plpgsql security definer set search_path = public, auth as $$ declare v_prediction public.predictions; v_user uuid := auth.uid(); begin if v_user is null then raise exception 'authentication required' using errcode = '28000'; end if; if p_home_score < 0 or p_away_score < 0 then raise exception 'scores must be non-negative' using errcode = '22023'; end if; with target as (select pm.id as pool_match_id, pm.tenant_id, pm.pool_id, p.id as participant_id, m.starts_at, pool.lock_offset from public.pool_matches pm join public.matches m on m.id = pm.match_id and m.tenant_id = pm.tenant_id join public.pools pool on pool.id = pm.pool_id and pool.tenant_id = pm.tenant_id join public.participants p on p.pool_id = pm.pool_id and p.tenant_id = pm.tenant_id where pm.pool_id = p_pool_id and pm.match_id = p_match_id and p.profile_id = v_user and p.approval_status = 'approved' and pool.status = 'open' and m.status = 'scheduled') insert into public.predictions(tenant_id, pool_id, pool_match_id, participant_id, home_score, away_score) select tenant_id, pool_id, pool_match_id, participant_id, p_home_score, p_away_score from target where now() < starts_at - lock_offset on conflict (participant_id, pool_match_id) do update set home_score = excluded.home_score, away_score = excluded.away_score, updated_at = now() returning * into v_prediction; if not found then raise exception 'prediction is unavailable, unauthorized, or locked' using errcode = '42501'; end if; return v_prediction; end $$;
revoke all on function public.join_pool(text), public.save_prediction(uuid, uuid, integer, integer) from public;
grant execute on function public.join_pool(text), public.save_prediction(uuid, uuid, integer, integer) to authenticated;

do $$ declare t text; begin foreach t in array array['tenant_memberships','tenant_entitlements','tenant_branding','pools','pool_rules','pool_join_codes','tournaments','teams','rounds','matches','pool_matches','participants','official_results','scoring_events','team_ratings','model_predictions','branding_assets'] loop execute format('alter table public.%I enable row level security', t); execute format('create policy %I on public.%I for select to authenticated using (public.is_tenant_member(tenant_id))', t || '_select_member', t); end loop; end $$;
alter table public.tenants enable row level security;
create policy tenants_select_member on public.tenants for select to authenticated using (public.is_tenant_member(id));
alter table public.audit_log enable row level security;
alter table public.predictions enable row level security;
alter table public.profiles enable row level security;
create policy profiles_select_self on public.profiles for select to authenticated using (id = auth.uid());
create policy profiles_insert_self on public.profiles for insert to authenticated with check (id = auth.uid());
create policy profiles_update_self on public.profiles for update to authenticated using (id = auth.uid()) with check (id = auth.uid());
alter table public.plans enable row level security;
create policy plans_select_authenticated on public.plans for select to authenticated using (true);
create policy predictions_select_visible on public.predictions for select to authenticated using (public.can_read_prediction(tenant_id, participant_id, pool_match_id));
create policy pools_admin_write on public.pools for all to authenticated using (public.is_tenant_admin(tenant_id)) with check (public.is_tenant_admin(tenant_id));
create policy pool_rules_admin_write on public.pool_rules for all to authenticated using (public.is_tenant_admin(tenant_id)) with check (public.is_tenant_admin(tenant_id));
create policy pool_codes_admin_write on public.pool_join_codes for all to authenticated using (public.is_tenant_admin(tenant_id)) with check (public.is_tenant_admin(tenant_id));
create policy schedule_admin_write on public.tournaments for all to authenticated using (public.is_tenant_admin(tenant_id)) with check (public.is_tenant_admin(tenant_id));
create policy teams_admin_write on public.teams for all to authenticated using (public.is_tenant_admin(tenant_id)) with check (public.is_tenant_admin(tenant_id));
create policy rounds_admin_write on public.rounds for all to authenticated using (public.is_tenant_admin(tenant_id)) with check (public.is_tenant_admin(tenant_id));
create policy matches_admin_write on public.matches for all to authenticated using (public.is_tenant_admin(tenant_id)) with check (public.is_tenant_admin(tenant_id));
create policy pool_matches_admin_write on public.pool_matches for all to authenticated using (public.is_tenant_admin(tenant_id)) with check (public.is_tenant_admin(tenant_id));
create policy branding_admin_write on public.branding_assets for all to authenticated using (public.is_tenant_admin(tenant_id)) with check (public.is_tenant_admin(tenant_id));
create policy branding_config_admin_write on public.tenant_branding for all to authenticated using (public.is_tenant_admin(tenant_id)) with check (public.is_tenant_admin(tenant_id));
create policy audit_admin_read on public.audit_log for select to authenticated using (public.is_tenant_admin(tenant_id));
revoke insert, update, delete on public.predictions, public.official_results, public.scoring_events, public.tenant_entitlements, public.tenant_memberships, public.participants, public.team_ratings, public.model_predictions, public.audit_log from authenticated, anon;
grant select on all tables in schema public to authenticated;
grant insert, update, delete on public.pools, public.pool_rules, public.pool_join_codes, public.tournaments, public.teams, public.rounds, public.matches, public.pool_matches, public.branding_assets, public.tenant_branding to authenticated;

insert into storage.buckets(id, name, public) values ('branding-assets', 'branding-assets', false) on conflict (id) do nothing;
create policy branding_assets_storage_select on storage.objects for select to authenticated using (bucket_id = 'branding-assets' and public.is_tenant_member(public.storage_tenant_id(name)));
create policy branding_assets_storage_insert on storage.objects for insert to authenticated with check (bucket_id = 'branding-assets' and public.is_tenant_admin(public.storage_tenant_id(name)) and lower(storage.extension(name)) in ('png','jpg','jpeg','webp'));
create policy branding_assets_storage_update on storage.objects for update to authenticated using (bucket_id = 'branding-assets' and public.is_tenant_admin(public.storage_tenant_id(name))) with check (bucket_id = 'branding-assets' and public.is_tenant_admin(public.storage_tenant_id(name)) and lower(storage.extension(name)) in ('png','jpg','jpeg','webp'));
create policy branding_assets_storage_delete on storage.objects for delete to authenticated using (bucket_id = 'branding-assets' and public.is_tenant_admin(public.storage_tenant_id(name)));

do $$ declare t text; begin foreach t in array array['profiles','tenants','tenant_memberships','tenant_entitlements','tenant_branding','pools','tournaments','teams','rounds','matches','participants','predictions'] loop execute format('create trigger %I before update on public.%I for each row execute function public.set_updated_at()', t || '_set_updated_at', t); end loop; end $$;
