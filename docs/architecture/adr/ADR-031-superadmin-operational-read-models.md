# ADR-031 — Modelos operativos de solo lectura para Superadmin

- Estado: Accepted
- Fecha: 2026-10-26
- Decisor: Propietario del producto

## Decisión

El Control Plane incorpora modelos de lectura de usuarios, actividad, partidos y monitor mediante RPCs `security definer` protegidas por `platform_console_guard()`. Las respuestas reducen datos personales: no exponen correo de Auth, cuerpos de notificaciones ni metadata arbitraria. Cada consulta deja una entrada de auditoría.

## Límites

Estos modelos no habilitan edición global. La publicación de resultados, edición de torneos, cambio de membresías, bloqueo de usuarios o baja de clientes exige operaciones específicas, con validaciones de dominio, confirmación y auditoría, antes de presentarse como control accionable.
