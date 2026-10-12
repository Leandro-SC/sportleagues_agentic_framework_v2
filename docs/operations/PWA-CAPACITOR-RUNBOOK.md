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
| Compilación nativa Android (APK/AAB) | BLOCKED_EXTERNAL | Sin Android SDK (`ANDROID_HOME` vacío) ni JDK 21 verificado en este equipo; `npm install` de `mobile/` no ejecutado. Comando operador: ver `mobile/README.md`. |
| Firma de release (keystore) y Play Console | BLOCKED_EXTERNAL + BLOCKED_DECISION | Cuenta de desarrollador, keystore y política de Play del propietario. |
| appId definitivo (`com.sportleagues.app` es provisional) | BLOCKED_DECISION | Una vez publicado en Play no puede cambiarse. |
| Dominio final y `assetlinks.json` (App Links) | BLOCKED_DECISION | Requiere dominio y huella SHA-256 de firma del propietario; plantillas en `mobile/deep-links/`. |
| Cableado de deep links nativos (`registerNativeDeepLinks`) en router/main | PENDING | Lógica y tests listos en `pwa.ts`; falta dominio y tocar `main.ts`/router (otro agente). |
| OAuth Google dentro del wrapper | BLOCKED_DECISION | Google bloquea OAuth en WebViews embebidos; requiere ADR (PKCE + navegador del sistema + App Link, ver `docs/security/PKCE-MIGRATION-ASSESSMENT.md`). Correo/contraseña funciona sin cambios. |
| Notificaciones push | Fuera de alcance / BLOCKED_DECISION | Proveedor sin decidir (FCM, etc.); añadiría SDK y datos personales (token) -> ADR. Hoy solo avisos dentro de la app. |
| iOS nativo | Fuera del primer release | Arquitectura preparada; añadir `@capacitor/ios` requiere macOS/Xcode. |
| UI de "Nueva versión disponible" | PENDING | Decisión de producto/frontend; el evento ya existe. |
| Decisión `vite-plugin-pwa`/Workbox | PENDING (ADR) | SW manual cubre el MVP; el plugin permitiría precache hasheado. |
| Cabeceras `Cache-Control` de `sw.js` en `vercel.json` | PENDING | Opcional, ver sección 2. |
