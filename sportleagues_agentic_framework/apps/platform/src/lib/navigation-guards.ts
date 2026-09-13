const PROFILE_REQUIRED = new Set(['pool', 'profile'])

export function protectedRouteRedirect(routeName: string, authenticated: boolean, hasProfile: boolean): 'home' | 'onboarding' | null {
  if (!['onboarding', ...PROFILE_REQUIRED].includes(routeName)) return null
  if (!authenticated) return 'home'
  if (PROFILE_REQUIRED.has(routeName) && !hasProfile) return 'onboarding'
  return null
}
