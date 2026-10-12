import { watch } from 'vue'

type AuthLike = { state: { user: { id: string } | null } }

/**
 * Reacciona a un cambio de identidad con la vista ya montada (FE-05): otra pestaña inicia sesión con
 * otra cuenta (mismo `localStorage`) o el token se refresca con otro usuario. Una vista que cargó
 * datos privados solo al montar seguiría mostrando los del usuario anterior bajo el JWT nuevo.
 *
 * - `onChange(userId)`: hay otro usuario (o volvió a haber uno): descarta el estado y recarga.
 * - `onSignedOut()`: ya no hay sesión; la vista debe soltar los datos y salir (normalmente a Inicio).
 *
 * No decide autorización: solo evita mostrar datos de otra identidad. La RLS sigue siendo la barrera.
 */
export function useIdentityWatch(auth: AuthLike, handlers: { onChange: (userId: string) => void; onSignedOut: () => void }): void {
  watch(() => auth.state.user?.id ?? null, (id, previous) => {
    if (id === previous) return
    if (id === null) handlers.onSignedOut()
    else handlers.onChange(id)
  })
}
