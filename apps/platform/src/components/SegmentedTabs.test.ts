import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import SegmentedTabs from './SegmentedTabs.vue'

const options = [
  { value: 'today', label: 'Hoy' },
  { value: 'tomorrow', label: 'Mañana' },
  { value: 'week', label: 'Esta semana' },
]

function mountTabs(modelValue = 'today') {
  return mount(SegmentedTabs, {
    props: { options, label: 'Día', modelValue, 'onUpdate:modelValue': (value: string) => wrapper.setProps({ modelValue: value }) },
    attachTo: document.body,
  })
}
let wrapper: ReturnType<typeof mountTabs>

describe('SegmentedTabs', () => {
  it('exposes a labelled tablist with one selected, focusable tab', () => {
    wrapper = mountTabs('tomorrow')
    expect(wrapper.get('[role="tablist"]').attributes('aria-label')).toBe('Día')
    const tabs = wrapper.findAll('[role="tab"]')
    expect(tabs.map((tab) => tab.attributes('aria-selected'))).toEqual(['false', 'true', 'false'])
    expect(tabs.map((tab) => tab.attributes('tabindex'))).toEqual(['-1', '0', '-1'])
    wrapper.unmount()
  })

  it('selects on click and moves with arrow keys, wrapping around', async () => {
    wrapper = mountTabs('today')
    await wrapper.findAll('[role="tab"]')[2]!.trigger('click')
    expect(wrapper.props('modelValue')).toBe('week')

    await wrapper.findAll('[role="tab"]')[2]!.trigger('keydown', { key: 'ArrowRight' })
    expect(wrapper.props('modelValue')).toBe('today')
    expect(document.activeElement?.textContent).toBe('Hoy')

    await wrapper.findAll('[role="tab"]')[0]!.trigger('keydown', { key: 'ArrowLeft' })
    expect(wrapper.props('modelValue')).toBe('week')
    wrapper.unmount()
  })
})
