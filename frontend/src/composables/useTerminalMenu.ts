import { ref } from 'vue'
import type { Ref } from 'vue'
import { useSettingsStore } from '../stores/settingsStore'
import { ClipboardGetText, ClipboardSetText } from '../../wailsjs/runtime/runtime'

export interface UseTerminalMenuOptions {
  getSelection: () => string
  onPaste: (text: string) => Promise<void> | void
  onAskAI?: (text: string) => void
  /** Position + open the actual menu. The host wires this to its <Menu>
   *  instance (openAt), so the composable stays decoupled from the component
   *  and its viewport clamping lives in Menu. */
  openAt?: (x: number, y: number) => void
}

export interface UseTerminalMenuReturn {
  menuVisible: Ref<boolean>
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
    hasSelection.value = !!options.getSelection()
    // menuVisible drives the host <Menu>.v-model; openAt positions it (and
    // flips it on). In isolation (tests) openAt is absent so we set it here.
    menuVisible.value = true
    options.openAt?.(e.clientX, e.clientY)
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

  return {
    menuVisible,
    hasSelection,
    onContextMenu,
    closeMenu,
    copySelection,
    copyAndPaste,
    pasteFromClipboard,
    askAI,
  }
}