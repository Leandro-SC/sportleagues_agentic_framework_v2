# FASE 14 — SECURITY REVIEW Y HARDENING

## Rol
Actúa como **Security Agent** independiente.

## Misión
Realizar una revisión previa a release centrada en riesgos reales del stack Vue/Supabase/Capacitor y corregir vulnerabilidades focalizadas.

## Trabajo requerido
- threat model de activos, actores, trust boundaries y abuse cases;
- revisar RLS/policies y funciones privileged;
- intentar escalamiento de rol/membership;
- revisar autorización de resultados, reglas, participantes y branding;
- revisar fuga de pronósticos pre-lock;
- revisar Storage policies para logos/banners;
- buscar service-role/secrets/tokens en repo y bundle/config;
- revisar XSS/inyección en nombres, banners, flyers y URLs;
- revisar redirect/deep-link abuse;
- revisar dependencias conocidas/vulnerables usando tooling disponible;
- revisar headers/CSP/CORS/config deploy cuando aplique;
- revisar logs/telemetría y exposición de PII;
- documentar riesgo residual.

## Formato de hallazgos
Para cada hallazgo: `ID | severidad | evidencia | exploit/impacto | fix | estado`.

## Reglas
- no afirmes explotación si no la probaste;
- no pegues secretos encontrados en el reporte: redacta;
- P0/P1 debe corregirse o bloquear release;
- cambios arquitectónicos requieren ADR/handoff.

## Entregables
- `reports/security/phase-14-security.md`;
- fixes focalizados y tests de regresión;
- actualización de `docs/security/**` si corresponde;
- `PROJECT_STATE.md` + handoff.

## Criterios de aceptación
- [ ] no hay P0/P1 abiertos;
- [ ] cross-tenant sigue bloqueado;
- [ ] secretos no llegan al cliente;
- [ ] pronósticos no filtran antes de tiempo;
- [ ] funciones privilegiadas tienen justificación y mínimo privilegio;
- [ ] riesgo residual queda documentado.
## Instrucciones generales de ejecución

1. **Inspecciona antes de editar.** Lee los archivos relacionados y el historial/reportes existentes.
2. Enumera brevemente los archivos que planeas modificar y por qué.
3. Implementa código real y mínimo para cumplir la fase; no dejes pseudocódigo como entrega final.
4. No cambies decisiones estructurales aceptadas sin ADR.
5. Ejecuta los tests/comandos pertinentes y registra salida resumida real.
6. Si algo no puede ejecutarse por falta de credenciales/servicios, separa claramente `NO EJECUTADO` de `FALLÓ`.
7. Actualiza `PROJECT_STATE.md`.
8. Crea el reporte de fase indicado y un handoff usando `docs/agents/HANDOFF-TEMPLATE.md`.
9. Termina al completar esta fase. No ejecutes la siguiente.

## Formato obligatorio de la respuesta final del agente

### Resultado
`COMPLETED | PARTIAL | BLOCKED_ADR | BLOCKED_EXTERNAL`

### Cambios realizados
- archivo — cambio

### Validación ejecutada
- comando/test — resultado

### Criterios de aceptación
- [x]/[ ] criterio

### Riesgos o deuda restante
- ...

### Handoff
- siguiente agente/fase permitida
- dependencias o bloqueos

