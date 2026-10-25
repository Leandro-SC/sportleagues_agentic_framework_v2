# ADR-026 — Eliminación de cuenta desde la app y páginas legales públicas

- Estado: **Accepted para QA** (2026-10-24, autorización completa del propietario para cerrar las brechas del diagnóstico). Migración `supabase/migrations/20261024000400_account_deletion.sql`, aplicada en QA (32/32); Edge Function `delete-account` desplegada en QA; reversión en `supabase/proposed/down/20261024000400_account_deletion.down.sql`.
- Relacionados: D22 (`docs/operations/D22-TENANT-OFFBOARDING-DRAFT.md`, baja de tenants; sigue pendiente), ADR-013, ADR-015, ADR-020.
- Impacto AGENTS.md §12: cambia los datos personales almacenados (anonimización a pedido) y añade una función pública (Edge Function).

## Contexto

Google Play exige que una app con registro permita eliminar la cuenta desde la app y desde la web. La verificación de la pantalla de consentimiento de Google OAuth exige una política de privacidad pública. No existían ni la baja ni los textos legales.

## Decisión

1. **Baja lógica primero** (principio de D22): no se borran en cascada pronósticos, puntos, resultados, pagos manuales ni auditoría, porque alteraría competencias ya jugadas.
   - `anonymize_account` (solo `service_role`): el perfil pasa a «Usuario eliminado» con `deleted_at`, las membresías quedan inactivas y se borran sus avisos. Deja un registro en `audit_log` por organización, sin PII.
   - La Edge Function `delete-account` borra después la identidad de Auth en **modo suave**: correo y teléfono anonimizados y sesiones revocadas.
2. **Solo la propia cuenta.** El usuario sale del JWT verificado (gateway con `verify_jwt = true` y nueva verificación en la función). El cuerpo solo admite `{ "confirm": "ELIMINAR" }`; cualquier campo extra se rechaza.
3. **Impedimentos.** Quien administra una organización (owner/admin activo) o integra el equipo de una quiniela no puede borrarse hasta transferir ese rol: la respuesta es 409 con el detalle. Así ninguna quiniela abierta queda sin responsable. `account_deletion_blockers()` permite explicarlo antes de confirmar.
4. **CORS.** La función acepta los orígenes de `CORS_ALLOWED_ORIGINS` más `https://localhost`, el origen del wrapper Capacitor, para que la app nativa también pueda dar de baja la cuenta.
5. **Páginas legales públicas** `/privacidad` y `/terminos` (`lib/legal-content.ts`, versión `2026-10-24`). Describen el tratamiento real:
   - datos de cuenta y de actividad, y que no se cobra ni se procesan pagos;
   - proveedores (Supabase, Vercel y Google);
   - ocultación de pronósticos hasta el cierre;
   - fotos locales que no se suben;
   - retención de avisos (180 días) y efecto de la baja.

   Se enlazan desde el registro, el inicio de sesión y Ajustes del perfil. El correo de contacto sale de `VITE_LEGAL_CONTACT_EMAIL`; sin un valor válido se indica la vía dentro de la app.

## Pendiente (requiere al propietario)

- Identidad del responsable del tratamiento, jurisdicción y revisión legal de los textos antes de una publicación abierta. Definir `VITE_LEGAL_CONTACT_EMAIL` en Vercel.
- URL web de baja para la ficha de Play: `https://<dominio>/perfil` funciona con sesión. Si Play exige una vía sin instalar la app, se puede publicar la misma página con instrucciones.
- D22 (baja de organizaciones completas) sigue en borrador.

## Evidencia

- `account-deletion.sql` 13/13 en rollback; regresión de privilegios 23/23 y de admin/participante 87/87.
- E2E real `scripts/qa/e2e/account-deletion.mjs` 8/8 contra la función desplegada: 401 sin usuario, 400 sin confirmación o con otro `user_id`, 200 `DELETED`, perfil anonimizado e inicio de sesión imposible después.
- Pruebas unitarias del núcleo de la función, del composable y de las páginas.
