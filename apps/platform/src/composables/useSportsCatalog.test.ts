import { flushPromises } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { resetSportsCatalogForTests, useSportsCatalog } from './useSportsCatalog'

describe('useSportsCatalog', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
    resetSportsCatalogForTests()
  })

  describe('with preview data enabled', () => {
    beforeEach(() => {
      vi.stubEnv('VITE_PREVIEW_DATA', 'true')
      resetSportsCatalogForTests()
    })

    it('starts loading, then exposes the lazily imported example catalog', async () => {
      const sports = useSportsCatalog()
      expect(sports.preview).toBe(true)
      expect(sports.loading.value).toBe(true)
      expect(sports.catalog.value.matches).toEqual([])

      await flushPromises()
      expect(sports.loading.value).toBe(false)
      expect(sports.failed.value).toBe(false)
      expect(sports.catalog.value.matches.length).toBeGreaterThan(0)
      expect(sports.team('america')?.name).toBe('América')
      expect(sports.competition('liga-mx')?.name).toBe('Liga MX CL 2020')
      expect(sports.teamName('unknown-id')).toBe('unknown-id')
    })

    it('loads the dataset once and shares it between consumers', async () => {
      const first = useSportsCatalog()
      const second = useSportsCatalog()
      await flushPromises()
      expect(second.catalog.value).toBe(first.catalog.value)
    })
  })

  describe('with preview data disabled (QA/production behaviour)', () => {
    beforeEach(() => {
      vi.stubEnv('VITE_PREVIEW_DATA', 'false')
      resetSportsCatalogForTests()
    })

    it('never loads example data and is immediately ready with an empty catalog', async () => {
      const sports = useSportsCatalog()
      await flushPromises()
      expect(sports.preview).toBe(false)
      expect(sports.loading.value).toBe(false)
      expect(sports.catalog.value.competitions).toEqual([])
      expect(sports.catalog.value.matches).toEqual([])
      expect(sports.catalog.value.communityLeagues).toEqual([])
      expect(sports.catalog.value.activity).toEqual([])
      expect(sports.catalog.value.profileStats).toBeNull()
    })
  })
})
