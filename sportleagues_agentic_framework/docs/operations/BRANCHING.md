# Branching para agentes

Formato sugerido:

- `agent/phase-03-data-rls`
- `agent/phase-05-admin-ui`
- `agent/fix-prediction-lock`

Una rama = una tarea cohesionada. No mezclar migraciones de schema con refactors visuales no relacionados.

Antes de merge:

1. rebase/merge contra la base acordada;
2. ejecutar tests de la zona;
3. revisar diff;
4. adjuntar handoff;
5. pasar gate de seguridad si toca auth/RLS/scoring.
