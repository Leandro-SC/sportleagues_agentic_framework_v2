-- ADR-029: the isolated Control console has one named human operator.
-- This does not change tenant authorization or the general platform_admin role.
-- The email comparison happens server-side against auth.users, never from client input or JWT user metadata.

create function public.is_control_operator() returns boolean
  language sql stable security definer set search_path = public, auth as $$
    select exists (
      select 1
      from public.platform_admins pa
      join auth.users u on u.id = pa.user_id
      where pa.user_id = auth.uid()
        and pa.revoked_at is null
        and lower(u.email) = 'developer.gruposaysil@gmail.com'
    )
  $$;

revoke all on function public.is_control_operator() from public, anon;
grant execute on function public.is_control_operator() to authenticated;

create or replace function public.platform_console_guard() returns void
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null or not public.is_control_operator() then
    raise exception 'not authorized' using errcode = '42501';
  end if;
end $$;
