# Inventario de cuentas de Supabase QA y plan de limpieza (2026-10-12)

Solo QA (`juoftaofzepxbrrxbkhx`). Consultas agregadas (conteos); este documento no contiene correos, UUID ni credenciales.

## Inventario observado (consulta agregada sobre `auth.users`)
| Categoría | Cantidad | Nota |
| --- | --- | --- |
| Total en Auth | 284 (todas confirmadas) | |
| Sintéticas `@example.test` | 279 | Fixtures de suites y E2E; contraseñas aleatorias no guardadas |
| Gmail (reales/validación) | 5 | Incluye la cuenta de validación y el único `platform_admin` real |
| Otros dominios | 0 | |
| Conjunto fijo `qa-*@example.test` | 0 al momento de la consulta | Lo crea el E2E de ciclo de vida (5 identidades) |
| Sintéticas con columnas de token nulas | 82 | Insertadas por SQL directo en suites antiguas; **GoTrue falla al listar** las páginas que las contienen (`Database error finding users`, páginas 4–6 con 50 por página). No afecta a las cuentas reales ni a los inicios de sesión |

Evolución: 194 sintéticas el 2026-10-11 → 279 hoy (+85 por las ejecuciones de E2E). Cada ejecución del E2E antiguo añade ~5 cuentas irrecuperables; por eso el E2E nuevo usa un conjunto **fijo** de 5 identidades.

## Cuenta de validación `quinielasvilla@gmail.com`
- **Ya existía**: la invitación oficial (`inviteUserByEmail`) la rechazó como duplicada; **no se envió correo ni se creó otra cuenta**.
- Estado verificado por conteos: tiene perfil; 0 membresías de tenant; 0 roles `owner/admin`; no es platform admin; 0 participaciones. Es, por tanto, solo experiencia `user`.
- Acceso a ligas QA: lo obtiene la propia persona con el **código de unión** de una liga QA autorizada (`join_pool`); no se inserta nada por DML directo. Pendiente: que el propietario entregue/autorice el código de la liga de prueba (ver `reports/testing/e2e-lifecycle-20261012.md`).

## Política y plan de limpieza
1. **Máximo cinco cuentas humanas persistentes de QA** (las 5 Gmail actuales, incluida la de validación) + las 5 identidades técnicas fijas `qa-*@example.test` documentadas aparte.
2. **Las 279 sintéticas no se pueden eliminar sin desactivar guardas de integridad**: sus filas están referenciadas por tablas append-only/inmutables (`audit_log`, partidos, pronósticos, participantes, exclusiones; ADR-015 y H2). Modificar `auth.users` directamente para corregir las 82 filas con tokens nulos está prohibido (solo mecanismos oficiales de Supabase).
3. **Respaldo previo a cualquier borrado:** Supabase PITR/copias del panel (según el plan del proyecto) y exportación de tablas sin PII; no se ha ejecutado ningún borrado.
4. **Borrado solo con tu aprobación sobre la lista exacta.** Candidatas: cuentas `@example.test` sin referencias en tablas inmutables (hoy ninguna verificada). Una lista exacta requiere una consulta de referencias por cuenta; queda `BLOCKED_DECISION` hasta que la apruebes.
5. **Producción:** se crea desde cero con las migraciones; este residuo no se migra.
