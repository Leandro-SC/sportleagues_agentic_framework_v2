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
- Flyers HD con Canvas/html2canvas + QR + Web Share API.
- Freemium y branding PRO.

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

- `apps/platform/`: aplicación Vue/PWA unificada (participante + organizador).
- `mobile/`: configuración y empaquetado Capacitor.
- `packages/domain/`: tipos, reglas y lógica de dominio sin UI.
- `packages/ui/`: componentes visuales reutilizables.
- `supabase/`: migraciones, RLS, funciones SQL, seeds y tests de datos.
- `docs/`: requisitos, arquitectura, seguridad, agentes, testing y operación.
- `prompts/`: instrucciones ejecutables por fase.
- `reports/`: evidencia y conclusiones de cada fase.

## Regla de MVP

La Fase 1 del producto NO incluye escrow real, wallet, procesamiento de apuestas ni iGaming. El control de pago del MVP es administrativo/manual: `pagado`, `pendiente`, `invitado`.


## Prompts operativos completos

Empieza en `prompts/START-HERE.md`. El paquete incluye `prompts/PROMPT-MAESTRO-ORQUESTADOR.md`, prompts persistentes por rol en `prompts/roles/` y 15 prompts detallados de ejecución en `prompts/mvp/`.
