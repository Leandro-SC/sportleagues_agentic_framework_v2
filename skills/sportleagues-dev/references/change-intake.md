# Change Intake

Usar este archivo cada vez que el usuario solicite:

- una función nueva;
- una mejora;
- un cambio de interfaz;
- una corrección;
- una optimización;
- una modificación de reglas.

El objetivo es mover rápido los cambios pequeños y aplicar controles completos solo cuando el riesgo lo exige.

---

# 1. Identificar intención

Determinar primero qué quiere lograr el usuario, no solo qué archivo quiere modificar.

Clasificar:

1. Mejora UI/UX
2. Bug
3. Nueva función pequeña
4. Nueva función de negocio
5. Backend/datos
6. Seguridad
7. Performance
8. Arquitectura
9. Release/infraestructura
10. Documentación

---

# 2. Mejora UI/UX simple

Ejemplos:

- reorganizar una pantalla;
- mejorar tarjetas;
- cambiar distribución;
- mejorar responsive;
- simplificar navegación;
- mejorar botones;
- mejorar tablas;
- mejorar empty states.

Si no cambia datos, permisos ni contratos:

Product Owner mini-spec
→ UI/UX
→ Frontend
→ QA
→ Documentation

Añadir Performance/Accessibility cuando sea relevante.

No involucrar Backend por defecto.

## Mini-spec

Definir únicamente:

- problema;
- objetivo;
- pantalla;
- cambio esperado;
- criterios de aceptación.

---

# 3. Bug

Determinar:

- comportamiento actual;
- comportamiento esperado;
- pasos de reproducción;
- alcance;
- posible regresión.

Flujo:

Agente dueño
→ QA
→ Code Review
→ Documentation

Añadir Security si el bug afecta permisos, datos o aislamiento.

---

# 4. Nueva función pequeña

Ejemplos:

- búsqueda;
- filtros;
- ordenamiento;
- exportación;
- duplicar una entidad;
- acciones administrativas simples.

Flujo:

Product Owner
→ Orchestrator
→ agente dueño
→ QA
→ Documentation

Añadir Backend, Security o Database Performance solo si corresponde.

---

# 5. Nueva función con reglas de negocio

Ejemplos:

- scoring;
- locks;
- ranking;
- estados;
- desempates;
- reglas de torneo;
- visibilidad de pronósticos.

Flujo:

Product Owner
→ Domain
→ Backend
→ Frontend
→ Security
→ QA
→ Code Review
→ Documentation

Architecture solo si cambia contratos estructurales.

---

# 6. Backend / datos

Ejemplos:

- tablas;
- columnas;
- RPC;
- RLS;
- Edge Functions;
- nuevas relaciones;
- storage.

Flujo:

Backend/Data-RLS
→ Security
→ Database Performance si aplica
→ QA
→ Code Review
→ Documentation

Toda modificación de schema posterior a migraciones aplicadas debe usar migración incremental.

---

# 7. Seguridad

Ejemplos:

- permisos;
- RLS;
- roles;
- cross-tenant;
- secrets;
- service_role;
- auth;
- RPC privilegiada.

Flujo:

Security
→ Backend/Frontend afectado
→ QA
→ Code Review
→ Documentation

Una vulnerabilidad abierta de severidad alta bloquea releases relacionados.

---

# 8. Performance

Ejemplos:

- página lenta;
- consultas lentas;
- leaderboard pesado;
- muchos requests;
- render lento;
- assets pesados.

Flujo:

Performance
→ Database Performance si existe SQL/DB
→ agente dueño
→ QA
→ Documentation

No optimizar sin encontrar primero el cuello probable.

---

# 9. Cambio arquitectónico

Ejemplos:

- nueva librería global;
- nueva dependencia estructural;
- nuevo proveedor;
- cambio de auth;
- tenancy;
- pagos;
- PII;
- API pública;
- mobile architecture.

Flujo:

Product Owner
→ Architecture
→ ADR
→ Orchestrator
→ implementación
→ Security
→ QA
→ Documentation

No implementar antes del ADR.

---

# 10. Clasificación de producto

Toda nueva función debe clasificarse:

## MVP

Ya contemplada por PRD/requirements.

## MEJORA_COMPATIBLE

No aparece explícitamente, pero mejora el MVP sin cambiar su naturaleza.

## POST_MVP

Pertenece a funcionalidades futuras.

## REQUIERE_ADR

Cambia una decisión estructural.

No ocultar esta clasificación al usuario si afecta alcance.

---

# 11. Fast Lane

Permitir Fast Lane únicamente para:

- cambios visuales;
- textos;
- spacing;
- responsive;
- accesibilidad menor;
- bugs localizados sin impacto contractual.

Fast Lane:

UI/UX o agente dueño
→ implementación
→ QA focalizado
→ Documentation

No usar Fast Lane para:

- RLS;
- auth;
- memberships;
- scoring;
- locks;
- pagos;
- tenant isolation;
- migraciones;
- secrets;
- cambios arquitectónicos.