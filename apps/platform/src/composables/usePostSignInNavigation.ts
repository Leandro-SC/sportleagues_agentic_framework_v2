import { useRouter } from 'vue-router'
import { useAuth } from './useAuth'
import { useJoinPool } from './useJoinPool'

/** Destino común tras obtener sesión (contraseña, confirmación de correo o Google). */
export function usePostSignInNavigation() {
  const router = useRouter()
  const auth = useAuth()
  const joiner = useJoinPool()

  async function continueAfterSignIn(): Promise<void> {
    if (auth.state.recovery) { await router.replace({ name: 'reset-password' }); return }
    if (!(await auth.ensureLegalAcceptance())) { await router.replace({ name: 'legal-acceptance' }); return }
    if (!auth.state.profile) { await router.replace({ name: 'onboarding' }); return }
    const participant = await joiner.resumeIntent()
    await router.replace(participant ? { name: 'pool', params: { poolId: participant.pool_id } } : { name: 'home' })
  }

  return { continueAfterSignIn }
}
