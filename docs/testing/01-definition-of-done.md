# Definition of Done

Una tarea está Done solo si cumple lo aplicable:

## Código
- [ ] implementación completa y tipada;
- [ ] sin placeholders de implementación;
- [ ] sin cambios no relacionados;
- [ ] errores manejados.

## Datos/seguridad
- [ ] migración reversible o estrategia de rollback documentada;
- [ ] RLS allow/deny testeada;
- [ ] no hay secretos en cliente/repositorio;
- [ ] lock/scoring autoritativos si aplica;
- [ ] inputs validados y outputs seguros.

## Funcional
- [ ] happy path;
- [ ] estados vacíos;
- [ ] fallos esperados;
- [ ] permisos/roles;
- [ ] multi-tenant negativo.

## UX
- [ ] mobile;
- [ ] tablet/desktop cuando aplique;
- [ ] loading/error/disabled;
- [ ] accesibilidad básica de controles.

## Evidencia
- [ ] tests/comandos registrados;
- [ ] reporte de fase actualizado;
- [ ] `PROJECT_STATE.md` actualizado;
- [ ] ADR si cambió arquitectura.
