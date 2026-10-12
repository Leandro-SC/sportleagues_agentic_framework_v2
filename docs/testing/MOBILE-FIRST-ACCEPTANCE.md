# Criterio de aceptación móvil (permanente)

SportLeagues es una **aplicación móvil** (PWA instalable, empaquetable con Capacitor), no una web de escritorio adaptada. Este criterio se aplica a **cada módulo y fase** y sobrevive a pausas y reanudaciones (`docs/agents/RESUME_STATE.md`).

**Regla de cierre:** ningún módulo es `DONE_VERIFIED` si su experiencia móvil tiene problemas importantes. Los tests de lógica no sustituyen la validación visual y funcional en dispositivo: sin ella, el máximo estado es `DONE_PENDING_UAT`.

## Lista de comprobación por pantalla

| # | Criterio | Cómo se verifica | Automatizable |
| --- | --- | --- | --- |
| 1 | Diseñada primero a 320/390/430 px; tablet y escritorio solo amplían | Revisión en emulación + dispositivo real | Parcial (tests de clases/estructura) |
| 2 | Navegación tipo app: barra inferior (≤5 opciones), encabezado compacto, acción principal al alcance del pulgar | Revisión | Parcial (`BottomNav.test.ts`) |
| 3 | Sin tablas anchas ni formularios largos: tarjetas/listas, formularios por pasos o en hoja inferior | Revisión | No |
| 4 | Objetivos táctiles ≥ 44 px, separación suficiente, sin acciones solo con hover | `touch-targets.test.ts` + revisión | Parcial |
| 5 | Sin scroll horizontal de página; safe areas (`env(safe-area-inset-*)`) respetadas | Revisión en iOS/Android | No |
| 6 | Estados de carga, vacío y error con reintento en cada lista/formulario | Tests de vista + revisión | Sí (vista) |
| 7 | Conexión lenta/perdida: aviso sin conexión, reintento, la caché nunca autoriza escrituras | `offline-cache.test.ts`, `usePoolPlay.cache.test.ts`; prueba manual en modo avión | Parcial |
| 8 | Rendimiento: carga inicial ligera (import dinámico de vistas), imágenes dimensionadas/lazy, consultas paginadas | `verify:bundle`, revisión de red | Parcial |
| 9 | Accesibilidad: contraste (`color-contrast.test.ts`), `aria-*`, foco visible, texto escalable al 200 % | Tests + revisión | Parcial |
| 10 | Roles: cada persona ve solo las opciones de su perfil (admin / user) | Tests de router/menús + RLS | Sí |
| 11 | Flujos clave en una mano: pronosticar, ver partidos, completar tickets, ver ranking | Prueba manual cronometrada | No |
| 12 | PWA instalable, offline básico, sin cachear datos privados | Runbook PWA | Parcial |

## Validación en dispositivo (UAT móvil)

Estado actual: **PENDING** — no hay navegador automatizado ni dispositivo en el proyecto; ninguna pantalla se ha validado visualmente por el agente en esta sesión. El operador ejecuta el checklist en Android (Chrome) e iOS (Safari) a 320/390/430 px con sesión de admin y de participante, y registra resultado por pantalla (PASS/FAIL, capturas sin PII). Ver también `docs/operations/PWA-CAPACITOR-RUNBOOK.md`.
