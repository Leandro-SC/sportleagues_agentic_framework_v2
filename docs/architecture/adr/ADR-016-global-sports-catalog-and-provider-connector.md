# ADR-016 — Catálogo deportivo global y conector de proveedor (API-Football)

- Estado: Accepted (2026-10-11, por encargo expreso del propietario) — **el despliegue a producción/Vercel del conector requiere autorización aparte**
- Complementa: ADR-009 (catálogo y escudos), ADR-010 (contexto de fixture por quiniela), ADR-011 (lock/calendario), ADR-012 (resultados revisables)
- Impacto AGENTS.md §12: proveedor externo nuevo, esquema central (datos globales fuera de tenants), cambio de lectura móvil.

## Contexto

Hoy cada organizador crea torneos, equipos y partidos a mano (tenant-owned). Se quiere importar competiciones reales desde API-Football (API-Sports)
sin que cada organizador consuma la cuota, sin mezclar datos privados entre tenants y sin que el móvil hable con el proveedor.

## Decisión

1. **Tres niveles de lectura: proveedor → Supabase → dispositivo.** Solo una Edge Function (`sports-sync`, `service_role`, clave en secretos de función) llama al
   proveedor. Los móviles solo leen Supabase y guardan caché local (ver §7).
2. **Catálogo global de solo lectura para clientes** (`catalog_competitions`, `catalog_seasons`, `catalog_teams`, `catalog_fixtures`): sin `tenant_id` porque son datos
   deportivos públicos, no datos de un organizador. RLS: `SELECT` a `authenticated`; **ninguna** escritura de clientes. Identidad única `(provider, external_id)`.
3. **Los datos de los tenants siguen aislados.** Importar una jornada **copia** al tenant (torneo/equipos/jornada/partidos tenant-owned) mediante la RPC
   `import_catalog_round` (autoriza `is_tenant_admin` del torneo; el tenant sale de la entidad). El vínculo se guarda en `external_refs` (Fase 06): equipo y
   partido por `(tenant, provider, tipo, external_id)`. Quinielas, tickets, pronósticos, ingresos y permisos no se comparten.
3. **Importación una sola vez por recurso compartido**: `catalog_import_jobs` + `pg_advisory_xact_lock` + índice único parcial `(provider, resource_key)` donde
   `status='running'`. Una segunda solicitud simultánea recibe `in_progress` (o `fresh` si ya se importó dentro de la ventana) y **no** consume cuota.
4. **Cuota**: contador atómico diario por proveedor (`provider_usage`, día UTC) con tope configurable (por defecto 100 = plan Free, con reserva). Sin cuota, la función
   degrada (devuelve datos del catálogo ya guardado y `provider_unavailable`/`quota_exhausted`); nunca descarga ligas anticipadamente.
5. **Sincronización de estados/resultados** (`catalog_propagate_*`, solo `service_role`):
   - horario: se aplica con la maquinaria de ADR-011 (`apply_fixture_update`): adelantar bloquea ya; **nunca reabre un lock alcanzado**;
   - estados del proveedor se mapean a `scheduled|live|final` + `matches.provider_state` (`postponed|cancelled|abandoned`) sin ampliar el enum de partido
     (el estado sigue siendo monótono); un partido cancelado no recibe resultado y por tanto no puntúa;
   - resultado final (marcador a 90 minutos, `score.fulltime`) → `official_results` con `source='provider'` y `published_by` nulo; una diferencia posterior sube la
     **revisión** y recalcula idempotentemente (`_recalculate_match_scoring`, ADR-012). Un resultado **manual** nunca se sobrescribe: se registra un conflicto;
   - todo cambio queda en `fixture_sync_log` (legible por administradores del tenant) y las importaciones en `audit_log`.
6. **Escudos**: no se almacenan, copian ni redistribuyen. No se pudo verificar con fuentes oficiales que los términos de API-Sports permitan guardar o servir
   logos de clubes (marcas de terceros); se mantiene la política de ADR-009 (escudo generado por iniciales/colores). No se guarda siquiera la URL del logo.
   Reabrir solo con licencia documentada.
7. **Caché móvil** (`lib/offline-cache`): IndexedDB (justificada: no existía persistencia estructurada; solo `localStorage` para banderas), espacio de nombres por
   `usuario:tenant`, versión de esquema + `updated_at`, TTL por tipo, tope de tamaño con desalojo LRU, borrado al cerrar sesión, deduplicación de solicitudes en vuelo
   y modo solo lectura sin conexión con indicador de antigüedad. **No** se cachean credenciales, tokens ni datos privados en cachés compartidas; las escrituras
   (pronósticos, tickets) se confirman siempre en servidor y la hora del dispositivo jamás decide un lock.
8. **Adaptador desacoplado**: interfaz `SportsProvider` (buscar competiciones, temporadas, fixtures por jornada, fixtures por ids) + implementación `api-football`.
   Cambiar de proveedor = nueva implementación y otro valor de `provider`; el esquema no cambia.

## Alternativas descartadas

- Que cada tenant llame al proveedor: multiplica cuota y filtra credenciales/horarios al cliente.
- Catálogo por tenant: duplica importaciones y rompe la deduplicación.
- Ampliar `match_status` con `postponed/cancelled`: cambia la máquina de estados protegida por H1–H6 (rango de regresión y `else 3` implícito).
- Descargar todas las ligas: contradice el control de costes.

## Consecuencias / riesgos

- Dependencia de la disponibilidad y cuota del proveedor: mitigada con catálogo persistente y degradación.
- Plan Free: temporadas actuales pueden no estar cubiertas (limitación del plan, no del diseño); se informa en la UI/respuesta de la función.
- El marcador a 90 min puede diferir del que el organizador desee en eliminatorias; el administrador puede corregir manualmente (queda como `manual`).
- Un partido cancelado conserva pronósticos hasta el lock natural (no hay puntos); el organizador puede retirarlo de la quiniela si no tiene pronósticos.

## Rollback

Migración forward-only con `down` en `supabase/proposed/down/`. Deshabilitar = no desplegar/borrar la función; los datos importados a tenants permanecen válidos.
