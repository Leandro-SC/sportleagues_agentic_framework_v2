import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import PredictionMatchCard from './PredictionMatchCard.vue'
import type { FixtureItem } from '../composables/usePoolPlay'

const now = new Date('2026-10-12T12:00:00Z')
const base: FixtureItem = {
  poolMatchId: 'pm', matchId: 'm', roundId: 'r', roundName: 'Fecha 1', roundOrder: 1, homeName: 'Alianza', awayName: 'Cristal', homeShort: null, awayShort: null,
  startsAt: '2026-10-12T13:00:00Z', lockAt: '2026-10-12T12:45:00Z', status: 'scheduled', mine: null, result: null, points: null,
}
const mountCard = (item: Partial<FixtureItem> = {}, props: Record<string, unknown> = {}) =>
  mount(PredictionMatchCard, { props: { item: { ...base, ...item }, now, timezone: 'America/Lima', canPredict: true, saving: false, ...props } })

describe('PredictionMatchCard', () => {
  it('ofrece el formulario antes del cierre del servidor y emite el marcador validado', async () => {
    const wrapper = mountCard()
    expect(wrapper.text()).toContain('Cierra en 45 min')
    await wrapper.get('#ph-m').setValue('2'); await wrapper.get('#pa-m').setValue('1')
    await wrapper.get('form').trigger('submit')
    expect(wrapper.emitted('save')).toEqual([[2, 1]])
  })

  it('valida en cliente y no emite marcadores inválidos', async () => {
    const wrapper = mountCard()
    await wrapper.get('#ph-m').setValue('-1'); await wrapper.get('#pa-m').setValue('1')
    await wrapper.get('form').trigger('submit')
    expect(wrapper.emitted('save')).toBeUndefined()
    expect(wrapper.get('[role="alert"]').text()).toMatch(/enteros/)
  })

  it('tras el cierre del servidor no hay formulario y se muestra el pronóstico guardado', () => {
    const wrapper = mountCard({ lockAt: '2026-10-12T11:00:00Z', mine: { home: 1, away: 0 } })
    expect(wrapper.find('form').exists()).toBe(false)
    expect(wrapper.text()).toContain('Pronósticos cerrados')
    expect(wrapper.text()).toContain('Tu pronóstico: 1 - 0')
  })

  it('un partido cerrado sin pronóstico lo indica', () => {
    expect(mountCard({ lockAt: '2026-10-12T11:00:00Z' }).text()).toContain('No enviaste pronóstico')
  })

  it('quien no puede pronosticar (administrador/no inscrito) nunca ve el formulario', () => {
    expect(mountCard({}, { canPredict: false }).find('form').exists()).toBe(false)
  })

  it('un partido final muestra resultado y puntos', () => {
    const wrapper = mountCard({ status: 'final', result: { home: 2, away: 1, revision: 1 }, mine: { home: 2, away: 1 }, points: 5 })
    expect(wrapper.text()).toContain('2 - 1')
    expect(wrapper.text()).toContain('+5 pts')
    expect(wrapper.text()).toContain('Partido finalizado')
  })

  it('muestra el rechazo del servidor sin ocultarlo', () => {
    expect(mountCard({}, { message: 'El pronóstico ya está cerrado o no estás habilitado en esta quiniela.' }).get('[role="alert"]').text()).toMatch(/cerrado/)
  })

  describe('sugerencia estadística', () => {
    const suggestion = { homeGoals: 2, awayGoals: 1, pHome: 0.5, pDraw: 0.27, pAway: 0.23, rated: true, modelVersion: 'elo-poisson-v1', computedAt: '2026-10-12T10:00:00Z' }

    it('sin suggestAvailable no hay botón (función oculta)', () => {
      expect(mountCard().find('[data-test="suggest"]').exists()).toBe(false)
    })

    it('con suggestAvailable muestra el botón y emite suggest; el botón mide al menos 44 px', async () => {
      const wrapper = mountCard({}, { suggestAvailable: true })
      const button = wrapper.get('[data-test="suggest"]')
      expect(button.classes()).toContain('min-h-11')
      await button.trigger('click')
      expect(wrapper.emitted('suggest')).toHaveLength(1)
      expect(wrapper.emitted('save')).toBeUndefined()
    })

    it('rellena el formulario con la sugerencia pero NO guarda; muestra probabilidades y aviso de no-certeza', async () => {
      const wrapper = mountCard({}, { suggestAvailable: true })
      await wrapper.setProps({ suggestion })
      expect((wrapper.get('#ph-m').element as HTMLInputElement).value).toBe('2')
      expect((wrapper.get('#pa-m').element as HTMLInputElement).value).toBe('1')
      expect(wrapper.emitted('save')).toBeUndefined()
      const box = wrapper.get('[data-test="suggestion"]').text()
      expect(box).toContain('Local 50%')
      expect(box).toContain('no está guardada')
      expect(box).toMatch(/no es una certeza ni una recomendación de apuesta/)
    })

    it('avisa cuando los equipos no tienen historial (rated=false)', async () => {
      const wrapper = mountCard({}, { suggestAvailable: true, suggestion: { ...suggestion, rated: false } })
      expect(wrapper.get('[data-test="suggestion"]').text()).toMatch(/valores por defecto/)
    })

    it('muestra el error de la sugerencia como alerta', () => {
      const wrapper = mountCard({}, { suggestAvailable: true, suggestionMessage: 'Este partido ya cerró: no hay sugerencia disponible.' })
      expect(wrapper.get('[data-test="suggestion-error"]').text()).toMatch(/cerró/)
    })

    it('tras el cierre del servidor o sin permiso de pronosticar no se ofrece sugerencia', () => {
      expect(mountCard({ lockAt: '2026-10-12T11:00:00Z' }, { suggestAvailable: true }).find('[data-test="suggest"]').exists()).toBe(false)
      expect(mountCard({}, { suggestAvailable: true, canPredict: false }).find('[data-test="suggest"]').exists()).toBe(false)
    })
  })
})
