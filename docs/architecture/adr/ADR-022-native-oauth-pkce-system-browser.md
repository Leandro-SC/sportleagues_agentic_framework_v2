# ADR-022 — OAuth nativo (Android/iOS): PKCE, navegador del sistema y App Link de retorno

- Estado: **Proposed** (2026-10-12). No se implementa hasta que el propietario la acepte (AGENTS.md §12: cambia auth y compatibilidad de builds móviles).
- Relacionados: ADR-013 (correo/contraseña + Google OAuth, flujo implícito), `docs/security/PKCE-MIGRATION-ASSESSMENT.md`, `docs/operations/PWA-CAPACITOR-RUNBOOK.md`.

## Contexto

ADR-013 usa Google OAuth con flujo **implícito** y redirección web a `/auth/callback`. Dentro del wrapper Capacitor (WebView) esto **no es viable**: Google bloquea OAuth en WebViews embebidos (`disallowed_useragent`) y el flujo implícito expone el token en el fragmento de la URL. Correo y contraseña funcionan igual en el wrapper. En la PWA instalada desde el navegador, Google OAuth sigue funcionando (es el navegador).

## Decisión propuesta

1. **PKCE** (`flowType: 'pkce'` en supabase-js) para todo el OAuth, en web y nativo: el cliente intercambia un `code` con `code_verifier` y el token nunca viaja en la URL.
2. En el wrapper, el consentimiento de Google se abre en el **navegador del sistema** (Custom Tabs en Android; ASWebAuthenticationSession en iOS) mediante el plugin oficial de Capacitor `@capacitor/browser`, no en el WebView.
3. El retorno usa un **App Link verificado** (`https://<dominio>/auth/callback`, `assetlinks.json` con la huella del propietario) que reabre la app; `registerNativeDeepLinks` (ya escrito en `lib/pwa.ts`, hoy sin cablear) recibe la URL, valida host y ruta permitidos y navega a `/auth/callback`.
4. Las **Redirect URLs** permitidas en Supabase Auth incluyen solo el dominio web y el App Link; ningún esquema personalizado sin verificar.
5. Hasta aceptar este ADR, en el wrapper el acceso es con correo y contraseña.

## Alternativas descartadas

- Seguir con el flujo implícito dentro del WebView: bloqueado por Google y más expuesto.
- Esquema personalizado (`sportleagues://`): suplantable por otras apps; el App Link verificado es preferible.
- SDK nativo de Google Sign-In: añade un SDK externo y otra superficie de autorización.

## Consecuencias / dependencias

- **BLOCKED_DECISION del propietario:** dominio de producción, huella SHA-256 del certificado de firma, appId definitivo.
- Cambio de dependencias de `mobile/` (`@capacitor/browser`) y de `lib/supabase.ts`/callback (pruebas de regresión del flujo de auth antes de aplicar).
- Cierra la pregunta pendiente «estrategia OAuth nativa» del tablero.

## Nota (2026-10-24)

Se implementó el punto 5 de la decisión propuesta: dentro del wrapper (`isNativePlatform()`) el botón de Google se oculta y el acceso es
con correo y contraseña; la confirmación de correo y la recuperación se completan en el navegador. Los App Links `/j/` y `/p/` ya están
cableados para el host de QA (`registerNativeDeepLinks` en `main.ts`, intent-filter y `assetlinks.json`).

El ADR **sigue Proposed**. Pasar todo el OAuth a PKCE cambia la recuperación de contraseña: el enlace del correo solo funciona en el mismo
navegador que lo pidió, porque guarda el `code_verifier`. Eso rompe el caso habitual de pedirlo en el teléfono y abrir el correo en otro
dispositivo. Además requiere el cliente OAuth Android y la huella de release en Google Cloud, que son del propietario. Decisiones
pendientes:

1. Aceptar el cambio de comportamiento de la recuperación o mantener el flujo implícito solo para la recuperación.
2. Aportar el keystore de release, su huella y el dominio definitivo para el App Link `/auth/callback`.
