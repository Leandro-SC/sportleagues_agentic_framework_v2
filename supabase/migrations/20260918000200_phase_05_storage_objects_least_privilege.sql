-- Supabase Storage grants are explicit in the linked QA database. Rebuild the
-- client surface from zero so no inherited/default write grant can bypass the
-- server-side branding pipeline; RLS policy remains the read authorization.
revoke all privileges on table storage.objects from public, anon, authenticated;
grant select on table storage.objects to authenticated;
