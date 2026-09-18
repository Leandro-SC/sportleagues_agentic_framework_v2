# ADR-004 - TypeScript y limites de modulos

- Estado: Accepted
- Fecha: 2026-09-08
- Decisores: Architecture Agent

## Contexto

TypeScript estaba propuesto para reducir errores entre agentes y el repositorio requiere limites para evitar duplicar autorizacion o reglas criticas.

## Decision

El codigo de aplicacion y paquetes compartidos usara TypeScript. Habra una PWA unica en `apps/platform`; `packages/domain` contiene tipos/DTOs y reglas puras no autoritativas; `packages/ui` contiene UI sin acceso directo a datos; `supabase` contiene integridad, RLS y SQL autoritativo; `mobile` solo adapta el build web. No se agrega libreria state/query en esta fase.

## Consecuencias

Los contratos RPC se tipan en cliente, pero los tipos no sustituyen validacion server-side. Cualquier dependencia adicional de state/query requiere justificar necesidad y ADR si modifica estos limites.
