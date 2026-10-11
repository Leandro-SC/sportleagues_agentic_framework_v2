import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import CatalogBoundary from './CatalogBoundary.vue'

const slots = { default: '<p>contenido</p>' }

describe('CatalogBoundary', () => {
  it('shows an accessible skeleton while loading and hides the content', () => {
    const wrapper = mount(CatalogBoundary, { props: { loading: true, rows: 2 }, slots })
    expect(wrapper.get('[role="status"]').attributes('aria-label')).toBe('Cargando')
    expect(wrapper.findAll('.skeleton-shimmer')).toHaveLength(2)
    expect(wrapper.text()).not.toContain('contenido')
  })

  it('shows an error with retry and emits retry', async () => {
    const wrapper = mount(CatalogBoundary, { props: { loading: false, failed: true }, slots })
    expect(wrapper.get('[role="alert"]').text()).toContain('No pudimos cargar esta sección')
    await wrapper.get('button').trigger('click')
    expect(wrapper.emitted('retry')).toHaveLength(1)
    expect(wrapper.text()).not.toContain('contenido')
  })

  it('renders the content when ready', () => {
    const wrapper = mount(CatalogBoundary, { props: { loading: false }, slots })
    expect(wrapper.text()).toContain('contenido')
    expect(wrapper.find('[role="status"]').exists()).toBe(false)
  })
})
