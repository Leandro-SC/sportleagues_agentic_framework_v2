# START HERE — CÓMO USAR LOS PROMPTS

Este directorio contiene prompts **completos**, no solo títulos de fase.

## Opción A — Un solo agente orquestador

1. Copia `PROMPT-MAESTRO-ORQUESTADOR.md` al agente principal.
2. El orquestador debe leer `AGENTS.md` y el resto de la documentación.
3. Para cada fase, dale al agente ejecutor el prompt de rol apropiado de `prompts/roles/` + el prompt de `prompts/mvp/phase-XX-....md`.
4. El agente ejecutor debe detenerse al cerrar su fase y entregar handoff.
5. El orquestador revisa gates antes de abrir la siguiente fase.

## Opción B — Un agente por especialidad

Mantén sesiones/agentes separados para Architecture, Data/RLS, Auth, Frontend, Domain/Scoring, Stats, Mobile, QA, Security y Release. A cada sesión dale una vez su `prompts/roles/*.md` y, después, únicamente el prompt de fase que le corresponda.

## Secuencia

01 Audit → 02 Architecture → 03 Data/RLS → 04 Auth → 05 Admin → 06 Tournaments/Matches → 07 Predictions/Locks → 08 Scoring → 09 Elo/Poisson → 10 Flyers → 11 Mobile → 12 Entitlements/Observability → 13 QA → 14 Security → 15 Release.

## Regla importante

No le digas simplemente “continúa con el proyecto”. Entrega al agente una fase explícita y exige el reporte/handoff. Así evitas que varios agentes modifiquen contratos o archivos críticos sin coordinación.
