// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ref } from 'vue'

vi.mock('../i18n', () => ({
  useI18n: () => ({ t: (k: string) => k, locale: ref('en') }),
}))

const { tabStoreMock, panelStoreMock, settingsStoreMock } = vi.hoisted(() => ({
  tabStoreMock: {
    tabs: [] as any[],
    setActiveTab: vi.fn(),
    createTab: vi.fn((type: string, title: string, panelId: string) => ({ id: 'tab-1', type, title, panelId })),
    isPanelAILocked: vi.fn(),
    addAILockedPanel: vi.fn(),
    removeAILockedPanel: vi.fn(),
  },
  panelStoreMock: {
    createPanel: vi.fn(() => ({ id: 'panel-1' })),
    updateTitle: vi.fn(),
    movePanelToTab: vi.fn(),
  },
  settingsStoreMock: {
    settings: {},
    activeCategory: '',
  },
}))

vi.mock('../stores/tabStore', () => ({ useTabStore: () => tabStoreMock }))
vi.mock('../stores/panelStore', () => ({ usePanelStore: () => panelStoreMock }))
vi.mock('../stores/settingsStore', () => ({ useSettingsStore: () => settingsStoreMock }))

import { useAppDialogs } from './useAppDialogs'

beforeEach(() => {
  vi.clearAllMocks()
  tabStoreMock.tabs = []
  settingsStoreMock.activeCategory = ''
})

function makeDeps() {
  return { sidebarRef: ref<any>(null) }
}

describe('useAppDialogs — openSettings', () => {
  it('activates existing settings tab when one already exists', () => {
    tabStoreMock.tabs = [{ id: 's-tab', type: 'settings' }]
    const dialogs = useAppDialogs(makeDeps())
    dialogs.openSettings()
    expect(tabStoreMock.setActiveTab).toHaveBeenCalledWith('s-tab')
    expect(panelStoreMock.createPanel).not.toHaveBeenCalled()
  })

  it('creates a new settings panel + tab when none exists', () => {
    tabStoreMock.tabs = [{ id: 'other', type: 'terminal' }]
    const dialogs = useAppDialogs(makeDeps())
    dialogs.openSettings()
    expect(panelStoreMock.createPanel).toHaveBeenCalledWith(null, 'settings')
    expect(panelStoreMock.updateTitle).toHaveBeenCalledWith('panel-1', 'settings.title')
    expect(tabStoreMock.createTab).toHaveBeenCalledWith('settings', 'settings.title', 'panel-1')
    expect(panelStoreMock.movePanelToTab).toHaveBeenCalledWith('panel-1', 'tab-1')
  })

  it('creates settings tab when tabs array is empty', () => {
    const dialogs = useAppDialogs(makeDeps())
    dialogs.openSettings()
    expect(panelStoreMock.createPanel).toHaveBeenCalled()
    expect(tabStoreMock.createTab).toHaveBeenCalled()
  })

  it('sets activeCategory when a category is provided', () => {
    const dialogs = useAppDialogs(makeDeps())
    dialogs.openSettings('ai')
    expect(settingsStoreMock.activeCategory).toBe('ai')
  })

  it('does not set activeCategory when no category is provided', () => {
    const dialogs = useAppDialogs(makeDeps())
    dialogs.openSettings()
    expect(settingsStoreMock.activeCategory).toBe('')
  })
})

describe('useAppDialogs — openNetscan / openLocalServices', () => {
  it('openNetscan sets netscanVisible to true', () => {
    const dialogs = useAppDialogs(makeDeps())
    expect(dialogs.netscanVisible.value).toBe(false)
    dialogs.openNetscan()
    expect(dialogs.netscanVisible.value).toBe(true)
  })

  it('openLocalServices sets localServicesVisible to true', () => {
    const dialogs = useAppDialogs(makeDeps())
    expect(dialogs.localServicesVisible.value).toBe(false)
    dialogs.openLocalServices()
    expect(dialogs.localServicesVisible.value).toBe(true)
  })
})

describe('useAppDialogs — group change handlers', () => {
  it('onChangeGroupFromStart calls sidebar openChangeGroupFor with [id]', () => {
    const sidebar = { openChangeGroupFor: vi.fn(), openChangeGroupForGroup: vi.fn() }
    const dialogs = useAppDialogs({ sidebarRef: ref(sidebar) })
    dialogs.onChangeGroupFromStart({ id: 'conn-1' })
    expect(sidebar.openChangeGroupFor).toHaveBeenCalledWith(['conn-1'])
  })

  it('onChangeGroupFromStartIds calls sidebar openChangeGroupFor with ids', () => {
    const sidebar = { openChangeGroupFor: vi.fn(), openChangeGroupForGroup: vi.fn() }
    const dialogs = useAppDialogs({ sidebarRef: ref(sidebar) })
    dialogs.onChangeGroupFromStartIds(['a', 'b'])
    expect(sidebar.openChangeGroupFor).toHaveBeenCalledWith(['a', 'b'])
  })

  it('onChangeGroupParentFromStart calls sidebar openChangeGroupForGroup', () => {
    const sidebar = { openChangeGroupFor: vi.fn(), openChangeGroupForGroup: vi.fn() }
    const dialogs = useAppDialogs({ sidebarRef: ref(sidebar) })
    dialogs.onChangeGroupParentFromStart('group-1')
    expect(sidebar.openChangeGroupForGroup).toHaveBeenCalledWith('group-1')
  })

  it('does not throw when sidebar ref is null', () => {
    const dialogs = useAppDialogs(makeDeps())
    expect(() => dialogs.onChangeGroupFromStart({ id: 'x' })).not.toThrow()
    expect(() => dialogs.onChangeGroupFromStartIds(['x'])).not.toThrow()
    expect(() => dialogs.onChangeGroupParentFromStart('x')).not.toThrow()
  })
})

describe('useAppDialogs — onToggleAiLock', () => {
  it('locks a panel when it is not currently locked', () => {
    tabStoreMock.isPanelAILocked.mockReturnValue(false)
    const dialogs = useAppDialogs(makeDeps())
    dialogs.onToggleAiLock('panel-1')
    expect(tabStoreMock.addAILockedPanel).toHaveBeenCalledWith('panel-1')
    expect(tabStoreMock.removeAILockedPanel).not.toHaveBeenCalled()
  })

  it('unlocks a panel when it is currently locked', () => {
    tabStoreMock.isPanelAILocked.mockReturnValue(true)
    const dialogs = useAppDialogs(makeDeps())
    dialogs.onToggleAiLock('panel-1')
    expect(tabStoreMock.removeAILockedPanel).toHaveBeenCalledWith('panel-1')
    expect(tabStoreMock.addAILockedPanel).not.toHaveBeenCalled()
  })
})