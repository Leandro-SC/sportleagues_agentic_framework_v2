import { createRouter, createWebHistory } from 'vue-router'
import AuthCallbackView from './views/AuthCallbackView.vue'
import HomeView from './views/HomeView.vue'
import JoinView from './views/JoinView.vue'
import OnboardingView from './views/OnboardingView.vue'
import PoolView from './views/PoolView.vue'
import ProfileView from './views/ProfileView.vue'
import { useAuth } from './composables/useAuth'
import { protectedRouteRedirect } from './lib/navigation-guards'

const GUARDED_ROUTES = ['onboarding', 'pool', 'profile']

export const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', name: 'home', component: HomeView },
    { path: '/auth/callback', name: 'auth-callback', component: AuthCallbackView },
    { path: '/onboarding', name: 'onboarding', component: OnboardingView },
    { path: '/j/:code', name: 'join', component: JoinView, props: true },
    { path: '/p/:poolId', name: 'pool', component: PoolView, props: true },
    { path: '/perfil', name: 'profile', component: ProfileView },
  ],
})

router.beforeEach(async (to) => {
  if (!GUARDED_ROUTES.includes(String(to.name))) return true
  const auth = useAuth()
  if (auth.state.loading) await auth.restore()
  const redirect = protectedRouteRedirect(String(to.name), auth.isAuthenticated.value, Boolean(auth.state.profile))
  if (redirect) return { name: redirect }
  return true
})
