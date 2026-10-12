/**
 * useBackgroundImage (A1 重构)
 *
 * 下沉 App.vue 中背景图加载与样式计算：
 *   - bgDataUrl / bgVisible / bgStyle 暴露给模板
 *   - loadBackgroundImage() 由 App.vue 在 onMounted 和 watch 中调用
 */
import { ref, computed } from 'vue'
import { useLocalStateStore } from '../stores/localStateStore'
import { GetBackgroundImage } from '../../bindings/github.com/laigcss/ai-ops-terminal/app'

export function useBackgroundImage() {
  const localStateStore = useLocalStateStore()
  const bgDataUrl = ref('')

  async function loadBackgroundImage() {
    const ls = localStateStore.state
    if (ls.backgroundEnabled && ls.backgroundImage) {
      try {
        bgDataUrl.value = await GetBackgroundImage(ls.backgroundImage)
      } catch {
        bgDataUrl.value = ''
      }
    } else {
      bgDataUrl.value = ''
    }
  }

  const bgVisible = computed(
    () => localStateStore.state.backgroundEnabled && !!bgDataUrl.value
  )

  const bgStyle = computed(() => {
    const ls = localStateStore.state
    const fit = ls.backgroundFit || 'cover'
    const style: Record<string, string> = {
      backgroundImage: `url("${bgDataUrl.value}")`,
      filter: ls.backgroundBlur ? `blur(${ls.backgroundBlur}px)` : 'none',
    }
    if (fit === 'cover') {
      style.backgroundSize = 'cover'; style.backgroundPosition = 'center'; style.backgroundRepeat = 'no-repeat'
    } else if (fit === 'contain') {
      style.backgroundSize = 'contain'; style.backgroundPosition = 'center'; style.backgroundRepeat = 'no-repeat'
    } else if (fit === 'center') {
      style.backgroundSize = 'auto'; style.backgroundPosition = 'center'; style.backgroundRepeat = 'no-repeat'
    } else {
      style.backgroundSize = 'auto'; style.backgroundRepeat = 'repeat'
    }
    style['--bg-mask-opacity'] = String((ls.backgroundOpacity ?? 60) / 100)
    return style
  })

  return { bgDataUrl, bgVisible, bgStyle, loadBackgroundImage }
}