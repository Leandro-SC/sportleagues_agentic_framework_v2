# SportLeagues — Design System (Dark Navy / Neon Sport)

Fuente de verdad visual para la PWA (`apps/platform`). Replica la referencia
`docs/design/reference/sportleagues-ui-reference.png`. Todos los tokens están
centralizados en `apps/platform/src/styles.css` (bloque `@theme`, Tailwind v4)
y se consumen como utilidades Tailwind (`bg-canvas`, `text-text-muted`, etc.).
No dupliques valores de color/radio fuera de ese archivo.

## Principios

- Dark navy premium, deportivo, alto contraste, acentos neón (verde + cian).
- Mobile-first, compacto, cards oscuras con borde cian sutil.
- Botones pill (`rounded-pill`), iconografía outline (Lucide).
- Navegación inferior fija con estado activo en verde neón.
- Nunca presentar datos inventados como reales. En builds de QA/producción las pantallas sin
  contrato de datos muestran `EmptyState` / `LoadingSkeleton`. Los datos de ejemplo solo existen
  con la vista previa activa (desarrollo local o `VITE_PREVIEW_DATA=true`) y siempre llevan
  `PreviewBadge` (ver "Vista previa pre-acceptance").

## Tokens de color

| Token (`--color-*`) | Valor | Uso |
| --- | --- | --- |
| `canvas` | `#03111C` | Fondo de página (body, shells) |
| `surface` | `#071B29` | Cards y superficies principales |
| `surface-2` | `#0A2434` | Superficie elevada / inputs / hover |
| `surface-3` | `#0F2E3F` | Superficie más elevada (skeleton, thumbs, pills inactivos) |
| `primary` | `#21F59A` | Verde neón — acción principal, estado activo |
| `primary-600` | `#12C97D` | Hover/active de `primary` |
| `primary-100` | `#0E3A2C` | Fondo tintado (chips, EmptyState, avisos success) |
| `secondary` | `#16D8F4` | Cian — acentos secundarios (link "Admin", iconos superadmin) |
| `secondary-600` | `#0FA9C2` | Hover de `secondary` |
| `secondary-100` | `#0B3440` | Fondo tintado cian |
| `text` | `#F7FAFC` | Texto principal |
| `text-muted` | `#8FA6B5` | Texto secundario / labels |
| `text-faint` | `#5C7889` | Texto terciario / placeholders / disabled |
| `border` | `#12293A` | Borde sutil de cards, headers, inputs |
| `border-strong` | `#1C3C50` | Borde de énfasis (EmptyState dashed, divisores) |
| `success` | `= primary` | Estados positivos (reutiliza el verde de marca) |
| `warn` | `#FFC24B` | Avisos (límite FREE, pendiente de aprobación) |
| `danger` | `#FF5D7A` | Errores, acciones destructivas |
| `*-100` (success/warn/danger) | tinte oscuro de cada estado | Fondos de chip/alerta |

Cada color de estado tiene una variante `-100` (tinte oscuro, ~15% de mezcla)
para fondos de badges/alertas, y el color base para texto/iconos/bordes.

## Radios y sombras

| Token | Valor | Uso |
| --- | --- | --- |
| `radius-lg` | `1rem` | Inputs, botones secundarios de icono |
| `radius-xl` | `1.25rem` | Cards de contenido (`MatchCard`, `app-surface`) |
| `radius-2xl` | `1.5rem` | Cards destacadas (`PoolCard` hero, sheets) |
| `radius-pill` | `999px` | Botones, chips, BottomSheet handle |
| `shadow-glow-primary` | glow verde | Botón primario, ítem activo de navegación, avatar |
| `shadow-glow-secondary` | glow cian | Reservado para acentos secundarios |

## Tipografía

- `font-sans` (Inter): cuerpo de texto, labels, botones.
- `font-display` (Manrope, 700/800): títulos (`h1`–`h3`, nombres de quiniela,
  montos, cifras destacadas).

## Utilidades compuestas (`styles.css`)

- `.app-surface`: card base (`border-border` + `bg-surface`, `rounded-2xl`).
- `.app-surface-raised`: igual + `shadow-md`, para bloques destacados (login,
  perfil, formularios focus).
- `.field-surface`: inputs/selects (`bg-surface-2`, `border-border`,
  `rounded-xl`).
- `.safe-top` / `.safe-bottom`: paddings de safe-area para notch / home
  indicator.
- `.press-scale`: microinteracción de presión (scale 0.97 + opacity en
  `:active`) para todo elemento pulsable.
- `.skeleton-shimmer`: animación de carga sobre `surface-2` → `surface-3`.
- `.stadium-hero`: fondo de luz de estadio con los acentos oficiales; se usa en
  los héroes de acceso, quiniela y perfil. Usa una fotografía local de estadio
  bajo capas de contraste; su atribución está en `docs/design/ASSET-ATTRIBUTIONS.md`.

## Componentes globales

| Componente | Rol visual |
| --- | --- |
| `AppShell.vue` | Layout de página. `app`: contenido + `BottomNav` (cada pantalla trae su `ScreenHeader`); `guest`: `TopBar` de marca; `focus`: pantalla centrada sin chrome (onboarding, unión). Ya no incluye FAB: unirse con código vive en Ligas → Unirme a una liga. |
| `TopBar.vue` | Header de marca para visitantes (variante `guest`). El acceso al panel de administración pasó a Perfil → Ajustes y solo se ofrece a owner/admin. |
| `BottomNav.vue` | Navegación inferior fija con 4 accesos habilitados (Inicio, Partidos, Ligas y Perfil). Ítem activo: icono y label en verde sobre pastilla `primary-100` con glow y `aria-current="page"`. |
| `SuperadminShell.vue` | Layout del entorno de plataforma: header propio + navegación lateral/tabs con el mismo lenguaje visual (superficie oscura, acentos cian para "verificado"). |
| `PrimaryButton.vue` | Botón pill sólido verde neón, texto `canvas` (oscuro, contraste ≈ 14:1; el blanco daba ≈ 1,5:1), glow sutil. Estado disabled en `surface-3`. |
| `SecondaryButton.vue` | Botón pill outline (borde verde o rojo en `tone="danger"`), fondo transparente, texto blanco. |
| `PoolCard.vue` | Card de quiniela con gradiente `surface-2` → `surface`, icono trofeo en badge verde, chips de estado. |
| `MatchCard.vue` | Card de partido (`app-surface`), fila de equipos, marcador o "vs", chip de estado (en vivo / bloqueado / finalizado). |
| `RankingRow.vue` | Fila de leaderboard; usuario actual resaltado con borde/fondo verde tintado. |
| `StatChip.vue` | Badge pill pequeño con 5 tonos semánticos (`brand` cian, `success`/`warn`/`danger`, `neutral`). |
| `FormField.vue` | Label + input con `.field-surface`, foco en verde, error en rojo. |
| `BottomSheet.vue` | Hoja inferior con overlay `canvas/70` + blur, handle superior, borde superior sutil. |
| `LoadingSkeleton.vue` | Bloque shimmer para estados de carga. |
| `EmptyState.vue` / `ErrorState.vue` | Estados vacíos/erróneos con icono en badge tintado y CTA opcional. |
| `ScreenHeader.vue` | Cabecera de pantalla: volver, título (normal o `large`) y slot de acciones. |
| `SearchField.vue` | Buscador pill con icono, botón limpiar y `role="search"`. |
| `SegmentedTabs.vue` | Tablist accesible (flechas ←/→). Variantes `pill` (Hoy/Mañana/Esta semana), `chip` (Resumen/Equipos/…) y `underline` (Partidos/Plantilla/Estadísticas). |
| `SectionHeader.vue` | Título de sección + enlace "Ver todos" opcional. |
| `ScoreboardCard.vue` / `UpcomingMatchCard.vue` / `TeamMatchRow.vue` / `LiveMatchCarousel.vue` | Tarjetas de partido: listado de Partidos, próximos partidos, fila compacta de equipo y carrusel "En vivo" de Inicio. |
| `MatchStatusPill.vue` | Estado de partido: En vivo (verde con pulso), Finalizado, Hoy · hora, Mañana · hora. |
| `StandingsTable.vue` | Tabla de posiciones (compacta o `detailed` con G/E/P/DG); líder resaltado. |
| `TeamCrest.vue` | Escudo genérico SVG con colores e iniciales del equipo; texto con contraste calculado. No reproduce escudos oficiales. |
| `CompetitionEmblem.vue` / `CountryFlag.vue` | Emblema circular de competición y banderas SVG simplificadas (Windows no renderiza banderas emoji). |
| `SportIcon.vue` | Balón de fútbol, básquet y tenis dibujados en la grilla de Lucide (Lucide no los incluye); vóley usa `Volleyball` de Lucide. |
| `QuickActionTile.vue`, `FollowedTeamCard.vue`, `CommunityLeagueRow.vue`, `ActivityRow.vue` | Accesos rápidos, equipos seguidos, ligas recomendadas y actividad del perfil. |
| `NotificationsButton.vue` / `ShareMenuButton.vue` | Campana con estado vacío (las notificaciones son de Fase 11) y menú ⋮ con Compartir (Web Share o copiar enlace). |
| `PreviewBadge.vue` | Marca ámbar "Vista previa" obligatoria en todo bloque con datos de ejemplo. |
| `CatalogBoundary.vue` | Frontera de carga/error del catálogo: skeleton accesible (`role="status"`), error con "Reintentar" y contenido cuando está listo. Evita mostrar "no encontrado" o vacío mientras se carga. |

## Portada pública

`HomeView.vue` muestra una portada sin chrome para visitantes. Usa los assets internos
`src/assets/backgrounds/fondo_app_tablo.png` y `src/assets/branding/logo_app_tablo.png`, con la
misma estructura de la referencia: marca, tagline, iconos deportivos, CTA primario, CTA outline y
pie de marca. Los CTAs no autentican por sí mismos: abren el formulario existente de Magic Link y
Google OAuth para preservar el contrato de Auth.

## Patrones móvil (verificados a 320, 390 y 430 px)

- **Objetivo táctil mínimo 44×44 px:** los botones de solo icono usan `.icon-button` (`styles.css`).
  Los puntos del carrusel amplían su zona táctil con un pseudo-elemento sin cambiar su tamaño.
- **Los nombres de equipo se parten en dos líneas** (`line-clamp-2`) en lugar de truncarse con "…";
  los textos auxiliares bajan a 10–13 px por debajo de 360 px (`min-[360px]:`).
- **Pestañas:** la variante `chip` reparte el ancho (`flex-1 min-w-0`) para que 4 pestañas quepan
  en 320 px; la `pill` no se parte (`whitespace-nowrap`).
- **Elementos fijos sobre la navegación** (botón "Seguir equipo") se posicionan con el token
  `--bottom-nav-h` (`styles.css`), el mismo alto que usa `BottomNav`, más el área segura del
  dispositivo, y llevan degradado para no tapar contenido de forma ilegible.
- **Listas horizontales** usan `scroll-px-5` para que el primer elemento se alinee con el margen.
- **Movimiento reducido:** con `prefers-reduced-motion` se desactivan animaciones y transiciones
  (skeleton, pulso de "En vivo").
- **Búsqueda:** el desplegable se cierra con Escape y al tocar fuera (`pointerdown` en el
  documento, porque `focusout` pierde el clic en Safari iOS) y se reabre al enfocar.

## Vista previa pre-acceptance (2026-10-05)

El rediseño completo de la referencia (Inicio, Partidos, Ligas, Unirme a una liga, detalle de
liga, ficha de equipo y Perfil) se implementó en la rama `prep/ui-redesign-pre-acceptance` antes del
cierre de Fase 05/05-bis. **No es inicio de Fase 06.**

- **Datos reales:** nombre, correo e iniciales del perfil; "Mis ligas" (`participants` + `pools`
  bajo RLS); unión por código (`/j/:code` → `join_pool`); acceso a `/admin` solo para owner/admin.
- **Datos de ejemplo:** partidos, competiciones, equipos, tablas, ligas recomendadas, actividad y
  nivel/puntos del perfil. Salen de `lib/sports-preview.ts` vía `useSportsCatalog()` y solo se
  muestran con `isPreviewDataEnabled()`: activo en `npm run dev` y desactivado en cualquier build
  salvo que se defina `VITE_PREVIEW_DATA=true`. Sin vista previa, esas secciones muestran estados
  vacíos. El dataset se importa de forma diferida (`import()`) tras una guarda con constantes de
  build: en builds sin vista previa **no está en el JavaScript** y con `VITE_PREVIEW_DATA=true`
  queda en un chunk `sports-preview-*` propio. `npm run verify:bundle` lo comprueba.
- **Contrato de presentación:** `lib/sports-catalog.ts` usa los nombres de columna de Fase 03
  (`tournaments`, `teams`, `matches`, `match_status`) para que Fase 06 sustituya la fuente sin
  tocar las vistas. No es autoridad para lock ni scoring. Borrador de la conexión real y sus
  brechas: `docs/design/PHASE-06-FRONTEND-DATA-CONTRACT-DRAFT.md`.
- **Seguir equipo:** preferencia local del dispositivo (`localStorage`, solo ids de equipo). No existe
  modelo de equipos seguidos en la base.

## Diferencias inevitables frente a la referencia

1. **Marca:** la referencia muestra el texto "SportLeagues"; la portada usa el logo aprobado
   `logo_app_tablo.png` (Tablo). Unificar la marca es una decisión de producto pendiente.
2. **Escudos, logos de ligas y foto del jugador:** no se usan marcas ni imágenes oficiales. Se
   generan escudos SVG con colores e iniciales y emblemas con bandera; el banner de liga usa el
   escudo del líder en lugar de la fotografía.
3. **Códigos de ligas recomendadas:** la referencia muestra `#LIGAMX2020`; los ejemplos usan el
   formato real de 6 caracteres (`[A-Z0-9]{6}`).
4. **Números de ejemplo:** la tabla y las estadísticas son coherentes entre sí (PJ = G + E + P,
   PTS = 3·G + E), por eso no copian cifras inconsistentes de la referencia.
5. **Usuario:** el perfil muestra el correo real en lugar de un `@usuario`, porque el modelo
   `profiles` no tiene handle. El icono de cámara del avatar se reemplazó por una insignia de
   verificación: no existe la subida de foto de perfil.
6. **Plantilla y Logros:** no forman parte del modelo del MVP; muestran estados vacíos explicados.
7. **Cerrar sesión** está en Perfil → Ajustes (⚙), junto al acceso al panel de administración.
8. **Adaptación desktop:** la referencia es 100% mobile; las pantallas mantienen una columna
   `max-w-lg` centrada y el `SuperadminShell` y `AdminView` usan grillas más anchas.
