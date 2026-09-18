-- Phase 05-bis: authorization foundation for the global platform Superadmin, per ADR-008
-- (docs/architecture/adr/ADR-008-platform-superadmin-authorization.md). This is infrastructure
-- only: no dashboard, no tenant listing, no real identity is provisioned here. Superadmin is a
-- global actor, not a tenant_role value and not a tenant_memberships row: platform_admins carries
-- no tenant_id, so a user can be a platform admin with zero tenant memberships, and a tenant
-- owner/admin is never implicitly a platform admin.

-- `granted_by` uses `on delete set null` rather than the default `no action`/`restrict`: deleting
-- an old Auth account must never be blocked just because it once granted platform admin access
-- to someone else, and the historical row (`granted_at`, `revoked_at`, `note`) must not be lost
-- either. A `NULL` granted_by is therefore read as "bootstrap, or the granting account no longer
-- exists" — both cases mean "no live account to attribute this grant to" and are handled
-- identically by is_platform_admin() (which never reads granted_by at all).
create table public.platform_admins (
  user_id uuid primary key references auth.users(id) on delete cascade,
  granted_by uuid references auth.users(id) on delete set null,
  granted_at timestamptz not null default now(),
  revoked_at timestamptz,
  note text
);

-- RLS is enabled but no policy is created for `authenticated`/`anon`: this table has no grants
-- at all below, so no signed-in user can select/insert/update/delete it directly, with or
-- without a policy. The only sanctioned read path is the security definer function below.
alter table public.platform_admins enable row level security;
revoke all on public.platform_admins from authenticated, anon;

-- is_platform_admin() takes no argument on purpose: the caller can never ask "is user X a
-- platform admin", only "am I one". Identity always comes from auth.uid(), never from a
-- client-supplied parameter. revoked_at is checked live on every call, so revocation is
-- immediate at the PostgreSQL level and does not depend on JWT expiry/refresh.
create function public.is_platform_admin() returns boolean
  language sql stable security definer set search_path = public, auth as $$
    select exists (
      select 1 from public.platform_admins
      where user_id = auth.uid() and revoked_at is null
    )
  $$;

revoke all on function public.is_platform_admin() from public;
grant execute on function public.is_platform_admin() to authenticated;
