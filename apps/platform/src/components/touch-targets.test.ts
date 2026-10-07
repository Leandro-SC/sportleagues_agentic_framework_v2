import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import { createMemoryHistory, createRouter } from 'vue-router'
import NotificationsButton from './NotificationsButton.vue'
import ScreenHeader from './ScreenHeader.vue'
import SearchField from './SearchField.vue'
import ShareMenuButton from './ShareMenuButton.vue'

const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/', name: 'home', component: { template: '<div />' } }] })

// Los iconos interactivos deben usar .icon-button (44×44 px) en lugar de paddings ad hoc.
describe('touch targets', () => {
  it('uses the 44px icon button for header actions', () => {
    const header = mount(ScreenHeader, { props: { title: 'Liga', back: true }, global: { plugins: [router] } })
    expect(header.get('button[aria-label="Volver"]').classes()).toContain('icon-button')
    expect(mount(NotificationsButton).get('button[aria-label="Notificaciones"]').classes()).toContain('icon-button')
    expect(mount(ShareMenuButton, { props: { title: 'Liga' } }).get('button[aria-label="Más opciones"]').classes()).toContain('icon-button')
  })

  it('gives the search clear button a 44px hit area and labels it', async () => {
    const wrapper = mount(SearchField, { props: { id: 's', label: 'Buscar', modelValue: 'abc' } })
    const clear = wrapper.get('button[aria-label="Limpiar búsqueda"]')
    expect(clear.classes()).toEqual(expect.arrayContaining(['h-11', 'w-11']))
    await clear.trigger('click')
    expect(wrapper.emitted('update:modelValue')?.at(-1)).toEqual([''])
  })
})
