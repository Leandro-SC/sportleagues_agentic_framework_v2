# CSP: recolección de reportes, revisión y promoción a política estricta (F-06)

Estado: **F-06 NO CERRADO.** `vercel.json` ya define las cabeceras y una CSP en modo `Content-Security-Policy-Report-Only`
(probado localmente en `apps/platform/src/lib/vercel-headers.test.ts`), pero **nada está desplegado ni verificado en producción**.
F-06 solo se declara cerrado cuando (1) las cabeceras estén desplegadas y comprobadas con el procedimiento de la sección 5 y
(2) el propietario decida sobre la política estricta (secciones 3 y 4). Decisión del propietario vigente: **mantener Report-Only**.

Fuentes: `reports/security/security-review-20261012.md` (F-06, F-08), AGENTS.md §5 y §12, `vercel.json`.

## 0. Piezas entregadas (todas SIN desplegar)

| Pieza | Ruta | Estado |
| --- | --- | --- |
| Edge Function receptora | `supabase/functions/csp-report/index.ts` + `_core.ts` | Escrita y probada con vitest; **no desplegada** |
| Pruebas | `apps/platform/src/lib/csp-report.test.ts` | Pasan (ver reporte de fase) |
| Esta guía | `docs/operations/CSP-REPORTING-AND-ENFORCEMENT.md` | — |

Comportamiento de la función (resumen; el contrato exacto está en las pruebas):

- Solo `POST` con `application/csp-report`, `application/reports+json` o `application/json`. Otro método 405; otro tipo 415.
- Cuerpo máximo 8 KB: si `Content-Length` lo supera, 413 sin leerlo; sin `Content-Length`, se lee en flujo y se aborta al pasar el tope.
- Forma estricta: clásica (`{"csp-report": {...}}`, `report-uri`) o Reporting API (arreglo con `type:"csp-violation"`, `report-to`). Forma inválida: 400 genérico.
- Se conserva solo: directiva violada y efectiva (lista blanca; lo demás es `other`), `blocked-uri` reducida a origen, ruta del documento
  sin host/query/hash y con UUID, correos, JWT, códigos de unión (`/j/XXXXXX`) y segmentos opacos largos enmascarados, disposición
  (`report`/`enforce`/`unknown`), familia de navegador y plataforma gruesa (sin versiones), canal (`report-uri`/`report-to`).
  No se guarda `referrer`, `original-policy`, `script-sample`, IP ni el user-agent completo.
- Duplicados (directiva efectiva + origen + ruta) descartados durante 60 s; tope de 100 reportes/minuto por instancia (con resumen
  `csp-violation-suppressed` al cambiar la ventana). Todo reporte bien formado recibe 204 sin cuerpo, se registre o no.
- Registro: una línea `csp-violation {json}` a stdout (logs de Supabase Functions). Sin tabla, sin migración, sin servicio externo, sin secretos.
- Sin CORS por defecto. Solo si se usa `report-to` (preflight de la Reporting API) se define `CSP_REPORT_ALLOWED_ORIGINS` (orígenes de la app, no `*`).

Limitación conocida: el estado (dedupe/tasa) es por instancia de la función; con varias instancias pueden pasar algunos duplicados.
Es aceptable para triage; la cota dura de volumen la ponen las 100/min por instancia y el límite de la plataforma.

## 1. Cómo se activa la recolección (requiere autorización humana)

**Orden obligatorio. Nunca añadir `report-uri`/`report-to` a `vercel.json` antes de que la función esté desplegada y se conozca su URL**
(un endpoint inexistente genera reintentos y ruido en todos los navegadores de los usuarios).

1. Autorización humana para desplegar (AGENTS §12: nuevo punto público de ingreso de datos). Desplegar primero en **QA**, no en producción.
2. Registrar la función como pública en `supabase/config.toml` (los navegadores no envían JWT; zona Data/RLS, cambio de una línea):

   ```toml
   [functions.csp-report]
   verify_jwt = false
   ```

3. Desplegar: `supabase functions deploy csp-report --project-ref <ref-QA> --no-verify-jwt`.
4. Comprobar la función en aislamiento con datos sintéticos (nada contra producción):

   ```sh
   URL="https://<ref-QA>.supabase.co/functions/v1/csp-report"
   # 204 y una línea csp-violation en los logs de la función:
   curl -s -o /dev/null -w "%{http_code}\n" -X POST "$URL" -H "content-type: application/csp-report" \
     -d '{"csp-report":{"document-uri":"https://qa.example/leagues","violated-directive":"img-src","effective-directive":"img-src","blocked-uri":"https://x.test/a.png?q=1","disposition":"report"}}'
   # 405:  curl -s -o /dev/null -w "%{http_code}\n" "$URL"
   # 400:  curl -s -o /dev/null -w "%{http_code}\n" -X POST "$URL" -H "content-type: application/json" -d '{'
   ```

5. Con la URL real de la función, añadir en `vercel.json` (Release, PR revisado) **al final** de la CSP Report-Only: `; report-uri https://<ref>.supabase.co/functions/v1/csp-report`.
   Empezar solo con `report-uri` (sin preflight CORS; lo soportan Chromium y Firefox). `report-to` + cabecera `Reporting-Endpoints` es opcional y
   exige `CSP_REPORT_ALLOWED_ORIGINS`; no añadirlo hasta que se necesite cobertura de Safari y se haya probado el preflight.
6. Actualizar `vercel-headers.test.ts` (el contrato actual no prohíbe `report-uri`, pero debe afirmar que apunta a `*.supabase.co/functions/v1/csp-report`).
7. Separar entornos: previews de Vercel y QA reportan a la función de QA; producción a la de producción (o a ninguna si se prefiere no exponer el endpoint).
8. Rollback: quitar `report-uri` de `vercel.json` y redeplegar; la función puede quedar inactiva o eliminarse.

## 2. Cómo se revisan los reportes

- Dónde: Supabase Dashboard > Edge Functions > `csp-report` > Logs. Búsqueda en Logs Explorer:
  `select timestamp, event_message from function_logs where event_message like 'csp-violation%' order by timestamp desc` (o filtrar por `csp-violation` en el panel).
- Frecuencia: diaria durante los primeros 7 días tras activar, luego semanal, y **después de cada release** que toque frontend, fuentes, imágenes o dominios externos.
- Responsable: Release/Security (un solo responsable por semana; anotar la revisión en el reporte de fase o en `PROJECT_STATE.md`).
- Agrupar por `directive + blocked + route`; la ruta ya llega saneada. `csp-violation-suppressed` con cifras altas indica ruido o ataque: revisar.
- Formato de triage (una fila por grupo):

| Fecha | directive | blocked | route | ua/platform | Veces | Clasificación | Acción | Responsable |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| aaaa-mm-dd | `img-src` | `https://<ref>.supabase.co` | `/admin/branding` | chrome/android | n | **Permitir** | Añadir origen a `img-src` | Release |

Clasificación y acción:

- **Permitir**: el recurso es legítimo y lo usa la app (origen propio de la arquitectura). Ajustar la política con el origen mínimo (nunca `*`, nunca `https:` completo), probar y repetir el ciclo.
- **Ajustar el código**: la app hace algo evitable (estilo en línea, fuente externa). Corregir en frontend en vez de ampliar la CSP.
- **Bloquear**: origen desconocido o ajeno (extensiones del navegador: `chrome-extension`, `moz-extension`, `safari-extension`; inyección de ISP/antivirus; `inline`/`eval` no atribuible). Ignorar como ruido si viene de extensiones; si no, abrir un hallazgo de seguridad (posible XSS o terceros en la página).
- Todo cambio de CSP se prueba en un preview y se registra en el reporte de fase.

## 3. Criterios de promoción a política estricta (`Content-Security-Policy`)

La promoción **no se hace** sin decisión explícita del propietario. Condiciones mínimas (todas):

1. Función desplegada y recolectando en producción **al menos 14 días consecutivos con tráfico real** (o 7 días y al menos un ciclo completo de uso con jornada de partidos), y **0 violaciones legítimas sin resolver** en ese periodo.
2. Los hallazgos de la sección 4 resueltos o aceptados por escrito.
3. Matriz de flujos verificada en **navegador real móvil** (Chrome Android, Safari iOS; y escritorio Chrome/Firefox como control) con la consola/`securitypolicyviolation` sin violaciones, en un preview con la política estricta ya aplicada:

| Flujo | Qué comprobar | Directivas implicadas |
| --- | --- | --- |
| Login correo/contraseña | Autenticación completa contra Supabase y sesión persistente («Recordar mi cuenta») | `connect-src` |
| Google OAuth | Redirección a Google y retorno a `/auth/callback` (fragmento `#access_token`, F-08) | `form-action`, navegación, `connect-src` |
| Recuperación de contraseña | Enlace del correo, `/auth/callback`, cambio de clave | `connect-src` |
| Fuentes | Inter/Manrope cargadas (`@import` de Google Fonts en `styles.css`) | `style-src`, `font-src` |
| Estilos de Vue/Tailwind | Estilos `:style`/en línea de componentes y esqueletos de carga | `style-src` |
| Flyers HD / blob | Generación con html2canvas/Canvas, `URL.createObjectURL` | `img-src blob:`, `connect-src` (si carga imágenes) |
| Compartir | `navigator.share` y descarga con blob (`lib/share.ts`) | `img-src`, `connect-src` |
| Branding (subida y vista) | Subida por la Edge Function y vista con `signed_url` de Storage | `img-src`, `connect-src` |
| Banderas/escudos | `/flags/*` propios; escudos generados | `img-src 'self'` |
| PWA y service worker | Registro de `/sw.js`, manifest, `offline.html`, modo sin conexión | `worker-src`, `manifest-src` |
| Realtime/WebSocket | Suscripciones de Supabase (`wss://*.supabase.co`) | `connect-src` |
| Cabeceras en `/sw.js` | No-cache y `Service-Worker-Allowed` (sección 5) | — |

4. Promoción gradual: (a) preview con `Content-Security-Policy` estricta **y** la Report-Only anterior en paralelo; (b) producción con ambas; (c) tras una semana sin violaciones nuevas, retirar la Report-Only.
5. Rollback documentado: revertir el commit de `vercel.json` y redeplegar (la CSP viaja solo en cabeceras; no hay migraciones ni datos implicados).
6. El wrapper Capacitor (`mobile/capacitor.config.json`, `webDir`, `androidScheme: https`, sin `server.url`) sirve los activos empaquetados localmente: **las cabeceras de Vercel no aplican a la app nativa**. Si algún día se usa `server.url`, la CSP afectará al wrapper y exige ADR (AGENTS §12, compatibilidad de builds móviles).

## 4. Riesgos y hallazgos de compatibilidad de la CSP actual

CSP actual: `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data: blob:; connect-src 'self' https://*.supabase.co wss://*.supabase.co; worker-src 'self'; manifest-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'`.

1. **Posible bloqueo de imágenes de branding (a verificar primero).** `BrandingAssetSlot.vue` muestra `asset.signed_url` (URL firmada de Supabase Storage, `https://<ref>.supabase.co/storage/v1/...`) en un `<img>`, pero `img-src` solo permite `'self' data: blob:`. Con política impuesta esas imágenes se bloquearían. Es de esperar que el primer lote de reportes muestre `img-src` + `https://<ref>.supabase.co`. Corrección probable: añadir `https://*.supabase.co` a `img-src` (origen mínimo). Hasta confirmarlo con un reporte real o prueba en navegador, **no promover**. (No se modificó `vercel.json`: fuera de la zona de esta tarea; requiere PR de Release.)
2. **`style-src 'unsafe-inline'`.** Necesario hoy por estilos en línea de Vue (`:style`) y `<style>` inyectado por herramientas; permite inyección de estilos (exfiltración por selectores CSS, defacement), pero **no ejecución de scripts** (`script-src 'self'` sin `unsafe-inline`/`unsafe-eval`, cubierto por tests). Riesgo aceptado mientras `script-src` siga estricto. Mejora posible: migrar estilos dinámicos a clases/variables CSS y probar `style-src-attr 'unsafe-inline'` solo para atributos, y retirar `unsafe-inline` de `style-src-elem`. Requiere trabajo de frontend; no es bloqueante para la promoción inicial.
3. **Google Fonts como origen externo** (`@import url("https://fonts.googleapis.com/...")` en `apps/platform/src/styles.css`; Inter y Manrope). Implica: dependencia de terceros en disponibilidad y privacidad (la IP del usuario llega a Google), y dos orígenes extra en la CSP. Alternativa recomendada: **autoalojar** las fuentes (archivos `woff2` en `public/fonts/` con `@font-face` propio, licencia OFL), dejando `style-src 'self' 'unsafe-inline'` y `font-src 'self'`, y el `@import` eliminado. También mejora el modo sin conexión (PWA: hoy el SW no cachea orígenes externos). Cambio de frontend (zona Frontend), sin dependencias nuevas.
4. **`connect-src https://*.supabase.co wss://*.supabase.co`.** Comodín de subdominio sobre el dominio del proveedor: permite cualquier proyecto Supabase, no solo el propio. Endurecer a `https://<ref>.supabase.co wss://<ref>.supabase.co` por entorno cuando se conozcan los refs de QA/producción (Vercel no admite variables en `vercel.json`: requeriría una cabecera por entorno o generación en build).
5. **OAuth con tokens en el fragmento (F-08, ADR-013).** La CSP es la mitigación principal frente a XSS que lea `localStorage`/fragmento. `Referrer-Policy: strict-origin-when-cross-origin` evita enviar rutas completas a terceros.
6. **Sin `Reporting-Endpoints`/`report-to` aún**; Safari tiene soporte parcial de `report-to`. La cobertura de Safari iOS en reportes puede ser incompleta: compensar con la prueba manual de la matriz.
7. **El service worker** solo cachea mismo origen (`sw.js`), compatible con `worker-src 'self'`. `/sw.js` debe seguir sin caché de borde (sección 5).
8. **`frame-ancestors 'none'` no funciona vía `<meta>`**; solo por cabecera (ya es cabecera). Mientras la CSP sea Report-Only no bloquea nada (ni siquiera `frame-ancestors`): la protección anti-clickjacking vigente la da `X-Frame-Options: DENY`.

## 5. Verificación de las demás cabeceras (tras el despliegue)

No ejecutar nada contra el sitio vivo antes del despliegue autorizado. Vercel aplica anti-bot a ciertos clientes: si `curl` recibe un desafío/HTML de verificación (403/429 o página de «Vercel Security Checkpoint»), repetirlo desde un navegador real (DevTools > Network > ver *Response Headers*) y anotar el resultado manualmente. Sustituir `$SITE` por el dominio desplegado.

```sh
SITE="https://<dominio-desplegado>"
curl -sI "$SITE/"                       # cabeceras globales
curl -sI "$SITE/sw.js"                  # cabeceras del service worker
curl -sI "$SITE/leagues"                # ruta de la SPA (rewrite) hereda las globales
curl -sI "$SITE/manifest.webmanifest"   # activo estático hereda las globales
```

Resultado esperado (`/` y cualquier ruta; las cabeceras de Vercel van en minúsculas por HTTP/2):

| Cabecera | Valor esperado |
| --- | --- |
| `x-content-type-options` | `nosniff` |
| `x-frame-options` | `DENY` |
| `referrer-policy` | `strict-origin-when-cross-origin` |
| `permissions-policy` | `camera=(), microphone=(), geolocation=(), payment=(), usb=()` |
| `strict-transport-security` | `max-age=31536000` (sin `includeSubDomains`/`preload` por ahora; Vercel puede añadir su propia versión en el dominio `*.vercel.app`: aceptable si el `max-age` es >= 31536000) |
| `content-security-policy-report-only` | La CSP de `vercel.json` (+ `report-uri` solo tras la sección 1) |
| `content-security-policy` | **Ausente** mientras la decisión del propietario sea Report-Only |

Para `/sw.js`, además de las globales:

| Cabecera | Valor esperado |
| --- | --- |
| `cache-control` | `no-cache, no-store, must-revalidate` (no debe aparecer `public, max-age=...` ni `s-maxage`) |
| `service-worker-allowed` | `/` |
| `x-vercel-cache` | `MISS` o `BYPASS` (nunca `HIT` con una versión antigua tras un despliegue) |

Comprobación automática rápida (solo salida local, sin escribir nada):

```sh
for h in x-content-type-options x-frame-options referrer-policy permissions-policy strict-transport-security content-security-policy-report-only; do
  curl -sI "$SITE/" | grep -i "^$h:" || echo "FALTA: $h"
done
curl -sI "$SITE/" | grep -i "^content-security-policy:" && echo "ATENCIÓN: CSP impuesta (no esperada)"
curl -sI "$SITE/sw.js" | grep -iE "^(cache-control|service-worker-allowed):"
```

Verificación en navegador real (móvil y escritorio): DevTools > Console sin avisos `[Report Only] Refused to ...` que no estén ya triados;
Application > Service Workers muestra `/sw.js` activado; la pestaña Network > `sw.js` con `cache-control: no-cache...`.
Anotar fecha, URL, quién ejecutó y resultado en el reporte de fase.

## 6. Estado explícito y autorizaciones pendientes

- **2026-10-24 (autorización completa del propietario), pasos 1–6 hechos en QA:** `[functions.csp-report] verify_jwt = false` en `config.toml`; función desplegada en QA (`--no-verify-jwt`); comprobación aislada 204/405/400; `report-uri https://juoftaofzepxbrrxbkhx.supabase.co/functions/v1/csp-report` al final de la CSP Report-Only; `vercel-headers.test.ts` lo exige.
- **F-06: EN OBSERVACIÓN, no cerrado.** Falta: verificar las cabeceras publicadas (sección 5) tras el despliegue de `main` en Vercel, observar los reportes durante el periodo de la sección 3 y decidir sobre la política impuesta.
- Sigue requiriendo autorización: (1) el mismo despliegue en producción, cuando exista, (2) promover a `Content-Security-Policy` impuesta, (3) cualquier cambio de `img-src`/`connect-src` o autoalojamiento de fuentes.
- No se añadieron dependencias, proveedores externos, tablas ni migraciones.
