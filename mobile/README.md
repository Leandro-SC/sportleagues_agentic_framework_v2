# mobile/ — wrapper Capacitor (Android)

Empaqueta el build web de `apps/platform` sin duplicar lógica de negocio (ADR-004). Paquete **aislado**: sus dependencias no están en el `package.json` raíz. Runbook completo: [`docs/operations/PWA-CAPACITOR-RUNBOOK.md`](../docs/operations/PWA-CAPACITOR-RUNBOOK.md).

## Dependencias (justificación)

| Paquete | Motivo |
| --- | --- |
| `@capacitor/core`, `@capacitor/android`, `@capacitor/cli` | Wrapper móvil (arquitectura base, AGENTS.md §4; no requiere ADR). |
| `@capacitor/app` | Evento `appUrlOpen` para deep links (`/j/:code`, `/p/:poolId`). `pwa.ts` lo usa vía el registro global de Capacitor, sin importarlo en el bundle web. |

Sin `@capacitor/ios` en el primer release. Sin plugins de push (decisión pendiente). Instaladas el 2026-10-11 solo en `mobile/` (`npm install`, `package-lock.json` versionado): `@capacitor/*` 8.5.3, `@capacitor/app` 8.1.2.

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
| `npm run add:android` | Crea `mobile/android/` (una sola vez; **ya creado y versionado**). |
| `npm run sync` | Build web (`npm --prefix .. run build`) + `cap sync android`. |
| `npm run open:android` | Abre el proyecto en Android Studio. |
| `npm run build:android` | `sync` + `gradlew assembleDebug` (APK debug firmado con la clave debug automática de Gradle; **no** es de release). Si falta toolchain o el JDK no es 21, sale con código 2 y lista qué falta. |
| `npm run build:android -- --skip-web` | Igual, pero reutiliza el `apps/platform/dist` existente (solo `cap sync`, sin regenerar el build web). |
| `npm run doctor` | Diagnóstico de Capacitor. |
| `npm run icons` | Regenera los iconos PWA (Windows PowerShell). |

### Compilación nativa (APK debug)

Estado (2026-10-11): **APK debug compilado** en este equipo con toolchain portable en `C:\Users\Acer\tools\android\` (JDK Temurin 21.0.12.1, Android SDK con `platforms;android-36`, `build-tools;36.0.0`, `platform-tools`; Gradle 8.14.3 del wrapper). Comandos, versiones, tiempos y verificación del artefacto: [`docs/operations/PWA-CAPACITOR-RUNBOOK.md`](../docs/operations/PWA-CAPACITOR-RUNBOOK.md) §7. Compilado **no** significa probado: la app no se ha instalado ni ejecutado en ningún dispositivo o emulador (PENDING).

Salida: `mobile/android/app/build/outputs/apk/debug/app-debug.apk` (ignorada por git). `mobile/android/` **se versiona** (recomendación de Capacitor: contiene manifest, Gradle wrapper y personalizaciones); no se versionan `build/`, `.gradle/`, `local.properties`, `*.apk`/`*.aab`, ni los activos web copiados por `cap sync`. La firma de release (keystore) y Play Console son decisión/acción del propietario (`*.keystore`, `*.jks` y `keystore.properties` están en `.gitignore`); el agente no generó ningún keystore.

Cambio de seguridad en el manifest generado: `android:allowBackup="false"` (el valor por defecto de Capacitor es `true`; con él, el almacenamiento de la WebView —incluida la sesión de Supabase— entraría en las copias de seguridad de Android). `usesCleartextTraffic` no se habilita. Permisos declarados: solo `INTERNET` (más el permiso propio, de firma, `<appId>.DYNAMIC_RECEIVER_NOT_EXPORTED_PERMISSION` que añade AndroidX).

## Deep links (activos en QA; producción pendiente de dominio y firma de release)

Rutas canónicas (contrato Fase 02): `/j/:code` (código de 6 caracteres alfanuméricos) y `/p/:poolId`. Las demás rutas (`/auth/*`, `/admin`, etc.) **no** se exponen como deep link.

Estado (2026-10-24):

1. `android/app/src/main/AndroidManifest.xml` declara el intent-filter `autoVerify="true"` para `https://sportleagues-qa.vercel.app` con los prefijos `/j/` y `/p/` (sin comodines).
2. `apps/platform/public/.well-known/assetlinks.json` declara `com.sportleagues.app` con la huella SHA-256 del **certificado debug** de este equipo (`A4:54:16:00:…:E6:63`). Sirve para el APK debug contra QA, nunca para producción.
3. `main.ts` llama a `registerNativeDeepLinks(router.push, appLinkHosts())`. `VITE_APP_LINK_HOSTS` (separado por comas) fija los hosts; si no se define, se usa el de QA. `deepLinkToRoute` solo acepta https, un host permitido y las rutas `/j/:code` o `/p/:poolId`, y descarta query y hash. Sin sesión, `/j/:code` conserva el código como intención local no confiable; tras autenticarse se llama a `join_pool` (la autorización sigue en el servidor).
4. Un test (`lib/pwa.test.ts`) comprueba que el manifest, `assetlinks.json`, `capacitor.config.json` y los hosts por defecto son coherentes.

Para producción: elegir el dominio propio, añadirlo al intent-filter y a `VITE_APP_LINK_HOSTS`, y publicar su `assetlinks.json` con la huella del keystore de release **que aporta el propietario** (plantillas en `deep-links/`). iOS (futuro): Universal Links con `apple-app-site-association` y Associated Domains.

Acceso dentro del wrapper: Google bloquea OAuth en WebViews (`disallowed_useragent`), así que el botón de Google se oculta en nativo y el acceso es con correo y contraseña hasta aceptar ADR-022. La confirmación de correo y la recuperación de contraseña se completan en el navegador; luego se inicia sesión en la app.

## Notificaciones push

Fuera de alcance de la Fase 11 y de este paquete. Proveedor sin decidir (FCM/APNs/otro); añadirlo implica SDK, almacenamiento de token (dato personal) y ADR (AGENTS.md §12). No se agregó ningún SDK.
