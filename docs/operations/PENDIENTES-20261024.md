# Pendientes al cierre del lote — 2026-10-24

Lista única de lo que falta. El lote se detuvo por pedido del propietario: no hay procesos en ejecución. Lo hecho y su evidencia están en `reports/release/diagnostico-final-20261024.md`.

Estado del repositorio al detenerse:

- Rama `feat/api-football-connector` publicada en `origin`, con todos los commits del lote.
- `main` sigue en `1f2b755` (QA web desactualizada; ver §2).
- Supabase QA tiene 34/34 migraciones.

## 1. Defectos encontrados por la UAT de navegador (sin corregir)

Fuente: `reports/testing/uat-browser-20261012.md` (88 PASS / 45 FAIL / 3 NOT_RUN). Las líneas citadas corresponden al commit probado `d6af695`.

| Id | Sev. | Defecto | Dónde | Corrección propuesta |
| --- | --- | --- | --- | --- |
| UAT-01 | **Alta** | `/admin` y `/organizador` muestran «No fue posible cargar la configuración.». El embed `participants → profiles(display_name)` da PGRST200 (no hay FK) y, además, RLS de `profiles` solo deja leer el propio perfil. El organizador no puede aprobar ni marcar pagos desde la UI. | `composables/useAdmin.ts` (`loadPoolDetails`) | Borrador listo, **no aplicado ni probado**: RPC `admin_pool_participants(pool)` en `supabase/proposed/20261024000800_admin_pool_participants.sql`, con reversión y suite `supabase/tests/proposed/admin-pool-participants.sql` (7 casos). Falta: correr la suite en rollback, aplicarla y cambiar `loadPoolDetails` para usar la RPC. |
| UAT-03 | **Alta** | Abrir o recargar sin conexión con sesión válida lleva a `/onboarding` («Completa tu perfil») y queda ahí al volver la red. Un error de red al leer el perfil se trata como «sin perfil». | `composables/useAuth.ts` (carga del perfil), `lib/navigation-guards.ts` | Distinguir «perfil inexistente» de «error al leerlo»; con error, no redirigir y reintentar al volver la conexión. **Coordinar con el trabajo de ADR-027**, que está modificando esos dos archivos. |
| UAT-02 | Media | Tras aprobar a un participante, su quiniela sigue «pendiente» hasta 10 min: la caché privada fresca se pinta sin revalidar. | `composables/usePoolPlay.ts` (`if (hit.fresh) return`) | No devolver antes si la participación cacheada no es `participant`; o revalidar siempre en segundo plano. La tabla en vivo (Realtime) no cubre el cambio de `participants`. |
| UAT-04 | Media | Volver a una liga ya visitada sin conexión se queda en «Verificando acceso…» y nunca muestra lo guardado; ante un error muestra el mensaje crudo. | `views/PoolView.vue` (`loadPool`), `composables/usePoolAccess.ts` | Cachear el resultado de acceso en la caché privada y, sin red, usarlo con el aviso «Sin conexión». |
| UAT-05 | Media | Una acción de ticket que falla sin conexión reemplaza todo el panel por un error sin botón de reintento. | `composables/usePoolTickets.ts` (`act`), `components/PoolTicketsPanel.vue` | Error de acción separado del error de carga y botón «Reintentar». |
| UAT-06 | Media | Objetivos táctiles menores de 44 px. | `SegmentedTabs.vue` (pill 37,5 px, underline 36 px, chips), `SectionHeader.vue` («Ver todos», 16 px), `MyTicketsView.vue` (nombres de quiniela, 24 px), `AdminView.vue` (selector y «+ Nueva», 38 px), `AdminFixtureView.vue` (casilla «En la quiniela», 20 px) | `min-h-11` / área táctil ampliada. |
| UAT-07 | Baja | Contraste menor de 4,5:1. | Token `text-text-faint` (3,76:1) en `PredictionMatchCard.vue` («vs») y `AdminFixtureView.vue` («Cierre estimado»); detalle de la fila destacada en `RankingRow.vue` (4,11:1) | Aclarar el token o usar `text-text-muted`. |
| UAT-08 | Baja | Con texto al 200 % las pantallas de organizador desbordan en horizontal (`/organizador`, `/admin` y `/admin/parrilla`, unos 445/390 px). | `AdminView.vue` (fila del selector) y equivalentes | `flex-wrap` / `min-w-0`. |
| UAT-09 | Media | LCP superior a 2,5 s en carga fría con 4G lento y CPU 4×: Inicio 4,1 s y quiniela 3,9 s. | `src/assets/branding/logo_app_tablo.png` (384 KB), `public/images/stadium-night-alex-simpson.jpg` (182 KB) | Pasar a WebP/AVIF con tamaños responsivos y `fetchpriority="high"` en la imagen LCP. |

Casos no ejecutados por la UAT:

- **P1.repeticion:** no quedan identidades libres para ver el estado «pendiente».
- **H1:** las cabeceras de Vercel solo existen desplegadas.
- **Lighthouse:** no está instalado.

## 2. Publicación

1. **Merge de `feat/api-football-connector` a `main`** (despliega Vercel QA) y verificación del sitio en vivo:
   - cabeceras y CSP con `report-uri`;
   - `/.well-known/assetlinks.json` como JSON;
   - rutas `/privacidad` y `/terminos`.

   Se recomienda corregir antes **UAT-01** y **UAT-03**. Ojo: el frontend de QA actual es anterior a varias migraciones ya aplicadas en la base.
2. **Primer pipeline de CI en GitHub:** comprobar que `.github/workflows/ci.yml` corre en verde. Si el push lo rechaza por falta del scope `workflow` del token, añadir el archivo desde la web de GitHub.
3. **Batería unitaria en un árbol limpio:** el estado commiteado pasó `npm ci` y typecheck en un worktree limpio. La batería completa (87 archivos / 812 pruebas) pasó en el árbol de trabajo antes de que apareciera el trabajo ajeno. La repetición limpia y `verify:bundle` se interrumpieron al detener el lote.

## 3. Trabajo ajeno detectado en el árbol de trabajo (no incluido en ningún commit)

Apareció durante el lote, sin autoría en esta sesión: ADR-027 (consentimiento legal versionado y catálogo de planes FREE/PRO con solicitud manual de PRO).

- Archivos nuevos: `supabase/migrations/20261024000700_legal_acceptance_and_plan_catalog.sql` (**no aplicada**), `views/LegalAcceptanceView.vue`, `views/PlansView.vue`, `composables/usePlanCatalog.ts`.
- Archivos modificados: `useAuth.ts`, `AuthForm.vue`, `router.ts`, `navigation-guards.ts`, `usePostSignInNavigation.ts`, `legal-content.ts` y `ProfileView.vue`.

Al detenerse **rompía el typecheck** (`LegalAcceptanceView.vue`: `acceptLegalDocuments` no existe en `useAuth`). Su autor debe terminarlo, probarlo (suite SQL en rollback, pruebas unitarias) y commitearlo. Si se aplica después de `20261024000800`, su migración queda fuera de orden y requiere `db push --include-all`.

## 4. Datos sintéticos que dejó la UAT en QA (registrar en `QA-SYNTHETIC-RESIDUE.md`)

Ya registrados en ese archivo el 2026-10-24:

- jornadas y partidos «UAT R…» y «UAT Jornada …» (un resultado publicado por cada corrida del bloque b1);
- tickets de qa-user1 (2 vigentes y el resto cancelados) con sus pronósticos, y un pronóstico de qa-user2 en la quiniela B;
- qa-user2 y qa-outsider como participantes de la quiniela B;
- 3 solicitudes «Crear mi propia quiniela» de qa-user1, canceladas;
- unos 5 códigos de unión de la quiniela B;
- `requires_approval` de la quiniela B activado y restaurado.

## 5. Decisiones y recursos del propietario (bloqueos externos)

1. **Producción:** proyecto Supabase y Vercel, dominio propio, backups/PITR y variables de entorno, incluida `VITE_LEGAL_CONTACT_EMAIL`.
2. **Android release:**
   - keystore de release y su huella SHA-256, que se añade a `assetlinks.json` del dominio final y a su intent-filter;
   - `appId` definitivo (no se puede cambiar tras publicar);
   - ficha de Play Console y URL web de eliminación de cuenta.
3. **Legal:** identidad del responsable del tratamiento, jurisdicción y revisión de `/privacidad` y `/terminos`; D22 (baja de organizaciones completas).
4. **ADR-022** (OAuth nativo con PKCE): aceptar el cambio en la recuperación de contraseña y aportar el cliente OAuth Android de Google Cloud. Hasta entonces Google está oculto en el APK.
5. **Push del sistema operativo** (Web Push/FCM): proveedor, claves y ADR. Las notificaciones dentro de la app ya funcionan.
6. **Colector externo de errores:** proveedor y ADR. Hoy la telemetría es local y sin PII.
7. **F-06:** observar los reportes de `csp-report` y decidir cuándo imponer la CSP.
8. **Logo en FREE:** hoy el logo es PRO según el PRD; decidir si se libera.
9. **iOS:** alcance para el primer release.
10. **`mobile/` npm audit:** 3 moderadas en la CLI de Capacitor (`uuid` vía `xcode`, solo desarrollo e iOS); se aceptan hasta que Capacitor publique una CLI corregida sin degradar.

## 6. Validación humana pendiente

- UAT en dispositivo real con `docs/testing/UAT-MOBILE-AUTHENTICATED.md` y `MOBILE-FIRST-ACCEPTANCE.md`; sin ella, el máximo es `DONE_PENDING_UAT`.
- Escenarios de auth E1–E19 (`docs/testing/AUTH-E2E-SCENARIOS.md`).
- Happy paths HTTP de la Fase 05 (`docs/operations/PHASE-05-HTTP-HAPPY-PATHS.md`).
- Configuración del Dashboard de Auth: Redirect URLs, SMTP y plantillas (`docs/operations/AUTH-QA-CONFIGURATION.md`).
- Prueba del APK en un dispositivo, incluidos los App Links. El APK debug no se recompiló en este lote: el intent-filter nuevo requiere `npm run build:android` dentro de `mobile/`.
- E2E de ciclo de vida (`scripts/qa/e2e/full-lifecycle.mjs`) con los puntos FREE 3/1. No se ejecutó en este lote porque compartía cuentas con la UAT.
