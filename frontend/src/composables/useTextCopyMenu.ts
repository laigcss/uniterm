import { ref, onMounted, onUnmounted } from 'vue'
import { ClipboardSetText } from '../../wailsjs/runtime/runtime'

// Right-click "复制" menu for selectable (non-terminal) text areas: detail rows,
// YAML <pre>, log <pre>. Attach onContextMenu to the container; the menu shows
// only when there's an active text selection.
export function useTextCopyMenu() {
  const visible = ref(false)
  const style = ref({ left: '0px', top: '0px' })

  function close() { visible.value = false }

  function onContextMenu(e: MouseEvent) {
    const sel = window.getSelection()?.toString() || ''
    if (!sel) return
    e.preventDefault()
    e.stopPropagation()
    window.dispatchEvent(new CustomEvent('global:close-context-menus'))
    let left = e.clientX
    let top = e.clientY
    if (left + 100 > window.innerWidth) left = e.clientX - 100
    if (top + 40 > window.innerHeight) top = e.clientY - 40
    style.value = { left: left + 'px', top: top + 'px' }
    visible.value = true
  }

  async function copy() {
    const sel = window.getSelection()?.toString() || ''
    if (sel) {
      try { await ClipboardSetText(sel) } catch { try { await navigator.clipboard.writeText(sel) } catch { /* ignore */ } }
    }
    close()
  }

  onMounted(() => {
    window.addEventListener('global:close-context-menus', close)
    document.addEventListener('click', close)
  })
  onUnmounted(() => {
    window.removeEventListener('global:close-context-menus', close)
    document.removeEventListener('click', close)
  })

  return { visible, style, onContextMenu, copy, close }
}
