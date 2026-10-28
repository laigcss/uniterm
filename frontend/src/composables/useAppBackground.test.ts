// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'

const { getBackgroundImageMock } = vi.hoisted(() => ({
  getBackgroundImageMock: vi.fn(),
}))

vi.mock('../../bindings/github.com/ys-ll/uniterm/app', () => ({
  GetBackgroundImage: getBackgroundImageMock,
  LoadLocalState: vi.fn(async () => ({})),
  SaveLocalState: vi.fn(async () => {}),
}))

import { useAppBackground } from './useAppBackground'
import { useLocalStateStore } from '../stores/localStateStore'

beforeEach(() => {
  setActivePinia(createPinia())
  getBackgroundImageMock.mockReset()
})

describe('useAppBackground — loadBackgroundImage', () => {
  it('loads the image when enabled and a path is set', async () => {
    getBackgroundImageMock.mockResolvedValue('data:image/png;base64,xxx')
    const store = useLocalStateStore()
    await store.update({ backgroundEnabled: true, backgroundImage: 'bg.png' })
    const bg = useAppBackground()
    await bg.loadBackgroundImage()
    expect(getBackgroundImageMock).toHaveBeenCalledWith('bg.png')
    expect(bg.bgDataUrl.value).toBe('data:image/png;base64,xxx')
  })

  it('clears the data url when background is disabled', async () => {
    const store = useLocalStateStore()
    await store.update({ backgroundEnabled: false, backgroundImage: 'bg.png' })
    const bg = useAppBackground()
    bg.bgDataUrl.value = 'old-data'
    await bg.loadBackgroundImage()
    expect(getBackgroundImageMock).not.toHaveBeenCalled()
    expect(bg.bgDataUrl.value).toBe('')
  })

  it('clears the data url when no image path is set', async () => {
    const store = useLocalStateStore()
    await store.update({ backgroundEnabled: true, backgroundImage: '' })
    const bg = useAppBackground()
    await bg.loadBackgroundImage()
    expect(getBackgroundImageMock).not.toHaveBeenCalled()
    expect(bg.bgDataUrl.value).toBe('')
  })

  it('clears the data url when GetBackgroundImage throws', async () => {
    getBackgroundImageMock.mockRejectedValue(new Error('read failed'))
    const store = useLocalStateStore()
    await store.update({ backgroundEnabled: true, backgroundImage: 'bg.png' })
    const bg = useAppBackground()
    bg.bgDataUrl.value = 'old-data'
    await bg.loadBackgroundImage()
    expect(bg.bgDataUrl.value).toBe('')
  })
})

describe('useAppBackground — bgVisible', () => {
  it('is false by default (disabled, no data)', () => {
    const bg = useAppBackground()
    expect(bg.bgVisible.value).toBe(false)
  })

  it('becomes true after loading with enabled + data', async () => {
    getBackgroundImageMock.mockResolvedValue('data:url')
    const store = useLocalStateStore()
    await store.update({ backgroundEnabled: true, backgroundImage: 'bg.png' })
    const bg = useAppBackground()
    await bg.loadBackgroundImage()
    expect(bg.bgVisible.value).toBe(true)
  })

  it('becomes false when disabled even if data url is set', async () => {
    getBackgroundImageMock.mockResolvedValue('data:url')
    const store = useLocalStateStore()
    await store.update({ backgroundEnabled: true, backgroundImage: 'bg.png' })
    const bg = useAppBackground()
    await bg.loadBackgroundImage()
    expect(bg.bgVisible.value).toBe(true)
    await store.update({ backgroundEnabled: false })
    expect(bg.bgVisible.value).toBe(false)
  })
})

describe('useAppBackground — bgStyle', () => {
  function setupBg(overrides: Record<string, any> = {}) {
    const store = useLocalStateStore()
    return store.update({
      backgroundEnabled: true,
      backgroundImage: 'bg.png',
      backgroundFit: 'cover',
      backgroundBlur: 0,
      backgroundOpacity: 60,
      ...overrides,
    }).then(() => {
      const bg = useAppBackground()
      bg.bgDataUrl.value = 'data:url'
      return bg
    })
  }

  it('produces cover styles by default', async () => {
    const bg = await setupBg()
    const s = bg.bgStyle.value
    expect(s.backgroundImage).toBe('url("data:url")')
    expect(s.backgroundSize).toBe('cover')
    expect(s.backgroundPosition).toBe('center')
    expect(s.backgroundRepeat).toBe('no-repeat')
    expect(s.filter).toBe('none')
    expect(s['--bg-mask-opacity']).toBe('0.6')
  })

  it('produces contain styles', async () => {
    const bg = await setupBg({ backgroundFit: 'contain' })
    const s = bg.bgStyle.value
    expect(s.backgroundSize).toBe('contain')
    expect(s.backgroundPosition).toBe('center')
    expect(s.backgroundRepeat).toBe('no-repeat')
  })

  it('produces center styles', async () => {
    const bg = await setupBg({ backgroundFit: 'center' })
    const s = bg.bgStyle.value
    expect(s.backgroundSize).toBe('auto')
    expect(s.backgroundPosition).toBe('center')
    expect(s.backgroundRepeat).toBe('no-repeat')
  })

  it('falls back to repeat for unknown fit', async () => {
    const bg = await setupBg({ backgroundFit: 'tile' })
    const s = bg.bgStyle.value
    expect(s.backgroundSize).toBe('auto')
    expect(s.backgroundRepeat).toBe('repeat')
  })

  it('applies blur filter when backgroundBlur > 0', async () => {
    const bg = await setupBg({ backgroundBlur: 5 })
    expect(bg.bgStyle.value.filter).toBe('blur(5px)')
  })

  it('uses default fit "cover" when backgroundFit is empty', async () => {
    const bg = await setupBg({ backgroundFit: '' })
    const s = bg.bgStyle.value
    expect(s.backgroundSize).toBe('cover')
  })

  it('computes mask opacity from backgroundOpacity', async () => {
    const bg = await setupBg({ backgroundOpacity: 80 })
    expect(bg.bgStyle.value['--bg-mask-opacity']).toBe('0.8')
  })

  it('defaults opacity to 60 when undefined', async () => {
    const store = useLocalStateStore()
    await store.update({
      backgroundEnabled: true,
      backgroundImage: 'bg.png',
      backgroundFit: 'cover',
      backgroundBlur: 0,
      backgroundOpacity: undefined as any,
    })
    const bg = useAppBackground()
    bg.bgDataUrl.value = 'data:url'
    expect(bg.bgStyle.value['--bg-mask-opacity']).toBe('0.6')
  })
})