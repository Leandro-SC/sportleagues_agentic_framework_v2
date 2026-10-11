import { computed, ref } from 'vue'

// Preferencia local del dispositivo (no se sincroniza ni es un dato del tenant): no existe todavía
// un modelo de "equipos seguidos" en la base. Se guarda solo el id del equipo, sin PII.
const STORAGE_KEY = 'sportleagues.followed-teams'

function readStored(): string[] | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    const parsed: unknown = raw ? JSON.parse(raw) : null
    return Array.isArray(parsed) ? parsed.filter((value): value is string => typeof value === 'string') : null
  } catch {
    return null
  }
}

function writeStored(ids: string[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(ids))
  } catch {
    // Sin almacenamiento disponible (modo privado): la preferencia vive solo en memoria.
  }
}

// null = el usuario todavía no ha elegido; se muestran los valores por defecto vigentes.
const chosen = ref<string[] | null>(null)
let hydrated = false

function hydrate(): void {
  if (hydrated) return
  hydrated = true
  chosen.value = readStored()
}

// `defaults` es un getter porque el catálogo puede cargarse después de montar la pantalla.
export function useFollowedTeams(defaults: () => string[] = () => []) {
  hydrate()

  const ids = computed(() => chosen.value ?? defaults())

  function isFollowing(teamId: string): boolean {
    return ids.value.includes(teamId)
  }

  function toggle(teamId: string): void {
    chosen.value = isFollowing(teamId) ? ids.value.filter((id) => id !== teamId) : [...ids.value, teamId]
    writeStored(chosen.value)
  }

  return { ids, isFollowing, toggle }
}

export function resetFollowedTeamsForTests(): void {
  chosen.value = null
  hydrated = false
}
