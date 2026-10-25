import { ref, type Component } from 'vue'
import { createRouter, createWebHistory, type RouteRecordRaw, type RouterHistory } from 'vue-router'
import AuthCallbackView from './views/AuthCallbackView.vue'
import HomeView from './views/HomeView.vue'
import { useAuth } from './composables/useAuth'
import { useSuperadmin } from './composables/useSuperadmin'
import { useTenantAdminAccess } from './composables/useTenantAdminAccess'
import { isSuperadminUiEnabled } from './lib/feature-flags'
import { platformAdminRedirect, protectedRouteRedirect, PUBLIC_ROUTE_NAMES, SELF_GUARDED_ROUTE_NAMES, tenantAdminRedirect } from './lib/navigation-guards'
import { isAdminRouteName } from './lib/role-navigation'

// Set while `/admin` or `/superadmin` are resolving their role check, so App.vue can show a
// sober loading state instead of the previous route's content (or nothing) during that gap —
// there is otherwise no visual feedback while the async guard below awaits a network round trip.
export const routeAuthCheck = ref<'admin' | 'superadmin' | null>(null)

type SuperadminViewLoader = () => Promise<Component>

// ADR-018: el cargador por defecto solo existe en un build con VITE_ENABLE_SUPERADMIN_UI=true. En
// cualquier otro build Vite reemplaza la variable por una constante, la rama del `import()` es
// código muerto y la vista de Superadmin (con su shell) no entra en el bundle de la app pública.
const loadSuperadminView: SuperadminViewLoader = () =>
  import.meta.env.VITE_ENABLE_SUPERADMIN_UI === 'true'
    ? import('./views/SuperadminView.vue').then((module) => module.default)
    : Promise.reject(new Error('La UI de Superadmin no está habilitada en este build.'))

export type RouterOptions = {
  // false (por defecto en cualquier build): `/superadmin` no existe y cae en el comodín hacia home.
  superadminUi: boolean
  history?: RouterHistory
  // Solo para pruebas: sustituye el cargador de la vista cuando `superadminUi` es true.
  superadminView?: SuperadminViewLoader
}

export function buildRoutes({ superadminUi, superadminView = loadSuperadminView }: Pick<RouterOptions, 'superadminUi' | 'superadminView'>): RouteRecordRaw[] {
  const routes: RouteRecordRaw[] = [
    { path: '/', name: 'home', component: HomeView },
    { path: '/auth/callback', name: 'auth-callback', component: AuthCallbackView },
    { path: '/auth/reset', name: 'reset-password', component: () => import('./views/ResetPasswordView.vue') },
    { path: '/privacidad', name: 'privacy', component: () => import('./views/LegalView.vue'), props: { doc: 'privacy' } },
    { path: '/terminos', name: 'terms', component: () => import('./views/LegalView.vue'), props: { doc: 'terms' } },
    { path: '/onboarding', name: 'onboarding', component: () => import('./views/OnboardingView.vue') },
    { path: '/j/:code', name: 'join', component: () => import('./views/JoinView.vue'), props: true },
    { path: '/p/:poolId', name: 'pool', component: () => import('./views/PoolView.vue'), props: true },
    { path: '/perfil', name: 'profile', component: () => import('./views/ProfileView.vue') },
    { path: '/mis-puntos', name: 'points', component: () => import('./views/PointsView.vue') },
    { path: '/mis-tickets', name: 'my-tickets', component: () => import('./views/MyTicketsView.vue') },
    { path: '/organizador', name: 'organizer-dashboard', component: () => import('./views/OrganizerDashboardView.vue') },
    { path: '/admin/ingresos', name: 'admin-income', component: () => import('./views/AdminIncomeView.vue') },
    { path: '/admin/parrilla', name: 'admin-fixture', component: () => import('./views/AdminFixtureView.vue') },
    // Solo Inicio y el callback de auth son eager (entrada de la app); el resto carga bajo demanda
    // para mantener ligera la carga inicial en móvil.
    // Pantallas del rediseño (pre-acceptance). Las que dependen de partidos usan datos de vista
    // previa solo cuando isPreviewDataEnabled() lo permite; ver lib/preview-mode.ts.
    { path: '/partidos', name: 'matches', component: () => import('./views/MatchesView.vue') },
    { path: '/ligas', name: 'leagues', component: () => import('./views/LeaguesView.vue') },
    { path: '/ligas/unirme', name: 'league-join', component: () => import('./views/JoinLeagueView.vue') },
    { path: '/ligas/:leagueId', name: 'league', component: () => import('./views/LeagueView.vue') },
    { path: '/equipos/:teamId', name: 'team', component: () => import('./views/TeamView.vue') },
    { path: '/admin', name: 'admin', component: () => import('./views/AdminView.vue') },
  ]
  if (superadminUi) routes.push({ path: '/superadmin', name: 'superadmin', component: superadminView })
  // Cualquier ruta desconocida (incluida `/superadmin` con la bandera apagada) vuelve a home sin
  // ejecutar ningún guard de autorización.
  routes.push({ path: '/:pathMatch(.*)*', name: 'not-found', redirect: { name: 'home' } })
  return routes
}

export function createAppRouter(options: RouterOptions) {
  const appRouter = createRouter({ history: options.history ?? createWebHistory(), routes: buildRoutes(options) })

  // `/superadmin` is a separate global authorization boundary from `/admin` (ADR-008): it is
  // gated by the platform-wide `is_platform_admin()` RPC, never by tenant_role or tenant
  // membership, and it never falls back to `/admin` on rejection to avoid mixing the two
  // contexts. This guard blocks navigation until the check resolves, so the view never mounts
  // (and therefore never flashes) for a caller who is not a platform admin. As with every guard
  // here, this is UX only — RLS/RPC remain the real authorization boundary. Con la bandera
  // apagada (ADR-018) la ruta no existe y este guard ni siquiera se instala.
  if (options.superadminUi) {
    appRouter.beforeEach(async (to) => {
      if (String(to.name) !== 'superadmin') return true
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
    })
  }

  appRouter.beforeEach(async (to) => {
    // `/admin` mirrors the same shape (block on an async role check, never flash content, never
    // fall through to `/superadmin`), but the check itself — useTenantAdminAccess — is entirely
    // independent of is_platform_admin(): a platform admin with no tenant membership does not get
    // in here, and this branch has no way to even ask about that flag (ADR-008 section 9).
    if (isAdminRouteName(String(to.name))) {
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

    // Falla cerrado (FE-04): solo las rutas públicas explícitas y las de guard propio pasan sin sesión; una ruta nueva
    // no clasificada exige sesión y perfil. La decisión vive en `protectedRouteRedirect` (lib/navigation-guards.ts).
    const name = String(to.name)
    if (PUBLIC_ROUTE_NAMES.has(name) || SELF_GUARDED_ROUTE_NAMES.has(name)) return true
    const auth = useAuth()
    if (auth.state.loading) await auth.restore()
    const redirect = protectedRouteRedirect(String(to.name), auth.isAuthenticated.value, Boolean(auth.state.profile))
    if (redirect) return { name: redirect }
    return true
  })

  return appRouter
}

export const router = createAppRouter({ superadminUi: isSuperadminUiEnabled() })
