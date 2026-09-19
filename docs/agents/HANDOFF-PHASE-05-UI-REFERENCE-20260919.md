# HANDOFF — Fase 05/05-bis: alineación UI con la referencia

- Agente: Frontend/UI/UX
- Estado: DONE (mejora visual; la fase continúa abierta)

## Objetivo

Alinear las superficies participantes existentes con la referencia visual oficial, conservando
las capacidades implementadas y sin anticipar funcionalidades de Fase 06/08.

## Archivos modificados

- `apps/platform/src/styles.css`
- `apps/platform/src/components/BottomNav.vue`
- `apps/platform/src/views/HomeView.vue`
- `apps/platform/src/views/PoolView.vue`
- `apps/platform/src/views/JoinView.vue`
- `apps/platform/src/views/ProfileView.vue`
- `apps/platform/public/images/stadium-night-alex-simpson.jpg`
- `docs/design/DESIGN-SYSTEM.md`
- `docs/design/ASSET-ATTRIBUTIONS.md`
- `PROJECT_STATE.md`

## Contratos/API afectados

Ninguno. No se cambiaron rutas, Auth, Supabase, RLS, RPCs ni modelos de datos.

## Decisiones

- Se añadió el tratamiento reutilizable `.stadium-hero` usando tokens y colores del sistema,
  más una fotografía local de estadio de Unsplash bajo capas oscuras de contraste.
- La navegación refleja Inicio, Partidos, Ligas y Perfil; Partidos y Ligas se mantienen
  deshabilitados con su fase correspondiente mientras no existan sus contratos.
- Los huecos de partidos y tabla conservan skeletons y textos de fase, en lugar de marcadores,
  standings, búsqueda, notificaciones o actividad simulados.

## Tests ejecutados

- `npm run typecheck` — PASS.
- `npm test` — PASS (10 archivos, 49 tests).
- `npm run build` — PASS.
- Revisión visual local de la pantalla pública en Vite — PASS: jerarquía, CTA, labels y campos
  accesibles presentes; no se realizó login automatizado.
- `git diff --check` — PASS.

## Riesgos / limitaciones

La referencia contiene funciones aún no implementadas: datos de partidos, tabla, buscador,
notificaciones, perfiles estadísticos y feed. Implementarlas requiere completar sus fases y no
forma parte de esta mejora.

## Bloqueos

El cierre de Fase 05/05-bis continúa bloqueado por los happy paths remotos autenticados de
`branding-asset` y `branding-reconciler`, ajenos a este cambio visual.

## Próximo paso permitido

Completar esos happy paths autorizados o continuar una mejora UI compatible solicitada; no iniciar
Fase 06.
