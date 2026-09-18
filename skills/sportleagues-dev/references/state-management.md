```markdown
# Gestión de estado y documentación

La documentación debe reflejar el código real.

No debe convertirse en una fuente paralela contradictoria.

---

# 1. PROJECT_STATE.md

`PROJECT_STATE.md` es el resumen operativo del proyecto.

Debe indicar:

- fase actual;
- última fase completada;
- estado general;
- bloqueos;
- pendientes;
- decisiones pendientes.

No reemplaza:

- `AGENTS.md`;
- ADRs;
- `PROJECT_CONFIG.md`;
- PRD.

---

# 2. Ownership

Cada especialista documenta su tarea.

Solo:

- Documentation Agent
o
- Orchestrator

consolidan cambios globales en `PROJECT_STATE.md`.

Evitar ediciones concurrentes.

---

# 3. Handoff

Al terminar una tarea registrar:

- fase/tarea;
- objetivo;
- archivos modificados;
- decisiones;
- tests;
- resultado;
- riesgos;
- limitaciones;
- pendientes;
- siguiente acción permitida.

Usar:

`docs/agents/HANDOFF-TEMPLATE.md`

cuando corresponda.

---

# 4. Reportes

Actualizar el reporte correspondiente cuando exista:

- `reports/admin/**`
- `reports/auth/**`
- `reports/security/**`
- otros reportes de fase.

No crear reportes duplicados si puede actualizarse uno existente.

---

# 5. PROJECT_STATE

Actualizar únicamente hechos comprobados.

Ejemplos:

Correcto:

- migración aplicada;
- test pasó;
- vulnerabilidad corregida;
- función desplegada;
- validación manual completada.

Incorrecto:

- "probablemente listo";
- "parece funcionar";
- "casi terminado".

---

# 6. Cierre de fase

Una fase puede marcarse `[x]` solo cuando:

- acceptance criteria completos;
- gates ejecutados;
- riesgos críticos cerrados o aceptados;
- reportes actualizados;
- handoff final disponible.

No cerrar una fase únicamente porque existe código.

---

# 7. Nuevas funcionalidades

Cuando se añada una función no contemplada originalmente:

Product Owner debe registrar:

- clasificación;
- fase;
- relación con PRD;
- criterio de aceptación.

Si cambia alcance oficial del MVP, actualizar documentación de producto solo después de aprobación.

---

# 8. Mejoras UI

Una mejora visual pequeña no necesita modificar PRD salvo que cambie comportamiento del producto.

Puede documentarse mediante:

- handoff;
- reporte de UI;
- commit/tarea.

---

# 9. Bugs

Documentar bugs importantes si:

- afectan seguridad;
- provocan pérdida de datos;
- bloquean fase;
- requieren decisión estructural.

Bugs menores pueden registrarse en el handoff.

---

# 10. Evidencia

Registrar evidencia resumida:

- comando;
- resultado;
- entorno;
- fecha cuando sea relevante.

No copiar logs completos innecesariamente.