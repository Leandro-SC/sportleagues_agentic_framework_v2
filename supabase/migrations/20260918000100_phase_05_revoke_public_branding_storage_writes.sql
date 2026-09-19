-- Phase 05 security hardening: Supabase Storage can retain grants inherited
-- through PUBLIC. Browser clients must never write branding objects directly;
-- only the server-side Edge Function uses the Storage API with service role.
revoke insert, update, delete on table storage.objects from public;
revoke insert, update, delete on table storage.objects from authenticated, anon;
