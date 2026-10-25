# SportLeagues / BetAdmin — Agentic Development Framework

Framework de trabajo para desarrollar el MVP de SportLeagues/BetAdmin con agentes IA de ingeniería, usando como patrón un flujo por fases, documentación viva, ADRs, estado explícito, Definition of Done y separación estricta de responsabilidades.

## Objetivo

Construir una plataforma SaaS multi-tenant para quinielas deportivas con:

- PWA móvil-first en Vue 3 + Vite + Tailwind.
- Empaquetado móvil con Capacitor.
- Supabase / PostgreSQL con Row Level Security.
- Panel de organizador y experiencia de participante.
- Pronósticos, bloqueo por hora, scoring y leaderboard.
- Motor estadístico Elo + Poisson en PostgreSQL.
- Flyers HD con Canvas nativo, QR local (`uqr`) y Web Share API, con un centro para compartir por WhatsApp (ADR-024).
- Freemium y branding PRO; nombre de plataforma del organizador en todos los planes.
- Notificaciones de resultados en la app y tabla en vivo (ADR-025).

## Principio de ejecución

Cada agente debe seguir:

**LEER → ANALIZAR → PLANIFICAR → IMPLEMENTAR → PROBAR → REVISAR SEGURIDAD → DOCUMENTAR → DETENERSE**

No ejecutar una fase posterior sin que `PROJECT_STATE.md` indique que la dependencia está cerrada.

## Punto de entrada para agentes

1. Leer `AGENTS.md`.
2. Leer `PROJECT_CONFIG.md`.
3. Leer `PROJECT_STATE.md`.
4. Leer `docs/product/PRD-MVP.md`.
5. Leer el prompt de la fase solicitada en `prompts/mvp/`.
6. Ejecutar solo esa fase y producir su reporte.

## Estructura

- `apps/platform/`: aplicación Vue/PWA unificada (participante + organizador). La lógica de dominio del cliente vive en
  `apps/platform/src/lib/` y los componentes en `apps/platform/src/components/`; las reglas autoritativas (locks, scoring, Elo,
  entitlements) están en SQL. `packages/` no se usa por ahora (no hay un segundo consumidor que justifique extraer paquetes).
- `mobile/`: configuración y empaquetado Capacitor (Android).
- `supabase/`: migraciones (`migrations/`), reversiones (`proposed/down/`), Edge Functions, seeds y suites SQL (`tests/`).
- `scripts/qa/`: ejecutores de suites SQL en rollback, E2E y UAT contra QA, y herramientas de operador.
- `.github/workflows/ci.yml`: gates automáticos (audit, typecheck, tests, build con `verify:bundle`, `git diff --check`).
- `docs/`: requisitos, arquitectura, seguridad, agentes, testing y operación.
- `prompts/`: instrucciones ejecutables por fase.
- `reports/`: evidencia y conclusiones de cada fase.

## Regla de MVP

La Fase 1 del producto NO incluye escrow real, wallet, procesamiento de apuestas ni iGaming. El control de pago del MVP es administrativo/manual: `pagado`, `pendiente`, `invitado`.


## Prompts operativos completos

Empieza en `prompts/START-HERE.md`. El paquete incluye `prompts/PROMPT-MAESTRO-ORQUESTADOR.md`, prompts persistentes por rol en `prompts/roles/` y 15 prompts detallados de ejecución en `prompts/mvp/`.
