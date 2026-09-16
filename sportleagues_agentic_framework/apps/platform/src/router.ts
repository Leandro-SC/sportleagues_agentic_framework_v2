import { ref } from 'vue'
import { createRouter, createWebHistory } from 'vue-router'
import AuthCallbackView from './views/AuthCallbackView.vue'
import HomeView from './views/HomeView.vue'
import JoinView from './views/JoinView.vue'
import OnboardingView from './views/OnboardingView.vue'
import PoolView from './views/PoolView.vue'
import ProfileView from './views/ProfileView.vue'
import AdminView from './views/AdminView.vue'
import SuperadminView from './views/SuperadminView.vue'
import { useAuth } from './composables/useAuth'
import { useSuperadmin } from './composables/useSuperadmin'
import { useTenantAdminAccess } from './composables/useTenantAdminAccess'
import { platformAdminRedirect, protectedRouteRedirect, tenantAdminRedirect } from './lib/navigation-guards'

const GUARDED_ROUTES = ['onboarding', 'pool', 'profile']

// Set while `/admin` or `/superadmin` are resolving their role check, so App.vue can show a
// sober loading state instead of the previous route's content (or nothing) during that gap —
// there is otherwise no visual feedback while the async guard below awaits a network round trip.
export const routeAuthCheck = ref<'admin' | 'superadmin' | null>(null)

export const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', name: 'home', component: HomeView },
    { path: '/auth/callback', name: 'auth-callback', component: AuthCallbackView },
    { path: '/onboarding', name: 'onboarding', component: OnboardingView },
    { path: '/j/:code', name: 'join', component: JoinView, props: true },
    { path: '/p/:poolId', name: 'pool', component: PoolView, props: true },
    { path: '/perfil', name: 'profile', component: ProfileView },
    { path: '/admin', name: 'admin', component: AdminView },
    { path: '/superadmin', name: 'superadmin', component: SuperadminView },
  ],
})

// `/superadmin` is a separate global authorization boundary from `/admin` (ADR-008): it is
// gated by the platform-wide `is_platform_admin()` RPC, never by tenant_role or tenant
// membership, and it never falls back to `/admin` on rejection to avoid mixing the two
// contexts. This guard blocks navigation until the check resolves, so the view never mounts
// (and therefore never flashes) for a caller who is not a platform admin. As with every guard
// here, this is UX only — RLS/RPC remain the real authorization boundary.
router.beforeEach(async (to) => {
  if (String(to.name) === 'superadmin') {
    routeAuthCheck.value = 'superadmin'
    try {
      const auth = useAuth()
      if (auth.state.loading) await auth.restore()
      const allowed = auth.isAuthenticated.value && (await useSuperadmin().checkAccess())
      const redirect = platformAdminRedirect(auth.isAuthenticated.value, allowed)
      return redirect ? { name: redirect } : true
    } finally {
      routeAuthCheck.value = null
    }
  }

  // `/admin` mirrors the same shape (block on an async role check, never flash content, never
  // fall through to `/superadmin`), but the check itself — useTenantAdminAccess — is entirely
  // independent of is_platform_admin(): a platform admin with no tenant membership does not get
  // in here, and this branch has no way to even ask about that flag (ADR-008 section 9).
  if (String(to.name) === 'admin') {
    routeAuthCheck.value = 'admin'
    try {
      const auth = useAuth()
      if (auth.state.loading) await auth.restore()
      const allowed = Boolean(auth.state.user) && (await useTenantAdminAccess().checkAccess(auth.state.user!.id))
      const redirect = tenantAdminRedirect(auth.isAuthenticated.value, allowed)
      return redirect ? { name: redirect } : true
    } finally {
      routeAuthCheck.value = null
    }
  }

  if (!GUARDED_ROUTES.includes(String(to.name))) return true
  const auth = useAuth()
  if (auth.state.loading) await auth.restore()
  const redirect = protectedRouteRedirect(String(to.name), auth.isAuthenticated.value, Boolean(auth.state.profile))
  if (redirect) return { name: redirect }
  return true
})
