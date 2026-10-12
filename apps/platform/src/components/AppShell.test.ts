import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import { createMemoryHistory, createRouter } from 'vue-router'
import { ADMIN_ROUTE_NAMES, isAdminRouteName, navModeForRoute } from '../lib/role-navigation'
import AppShell from './AppShell.vue'

const Blank = { template: '<div />' }
const names = ['home', 'matches', 'leagues', 'points', 'profile', 'pool', 'organizer-dashboard', 'admin', 'admin-fixture', 'admin-income']
const router = createRouter({ history: createMemoryHistory(), routes: names.map((name) => ({ path: name === 'home' ? '/' : name === 'pool' ? '/p/:id' : `/${name}`, name, component: Blank })) })

async function shellAt(path: string) {
  await router.push(path); await router.isReady()
  return mount(AppShell, { props: { variant: 'app', active: 'home' }, slots: { default: '<p>contenido</p>' }, global: { plugins: [router] } })
}

describe('role navigation', () => {
  it('only the organizer routes belong to the admin experience', () => {
    expect([...ADMIN_ROUTE_NAMES].sort()).toEqual(['admin', 'admin-fixture', 'admin-income', 'organizer-dashboard'])
    for (const name of ['home', 'profile', 'pool', 'leagues', 'matches', 'points', 'my-tickets', 'superadmin', undefined]) {
      expect(isAdminRouteName(name), String(name)).toBe(false)
      expect(navModeForRoute(name)).toBe('user')
    }
  })

  it('AppShell shows the organizer bar on /organizador and /admin/** routes and the participant bar elsewhere', async () => {
    for (const path of ['/organizer-dashboard', '/admin', '/admin-fixture', '/admin-income']) {
      const wrapper = await shellAt(path)
      expect(wrapper.find('nav[aria-label="Navegación del organizador"]').exists(), path).toBe(true)
      expect(wrapper.find('[data-test="exit-admin-mode"]').exists(), path).toBe(true)
    }
    for (const path of ['/', '/profile', '/leagues', '/p/abc', '/points']) {
      const wrapper = await shellAt(path)
      expect(wrapper.find('nav[aria-label="Navegación principal"]').exists(), path).toBe(true)
      expect(wrapper.find('[data-test="exit-admin-mode"]').exists(), path).toBe(false)
    }
  })
})
