# HANDOFF — ADR-014 Etapa 1: tickets gratuitos

- Agente: Orchestrator (sportleagues-dev) con Data/RLS, Backend, Security, QA, Frontend
- Estado: DONE en QA y rama; PARTIAL en publicación (sin merge/despliegue, sin UAT manual móvil)
- Rama: `feat/tickets-stage1` (sobre `main` = `acd4d38`)

## Archivos
- Migración: `supabase/migrations/20261016000100_tickets_stage1_free.sql` (+ `supabase/proposed/down/…down.sql`).
- Pruebas: `supabase/tests/phase-tickets-stage1.sql`, `scripts/qa/e2e/tickets-flow.mjs`.
- App: `lib/tickets.ts`, `composables/usePoolTickets.ts`, `usePoolTicketsAdmin.ts`, `components/PoolTicketsPanel.vue`, `PoolTicketsAdmin.vue`, `ClosingSoonBanner.vue`, `views/MyTicketsView.vue`, `PoolView.vue`, `AdminView.vue`, `usePoolPlay.ts` (+ tests).
- Docs: ADR-014 (aceptación por etapas), PROJECT_STATE, QA-SYNTHETIC-RESIDUE.

## Riesgos / limitaciones
- La BD de QA ya incluye la migración mientras `main` aún no tiene el frontend de tickets: es compatible (las quinielas existentes siguen en modo `none`, firmas de RPC previas intactas).
- Habilitar tickets es irreversible por quiniela; el `down` solo funciona sin tickets.
- Una jornada creada después de habilitar tickets requiere `configure_pool_round` para ser vendible (la UI de administración lo muestra).
- Avisos de cierre: solo dentro de la app (sin notificaciones push/PWA).

## Próximo paso permitido
UAT manual móvil; con autorización: merge de `feat/tickets-stage1` a `main` y despliegue. Fase comercial solo tras D13.
