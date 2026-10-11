import { computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'

// Pestaña activa sincronizada con `?tab=` para que el botón Atrás y los enlaces profundos
// (por ejemplo "Tabla" desde Inicio) abran la pestaña correcta.
export function useRouteTab<T extends string>(tabs: readonly T[], fallback: T) {
  const route = useRoute()
  const router = useRouter()

  return computed<T>({
    get: () => {
      const value = route.query.tab
      return typeof value === 'string' && (tabs as readonly string[]).includes(value) ? (value as T) : fallback
    },
    set: (value) => {
      void router.replace({ query: { ...route.query, tab: value === fallback ? undefined : value } })
    },
  })
}
