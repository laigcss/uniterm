// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ref, computed, nextTick } from 'vue'

const { focusPanelTerminalMock, tabStoreMock, mocks } = vi.hoisted(() => ({
  focusPanelTerminalMock: vi.fn(),
  tabStoreMock: { getActivePanelId: vi.fn((): any => null) },
  mocks: {
    aiStore: null as any,
    settingsStore: null as any,
    localStateStore: null as any,
  },
}))

vi.mock('./useFocusTerminal', () => ({
  focusPanelTerminal: focusPanelTerminalMock,
  installTerminalFocusRestore: vi.fn(() => () => {}),
}))
vi.mock('../stores/tabStore', () => ({ useTabStore: () => tabStoreMock }))
vi.mock('../stores/aiStore', async () => {
  const { reactive } = await import('vue')
  mocks.aiStore = reactive({ visible: false })
  return { useAIStore: () => mocks.aiStore }
})
vi.mock('../stores/settingsStore', async () => {
  const { reactive } = await import('vue')
  mocks.settingsStore = reactive({ settings: { keyboard: { zoomFontIn: { ctrl: true, key: '=' } } } })
  return { useSettingsStore: () => mocks.settingsStore }
})
vi.mock('../stores/localStateStore', async () => {
  const { reactive } = await import('vue')
  mocks.localStateStore = {
    state: reactive({ backgroundEnabled: false, backgroundImage: '', sidebarVisible: false }),
    update: vi.fn(),
  }
  return { useLocalStateStore: () => mocks.localStateStore }
})

import { useAppWatchers } from './useAppWatchers'

beforeEach(() => {
  vi.clearAllMocks()
  mocks.aiStore.visible = false
  mocks.settingsStore.settings.keyboard = { zoomFontIn: { ctrl: true, key: '=' } }
  mocks.localStateStore.state.backgroundEnabled = false
  mocks.localStateStore.state.backgroundImage = ''
  mocks.localStateStore.update.mockClear()
  focusPanelTerminalMock.mockClear()
  tabStoreMock.getActivePanelId.mockReturnValue(null)
})

function makeDeps() {
  const activeTab = computed(() => ({} as any))
  const showConnectionForm = ref(false)
  const sidebarVisible = ref(false)
  const rdpEmbedding = {
    onTabSwitch: vi.fn(),
    RDPHideForOverlay: vi.fn(),
    RDPShowForOverlay: vi.fn(),
    rdpResetTracking: vi.fn(),
  }
  const applyKeybindings = vi.fn()
  const loadBackgroundImage = vi.fn(async () => {})
  return { activeTab, showConnectionForm, sidebarVisible, rdpEmbedding, applyKeybindings, loadBackgroundImage }
}

describe('useAppWatchers — activeTab watch', () => {
  it('calls rdpEmbedding.onTabSwitch on tab change', async () => {
    const tab = ref<any>(null)
    const deps = makeDeps()
    deps.activeTab = computed(() => tab.value)
    useAppWatchers(deps)
    tab.value = { id: 't1', type: 'terminal' }
    await nextTick()
    expect(deps.rdpEmbedding.onTabSwitch).toHaveBeenCalled()
  })

  it('focuses the active panel terminal on tab switch', async () => {
    tabStoreMock.getActivePanelId.mockReturnValue('panel-1')
    const tab = ref<any>(null)
    const deps = makeDeps()
    deps.activeTab = computed(() => tab.value)
    useAppWatchers(deps)
    tab.value = { id: 't1' }
    await nextTick()
    await nextTick()
    expect(focusPanelTerminalMock).toHaveBeenCalledWith('panel-1')
  })

  it('does not focus when there is no active panel', async () => {
    tabStoreMock.getActivePanelId.mockReturnValue(null)
    const tab = ref<any>(null)
    const deps = makeDeps()
    deps.activeTab = computed(() => tab.value)
    useAppWatchers(deps)
    tab.value = { id: 't1' }
    await nextTick()
    expect(focusPanelTerminalMock).not.toHaveBeenCalled()
  })
})

describe('useAppWatchers — showConnectionForm watch', () => {
  it('hides RDP overlay when form opens', async () => {
    const deps = makeDeps()
    useAppWatchers(deps)
    deps.showConnectionForm.value = true
    await nextTick()
    expect(deps.rdpEmbedding.RDPHideForOverlay).toHaveBeenCalled()
  })

  it('shows RDP overlay when form closes', async () => {
    const deps = makeDeps()
    deps.showConnectionForm.value = true
    useAppWatchers(deps)
    deps.showConnectionForm.value = false
    await nextTick()
    expect(deps.rdpEmbedding.RDPShowForOverlay).toHaveBeenCalled()
  })
})

describe('useAppWatchers — sidebarVisible watch', () => {
  it('resets RDP tracking and persists sidebar state', async () => {
    const deps = makeDeps()
    useAppWatchers(deps)
    deps.sidebarVisible.value = true
    await nextTick()
    expect(deps.rdpEmbedding.rdpResetTracking).toHaveBeenCalled()
    expect(mocks.localStateStore.update).toHaveBeenCalledWith({ sidebarVisible: true })
  })
})

describe('useAppWatchers — aiStore.visible watch', () => {
  it('resets RDP tracking when AI visibility changes', async () => {
    const deps = makeDeps()
    useAppWatchers(deps)
    mocks.aiStore.visible = true
    await nextTick()
    expect(deps.rdpEmbedding.rdpResetTracking).toHaveBeenCalled()
  })
})

describe('useAppWatchers — keyboard settings watch', () => {
  it('reloads keybindings when keyboard settings change', async () => {
    const deps = makeDeps()
    useAppWatchers(deps)
    mocks.settingsStore.settings.keyboard = { zoomFontIn: { ctrl: false, key: 'x' } }
    await nextTick()
    expect(deps.applyKeybindings).toHaveBeenCalled()
  })
})

describe('useAppWatchers — background settings watch', () => {
  it('reloads background image when backgroundEnabled changes', async () => {
    const deps = makeDeps()
    useAppWatchers(deps)
    mocks.localStateStore.state.backgroundEnabled = true
    await nextTick()
    expect(deps.loadBackgroundImage).toHaveBeenCalled()
  })

  it('reloads background image when backgroundImage changes', async () => {
    const deps = makeDeps()
    useAppWatchers(deps)
    mocks.localStateStore.state.backgroundImage = 'new-bg.png'
    await nextTick()
    expect(deps.loadBackgroundImage).toHaveBeenCalled()
  })
})