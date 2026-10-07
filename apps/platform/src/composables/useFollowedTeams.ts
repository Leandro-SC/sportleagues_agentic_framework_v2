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

const followed = ref<string[] | null>(null)

export function useFollowedTeams(defaults: string[] = []) {
  if (followed.value === null) followed.value = readStored() ?? [...defaults]

  const ids = computed(() => followed.value ?? [])

  function isFollowing(teamId: string): boolean {
    return ids.value.includes(teamId)
  }

  function toggle(teamId: string): void {
    followed.value = isFollowing(teamId) ? ids.value.filter((id) => id !== teamId) : [...ids.value, teamId]
    writeStored(followed.value)
  }

  return { ids, isFollowing, toggle }
}

export function resetFollowedTeamsForTests(): void {
  followed.value = null
}
