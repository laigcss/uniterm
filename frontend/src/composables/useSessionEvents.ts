import { onUnmounted } from 'vue'
import { Events } from '@wailsio/runtime'

/**
 * useSessionData — subscribe to `session:data` events for a specific session.
 *
 * The callback receives the raw data string (event.data.data) only when the
 * event matches the given session ID. The listener is automatically removed
 * on component unmount.
 */
export function useSessionData(
  sessionId: string | undefined,
  onData: (raw: string) => void,
): void {
  const unlisten = Events.On('session:data', (ev: any) => {
    const data = ev?.data
    if (!data || data.id !== sessionId) return
    onData(data.data)
  })

  onUnmounted(() => {
    if (typeof unlisten === 'function') unlisten()
  })
}