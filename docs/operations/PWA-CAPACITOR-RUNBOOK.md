# Runbook PWA + Capacitor (Fase 11)

Estado de verificación: todo lo marcado **PENDING** requiere dispositivo real y NO se ha verificado. Ningún ítem de este documento es PASS en dispositivo. Criterio de aceptación móvil: [`docs/testing/MOBILE-FIRST-ACCEPTANCE.md`](../testing/MOBILE-FIRST-ACCEPTANCE.md) (criterios 5, 7, 8 y 12 dependen de este runbook).

SportLeagues es una app móvil: la PWA instalada debe sentirse como app (standalone, sin barra del navegador, splash coherente). El wrapper Capacitor es un empaquetado del mismo build web, no una migración tecnológica.

## 1. Qué hay implementado

| Pieza | Archivo | Notas |
| --- | --- | --- |
| Manifest | `apps/platform/public/manifest.webmanifest` | `display: standalone`, `theme_color`/`background_color` `#03111c`, `lang: es`, `scope`/`start_url` `/`. |
| Iconos | `apps/platform/public/icons/` | 192/512 `any`, 192/512 `maskable` (logo al 64 % central = zona segura), `apple-touch-icon` 180. Regenerar: `mobile/scripts/generate-icons.ps1`. |
| Splash | derivado | Android/Chrome genera el splash con `background_color` + icono 512. iOS usa `apple-touch-icon` (sin imágenes de splash propias: PENDING decidir si se quieren). |
| Service worker | `apps/platform/public/sw.js` | Manual, sin dependencias (la decisión de `vite-plugin-pwa` sigue pendiente). |
| Offline | `apps/platform/public/offline.html` | Pantalla de respaldo con botón Reintentar. |
| Registro | `apps/platform/src/lib/pwa.ts` + llamada en `main.ts` | Solo producción, HTTPS/localhost, no dentro de Capacitor; evento `sl:pwa-update-available`. |
| Capacitor | `mobile/` | Ver `mobile/README.md`. |

### Política del service worker (resumen)

- Precache: `/offline.html` (obligatorio) y `/`, manifest e icono 192 (opcionales, no bloquean la instalación).
- Navegación: network-first -> shell `/` cacheado -> `offline.html`. El shell se guarda siempre bajo la clave `/` (nunca la URL real).
- Cache-first solo para `/assets/*`, `/flags/*`, `/images/*`, `/icons/*` del mismo origen (máx. 150 entradas).
- **Nunca** se intercepta ni guarda: otros orígenes, `*.supabase.co`, `/auth/*` y URLs con `code`, `access_token`, `refresh_token`, `token_hash`, `error*`, `state` o `type=recovery`; métodos no-GET; peticiones con `Authorization` o `Range`; respuestas `no-store`/`private`, con `Set-Cookie`, `Vary: *`, opacas, no-200, o HTML devuelto como activo (el rewrite de Vercel devuelve `index.html` 200 para rutas inexistentes).
- OAuth (Google, implícito hoy según ADR-013) y recuperación de contraseña vuelven a `/auth/callback`: el SW no interviene, el flujo es idéntico al de la web sin SW.
- Cerrar sesión no requiere tocar el SW: no guarda datos de usuario. Los datos privados viven en IndexedDB por cuenta (`offline-cache.ts`) y se purgan con `purgePrivateCaches`.
- Actualización: el SW nuevo queda en espera (sin `skipWaiting` automático). `pwa.ts` emite `sl:pwa-update-available` con la `registration`; `applyPwaUpdate(registration)` activa y recarga una vez. **No hay UI aún** (decisión de producto: toast "Nueva versión" en una fase de frontend). Hasta entonces la versión nueva se activa cuando se cierran todas las pestañas/ventanas de la app.
- Versionado: subir `CACHE_VERSION` en `sw.js` borra las cachés `sl-*` anteriores en `activate`.

Limitación conocida: sin plugin, el precache no incluye los chunks hasheados; se llenan al navegar (cache-first runtime). La primera visita offline tras instalar solo garantiza shell + `offline.html`; las pantallas visitadas antes sí cargan sin red. La app no acepta pronósticos offline (requisito `05-mobile-pwa.md`; sin estrategia de sincronización/conflicto); el aviso de conexión lo da `useOnlineStatus`/offline-cache.

## 2. Kill-switch (desactivar la PWA en producción)

Orden de menor a mayor impacto:

1. **Por build** (recomendado): definir `VITE_PWA_DISABLED=true` en Vercel y redeplegar. Al abrir la app, `pwa.ts` desregistra todos los SW y borra las cachés `sl-*`. No requiere intervención del usuario.
2. **SW de emergencia**: reemplazar `apps/platform/public/sw.js` por el siguiente contenido y desplegar. Los navegadores comprueban `sw.js` en cada navegación (`updateViaCache: 'none'`), el nuevo SW se instala, borra todo y se desregistra:

```js
self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    for (const name of await caches.keys()) await caches.delete(name)
    await self.registration.unregister()
    for (const client of await self.clients.matchAll()) client.navigate(client.url)
  })())
})
```

3. **Por cliente**: enviar `postMessage({ type: 'SL_KILL' })` al SW activo (borra cachés `sl-*` y se desregistra). Soporte/diagnóstico.
4. **Usuario final**: Chrome Android -> Ajustes del sitio -> Borrar datos; iOS -> Ajustes -> Safari -> Avanzado -> Datos de sitios web.

Recomendación de cabeceras en Vercel (PENDING, fuera de la zona de esta fase; `vercel.json` sin tocar): `Cache-Control: no-cache` para `/sw.js` y `/manifest.webmanifest`. Los navegadores ya ignoran la caché HTTP de `sw.js` (`updateViaCache: 'none'`), por lo que no es bloqueante.

## 3. Evaluación (estado real)

| Área | Evaluación | Estado |
| --- | --- | --- |
| Instalabilidad | Manifest completo, iconos 192/512 any + maskable, standalone, theme-color, `apple-touch-icon`, SW con handler `fetch` (criterio de instalación de Chrome). Probado con tests de archivo y build; **no** instalado en dispositivo. | PENDING (dispositivo) |
| Splash/background | `background_color` `#03111c` = fondo del tema; evita destello blanco al abrir. iOS sin splash propio. | PENDING |
| Offline / conexión lenta o perdida | Shell + `offline.html` + caché IndexedDB de lectura (`offline-cache.ts`, aviso `useOnlineStatus`). Navegación network-first **sin timeout**: con red muy lenta/colgada el navegador espera. Mejora propuesta (no hecha): timeout de 4 s con fallback al shell. Sin escritura offline (decisión consciente). | PENDING (modo avión y 3G simulada) |
| Rendimiento de carga inicial | Build actual: `index` 173 kB (55 kB gzip) + `EmptyState` 323 kB (96 kB gzip, modulepreload) + CSS 58 kB. **Hallazgo (atendido 2026-10-12):** los dos PNG pesados se optimizaron: `fondo_app_tablo` pasó de 1,41 MB (PNG) a 75 KB (JPEG, opaco) y `logo_app_tablo` de 1,17 MB a 393 KB (PNG con alfa a 576 px). El chunk `EmptyState` es código compartido (supabase-js/Vue), no el componente. Lighthouse no ejecutado. | PENDING (medición) |
| Safe areas / viewport | `viewport-fit=cover` presente; `styles.css`, `HomeView` y `TeamView` usan `env(safe-area-inset-*)`. `apple-mobile-web-app-status-bar-style=black` (no `black-translucent`) para no solapar el contenido con la barra de estado en iOS standalone. No verificado visualmente. | PENDING |
| Deep links | Esquema definido, sin dominio final. Ver `mobile/README.md`. | BLOCKED_DECISION |

## 4. Pruebas manuales en dispositivo (todas PENDING)

Registrar PASS/FAIL por ítem con capturas sin PII. Usar el entorno QA (`https://sportleagues-qa.vercel.app`) sobre HTTPS.

### 4.1 Instalación Android (Chrome)
1. Abrir la URL, esperar 30 s navegando. Debe aparecer "Instalar app" / menú "Instalar aplicación".
2. Instalar: el icono del launcher es el logo (maskable recortado en círculo/squircle sin cortar el trofeo ni el texto).
3. Abrir desde el launcher: splash oscuro `#03111c`, sin barra de direcciones (standalone), barra de estado con el color del tema.
4. Rotación: la app queda en vertical.
5. En `chrome://inspect` o DevTools remoto -> Application -> Manifest: sin advertencias; Service Workers: `sw.js` activado.

### 4.2 Instalación iOS (Safari)
1. Compartir -> "Añadir a pantalla de inicio": nombre "SportLeagues", icono 180 px nítido.
2. Abrir desde el icono: modo standalone; contenido no queda bajo la barra de estado ni el indicador inferior (safe areas).
3. Iniciar sesión con correo/contraseña y con Google; recuperar contraseña desde el enlace del correo. Nota: en iOS standalone el almacenamiento está separado de Safari; abrir el enlace del correo puede abrirse en Safari y no en la PWA. Documentar el comportamiento observado.

### 4.3 Offline y conexión lenta
1. Con sesión iniciada y varias pantallas visitadas, activar modo avión y recargar: carga el shell y muestra el aviso de sin conexión; no se pueden guardar pronósticos y la UI lo indica.
2. Primera carga sin visitas previas en modo avión: `offline.html` con botón Reintentar; al volver la red, Reintentar recupera la app.
3. Throttling "Slow 3G" (DevTools) o red real mala: la app muestra estados de carga/error con reintento; anotar tiempo hasta contenido útil (objetivo orientativo < 5 s en 4G medio).
4. Verificar en DevTools -> Application -> Cache Storage que existen solo `sl-shell-v1` y `sl-static-v1`, sin respuestas de `supabase.co`, `/auth/*` ni JSON de usuario.
5. Cerrar sesión y entrar con otra cuenta: no aparece nada de la cuenta anterior (IndexedDB por cuenta purgada).

### 4.4 Actualización del SW
1. Desplegar una versión con cambio visible. Con la app abierta, recargar: sigue la versión anterior (SW nuevo en espera) y, en consola, `window.addEventListener('sl:pwa-update-available', console.log)` recibe el evento (no hay UI aún).
2. Cerrar todas las ventanas de la app y reabrir: versión nueva.
3. Cambiar `CACHE_VERSION`: tras activar, Cache Storage solo contiene las cachés de la versión nueva.

### 4.5 Kill-switch
Probar el método 1 de la sección 2 en QA: tras redeploy con `VITE_PWA_DISABLED=true` y abrir la app, Application -> Service Workers vacío y Cache Storage sin `sl-*`.

### 4.6 Auth no afectada por el SW
Login Google (redirección a `/auth/callback`), login por correo, y enlace de recuperación (`/auth/callback` con `type=recovery` -> `/auth/reset`) con el SW activo. En Network, esas navegaciones no deben aparecer como "(from ServiceWorker)".

## 5. Checklist Lighthouse PWA (manual)

Chrome DevTools -> Lighthouse, modo móvil, en la URL QA (no se ha ejecutado):

- [ ] "Installable" cumple (manifest, SW, iconos).
- [ ] Theme color y viewport correctos; icono maskable detectado.
- [ ] Performance móvil: anotar LCP, TBT, CLS (referencia, no gate automático).
- [ ] Accessibility: sin fallos críticos (contraste, nombres accesibles).
- [ ] Best practices: HTTPS, sin errores de consola.
- [ ] Sin advertencias de "No responde con 200 offline": el shell cacheado debe responder en modo avión tras una visita.

## 6. Pendiente / bloqueado

| Elemento | Estado | Motivo / siguiente paso |
| --- | --- | --- |
| Verificación en dispositivo Android/iOS (4.x) | PENDING | Requiere dispositivo y operador. |
| Lighthouse | PENDING | No ejecutado. |
| Compilación nativa Android, APK **debug** | DONE_BUILD (compilado, no probado) | Compilado el 2026-10-11 con toolchain portable; ver §7. **No** instalado en dispositivo/emulador: PENDING. |
| Compilación nativa Android, AAB/APK **release** | BLOCKED_EXTERNAL + BLOCKED_DECISION | Requiere keystore de release, appId definitivo y política de Play del propietario. |
| Prueba del APK en dispositivo/emulador (instalación, WebView, login por correo, rotación, deep links, retorno OAuth) | PENDING | Sin dispositivo ni emulador en este equipo (HW limitado; no se instalaron imágenes de sistema). |
| Firma de release (keystore) y Play Console | BLOCKED_EXTERNAL + BLOCKED_DECISION | Cuenta de desarrollador, keystore y política de Play del propietario. |
| appId definitivo (`com.sportleagues.app` es provisional) | BLOCKED_DECISION | Una vez publicado en Play no puede cambiarse. |
| Dominio final y `assetlinks.json` (App Links) | BLOCKED_DECISION | Requiere dominio y huella SHA-256 de firma del propietario; plantillas en `mobile/deep-links/`. |
| Cableado de deep links nativos (`registerNativeDeepLinks`) en router/main | PENDING | Lógica y tests listos en `pwa.ts`; falta dominio y tocar `main.ts`/router (otro agente). |
| OAuth Google dentro del wrapper | BLOCKED_DECISION | Google bloquea OAuth en WebViews embebidos; ruta recomendada en §8 y ADR-022 (Proposed, por aceptar el propietario). Correo/contraseña funciona sin cambios. |
| Notificaciones push | Fuera de alcance / BLOCKED_DECISION | Proveedor sin decidir (FCM, etc.); añadiría SDK y datos personales (token) -> ADR. Hoy solo avisos dentro de la app. |
| iOS nativo | Fuera del primer release | Arquitectura preparada; añadir `@capacitor/ios` requiere macOS/Xcode. |
| UI de "Nueva versión disponible" | PENDING | Decisión de producto/frontend; el evento ya existe. |
| Decisión `vite-plugin-pwa`/Workbox | PENDING (ADR) | SW manual cubre el MVP; el plugin permitiría precache hasheado. |
| Cabeceras `Cache-Control` de `sw.js` en `vercel.json` | PENDING | Opcional, ver sección 2. |

## 7. APK debug de Android: toolchain, build y verificación (2026-10-11)

### 7.1 Tres estados distintos (no confundir)

| Estado | Qué significa | Situación hoy |
| --- | --- | --- |
| PWA | Web instalable desde el navegador (manifest + SW). | Implementada; instalación en dispositivo PENDING. |
| APK compilado | El wrapper Capacitor empaqueta `apps/platform/dist` y Gradle produce un `.apk`. | **Hecho** (debug). Solo demuestra que compila, firma con la clave debug y embebe el build web. |
| App probada en dispositivo | Instalada y ejercitada en Android real/emulador. | **PENDING**: no se instaló ni se ejecutó el APK en ningún dispositivo o emulador. |

### 7.2 Toolchain instalado (solo directorio de usuario; sin admin, sin PATH ni variables persistentes, nada en Program Files)

Todo en `C:\Users\Acer\tools\android\`. Para revertirlo: borrar esa carpeta (y, opcionalmente, `C:\Users\Acer\.android\debug.keystore`, `analytics.settings`, `bin\` y `cli\`, creados/actualizados por Gradle y por la CLI de Android el 2026-10-11; el resto de `.android` ya existía de antes).

| Componente | Versión real | Origen oficial | Ruta |
| --- | --- | --- | --- |
| JDK | Temurin 21.0.12.1+1 (LTS) | Adoptium (`api.adoptium.net`, zip x64 Windows; SHA-256 verificado contra el publicado: `f9d6e191ab098c0d416e7d588a24420a8621cd2f4720dab2459b8b7b2d2d8b4e`) | `...\android\jdk-21` |
| Android cmdline-tools | build 16111833 (`cmdline-tools/latest`, reporta 23.0.0) | `dl.google.com` (SHA-1 verificado contra `repository2-3.xml`: `57d04f2d75eb8e8fffc5000a987e5de4b5a63e9d`) | `...\android\sdk\cmdline-tools\latest` |
| platform-tools | 37.0.1 | `dl.google.com` | `...\android\sdk\platform-tools` |
| Plataforma | `platforms;android-36` (r02) | `dl.google.com` | `...\android\sdk\platforms\android-36` |
| Build-tools | `build-tools;36.0.0` | `dl.google.com` | `...\android\sdk\build-tools\36.0.0` |
| Gradle | 8.14.3 (`-all`, del wrapper del proyecto) | `services.gradle.org` | `...\android\gradle-home` (`GRADLE_USER_HOME` solo por proceso; incluye también la caché de Maven Central/Google Maven) |
| Android Gradle Plugin | 8.13.0 (plantilla Capacitor 8.5.3) | Google Maven | caché Gradle |

Requisitos de Capacitor 8.5.3 leídos del propio proyecto generado: `compileSdk`/`targetSdk` 36, `minSdk` 24, Java 21 (`JavaVersion.VERSION_21` en `capacitor.build.gradle`). El JDK 23 del sistema **no** se usó ni se tocó.

No se instalaron emuladores, imágenes de sistema ni extras.

### 7.3 Licencias del SDK aceptadas

Orden expresa del propietario («configuración del entorno SDK y preparación de compilación Android»). Se aceptó únicamente la licencia estándar `android-sdk-license` (necesaria para `platform-tools`, `platforms;android-36` y `build-tools;36.0.0`), registrada en `C:\Users\Acer\tools\android\sdk\licenses\android-sdk-license` (hash `24333f8a63b6825ea9c5514f83c2829b004d1fee`). No se aceptaron licencias de emuladores, imágenes de sistema, NDK ni otras. Revertir: borrar `C:\Users\Acer\tools\android\sdk\licenses\` (o todo el directorio).

### 7.4 Comandos reproducibles (Windows, Git Bash; variables solo por proceso)

Descarga (usar `curl.exe`: `Invoke-WebRequest` de Windows PowerShell 5.1 con barra de progreso fue ~10 veces más lento, 0,4 MB/s frente a 4,4 MB/s):

```
mkdir -p /c/Users/Acer/tools/android/_dl && cd /c/Users/Acer/tools/android/_dl
curl.exe -L --fail -o jdk21.zip "https://api.adoptium.net/v3/binary/latest/21/ga/windows/x64/jdk/hotspot/normal/eclipse"
curl.exe -L --fail -o cmdline.zip "https://dl.google.com/android/repository/commandlinetools-win-16111833_latest.zip"
sha256sum jdk21.zip   # debe coincidir con el SHA-256 de 7.2 (f9d6e191ab098c0d416e7d588a24420a8621cd2f4720dab2459b8b7b2d2d8b4e)
sha1sum cmdline.zip   # debe ser 57d04f2d75eb8e8fffc5000a987e5de4b5a63e9d
cd .. && unzip -q _dl/jdk21.zip && mv jdk-21.0.12.1+1 jdk-21
mkdir -p sdk/cmdline-tools && unzip -q _dl/cmdline.zip && mv cmdline-tools sdk/cmdline-tools/latest
```

Instalación del SDK mínimo (`sdkmanager.bat` es ahora un envoltorio de la CLI `android`, y su `.bat` parte los argumentos en `;`; por eso se usa `android.exe sdk install`). Las licencias se aceptan respondiendo `y` solo a las que pide ese conjunto de paquetes:

```
export JAVA_HOME="C:\\Users\\Acer\\tools\\android\\jdk-21"
export PATH="/c/Users/Acer/tools/android/jdk-21/bin:$PATH"
cd /c/Users/Acer/tools/android
yes y | ./sdk/cmdline-tools/latest/bin/sdkmanager.bat --sdk_root="C:\\Users\\Acer\\tools\\android\\sdk" "platform-tools"
yes y | ./sdk/cmdline-tools/latest/bin/android.exe sdk --sdk="C:\\Users\\Acer\\tools\\android\\sdk" install "platforms;android-36" "build-tools;36.0.0"
./sdk/cmdline-tools/latest/bin/sdkmanager.bat --sdk_root="C:\\Users\\Acer\\tools\\android\\sdk" --list_installed
```

Proyecto y compilación (desde la raíz del repo):

```
cd mobile
npm install                 # ~19 s; solo mobile/ (package-lock.json versionado)
npx cap add android         # ~17 s; una sola vez (ya hecho; mobile/android/ se versiona)
export JAVA_HOME="C:\\Users\\Acer\\tools\\android\\jdk-21" ANDROID_HOME="C:\\Users\\Acer\\tools\\android\\sdk" ANDROID_SDK_ROOT="C:\\Users\\Acer\\tools\\android\\sdk" GRADLE_USER_HOME="C:\\Users\\Acer\\tools\\android\\gradle-home"
export PATH="/c/Users/Acer/tools/android/jdk-21/bin:$PATH"
node scripts/build-android.mjs --skip-web   # cap sync (reusa apps/platform/dist) + gradlew assembleDebug
# equivalente manual: npx cap sync android && cd android && ./gradlew.bat assembleDebug --no-daemon --max-workers=2 -Dorg.gradle.jvmargs=-Xmx1024m
```

PowerShell equivalente de las variables: `$env:JAVA_HOME='C:\Users\Acer\tools\android\jdk-21'; $env:ANDROID_HOME='C:\Users\Acer\tools\android\sdk'; $env:GRADLE_USER_HOME='C:\Users\Acer\tools\android\gradle-home'; $env:Path="$env:JAVA_HOME\bin;$env:Path"`. Sin `--skip-web` el script regenera el build web (`npm --prefix .. run build`).

Máquina de 7,8 GB de RAM con ~0,6 GB libres durante el build: se usó `--no-daemon`, 2 workers y `-Xmx1024m` por línea de comandos (sin tocar `gradle.properties`).

### 7.5 Resultado y tiempos aproximados

| Paso | Tiempo |
| --- | --- |
| Descarga JDK 21 (205 MB, `Invoke-WebRequest`) | ~8 min |
| Descarga cmdline-tools (155 MB, `curl.exe`) | ~28 s |
| Instalación platforms/build-tools (`android sdk install`) | ~2 min 35 s |
| `npm install` + `cap add android` | ~19 s + ~17 s |
| Primera compilación `assembleDebug` (incluye descarga de Gradle 8.14.3 y dependencias) | 10 min 21 s (`BUILD SUCCESSFUL`, 123 tareas) |
| Segunda compilación vía `build-android.mjs --skip-web` (caché caliente) | 2 min 13 s (`BUILD SUCCESSFUL`) |

Salida: `mobile/android/app/build/outputs/apk/debug/app-debug.apk`

- Tamaño: 6 104 380 bytes.
- SHA-256: `cea3dfc7b2a9f8a7507fce91b20bf5156a24a9f284b580810defad2a319f2c43` (idéntico en las dos compilaciones).
- `aapt2 dump badging`: `package: name='com.sportleagues.app' versionCode='1' versionName='1.0'`, `minSdkVersion:'24'`, `targetSdkVersion:'36'`, `compileSdkVersion='36'`, `application-label:'SportLeagues'`, `launchable-activity: com.sportleagues.app.MainActivity`, `application-debuggable`.
- Permisos: `android.permission.INTERNET` (necesario: Supabase por HTTPS) y el permiso propio de firma `com.sportleagues.app.DYNAMIC_RECEIVER_NOT_EXPORTED_PERMISSION` que AndroidX añade de forma automática para receivers dinámicos no exportados (no es acceso a datos del usuario). Ningún permiso innecesario; nada que eliminar.
- `apksigner verify`: firma APK Signature Scheme v2 válida con el certificado debug automático de Gradle (`CN=Android Debug`, SHA-256 `a4541600f1b409d31b6b2a394e979048886c6966e617ec3c3c7c8de8d601e663`, almacén `C:\Users\Acer\.android\debug.keystore`). **Esta huella es de depuración: jamás usarla en `assetlinks.json` de producción ni para publicar.**
- Manifest: sin `usesCleartextTraffic` ni `networkSecurityConfig`; `allowBackup=false` (ajustado desde el valor `true` de la plantilla); `MainActivity` `exported=true` solo con MAIN/LAUNCHER (sin intent filters de deep link: ver §7.6). Los demás `intent-filter`/`exported` del manifest fusionado pertenecen al receiver de `androidx.profileinstaller` (protegido con `android.permission.DUMP`).
- Activos: `assets/public/` (253 entradas: `index.html`, `assets/*`, `sw.js`, `manifest.webmanifest`...) proviene de `apps/platform/dist`, y `assets/capacitor.config.json` no contiene `server.url` (`androidScheme: https`, `cleartext: false`, `allowMixedContent: false`). La app sirve los activos empaquetados; no apunta a ningún host remoto.
- `appId`: `com.sportleagues.app` es **provisional**; el definitivo es decisión del propietario y no puede cambiarse tras publicar en Play.
- Lo único que se verificó es el artefacto (herramientas de línea de comandos). Instalación, arranque, WebView, login, rotación, safe areas, deep links: PENDING en dispositivo.

Advertencias no bloqueantes del build: `flatDir` desaconsejado (plantilla Capacitor) y «SDK XML version 4» (cmdline-tools y herramientas de Gradle de distintas fechas).

Nota de dependencias: la plantilla de Capacitor incluye en `android/build.gradle` el classpath `com.google.gms:google-services:4.4.4`; solo se aplica si existe `app/google-services.json` (no existe), por lo que no hay SDK de Firebase/push en el APK. Cualquier push futuro requiere ADR (AGENTS.md §12).

### 7.6 Deep links (App Links): BLOCKED_DECISION

Revisada la plantilla `mobile/deep-links/android-intent-filters.template.xml`: ya es solo `https`, `autoVerify="true"`, sin comodines y con los dos prefijos canónicos `/j/` y `/p/`; no requiere cambios. **No se aplicó** al `AndroidManifest.xml` porque el dominio de producción y la huella SHA-256 del certificado de firma son del propietario (valores no inventados; `REPLACE_WITH_APP_LINK_HOST` sigue siendo placeholder). Cuando existan: pegar la plantilla en `MainActivity`, publicar `/.well-known/assetlinks.json` con el `package_name` final y la huella de **release** (no la debug), y verificar con `adb shell pm get-app-links com.sportleagues.app` en un dispositivo (PENDING).

## 8. OAuth nativo (Google) en el wrapper: por qué no en la WebView y ruta recomendada

Solo documentación; **no implementado**. Requiere ADR (AGENTS.md §12: cambia auth y compatibilidad de builds móviles): ver `docs/architecture/adr/ADR-022-native-oauth-pkce-system-browser.md` (estado Proposed, redactado por el coordinador).

Por qué el flujo actual no sirve dentro del APK:

1. Google bloquea el consentimiento OAuth en navegadores embebidos/WebViews (`Error 403: disallowed_useragent`, política de «Secure browsers» de Google). El wrapper Capacitor ejecuta la app en un WebView, de modo que `signInWithOAuth` con redirección dentro de él falla aunque funcione en Chrome o en la PWA instalada.
2. El cliente usa `flowType: 'implicit'` (ADR-013): el token regresa en el fragmento `#access_token=` de la URL de retorno. Con WebView embebido eso exige además un esquema de retorno propio y expone el token en la URL (historial, intents, otras apps).
3. En la WebView el origen es `https://localhost` (`androidScheme: https`); Supabase no puede redirigir allí un flujo de navegador externo sin un retorno verificado.

Ruta recomendada (a implementar solo tras aceptar el ADR):

1. **PKCE** (`flowType: 'pkce'`; ver `docs/security/PKCE-MIGRATION-ASSESSMENT.md`): el `code_verifier` queda en la app y el `code` de un solo uso se canjea con `exchangeCodeForSession`; el token nunca viaja en la URL.
2. Abrir la URL de autorización de Supabase/Google en el **navegador del sistema** mediante **Chrome Custom Tabs** (plugin oficial `@capacitor/browser`, nueva dependencia a registrar), no en el WebView.
3. Retorno por **App Link verificado** (`https://<dominio>/auth/callback`, `assetlinks.json` con la huella de release): Android reabre la app, `@capacitor/app` emite `appUrlOpen` y `registerNativeDeepLinks` (ya en `lib/pwa.ts`, sin cablear) valida host y ruta y navega a `/auth/callback`. Sin esquema personalizado (`sportleagues://`), suplantable.
4. Redirect URLs de Supabase limitadas al dominio web y al App Link.
5. Bloqueado por el propietario: dominio, huella de firma de release y appId definitivo. Hasta entonces, en el wrapper el acceso es con correo y contraseña.
