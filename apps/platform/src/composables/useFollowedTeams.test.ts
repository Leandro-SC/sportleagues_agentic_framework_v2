import { ref } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { resetFollowedTeamsForTests, useFollowedTeams } from './useFollowedTeams'

describe('useFollowedTeams', () => {
  beforeEach(() => {
    localStorage.clear()
    resetFollowedTeamsForTests()
  })

  afterEach(() => vi.restoreAllMocks())

  it('starts from defaults and persists toggles locally', () => {
    const followed = useFollowedTeams(() => ['a'])
    expect(followed.ids.value).toEqual(['a'])
    followed.toggle('b')
    followed.toggle('a')
    expect(followed.ids.value).toEqual(['b'])
    expect(JSON.parse(localStorage.getItem('sportleagues.followed-teams')!)).toEqual(['b'])
  })

  it('follows defaults that become available after mount until the user chooses', () => {
    const loaded = ref<string[]>([])
    const followed = useFollowedTeams(() => loaded.value)
    expect(followed.ids.value).toEqual([])
    loaded.value = ['a']
    expect(followed.ids.value).toEqual(['a'])
    followed.toggle('a')
    loaded.value = ['z']
    expect(followed.ids.value).toEqual([]) // la elección del usuario manda sobre los valores por defecto
  })

  it('prefers the stored list over defaults and ignores malformed values', () => {
    localStorage.setItem('sportleagues.followed-teams', JSON.stringify(['x', 3, null]))
    expect(useFollowedTeams(() => ['a']).ids.value).toEqual(['x'])
  })

  it('keeps working in memory when storage is unavailable', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked') })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('blocked') })
    const followed = useFollowedTeams(() => ['a'])
    followed.toggle('b')
    expect(followed.isFollowing('b')).toBe(true)
  })
})
