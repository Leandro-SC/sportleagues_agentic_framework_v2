# ADR-006 - Entitlements server-side y assets privados

- Estado: Accepted
- Fecha: 2026-09-08
- Decisores: Architecture Agent

## Contexto

FREE/PRO no puede depender de UI y logos/banners son inputs no confiables. El panel se implementa antes de que la fase de entitlements quede completa.

## Decision

`tenant_entitlements` es fuente de verdad y comprobacion DB/RPC se aplica a toda mutacion que consume limites o capacidades desde Fase 03. Branding usa Storage privado tenant-scoped con metadata DB, validando rol, entitlement, tipo y tamano. SVG queda fuera hasta contar con sanitizacion segura. Flyers no se guardan por defecto: se generan y comparten desde cliente.

## Consecuencias

Fase 03 implementa datos/enforcement minimo; Fase 12 amplia UX, auditoria, observabilidad y downgrade. No se agrega pago, wallet ni proveedor externo.
