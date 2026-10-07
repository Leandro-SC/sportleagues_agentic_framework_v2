# ADR-009 — Catálogo de torneos/equipos y política de escudos

- Estado: Proposed
- Fecha: 2026-10-06
- Decisores: Architecture (preparación de Fase 06)

## Contexto

Fase 03 creó `tournaments` con solo nombre y `teams` con nombre más `crest_asset_path`. El contrato
visual de preparación expone brechas: deporte, país, color, temporada, identidad visual y una
relación inequívoca equipo-torneo. Además, un path de escudo sin bucket, lifecycle, licencia ni
política no permite una carga segura.

## Decisión propuesta

1. Torneo y equipo seguirán siendo tenant-owned. Se propone añadir al torneo `sport_code` controlado,
   `country_code` ISO opcional, `season_label` opcional y color de presentación validado. El equipo
   tendrá país opcional, colores primario/secundario validados e identidad por nombre dentro del
   tenant; ningún campo se usa como autorización.
2. Un equipo no pertenece implícitamente a un único torneo. Se propone una relación tenant-scoped
   `tournament_teams`; permite reutilizarlo en varios torneos y permite que DB/RPC exija que los dos
   equipos de cada partido estén inscritos en su torneo.
3. No se usarán logos oficiales de clubes, ligas o federaciones sin licencia documentada. El fallback
   normal es un escudo generado por iniciales y colores propios.
4. Si el producto aprueba assets propios, se crearán en una fase autorizada un bucket privado
   independiente `team-assets`, metadata tenant-scoped y lifecycle análogo a ADR-007. Solo
   owner/admin podrá iniciar/gestionar el asset; miembros autorizados solo leerán assets activos por
   URL firmada breve. El pipeline server-side inspecciona PNG/JPEG/WebP y recodifica WebP; prohíbe
   SVG, hotlinks externos, URLs públicas y nombres originales persistidos.
5. `crest_asset_path` no se tratará como contrato seguro ni como integración con `branding_assets`.
   La migración aprobada definirá una referencia nueva o una transición explícita y validable.

## Alternativas consideradas

- Agregar `tournament_id` directamente a `teams`: rechazada, porque duplicaría equipos que participan
  en más de un torneo y no expresa la inscripción.
- Dejar solo `crest_asset_path`: rechazada; no tiene autorización, lifecycle ni validación binaria.
- Reusar `branding-assets`/`branding_assets`: rechazada; los escudos no son branding PRO y comparten
  ni el entitlement ni la retención del tenant branding.
- Permitir URL externa: rechazada por licencia, disponibilidad, tracking y falta de control de contenido.

## Consecuencias

La implementación futura necesita migración forward-only, constraints de coherencia tenant/torneo,
RLS, RPC de gestión y pruebas negativas cross-tenant. La UI puede renderizar escudos generados sin
esperar esa infraestructura. La relación permite filtrar el catálogo por torneo sin inferirlo de
partidos existentes.

## Seguridad / privacidad

Tenant, path y asset ID del cliente son localizadores, nunca permiso. No se persisten nombre de
archivo, EXIF ni URL firmada. La licencia/origen del asset propio debe documentarse fuera del binario
antes de activarlo.

## Migración / rollback

No se crea migración con este ADR. La implementación debe conservar los datos actuales y hacer
backfill explícito o dejar los campos opcionales. Un rollback funcional deshabilita cargas y vuelve a
escudo generado; no borra assets sin pasar por lifecycle de limpieza.
