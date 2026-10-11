// "Recordar mi cuenta": con la casilla activa la sesión de Supabase Auth persiste en localStorage; con
// ella desactivada vive solo en sessionStorage (se pierde al cerrar la pestaña/ventana), útil en
// dispositivos compartidos. La preferencia es solo un booleano y no contiene credenciales.
const FLAG = 'sportleagues.remember-session'

function attempt<T>(action: () => T, fallback: T): T {
  try { return action() } catch { return fallback }
}

export function getRememberSession(): boolean {
  return attempt(() => localStorage.getItem(FLAG) !== 'false', true)
}

export function setRememberSession(remember: boolean): void {
  attempt(() => localStorage.setItem(FLAG, String(remember)), undefined)
}

export const authStorage = {
  getItem: (key: string): string | null => attempt(() => localStorage.getItem(key), null) ?? attempt(() => sessionStorage.getItem(key), null),
  setItem: (key: string, value: string): void => {
    const remember = getRememberSession()
    attempt(() => (remember ? localStorage : sessionStorage).setItem(key, value), undefined)
    attempt(() => (remember ? sessionStorage : localStorage).removeItem(key), undefined)
  },
  removeItem: (key: string): void => {
    attempt(() => localStorage.removeItem(key), undefined)
    attempt(() => sessionStorage.removeItem(key), undefined)
  },
}
