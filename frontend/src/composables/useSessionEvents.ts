/**
 * Session event subscription composables.
 *
 * The `session:data` and `session:status` Wails events are subscribed in many
 * components with the same boilerplate: parse `ev.data`, filter by session id,
 * run a handler, and clean up on unmount. These helpers encapsulate that
 * pattern so call-sites only provide the session id and the handler logic.
 *
 * The returned cleanup function allows early manual disposal (e.g. when
 * rebinding listeners after a session switch); otherwise disposal happens
 * automatically on component unmount.
 */
import { Events } from '@wailsio/runtime'
import { onUnmounted } from 'vue'

/** Payload of the `session:data` event. */
export interface SessionDataPayload {
  id: string
  data: string
}

/** Payload of the `session:status` event. */
export interface SessionStatusPayload {
  id: string
  status: string
  remoteOS?: string
}

/** A session-id source — either a fixed string or a getter returning the current id. */
export type SessionIdGetter = string | (() => string | undefined)

function resolveSid(getter: SessionIdGetter): string | undefined {
  return typeof getter === 'function' ? getter() : getter
}

/**
 * Subscribe to `session:data` for a specific session. The handler is only
 * invoked when the event's session id matches. The subscription is cleaned
 * up automatically on component unmount; the returned function allows early
 * manual cleanup (e.g. when rebinding listeners).
 *
 * @example
 * // fixed session id, auto-cleanup on unmount
 * useSessionData(props.sessionId, (data) => { ... })
 * // dynamic session id with manual cleanup
 * const stop = useSessionData(() => sessionId.value, (data) => { ... })
 * function rebind() { stop(); /* ... *\/ }
 */
export function useSessionData(
  sessionId: SessionIdGetter,
  handler: (data: string) => void,
): () => void {
  const unlisten = Events.On('session:data', (ev) => {
    const payload = ev.data as SessionDataPayload | undefined
    if (!payload || payload.id !== resolveSid(sessionId)) return
    handler(payload.data)
  })
  const cleanup = () => unlisten()
  onUnmounted(cleanup)
  return cleanup
}

/**
 * Subscribe to `session:status` for a specific session. The handler receives
 * the full status payload (id, status, remoteOS). Cleaned up automatically on
 * component unmount; the returned function allows early manual cleanup.
 */
export function useSessionStatus(
  sessionId: SessionIdGetter,
  handler: (payload: SessionStatusPayload) => void,
): () => void {
  const unlisten = Events.On('session:status', (ev) => {
    const payload = ev.data as SessionStatusPayload | undefined
    if (!payload || payload.id !== resolveSid(sessionId)) return
    handler(payload)
  })
  const cleanup = () => unlisten()
  onUnmounted(cleanup)
  return cleanup
}