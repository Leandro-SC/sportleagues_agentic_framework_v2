-- Nombre de plataforma del organizador (ADR-024, 2026-10-24). Forward-only; reversión en
-- supabase/proposed/down/20261024000200_tenant_brand_name.down.sql.
--
-- Cada organizador puede darle un nombre propio a su espacio (p. ej. «Quinielas Silva»). Sus jugadores lo ven en la app y aparece en
-- los flyers e invitaciones que comparte. Disponible en todos los planes; el logo, el banner y los colores siguen siendo PRO (ADR-006).
-- Lectura: la política existente `tenant_branding_select_member` (solo miembros del tenant). Escritura: solo la RPC, solo administradores.
set local lock_timeout = '5s';
set local statement_timeout = '60s';

alter table public.tenant_branding add column brand_name text
  check (brand_name is null or (char_length(brand_name) between 2 and 60 and brand_name = btrim(brand_name) and brand_name !~ '[[:cntrl:]]'));

create function public.set_tenant_brand_name(p_tenant_id uuid, p_brand_name text)
returns public.tenant_branding language plpgsql security definer set search_path = ''
as $$
declare v_name text; v_row public.tenant_branding;
begin
  if auth.uid() is null then raise exception 'authentication required' using errcode = '28000'; end if;
  if p_tenant_id is null or not public.is_tenant_admin(p_tenant_id) then raise exception 'not authorized' using errcode = '42501'; end if;
  -- Espacios internos colapsados; vacío = quitar el nombre (la app vuelve a mostrar SportLeagues).
  v_name := nullif(regexp_replace(btrim(coalesce(p_brand_name, '')), '\s+', ' ', 'g'), '');
  if v_name is not null and (char_length(v_name) not between 2 and 60 or v_name ~ '[[:cntrl:]]') then
    raise exception 'brand name must have between 2 and 60 characters' using errcode = '22023', hint = 'BRAND_NAME_INVALID';
  end if;
  if v_name ~* '(https?://|www\.|@)' then
    raise exception 'brand name cannot contain links or emails' using errcode = '22023', hint = 'BRAND_NAME_INVALID';
  end if;
  insert into public.tenant_branding(tenant_id, brand_name) values (p_tenant_id, v_name)
  on conflict (tenant_id) do update set brand_name = excluded.brand_name, updated_at = now()
  returning * into v_row;
  return v_row;
end $$;
revoke all on function public.set_tenant_brand_name(uuid, text) from public, anon;
grant execute on function public.set_tenant_brand_name(uuid, text) to authenticated;

create trigger audit_tenant_branding after insert or update or delete on public.tenant_branding
  for each row execute function public.tg_audit_row_change('brand_name,primary_color,secondary_color,logo_asset_id,banner_asset_id');
