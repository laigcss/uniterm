import { ref, nextTick, onMounted, onUnmounted } from 'vue'
import type { Ref } from 'vue'
import { useSettingsStore } from '../stores/settingsStore'
import { ClipboardGetText, ClipboardSetText } from '../../wailsjs/runtime/runtime'

export interface UseTerminalMenuOptions {
  getSelection: () => string
  onPaste: (text: string) => Promise<void> | void
  onAskAI?: (text: string) => void
  /** The rendered menu element, used to measure its real size so it can be
   *  clamped inside the viewport instead of relying on an estimated height. */
  menuElement?: Ref<HTMLElement | null>
}

export interface UseTerminalMenuReturn {
  menuVisible: Ref<boolean>
  menuStyle: Ref<{ left: string; top: string }>
  hasSelection: Ref<boolean>
  onContextMenu: (e: MouseEvent) => void
  closeMenu: () => void
  copySelection: () => void
  copyAndPaste: () => Promise<void>
  pasteFromClipboard: () => Promise<void>
  askAI: () => void
}

export function useTerminalMenu(options: UseTerminalMenuOptions): UseTerminalMenuReturn {
  const settingsStore = useSettingsStore()

  const menuVisible = ref(false)
  const menuStyle = ref({ left: '0px', top: '0px' })
  const hasSelection = ref(false)

  function closeMenu() {
    menuVisible.value = false
  }

  function onContextMenu(e: MouseEvent) {
    const rightClickAction = settingsStore.settings.terminal.rightClickAction
    if (rightClickAction === 'paste') {
      e.preventDefault()
      e.stopPropagation()
      pasteFromClipboard()
      return
    }
    e.preventDefault()
    e.stopPropagation()
    window.dispatchEvent(new CustomEvent('global:close-context-menus'))
    hasSelection.value = !!options.getSelection()

    const menuElement = options.menuElement?.value
    if (menuElement) {
      // Show at the cursor first, then clamp to the viewport on nextTick once
      // Vue has laid the menu out so we can read its real width/height.
      menuStyle.value = { left: e.clientX + 'px', top: e.clientY + 'px' }
      menuVisible.value = true
      nextTick(() => {
        if (!menuVisible.value) return
        menuStyle.value = fitMenuToViewport(e.clientX, e.clientY, menuElement.offsetWidth, menuElement.offsetHeight)
      })
    } else {
      // Fallback when no element is provided (e.g. isolated unit tests).
      menuStyle.value = fitMenuToViewport(e.clientX, e.clientY, 120, 140)
      menuVisible.value = true
    }
  }

  function fitMenuToViewport(x: number, y: number, menuW: number, menuH: number) {
    const margin = 4
    let left = x
    let top = y
    if (left + menuW + margin > window.innerWidth) left = window.innerWidth - menuW - margin
    if (top + menuH + margin > window.innerHeight) top = window.innerHeight - menuH - margin
    if (left < margin) left = margin
    if (top < margin) top = margin
    return { left: left + 'px', top: top + 'px' }
  }

  // Write to the OS clipboard. Wails' ClipboardSetText resolves false (it
  // does not reject) on focus loss / AppKit glitches, so a false return has
  // to fall through to the browser API rather than being treated as done.
  // browserWriter is also the standalone path when Wails is absent (dev
  // outside the runtime).
  type ClipboardWriter = (text: string) => Promise<boolean>
  const browserWriter: ClipboardWriter = async (text) => {
    try { await navigator.clipboard.writeText(text); return true } catch { return false }
  }
  const wailsWriter: ClipboardWriter = async (text) => {
    let ok = false
    try {
      ok = await ClipboardSetText(text)
    } catch {
      ok = false
    }
    return ok || browserWriter(text)
  }
  const writeClipboard: ClipboardWriter = typeof ClipboardSetText === 'function'
    ? wailsWriter
    : browserWriter

  function copySelection() {
    // Trust getSelection() at click time; the contextmenu-captured ref can
    // be stale in WKWebView (right-click mousedown clears the xterm selection).
    const text = options.getSelection()
    if (text) {
      writeClipboard(text)
    }
    closeMenu()
  }

  async function copyAndPaste() {
    const text = options.getSelection()
    if (text) {
      await writeClipboard(text)
      await options.onPaste(text)
    }
    closeMenu()
  }

  function askAI() {
    const text = options.getSelection()
    if (text && options.onAskAI) {
      options.onAskAI(text)
    }
    closeMenu()
  }

  async function pasteFromClipboard() {
    try {
      // Wails clipboard, not navigator.clipboard.readText() — the latter pops
      // a system "Paste" confirmation on macOS WKWebView.
      const text = await ClipboardGetText()
      if (text) {
        await options.onPaste(text)
      }
    } catch {
      // clipboard read failed
    }
    closeMenu()
  }

  onMounted(() => {
    window.addEventListener('global:close-context-menus', closeMenu)
    document.addEventListener('click', closeMenu)
  })

  onUnmounted(() => {
    window.removeEventListener('global:close-context-menus', closeMenu)
    document.removeEventListener('click', closeMenu)
  })

  return {
    menuVisible,
    menuStyle,
    hasSelection,
    onContextMenu,
    closeMenu,
    copySelection,
    copyAndPaste,
    pasteFromClipboard,
    askAI,
  }
}
