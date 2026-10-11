# Política de desarrollo y pruebas sin Docker (todo en la nube)

Estado: **aprobada por el usuario (2026-10-11)**. Prevalece sobre cualquier runbook histórico que mencione Docker o
Supabase local. No sustituye a `AGENTS.md`.

## 1. Regla

No se instala, inicia ni exige Docker Desktop, contenedores ni servicios locales de Supabase. Infraestructura:
VS Code · GitHub · Vercel · **Supabase Cloud** (BD, Auth, RLS, Storage) · Vitest y herramientas actuales de Node.

**Comandos prohibidos** (dependen de contenedores): `supabase start`, `supabase stop`, `supabase status`, `supabase test db`,
`supabase db reset`, `supabase db diff`/`db lint`/`db pull`/`db dump` (usan contenedores: shadow DB o `pg_dump` en Docker), `supabase db start`, `docker …`, `npx supabase gen types --local`.
Se conservan como referencia histórica (no ejecutar): `supabase/config.toml` (puertos locales), la mención «local vía Docker» en
reportes antiguos y las cabeceras «privileged local test role» de `supabase/tests/*.sql`.

**Comandos permitidos:** `npm run typecheck|test|build|verify:bundle`, `git`, `npx supabase migration list --linked`,
`npx supabase db push --linked --dry-run`, `npx supabase db query --linked|--project-ref <ref>` (Management API),
`npx supabase db advisors --linked`. Respaldos sin Docker: PITR/copias del panel de Supabase (según plan) y exportaciones por `db query` de tablas sin PII.

## 2. Clasificación de pruebas SQL

| Clase | Qué es | Dónde puede ejecutarse | Condiciones |
| --- | --- | --- | --- |
| **A — solo lectura** | `SELECT` sobre catálogos (`pg_class`, `pg_policies`, `pg_proc`, `has_table_privilege`, …) sin leer filas de aplicación | **QA**, de inmediato | Sin PII ni pronósticos; un solo archivo por consulta; resultado guardado como evidencia |
| **B — transaccional reversible** | Escrituras dentro de `BEGIN … ROLLBACK` (p. ej. las suites `phase-03/04/05`) | QA **solo tras revisar el archivo y con aprobación expresa** | Un `ROLLBACK` no elimina todos los riesgos: bloqueos de tabla, consumo de secuencias, filas muertas/bloat, `NOTIFY`, triggers con efectos externos, advisory locks, *pg_cron*/webhooks, y requiere sesión que no se corte antes del `ROLLBACK`. Por defecto se trata como C |
| **C — migraciones, ataques, destructivas, concurrencia** | Aplicar migraciones, reproducir H1/H2, `TRUNCATE`, cambios de roles, pruebas paralelas | **Solo en un proyecto Supabase Cloud independiente y descartable**, con datos sintéticos | Requiere autorización para crearlo (coste) y para cada ejecución; **QA nunca es entorno descartable** |

Una prueba que no pueda ejecutarse se reporta **BLOCKED** con su alternativa prevista; **no se elimina ni se debilita** para obtener PASS.

## 3. Catálogo de pruebas existentes y propuestas

| Suite | Clase | Estado | Alternativa sin Docker |
| --- | --- | --- | --- |
| `supabase/tests/phase-03-rls.sql`, `phase-04-join-pool.sql`, `phase-05-*.sql`, `phase-05bis-platform-admin.sql` | B→C (escriben dentro de transacciones y usan semilla) | **BLOCKED** hasta entorno descartable | Ejecutar con `db query --project-ref <scratch>`; en QA solo con aprobación (clase B) |
| `supabase/tests/proposed/00-readonly-baseline.sql` (nuevo) | **A** | **Ejecutable ya** sobre QA | `db query --linked -f …`; hoy debe **fallar** donde aún no se aplica la remediación (línea base) |
| `supabase/tests/proposed/10…` (remediación H1–H6, incompatibilidad, auditoría, privilegios, rollback) | C | BLOCKED | Proyecto descartable + `scripts/qa/remediation/run-suite.mjs` |
| `scripts/qa/remediation/concurrency.mjs` (nuevo) | C | BLOCKED | Usa `@supabase/supabase-js` ya instalado y sesiones de usuarios sintéticos; carreras con `Promise.all` de RPC |
| `scripts/qa/*.sh` (happy paths de branding) | B/C (escriben en QA) | Histórico; no ejecutar sin aprobación | Cloud ya; requieren credenciales de QA |
| Vitest (`npm test`), `typecheck`, `build`, `verify:bundle` | — (sin BD) | Ejecutables | Secuenciales, nunca en paralelo |

## 4. Entorno descartable en la nube (propuesta; **no creado**)

- **Qué:** un proyecto Supabase Cloud separado de QA (p. ej. `sportleagues-scratch`), misma región, solo para clase C.
- **Requisitos:** organización con cupo; contraseña de BD y claves en variables de entorno locales (nunca en el repositorio);
  esquema aplicado desde `supabase/migrations/` + `supabase/proposed/` mediante `db query`/`db push --db-url` (sin `link`,
  para no cambiar el proyecto enlazado a QA); datos solo sintéticos (semilla de Fase 03 adaptada); usuarios creados con la API
  Admin del propio proyecto descartable.
- **Salvaguardas:** `run-suite.mjs` rechaza ejecutarse si la referencia es la de QA o la enlazada y exige `SCRATCH_CONFIRM=DESTRUCTIVE`.
- **Coste (verificar precios vigentes en el panel antes de crear):** en un plan gratuito un segundo proyecto suele ser sin
  coste mientras la organización no supere el límite de proyectos activos (los gratuitos se pausan por inactividad);
  en una organización de pago cada proyecto adicional añade coste de cómputo mensual prorratado. Alternativa: ramas
  (*branching*) con coste por tiempo activo. Eliminar el proyecto al cerrar la ronda de pruebas limita el gasto.
- **Autorización necesaria:** crear el proyecto (coste), almacenar sus claves en variables locales y ejecutar cada suite clase C.

## 5. Optimización de recursos

Sin procesos persistentes; un build/test a la vez; pruebas incrementales (archivo o directorio) antes de la suite completa
(`npx vitest run --config apps/platform/vitest.config.ts <ruta>`); no leer todo el repositorio; Skills y agentes solo cuando
correspondan; sin dependencias nuevas sin justificar. Herramientas auxiliares puntuales (p. ej. un parser SQL para validar
sintaxis) se instalan fuera del repositorio y se desechan.

## 6. Impacto en fases y criterios de aceptación

- Fases 05/05-bis: la validación «Postgres real local vía Docker» de `PHASE-05BIS-QA-DEPLOYMENT-PLAN.md` se sustituye por
  «proyecto descartable en la nube (clase C) o, con aprobación, QA en transacción (clase B)».
- Hardening H1–H6 (ADR-015): criterio de aceptación = suites clase C **ejecutadas en el proyecto descartable**; sin entorno,
  el estado es **BLOCKED**, no PASS. La migración no se aplica a QA antes de esa validación.
- Fase 06 no inicia hasta cerrar las condiciones de seguridad (ADR-015 §12).

## 7. Excepción del propietario (2026-10-11)

El propietario autorizó aplicar migraciones y ejecutar suites clase B/C sobre QA (`juoftaofzepxbrrxbkhx`) con datos sintéticos, sin proyecto descartable adicional, sin Docker y sin borrar Auth/Storage/secretos ni datos de naturaleza no comprobada. Las pruebas que crean datos protegidos (H2/append-only) dejan residuo sintético irreversible; documentar el residuo en cada handoff.

Desde 2026-10-11 las suites SQL nuevas se ejecutan con `scripts/qa/run-sql-suite.mjs` (transacción con rollback, sin residuo); ver `docs/operations/QA-SYNTHETIC-RESIDUE.md`.
