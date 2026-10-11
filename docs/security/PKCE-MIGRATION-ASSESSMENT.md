# Evaluación: migrar de flujo `implicit` a PKCE (no ejecutada)

Estado: **solo análisis**. El cliente sigue en `flowType: 'implicit'` (`apps/platform/src/lib/supabase.ts`).
Cambiarlo requiere un ADR propio (AGENTS.md §12) y revalidación en QA.

## Beneficios
- Los tokens dejan de viajar en el fragmento de la URL (`#access_token=…`): menos exposición en historial,
  capturas, extensiones y cabeceras `Referer` mal configuradas.
- El código de autorización es de un solo uso y solo canjeable por quien tiene el `code_verifier`
  (mitiga la interceptación del enlace). Es la recomendación vigente de Supabase para apps de navegador y móviles.
- Mejor base para Capacitor y deep links (Fase 11).

## Riesgos
- El enlace de confirmación o recuperación solo funciona en el **mismo navegador/dispositivo** que lo pidió
  (el verifier vive en su almacenamiento). Abrirlo en otro dispositivo falla; es frecuente en móvil (correo en
  una app nativa) y en la confirmación de registro.
- Hay que tratar `?code=` en `/auth/callback` e invocar `exchangeCodeForSession`; los errores llegan por query,
  no por fragmento. La detección de recuperación cambia (hoy `type=recovery` en el hash).
- Las plantillas de correo deben seguir usando `{{ .ConfirmationURL }}`; si se usara `token_hash`, la ruta de
  verificación cambia.
- Los escáneres de enlaces de algunos clientes de correo pueden consumir el código antes que el usuario.

## Cambios necesarios
1. `flowType: 'pkce'` y canje del código en `AuthCallbackView` (o `detectSessionInUrl` activo).
2. Reescribir `lib/auth-callback.ts` (errores por query; recuperación por evento `PASSWORD_RECOVERY`) y sus
   tests; ajustar `landedAsRecovery` en `useAuth`.
3. Mensaje explícito «abre el enlace en el mismo dispositivo».
4. Revisar Redirect URLs, plantillas y repetir E1–E14 de `docs/testing/AUTH-E2E-SCENARIOS.md`.
5. Sin migraciones de base de datos.

## Recomendación
Adoptar PKCE antes de empaquetar con Capacitor (Fase 11), después de cerrar 05/05-bis, con ADR propio y una
prueba E2E de confirmación entre dos dispositivos.
