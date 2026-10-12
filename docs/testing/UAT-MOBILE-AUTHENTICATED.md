# UAT móvil autenticada — checklist reproducible

Estado: **PENDING (no ejecutada)**. Los agentes no tienen navegador automatizado ni dispositivo; ningún caso de esta lista se ha marcado PASS. La ejecuta una persona con sesiones reales y anota el resultado. Criterios transversales: `docs/testing/MOBILE-FIRST-ACCEPTANCE.md`.

**Entorno:** `https://sportleagues-qa.vercel.app` (QA), con la versión candidata ya desplegada por quien tenga autorización. Dispositivos: Android (Chrome) e iOS (Safari) a ~320, 390 y 430 px de ancho; una pasada con texto al 200 % y otra en modo avión.
**Cuentas** (solo QA; nunca credenciales en este documento): Admin A, Admin B (otra organización), Participante 1, Participante 2. Máximo 5 cuentas humanas persistentes (Encargo §8).
**Evidencia:** captura sin PII y una línea de resultado por caso. Un FAIL abre un defecto; no se reinterpreta.

| # | Flujo | Pasos | Resultado esperado | Estado |
| --- | --- | --- | --- | --- |
| A1 | Admin: navegación | Iniciar sesión como Admin A → Panel | Barra inferior de administrador (Panel, Quinielas, Parrilla, Finanzas, Perfil) + franja «Modo participante»; sin menú ni enlace global/Superadmin | PENDING |
| A2 | Admin: ruta global | Escribir `/superadmin` en la barra | Cae en Inicio; sin pantalla de plataforma | PENDING |
| A3 | Admin: parrilla | Crear jornada y partido; publicar resultado; corregir resultado | Sin scroll horizontal; el recálculo no duplica puntos | PENDING |
| F1 | Finanzas propias | Admin A → Mis finanzas | Solo conteos de estado manual de SUS quinielas; ninguna cifra monetaria | PENDING |
| F2 | Finanzas ajenas | Con Admin A, intentar ver la organización/quiniela de Admin B (cambiar ids en la URL, selector) | No aparece nada de B; sin error que revele existencia | PENDING |
| F3 | Participante y finanzas | Participante 1 → `/admin/ingresos` y `/organizador` | Redirige a Inicio; en su liga solo ve su propio estado | PENDING |
| P1 | Participante: inscripción | Unirse con código; esperar aprobación; ver estado pendiente/aprobado | Mensajes claros; sin acceso a pronósticos hasta aprobación | PENDING |
| P2 | Pronósticos | Guardar y editar un pronóstico antes del cierre; intentar tras el cierre | Tras el cierre el servidor rechaza y la UI lo explica; hora del servidor, no la del dispositivo | PENDING |
| P3 | Privacidad | Participante 2 intenta ver pronósticos de Participante 1 antes del cierre | Ocultos hasta el cierre; visibles después | PENDING |
| P4 | Admin ≠ participante | Admin A abre su propia quiniela; abre una quiniela de otra organización | En la propia: sin formulario de pronóstico ni tickets. En la ajena (si está inscrito): puede participar | PENDING |
| T1 | Tickets gratuitos | Emitir hasta el cupo, guardar, enviar, cancelar y reemitir | Cupo respetado; avisos de cierre; sin duplicados al reintentar con mala conexión | PENDING |
| R1 | Rankings | Ver tabla general, por jornada y rachas | Posición y puntos coherentes con los resultados; administradores no figuran | PENDING |
| S1 | Solicitud de quiniela | Participante → Mi perfil → «Crear mi propia quiniela» | Estado pendiente; no se duplica al reenviar; no se obtiene acceso admin. Mientras la migración no esté aplicada: botón deshabilitado con «Función aún no disponible» | PENDING |
| C1 | Cierre de sesión y caché | Participante 1 abre su liga → cierra sesión → inicia como Participante 2 en el mismo dispositivo | Ninguna fila de P1 visible; IndexedDB privada purgada | PENDING |
| C2 | Conexión | Modo avión en una liga ya visitada; recuperar red | Aviso «Sin conexión: mostrando lo último guardado»; guardar requiere conexión; se recupera sola | PENDING |
| W1 | PWA | Instalar desde el navegador; abrir; modo avión | Pantalla de instalación correcta; offline muestra shell u `offline.html`; sin datos privados en caché del SW | PENDING |
| X1 | Auto-fill (si la migración 20261021 está aplicada) | Partido abierto → «Sugerir marcador» | Rellena sin guardar; muestra probabilidades y «no es una certeza ni una recomendación de apuesta» | PENDING |
| H1 | Cabeceras | Tras el despliegue: `curl -sI <url>` y consola del navegador (violaciones CSP) | Cabeceras de `vercel.json`; CSP en Report-Only sin violaciones en flujos clave | PENDING |
