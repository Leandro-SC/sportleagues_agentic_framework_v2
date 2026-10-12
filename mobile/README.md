# mobile/ — wrapper Capacitor (Android)

Empaqueta el build web de `apps/platform` sin duplicar lógica de negocio (ADR-004). Paquete **aislado**: sus dependencias no están en el `package.json` raíz. Runbook completo: [`docs/operations/PWA-CAPACITOR-RUNBOOK.md`](../docs/operations/PWA-CAPACITOR-RUNBOOK.md).

## Dependencias (justificación)

| Paquete | Motivo |
| --- | --- |
| `@capacitor/core`, `@capacitor/android`, `@capacitor/cli` | Wrapper móvil (arquitectura base, AGENTS.md §4; no requiere ADR). |
| `@capacitor/app` | Evento `appUrlOpen` para deep links (`/j/:code`, `/p/:poolId`). `pwa.ts` lo usa vía el registro global de Capacitor, sin importarlo en el bundle web. |

Sin `@capacitor/ios` en el primer release. Sin plugins de push (decisión pendiente). Versiones verificadas en npm el 2026-10-11 (8.5.3 / app 8.1.2); **no instaladas** en esta fase.

## `capacitor.config.json`

- `appId: com.sportleagues.app` — **provisional**. El appId definitivo es decisión del propietario y no puede cambiarse tras publicar en Play.
- `webDir: ../apps/platform/dist` — el build web de Vite.
- `server.androidScheme: https` (origen `https://localhost`), `cleartext: false`. **Sin `server.url`**: la app sirve los activos empaquetados, nunca apunta a un host remoto de producción.
- Supabase se consume por HTTPS desde la WebView igual que en la PWA; solo `VITE_SUPABASE_URL` y la anon key (públicas) se incrustan en el build. Nunca service-role.
- El SW no se registra dentro del wrapper (`pwa.ts` detecta `Capacitor.isNativePlatform()`).

## Comandos (ejecutar dentro de `mobile/`)

| Comando | Qué hace |
| --- | --- |
| `npm install` | Instala Capacitor (primera vez). |
| `npm run add:android` | Crea `mobile/android/` (una sola vez; se versiona). |
| `npm run sync` | Build web (`npm --prefix .. run build`) + `cap sync android`. |
| `npm run open:android` | Abre el proyecto en Android Studio. |
| `npm run build:android` | `sync` + `gradlew assembleDebug` (APK debug sin firma). Si falta toolchain, sale con código 2 y lista qué falta. |
| `npm run doctor` | Diagnóstico de Capacitor. |
| `npm run icons` | Regenera los iconos PWA (Windows PowerShell). |

### BLOCKED_EXTERNAL: compilación nativa

No compilada en esta fase: este equipo no tiene `ANDROID_HOME` ni Android SDK; hay JDK 23 (Capacitor 8 exige JDK 21: confirmar en la documentación oficial). Comando exacto para el operador, con Android Studio + JDK 21 instalados y `ANDROID_HOME` definido:

```
cd mobile
npm install
npm run add:android
npm run build:android
```

El APK debug queda en `mobile/android/app/build/outputs/apk/debug/app-debug.apk`. La firma de release (keystore) y Play Console son decisión/acción del propietario (`*.keystore`, `*.jks` y `keystore.properties` están en `.gitignore`).

## Deep links (BLOCKED_DECISION: dominio y huella)

Rutas canónicas (contrato Fase 02): `/j/:code` (código de 6 caracteres alfanuméricos) y `/p/:poolId`. Las demás rutas (`/auth/*`, `/admin`, etc.) **no** se exponen como deep link.

1. Elegir host de producción (dominio propio; no usar el de QA).
2. Pegar `deep-links/android-intent-filters.template.xml` en la `MainActivity` de `android/app/src/main/AndroidManifest.xml` sustituyendo `REPLACE_WITH_APP_LINK_HOST` (`autoVerify="true"`, https, sin comodines).
3. Publicar `https://<host>/.well-known/assetlinks.json` (ubicación: `apps/platform/public/.well-known/assetlinks.json`; archivos estáticos prevalecen sobre el rewrite de Vercel) a partir de `deep-links/assetlinks.template.json` con el `package_name` final y la huella SHA-256 del certificado de firma **que aporta el propietario**. Nunca inventar ni reutilizar huellas de debug en producción.
4. En la web, llamar a `registerNativeDeepLinks(router.push, [host])` (en `lib/pwa.ts`) al arrancar. `deepLinkToRoute` solo acepta https, host permitido y rutas `/j/:code` o `/p/:poolId`, y descarta query/hash. Sin sesión, `/j/:code` conserva el código como intención local no confiable y tras autenticarse se llama `join_pool` (la autorización sigue en servidor).
5. iOS (futuro): Universal Links con `apple-app-site-association` y Associated Domains.

## Notificaciones push

Fuera de alcance de la Fase 11 y de este paquete. Proveedor sin decidir (FCM/APNs/otro); añadirlo implica SDK, almacenamiento de token (dato personal) y ADR (AGENTS.md §12). No se agregó ningún SDK.
