# HANDOFF — Fase 11: PWA + wrapper Capacitor

- Agente: Mobile
- Estado: PARTIAL (código/config/tests listos; verificación en dispositivo y compilación nativa pendientes)

## Objetivo

PWA instalable con service worker seguro (sin cachear datos privados) y wrapper Capacitor Android preparado y aislado, con runbook de pruebas manuales. Criterio móvil: `docs/testing/MOBILE-FIRST-ACCEPTANCE.md` (criterios 5, 7, 8, 12).

## Archivos modificados / creados

- `apps/platform/index.html` (manifest, icons, apple-touch-icon, metas apple/mobile-web-app; theme-color y viewport-fit ya existían).
- `apps/platform/src/main.ts` (solo import + `scheduleServiceWorkerRegistration()`).
- `apps/platform/src/lib/pwa.ts`, `apps/platform/src/lib/pwa.test.ts` (nuevos).
- `apps/platform/public/`: `manifest.webmanifest`, `sw.js`, `offline.html`, `icons/` (5 PNG).
- `mobile/`: `package.json`, `capacitor.config.json`, `README.md`, `.gitignore`, `scripts/generate-icons.ps1`, `scripts/build-android.mjs`, `deep-links/assetlinks.template.json`, `deep-links/android-intent-filters.template.xml`.
- `docs/operations/PWA-CAPACITOR-RUNBOOK.md`, este informe.
- No se tocó `vite.config.ts`, `vercel.json`, `scripts/verify-preview-bundle.mjs` (no fue necesario), `supabase/**` ni otras zonas.

## Iconos (tamaño real verificado con System.Drawing y lectura de cabecera PNG en test)

| Archivo | Dimensiones | Bytes |
| --- | --- | --- |
| icon-192.png | 192x192 | 44 008 |
| icon-512.png | 512x512 | 258 998 |
| maskable-192.png | 192x192 | 25 603 |
| maskable-512.png | 512x512 | 148 377 |
| apple-touch-icon.png | 180x180 | 39 133 |

Origen: `src/assets/branding/logo_app_tablo.png` sobre fondo `#03111c`; maskable con el logo al 64 % (zona segura). Inspección visual del maskable-512 realizada.

## Decisiones

- SW manual sin dependencias (plugin/Workbox sigue pendiente de ADR). Reglas de exclusión en una función pura `classifyRequest` dentro del propio `sw.js`; el test carga el `sw.js` real en un sandbox `vm` (sin duplicar lógica).
- Se cubre además el caso de Vercel (rewrite `/(.*)` -> `/` devuelve HTML 200 para activos inexistentes): nunca se guarda HTML como activo.
- Sin `skipWaiting` automático; actualización vía evento `sl:pwa-update-available` (sin UI nueva) y `applyPwaUpdate`.
- Kill-switch triple: `VITE_PWA_DISABLED=true` (desregistra y borra `sl-*`), mensaje `SL_KILL`, y SW de emergencia documentado.
- SW no se registra dentro de Capacitor (activos locales).
- Logout no toca el SW: no guarda datos privados; la caché privada es IndexedDB por cuenta (`purgePrivateCaches`).
- `mobile/package.json` aislado: `@capacitor/core|cli|android` 8.5.3 y `@capacitor/app` 8.1.2 (solo para `appUrlOpen`); sin iOS ni push. No instalado.
- Deep links: lógica pura `deepLinkToRoute` + `registerNativeDeepLinks` (usa `Capacitor.Plugins.App`, sin importar el paquete en el bundle web); NO cableado en main/router (zona de otro agente y dominio sin decidir).
- `apple-mobile-web-app-status-bar-style=black` en vez de `black-translucent` para evitar solape con la barra de estado en iOS.

## Tests ejecutados

- `npx vitest run --config apps/platform/vitest.config.ts apps/platform/src/lib/pwa.test.ts` -> 1 archivo, 26 tests pasan (decisión de registro, kill-switch cliente, reglas de exclusión Supabase/auth/no-GET/Authorization/Range/no-store/cookies/HTML-como-activo, comportamiento de `fetch`/`install`/`activate`/`message`, manifest + iconos + dimensiones PNG, index.html, deep links, config Capacitor, plantillas sin fingerprints).
- `npm run typecheck` -> sin errores.
- `npm run verify:bundle` (un único build) -> build OK (6.6 s); `OK: 15 chunks JS revisados; el dataset de vista previa no está en el bundle.` `dist/` contiene `manifest.webmanifest`, `sw.js`, `offline.html`, `icons/*` e `index.html` enlazando el manifest. No fue necesario ajustar `verify-preview-bundle.mjs`.
- No se ejecutó `npm test` completo.

## Riesgos / limitaciones

- Nada verificado en dispositivo real ni con Lighthouse: todo PENDING (ver runbook §3-§5).
- Rendimiento: `dist/assets` incluye PNG de 1,17 MB (`logo_app_tablo`) y 1,41 MB (`fondo_app_tablo`) y un chunk compartido `EmptyState` de 323 kB (96 kB gzip) precargado. Recomendado a Frontend: WebP/AVIF dimensionado y reducir ese chunk. No se modificó (fuera de zona).
- Navegación network-first sin timeout: con red colgada el usuario espera. Mejora propuesta, no implementada.
- Sin precache de chunks hasheados (limitación de SW manual): primera visita offline solo garantiza shell/`offline.html`.
- OAuth Google es flujo implícito (ADR-013); dentro de WebView de Capacitor Google lo bloquea: requiere ADR (PKCE + navegador del sistema + App Link).
- `useOnlineStatus` y el aviso de conexión pertenecen a otro agente; no revisado su cableado completo.
- iOS standalone tiene almacenamiento separado de Safari: los enlaces de correo pueden abrir fuera de la PWA (a documentar por UAT).

## Bloqueos

- BLOCKED_EXTERNAL: compilación Android (sin `ANDROID_HOME`/SDK; JDK 23 presente, Capacitor 8 pide JDK 21 a confirmar; `npm install` de `mobile/` no ejecutado). Comando operador: `cd mobile && npm install && npm run add:android && npm run build:android`. Firma de release y Play Console.
- BLOCKED_DECISION: appId definitivo (`com.sportleagues.app` provisional), dominio final + huella SHA-256 para `assetlinks.json` (plantilla, sin valores inventados), estrategia OAuth nativa (ADR), proveedor push (fuera de alcance), ADR de `vite-plugin-pwa`.

## Próximo paso permitido

1. Operador ejecuta el checklist del runbook en Android/iOS y registra PASS/FAIL.
2. Frontend: toast de actualización consumiendo `sl:pwa-update-available`; optimizar imágenes/chunk.
3. Tras definir dominio/appId: cablear `registerNativeDeepLinks`, publicar `assetlinks.json`, añadir intent filters.
