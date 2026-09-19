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
- Nunca inventar datos o funcionalidades que no existen: usar `EmptyState` /
  `LoadingSkeleton` en vez de contenido de ejemplo.

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
| `shadow-glow-primary` | glow verde | Botón primario, FAB, avatar/ítem activo |
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
| `AppShell.vue` | Layout de página: `TopBar` + contenido + `BottomNav` + FAB de unión por código. Variantes `guest` / `app` / `focus` (pantallas centradas sin chrome, p. ej. onboarding). |
| `TopBar.vue` | Header fijo compacto: logo (ícono trofeo en pill verde) + nombre de marca; en variante `app` agrega enlace "Admin" (cian) y avatar circular con anillo verde. |
| `BottomNav.vue` | Navegación inferior fija, 4 accesos (Inicio, Partidos, Ligas y Perfil). Ítem activo: icono dentro de un círculo relleno verde neón (`bg-primary text-canvas`) + label en verde; ítems deshabilitados (fases futuras) quedan atenuados con badge de fase. |
| `SuperadminShell.vue` | Layout del entorno de plataforma: header propio + navegación lateral/tabs con el mismo lenguaje visual (superficie oscura, acentos cian para "verificado"). |
| `PrimaryButton.vue` | Botón pill sólido verde neón, texto blanco, glow sutil. Estado disabled en `surface-3`. |
| `SecondaryButton.vue` | Botón pill outline (borde verde o rojo en `tone="danger"`), fondo transparente, texto blanco. |
| `PoolCard.vue` | Card de quiniela con gradiente `surface-2` → `surface`, icono trofeo en badge verde, chips de estado. |
| `MatchCard.vue` | Card de partido (`app-surface`), fila de equipos, marcador o "vs", chip de estado (en vivo / bloqueado / finalizado). |
| `RankingRow.vue` | Fila de leaderboard; usuario actual resaltado con borde/fondo verde tintado. |
| `StatChip.vue` | Badge pill pequeño con 5 tonos semánticos (`brand` cian, `success`/`warn`/`danger`, `neutral`). |
| `FormField.vue` | Label + input con `.field-surface`, foco en verde, error en rojo. |
| `BottomSheet.vue` | Hoja inferior con overlay `canvas/70` + blur, handle superior, borde superior sutil. |
| `LoadingSkeleton.vue` | Bloque shimmer para estados de carga. |
| `EmptyState.vue` / `ErrorState.vue` | Estados vacíos/erróneos con icono en badge tintado y CTA opcional. |

## Diferencias inevitables frente a la referencia

1. **Contenido de partidos, ligas, tablas de posiciones y feed en vivo**: la
   referencia muestra datos reales (marcadores, jornadas, standings). Esas
   funcionalidades no existen aún (Fase 06 en adelante), así que las pantallas
   equivalentes (`PoolView`) usan skeletons y notas explícitas ("se habilita en
   la Fase 06/08") en vez de datos inventados.
2. **Buscador global y accesos rápidos de Home** (Calendario, Tabla,
   Estadísticas) no están implementados; se conservan solo los pasos
   funcionales existentes (Unirse / Predecir / Competir).
3. **Bell de notificaciones** de la referencia no se agregó: no existe un
   sistema de notificaciones en el producto y agregar el icono sin función
   sería inventar una feature.
4. **Adaptación desktop**: la referencia es 100% mobile; en `sm:`/`md:` el
   `SuperadminShell` y los formularios de `AdminView` usan grillas más anchas
   manteniendo los mismos tokens.
