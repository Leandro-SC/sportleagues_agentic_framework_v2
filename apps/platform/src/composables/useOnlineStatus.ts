import { onBeforeUnmount, onMounted, ref } from 'vue'

// Estado de conexión del dispositivo solo para AVISAR en pantalla (criterio móvil 7). No autoriza
// nada: el servidor confirma siempre cada acción y la caché nunca autoriza escrituras.
export function useOnlineStatus() {
  const online = ref(typeof navigator === 'undefined' ? true : navigator.onLine !== false)
  const update = (): void => { online.value = typeof navigator === 'undefined' ? true : navigator.onLine !== false }
  onMounted(() => { update(); window.addEventListener('online', update); window.addEventListener('offline', update) })
  onBeforeUnmount(() => { window.removeEventListener('online', update); window.removeEventListener('offline', update) })
  return { online }
}
