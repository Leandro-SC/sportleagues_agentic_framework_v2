# HANDOFF — Legal, planes y solicitudes comerciales

- Agente: Codex
- Estado: PARTIAL — código y migración preparados; no aplicados a QA ni a producción.

## Objetivo

Preparar aceptación obligatoria y versionada de Privacidad/Términos, planes visibles, solicitud manual de PRO, promoción anual y PRO para una sola quiniela.

## Archivos modificados

- `supabase/migrations/20261024000700_legal_acceptance_and_plan_catalog.sql`
- `docs/architecture/adr/ADR-027-legal-acceptance-and-plan-catalog.md`
- `apps/platform/src/{composables/useAuth.ts,composables/usePostSignInNavigation.ts,composables/usePlanCatalog.ts,components/AuthForm.vue,lib/legal-content.ts,lib/navigation-guards.ts,router.ts,views/LegalAcceptanceView.vue,views/PlansView.vue,views/ProfileView.vue,views/OrganizerDashboardView.vue,views/SuperadminView.vue}`

## Contratos/API afectados

- RPC nuevas: `legal_acceptance_status`, `accept_legal_documents`, `request_plan_change`, `update_plan_offer`.
- Tablas nuevas: `legal_document_versions`, `legal_acceptances`, `plan_offers`, `plan_change_requests`.

## Decisiones

- FREE: S/ 0, una quiniela activa y máximo 10 participantes.
- PRO mensual organización: S/ 19.90; PRO anual: S/ 199.00 (promoción equivalente a diez meses); PRO por una quiniela: S/ 9.90/mes.
- Los importes son configurables por Superadmin y no habilitan cobros ni cambios automáticos de plan.
- La oferta por quiniela se limita por solicitud: el modelo vigente de entitlements es por tenant y requerirá una fase posterior para hacer cumplir beneficios PRO por pool tras aprobarla.

## Tests ejecutados

- `npm.cmd run typecheck` — PASS.
- `npm.cmd test` — PASS (Vitest finalizó con código 0).
- `git diff --check` — PASS (solo avisos de normalización LF/CRLF, sin errores).

## Riesgos / limitaciones

- Revisión legal profesional, responsable del tratamiento, jurisdicción, edad mínima, correo de contacto y precios finales siguen pendientes antes de producción.
- La aceptación se fuerza en el flujo y navegación de la app; las RPC preexistentes no se han reescrito para exigir consentimiento, pues este no sustituye la autorización RLS/RPC.
- La migración no se aplicó contra Supabase QA. Deben añadirse pruebas SQL de RLS, concurrencia e idempotencia antes de hacerlo.

## Bloqueos

- No desplegar ni aplicar la migración sin revisión del SQL y pruebas contra el proyecto QA.

## Próximo paso permitido

Ejecutar la migración en QA con pruebas SQL específicas; validar manualmente registro, Google OAuth, aceptación, solicitud PRO, anual y por quiniela en móvil.
