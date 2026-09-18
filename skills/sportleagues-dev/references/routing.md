# Routing de tareas

Seleccionar siempre el equipo mínimo necesario.

No activar todos los roles de forma automática.

---

# Matriz principal

| Tarea | Líder | Revisores |
|---|---|---|
| Nueva fase | Orchestrator | Product Owner, Architecture, Security, QA, Documentation |
| Nueva función | Product Owner | Orchestrator + agentes afectados |
| Mejora UI | UI/UX | Frontend, QA |
| Bug frontend | Frontend | QA, Code Review |
| Bug backend | Backend | QA, Code Review |
| Bug de negocio | Domain | Backend/Frontend según aplique, QA |
| Base de datos | Backend | Security, QA |
| RLS/Auth/roles | Security o Backend | Security, QA |
| RPC | Backend | Security, QA |
| Edge Function | Backend | Security, QA |
| Query lenta | Database Performance | Backend, QA |
| Leaderboard pesado | Database Performance | Domain, Backend, QA |
| Scoring | Domain | Backend, Security, QA |
| Locks | Domain | Backend, Security, QA |
| Responsive | UI/UX | Frontend, QA |
| Accesibilidad | Performance/UIUX | Frontend, QA |
| Performance frontend | Performance | Frontend, QA |
| Arquitectura | Architecture | Orchestrator, Security si aplica |
| Release | Release | QA, Security, Documentation |
| Cierre de fase | Orchestrator | QA, Security si aplica, Documentation |

---

# Producto

Toda nueva función comienza en Product Owner.

Product Owner no implementa código.

Su responsabilidad es convertir una petición en:

- alcance;
- fase;
- reglas;
- criterios de aceptación;
- clasificación MVP.

---

# UI simple

Para una mejora visual sin cambio contractual:

UI/UX
→ Frontend
→ QA

Product Owner puede limitarse a mini-spec.

No involucrar Architecture/Backend/Security sin necesidad.

---

# Datos y seguridad

Si una tarea toca cualquiera de estos puntos:

- tenant;
- membership;
- role;
- RLS;
- RPC;
- auth;
- storage;
- Edge Function;
- secrets;
- PII;

Security debe participar.

---

# Performance de DB

Database Performance participa cuando existen:

- consultas grandes;
- joins frecuentes;
- agregaciones;
- leaderboard;
- scoring masivo;
- filtros importantes;
- paginación;
- tablas crecientes;
- RPC costosas.

No participa obligatoriamente en cada cambio de schema.

---

# Arquitectura

Architecture debe intervenir cuando:

- cambia stack;
- cambia auth;
- cambia tenancy;
- cambia API pública;
- cambia scoring estructural;
- se añade proveedor;
- se añade SDK estructural;
- cambia PII;
- cambia mobile architecture;
- aparece una dependencia global importante.

---

# QA

Toda implementación debe pasar por QA proporcional al riesgo.

No significa siempre E2E completo.

Aplicar:

- prueba focalizada para cambio pequeño;
- regresión ampliada para cambios centrales;
- tests negativos para seguridad;
- tests cross-tenant para tenancy/RLS.

---

# Paralelismo

Permitir trabajo paralelo solo si:

- no se editan archivos críticos compartidos;
- contratos ya están definidos;
- no existe dependencia entre tareas.

Si dos agentes necesitan modificar el mismo archivo:

trabajar secuencialmente mediante handoff.

---

# Fuente de estado

Antes de enrutar trabajo:

leer `PROJECT_STATE.md`.

No iniciar una fase posterior si la actual mantiene bloqueos que impiden su cierre.