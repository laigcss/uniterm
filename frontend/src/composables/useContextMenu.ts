/**
 * useContextMenu (A1 重构)
 *
 * 下沉 App.vue 中输入框右键菜单（剪切/复制/粘贴/全选）的状态与处理：
 *   - inputMenuVisible / inputMenuReadonly / inputMenuRef 暴露给模板绑定
 *   - onInputContextMenu 监听 'input:contextmenu' 自定义事件
 *   - inputMenuCut/Copy/Paste/SelectAll 处理 contenteditable / input / textarea
 *
 * App.vue 用法：
 *   const { inputMenuVisible, inputMenuReadonly, inputMenuRef,
 *           inputMenuCut, inputMenuCopy, inputMenuPaste, inputMenuSelectAll,
 *           init, dispose } = useContextMenu()
 *   onMounted(() => init()); onUnmounted(() => dispose())
 */
import { ref } from 'vue'
import { Clipboard } from '@wailsio/runtime'
import type Menu from '../components/Menu.vue'

export function useContextMenu() {
  const inputMenuVisible = ref(false)
  const inputMenuReadonly = ref(false)
  const inputMenuRef = ref<InstanceType<typeof Menu> | null>(null)
  let inputMenuTarget: HTMLInputElement | HTMLTextAreaElement | HTMLElement | null = null

  function closeInputMenu() {
    inputMenuVisible.value = false
    inputMenuTarget = null
  }

  function onInputContextMenu(e: Event) {
    const { x, y, target, readonly } = (e as CustomEvent).detail as {
      x: number; y: number; target: HTMLElement; readonly?: boolean
    }
    inputMenuTarget = target
    inputMenuReadonly.value = !!readonly
    inputMenuRef.value?.openAt(x, y)
  }

  function getInputSelection(el: HTMLElement): string {
    if (el.isContentEditable) {
      return window.getSelection()?.toString() || ''
    }
    const input = el as HTMLInputElement | HTMLTextAreaElement
    return input.value.substring(input.selectionStart ?? 0, input.selectionEnd ?? 0)
  }

  function setInputSelection(el: HTMLInputElement | HTMLTextAreaElement, text: string) {
    // <input type="number"> (e.g. the port field) doesn't expose a text selection, so
    // selectionStart/End are null. Falling the offsets back to 0 would prepend the pasted
    // text instead of replacing it. Treat the unreadable selection as select-all so paste
    // overwrites the whole value (issue #555).
    const start = el.selectionStart
    const end = el.selectionEnd
    if (start === null || end === null) {
      el.value = text
      el.setSelectionRange(text.length, text.length)
      el.focus()
      return
    }
    el.value = el.value.substring(0, start) + text + el.value.substring(end)
    const pos = start + text.length
    el.setSelectionRange(pos, pos)
    el.focus()
  }

  function insertTextAtContentEditable(el: HTMLElement, text: string) {
    el.focus()
    const sel = window.getSelection()
    if (sel && sel.rangeCount > 0) {
      const range = sel.getRangeAt(0)
      range.deleteContents()
      range.insertNode(document.createTextNode(text))
      range.collapse(false)
      sel.removeAllRanges()
      sel.addRange(range)
    } else {
      el.textContent += text
    }
  }

  function inputMenuCut() {
    const el = inputMenuTarget
    closeInputMenu()
    if (!el) return
    const sel = getInputSelection(el)
    navigator.clipboard.writeText(sel)
    if (el.isContentEditable) {
      const s = window.getSelection()
      if (s && s.rangeCount > 0) { s.getRangeAt(0).deleteContents() }
    } else {
      setInputSelection(el as HTMLInputElement | HTMLTextAreaElement, '')
    }
    el.dispatchEvent(new Event('input', { bubbles: true }))
  }

  function inputMenuCopy() {
    const el = inputMenuTarget
    const readonly = inputMenuReadonly.value
    closeInputMenu()
    if (!el) return
    // Read-only plain element (log-path toast): copy the live selection if any,
    // otherwise the whole text.
    if (readonly) {
      const sel = window.getSelection()?.toString()
      navigator.clipboard.writeText(sel || el.textContent || '')
      return
    }
    navigator.clipboard.writeText(getInputSelection(el))
  }

  function inputMenuPaste() {
    const el = inputMenuTarget
    closeInputMenu()
    if (!el) return
    Clipboard.Text().then(text => {
      if (el.isContentEditable) {
        insertTextAtContentEditable(el, text)
      } else {
        setInputSelection(el as HTMLInputElement | HTMLTextAreaElement, text)
      }
      el.dispatchEvent(new Event('input', { bubbles: true }))
    }).catch(() => {})
  }

  function inputMenuSelectAll() {
    const el = inputMenuTarget
    const readonly = inputMenuReadonly.value
    if (el && readonly) {
      const range = document.createRange()
      range.selectNodeContents(el)
      const sel = window.getSelection()
      sel?.removeAllRanges()
      sel?.addRange(range)
    } else if (el && 'select' in el) {
      (el as HTMLInputElement | HTMLTextAreaElement).select()
    }
    closeInputMenu()
  }

  function init() {
    window.addEventListener('input:contextmenu', onInputContextMenu)
  }
  function dispose() {
    window.removeEventListener('input:contextmenu', onInputContextMenu)
  }

  return {
    inputMenuVisible,
    inputMenuReadonly,
    inputMenuRef,
    inputMenuCut,
    inputMenuCopy,
    inputMenuPaste,
    inputMenuSelectAll,
    init,
    dispose,
  }
}