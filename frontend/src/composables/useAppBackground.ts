/**
 * useAppBackground — 应用背景图逻辑 (App.vue 拆分)
 *
 * 从 App.vue 下沉：
 *   - bgDataUrl / loadBackgroundImage / bgVisible / bgStyle
 *
 * App.vue 用法：
 *   const bg = useAppBackground()
 *   // 模板绑定 bg.bgVisible / bg.bgStyle
 *   // onMounted 中调用 bg.loadBackgroundImage()
 *   // watch(localState 背景设置) 中调用 bg.loadBackgroundImage()
 */
import { ref, computed } from 'vue'
import { useLocalStateStore } from '../stores/localStateStore'
import { GetBackgroundImage } from '../../bindings/github.com/ys-ll/uniterm/app'

export function useAppBackground() {
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

  return {
    bgDataUrl,
    bgVisible,
    bgStyle,
    loadBackgroundImage,
  }
}