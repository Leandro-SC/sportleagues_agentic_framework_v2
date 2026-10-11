# HANDOFF — Auth con correo/contraseña y Google (ADR-013)

- Agente: Frontend + Security (auth) · Estado: DONE en código; validación remota parcial

## Objetivo
Eliminar Magic Link; ofrecer registro (nombre, correo, contraseña + confirmación), login con contraseña,
recuperación de contraseña y Google OAuth, sin tocar roles ni RLS.

## Archivos
Nuevos: `lib/auth-validation.ts`, `components/AuthForm.vue`, `views/ResetPasswordView.vue`,
`composables/usePostSignInNavigation.ts`, ADR-013 y tests (`auth-validation`, `useAuth`, `AuthForm`,
`no-magic-link`). Modificados: `composables/useAuth.ts` (sin `sendMagicLink`; `signUpWithPassword`,
`signInWithPassword`, `requestPasswordReset`, `updatePassword`, `ensureProfile`), `lib/auth-callback.ts`
(`isRecoveryCallback`), `lib/navigation-guards.ts`, `router.ts` (`/auth/reset`), `HomeView.vue`,
`AuthCallbackView.vue`, `supabase/config.toml` (contraseña 8+, letras y dígitos, confirmación de correo),
PRD / requisitos / DESIGN-SYSTEM.

## Decisiones
Ver ADR-013: sin migración, un solo callback, mensajes anti-enumeración, sin vinculación manual de identidades.

## Tests
typecheck, `npm test` 216/216, build, verify:bundle, `git diff --check`: PASS. 5 suites SQL contra QA: exit 0.

## Riesgos
- Si el perfil no se crea (sin nombre), el usuario pasa por `/onboarding` (comportamiento previo).
- `user_metadata` es editable por el usuario; solo alimenta `display_name`.
- La intención de unión (`sessionStorage`) se pierde si el enlace de confirmación abre otra pestaña.
- Config remota (política de contraseña, Redirect URLs, plantillas, SMTP) no verificable sin Dashboard.

## Próximos pasos permitidos
Revisar el Dashboard de QA; probar registro/recuperación con un correo de prueba autorizado; obtener
`ADMIN2_JWT` y ejecutar los scripts de `scripts/qa/`; validación manual de `/admin` y `/superadmin`.

## Bloqueos
Fase 05/05-bis sin ACCEPTED hasta tener esa evidencia.

## Addendum 2026-10-11
Correcciones: modo recuperación acotado y limpiable; mensajes de callback sin texto crudo; invitación en
`localStorage` con TTL 24 h; perfil con intento único y reintento por onboarding; tests de compatibilidad de
guards (`auth-route-compat.test.ts`). Nuevos: `scripts/qa/auth-config-probe.mjs`, `scripts/qa/login-admin2.sh`,
`docs/operations/AUTH-QA-CONFIGURATION.md`, `docs/testing/AUTH-E2E-SCENARIOS.md`, `docs/security/PKCE-MIGRATION-ASSESSMENT.md`.
