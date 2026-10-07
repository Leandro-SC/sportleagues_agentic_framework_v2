// Datos de vista previa (pre-acceptance): partidos, competiciones, tablas y actividad todavía no
// tienen contrato de datos (Fase 06/08/09). Se muestran solo en desarrollo local o cuando el build
// lo activa explícitamente con VITE_PREVIEW_DATA=true, y siempre con la marca "Vista previa".
// En cualquier otro build las pantallas muestran sus estados vacíos y nunca datos ficticios.
export type PreviewEnv = { DEV?: boolean; VITE_PREVIEW_DATA?: string }

export function isPreviewDataEnabled(env: PreviewEnv = import.meta.env): boolean {
  if (env.VITE_PREVIEW_DATA === 'true') return true
  if (env.VITE_PREVIEW_DATA === 'false') return false
  return env.DEV === true
}
