import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import { createMemoryHistory, createRouter } from 'vue-router'
import BottomNav from './BottomNav.vue'

const Blank = { template: '<div />' }
const router = createRouter({
  history: createMemoryHistory(),
  routes: ['home', 'matches', 'leagues', 'points', 'profile', 'organizer-dashboard', 'admin', 'admin-fixture', 'admin-income'].map((name) => ({ path: name === 'home' ? '/' : `/${name}`, name, component: Blank })),
})

describe('BottomNav', () => {
  it('links all five sections and marks the active one for assistive tech', async () => {
    const wrapper = mount(BottomNav, { props: { active: 'leagues' }, global: { plugins: [router] } })
    await router.isReady()

    const links = wrapper.findAll('a')
    expect(links.map((link) => link.text())).toEqual(['Inicio', 'Partidos', 'Ligas', 'Puntos', 'Perfil'])
    expect(links.map((link) => link.attributes('href'))).toEqual(['/', '/matches', '/leagues', '/points', '/profile'])
    expect(wrapper.findAll('[aria-current="page"]').map((link) => link.text())).toEqual(['Ligas'])
    expect(wrapper.find('button[disabled]').exists()).toBe(false)
  })

  it('the participant bar never links to organizer screens', () => {
    const wrapper = mount(BottomNav, { props: { active: 'home' }, global: { plugins: [router] } })
    const hrefs = wrapper.findAll('a').map((link) => link.attributes('href'))
    expect(hrefs.some((href) => /admin|organizer/.test(href ?? ''))).toBe(false)
    expect(wrapper.find('[data-test="exit-admin-mode"]').exists()).toBe(false)
  })

  it('shows the organizer variant (5 options, existing destinations) with a clear exit to participant mode', async () => {
    const wrapper = mount(BottomNav, { props: { active: 'finance', mode: 'admin' }, global: { plugins: [router] } })
    await router.isReady()

    expect(wrapper.get('nav').attributes('aria-label')).toBe('Navegación del organizador')
    const items = wrapper.findAll('a:not([data-test="exit-admin-mode"])')
    expect(items.map((link) => link.text())).toEqual(['Panel', 'Quinielas', 'Parrilla', 'Finanzas', 'Perfil'])
    expect(items).toHaveLength(5) // criterio móvil: barra inferior de a lo sumo 5 opciones
    expect(items.map((link) => link.attributes('href'))).toEqual(['/organizer-dashboard', '/admin', '/admin-fixture', '/admin-income', '/profile'])
    expect(items.filter((link) => link.attributes('aria-current') === 'page').map((link) => link.text())).toEqual(['Finanzas'])

    const exit = wrapper.get('[data-test="exit-admin-mode"]')
    expect(exit.text()).toContain('Modo participante')
    expect(exit.attributes('href')).toBe('/')
    expect(exit.classes()).toContain('min-h-11')
    expect(wrapper.find('button[disabled]').exists()).toBe(false)
  })

  it('the organizer bar offers no global (platform) operations', () => {
    const wrapper = mount(BottomNav, { props: { active: 'panel', mode: 'admin' }, global: { plugins: [router] } })
    expect(wrapper.text()).not.toMatch(/superadmin|plataforma|global/i)
    expect(wrapper.findAll('a').every((link) => !/superadmin/.test(link.attributes('href') ?? ''))).toBe(true)
  })
})
