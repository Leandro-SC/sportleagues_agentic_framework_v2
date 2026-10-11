import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import { createMemoryHistory, createRouter } from 'vue-router'
import BottomNav from './BottomNav.vue'

const Blank = { template: '<div />' }
const router = createRouter({
  history: createMemoryHistory(),
  routes: ['home', 'matches', 'leagues', 'profile'].map((name) => ({ path: name === 'home' ? '/' : `/${name}`, name, component: Blank })),
})

describe('BottomNav', () => {
  it('links all four sections and marks the active one for assistive tech', async () => {
    const wrapper = mount(BottomNav, { props: { active: 'leagues' }, global: { plugins: [router] } })
    await router.isReady()

    const links = wrapper.findAll('a')
    expect(links.map((link) => link.text())).toEqual(['Inicio', 'Partidos', 'Ligas', 'Perfil'])
    expect(links.map((link) => link.attributes('href'))).toEqual(['/', '/matches', '/leagues', '/profile'])
    expect(wrapper.findAll('[aria-current="page"]').map((link) => link.text())).toEqual(['Ligas'])
    expect(wrapper.find('button[disabled]').exists()).toBe(false)
  })
})
