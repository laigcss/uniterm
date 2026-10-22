/**
 * HarmonyOS JSBridge frontend adapter.
 *
 * When the app runs inside a HarmonyOS ArkWeb container, the ArkTS side
 * injects `window.harmonyBridge` via registerJavaScriptProxy. This module
 * provides a unified, type-safe API that mirrors @wailsio/runtime so
 * existing frontend code can migrate with minimal changes:
 *   - isHarmonyOS() — detect the HarmonyOS environment
 *   - HarmonyOSBridge — HarmonyOS-only bridge API (file dialog, clipboard, notification)
 *   - unifiedClipboard / unifiedNotification — auto-routing helpers that fall
 *     back to @wailsio/runtime (or browser APIs) on non-HarmonyOS platforms
 *
 * JSBridge protocol:
 *   call: window.harmonyBridge.invoke(method, paramsJson) → Promise<resultJson>
 *   success: { success: true, data: T }
 *   failure: { success: false, error: { code: number, message: string } }
 *
 * Method naming convention: `module.action`, e.g. `fileDialog.open`,
 * `clipboard.readText`, `notification.show`.
 */
import { Clipboard as WailsClipboard } from '@wailsio/runtime'

// ---------------------------------------------------------------------------
// Type definitions
// ---------------------------------------------------------------------------

/** ArkTS-injected harmonyBridge proxy interface. */
interface HarmonyBridgeProxy {
  invokeCallback(method: string, params: string, callId: string): number
  invoke?(method: string, params: string): Promise<string>
}

/** JSBridge success response. */
interface BridgeSuccessResponse<T> {
  success: true
  data: T
}

/** JSBridge error response. */
interface BridgeErrorResponse {
  success: false
  error: { code: number; message: string }
}

/** JSBridge response (discriminated union). */
type BridgeResponse<T> = BridgeSuccessResponse<T> | BridgeErrorResponse

/** Error thrown when a JSBridge call fails. */
export class HarmonyBridgeError extends Error {
  readonly code: number
  constructor(code: number, message: string) {
    super(message)
    this.name = 'HarmonyBridgeError'
    this.code = code
  }
}

/** File-open dialog options. */
export interface FileOpenDialogOptions {
  title?: string
  defaultPath?: string
  /** File extension filters, e.g. ['.txt', '.json']. */
  filters?: string[]
  /** Allow selecting multiple files. */
  multiple?: boolean
}

/** File-save dialog options. */
export interface FileSaveDialogOptions {
  title?: string
  defaultPath?: string
  filters?: string[]
  defaultFileName?: string
}

/** Directory-picker dialog options. */
export interface DirectoryDialogOptions {
  title?: string
  defaultPath?: string
}

/** Clipboard read result supporting multiple MIME types. */
export interface ClipboardReadResult {
  text: string
  html: string
  image: string
}

/** Clipboard write payload supporting multiple MIME types. */
export interface ClipboardWriteData {
  text?: string
  html?: string
}

/** Notification show options. */
export interface NotificationShowOptions {
  id?: number
  title: string
  body: string
  icon?: string
}

// ---------------------------------------------------------------------------
// Environment detection
// ---------------------------------------------------------------------------

/** Cached HarmonyOS environment detection result. */
let harmonyEnvCache: boolean | null = null

/**
 * Detect whether the app is running inside a HarmonyOS ArkWeb container.
 *
 * Checks for the presence of `window.harmonyBridge`. The result is cached
 * to avoid repeated lookups.
 *
 * @returns true when running in HarmonyOS
 */
export function isHarmonyOS(): boolean {
  if (harmonyEnvCache !== null) {
    return harmonyEnvCache
  }
  const w = window as unknown as { harmonyBridge?: HarmonyBridgeProxy }
  harmonyEnvCache = typeof w.harmonyBridge !== 'undefined' && w.harmonyBridge !== null
  return harmonyEnvCache
}

/**
 * Retrieve the harmonyBridge proxy from the window object.
 *
 * @returns the bridge proxy, or null when not in HarmonyOS
 */
function getBridge(): HarmonyBridgeProxy | null {
  const w = window as unknown as { harmonyBridge?: HarmonyBridgeProxy }
  return w.harmonyBridge ?? null
}

// ---------------------------------------------------------------------------
// Callback-mode invoke — ArkWeb asyncMethodList workaround
// ---------------------------------------------------------------------------
//
// ArkWeb (OpenHarmony 7.0) cannot deliver asyncMethodList Promise results to
// the JS side (resolve('pong') arrives as the number 0), so cross-boundary
// calls use a synchronous entry + runJavaScript callback push instead:
//   JS:  harmonyBridge.invokeCallback(method, params, callId)   (sync, void)
//   ArkTS: runs the handler async, then runJavaScript(
//            "window.__unitermBridgeResolve(callId, resultJson)")
//   JS:  the pending Promise stored under callId resolves with resultJson.

/** Bridge calls awaiting the ArkTS-side result, keyed by callId. */
const pendingBridgeCalls = new Map<string, (resultJson: string) => void>()

/** Callback entry invoked by ArkTS via runJavaScript. */
function onBridgeResult(callId: string, resultJson: string): void {
  const resolve = pendingBridgeCalls.get(callId)
  if (resolve) {
    pendingBridgeCalls.delete(callId)
    resolve(resultJson)
  }
}

// Register the global entry points eagerly (module load) so any consumer —
// including the @wailsio/runtime clipboard.js patch, which calls
// window.__unitermBridgeInvoke directly — finds them regardless of import
// order. The proxy itself is looked up lazily inside each call.
function ensureBridgeGlobals(): void {
  const w = window as unknown as {
    __unitermBridgeResolve?: (callId: string, resultJson: string) => void
    __unitermBridgeInvoke?: (method: string, params: string) => Promise<string>
  }
  if (!w.__unitermBridgeResolve) {
    w.__unitermBridgeResolve = onBridgeResult
  }
  if (!w.__unitermBridgeInvoke) {
    w.__unitermBridgeInvoke = (method: string, params: string): Promise<string> =>
      invokeViaCallback(method, params)
  }
}

/** Default timeout for a single callback-mode bridge call. */
const BRIDGE_CALL_TIMEOUT_MS = 8000

/** Sequential call id counter (unique per page load). */
let bridgeCallSeq = 0

/**
 * Invoke an ArkTS-side bridge method via the callback protocol.
 *
 * Rejects with HarmonyBridgeError when the proxy or its invokeCallback entry
 * is unavailable, the synchronous dispatch throws, or no result arrives
 * within BRIDGE_CALL_TIMEOUT_MS.
 */
function invokeViaCallback(method: string, params: string): Promise<string> {
  ensureBridgeGlobals()
  const bridge = getBridge()
  if (!bridge) {
    return Promise.reject(new HarmonyBridgeError(-1, `harmonyBridge unavailable, cannot invoke ${method}`))
  }
  if (typeof bridge.invokeCallback !== 'function') {
    return Promise.reject(new HarmonyBridgeError(-1, `invokeCallback unavailable, cannot invoke ${method}`))
  }
  const callId = `bc-${Date.now()}-${++bridgeCallSeq}`
  return new Promise<string>((resolve, reject) => {
    const timer = setTimeout(() => {
      if (pendingBridgeCalls.has(callId)) {
        pendingBridgeCalls.delete(callId)
        reject(new HarmonyBridgeError(-1, `JSBridge timeout: ${method}`))
      }
    }, BRIDGE_CALL_TIMEOUT_MS)
    pendingBridgeCalls.set(callId, (resultJson) => {
      clearTimeout(timer)
      resolve(resultJson)
    })
    try {
      bridge.invokeCallback(method, params, callId)
    } catch (err) {
      clearTimeout(timer)
      pendingBridgeCalls.delete(callId)
      const msg = err instanceof Error ? err.message : String(err)
      reject(new HarmonyBridgeError(-1, `JSBridge dispatch error: ${method}: ${msg}`))
    }
  })
}

// Register the global entry points at module load (browser only) so the
// @wailsio/runtime clipboard patch — which calls window.__unitermBridgeInvoke
// directly, possibly before any adapter function runs — always finds them.
if (typeof window !== 'undefined') {
  ensureBridgeGlobals()
}

// ---------------------------------------------------------------------------
// Core invoke
// ---------------------------------------------------------------------------

/**
 * Invoke an ArkTS-side JSBridge method.
 *
 * Serializes params to JSON, dispatches via the callback protocol (see
 * invokeViaCallback — ArkWeb's asyncMethodList cannot deliver Promise
 * results), parses the response, and returns the `data` field. Throws
 * HarmonyBridgeError on any failure (bridge missing, invocation exception,
 * response parse error, timeout, or a success=false response).
 *
 * @param method  method name, e.g. 'fileDialog.open'
 * @param params  parameter object (optional)
 * @returns the `data` value from the bridge response
 */
async function invokeBridge<T>(method: string, params?: object): Promise<T> {
  const bridge = getBridge()
  if (bridge === null) {
    throw new HarmonyBridgeError(-1, `harmonyBridge unavailable, cannot invoke ${method}`)
  }

  const paramsJson = params !== undefined ? JSON.stringify(params) : '{}'
  let raw: string
  raw = await invokeViaCallback(method, paramsJson)

  let response: BridgeResponse<T>
  try {
    response = JSON.parse(raw) as BridgeResponse<T>
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    throw new HarmonyBridgeError(-1, `JSBridge response parse error: ${method}: ${msg}`)
  }

  if (!response.success) {
    throw new HarmonyBridgeError(response.error.code, response.error.message)
  }
  return response.data
}

// ---------------------------------------------------------------------------
// HarmonyOSBridge — HarmonyOS-only API
// ---------------------------------------------------------------------------

/**
 * HarmonyOS JSBridge wrapper.
 *
 * Provides typed access to the file dialog, clipboard, and notification
 * bridge methods. Only callable when isHarmonyOS() returns true; callers
 * should check the environment first or handle HarmonyBridgeError.
 *
 * The interface mirrors @wailsio/runtime naming where possible to ease
 * migration.
 */
export class HarmonyOSBridge {
  /** File dialog operations. */
  static readonly fileDialog = {
    /**
     * Open the file selection dialog.
     * @returns array of selected file URIs
     */
    open(options?: FileOpenDialogOptions): Promise<string[]> {
      return invokeBridge<string[]>('fileDialog.open', options)
    },

    /**
     * Open the file save dialog.
     * @returns the save target URI
     */
    save(options?: FileSaveDialogOptions): Promise<string> {
      return invokeBridge<string>('fileDialog.save', options)
    },

    /**
     * Open the directory selection dialog.
     * @returns the selected directory URI
     */
    directory(options?: DirectoryDialogOptions): Promise<string> {
      return invokeBridge<string>('fileDialog.directory', options)
    },
  }

  /** Clipboard operations. */
  static readonly clipboard = {
    /** Read plain text from the clipboard. */
    readText(): Promise<string> {
      return invokeBridge<string>('clipboard.readText')
    },

    /** Write plain text to the clipboard. */
    writeText(text: string): Promise<boolean> {
      return invokeBridge<boolean>('clipboard.writeText', { text })
    },

    /** Read clipboard content supporting multiple MIME types. */
    read(): Promise<ClipboardReadResult> {
      return invokeBridge<ClipboardReadResult>('clipboard.read')
    },

    /** Write clipboard content supporting multiple MIME types. */
    write(data: ClipboardWriteData): Promise<boolean> {
      return invokeBridge<boolean>('clipboard.write', data)
    },

    /** Clear the clipboard. */
    clear(): Promise<boolean> {
      return invokeBridge<boolean>('clipboard.clear')
    },
  }

  /** Notification operations. */
  static readonly notification = {
    /** Show a system notification; returns the notification id. */
    show(options: NotificationShowOptions): Promise<number> {
      return invokeBridge<number>('notification.show', options)
    },

    /** Request notification permission; returns true if granted. */
    requestPermission(): Promise<boolean> {
      return invokeBridge<boolean>('notification.requestPermission')
    },

    /** Cancel a previously shown notification by id. */
    cancel(id: number): Promise<boolean> {
      return invokeBridge<boolean>('notification.cancel', { id })
    },
  }
}

// ---------------------------------------------------------------------------
// Unified adapters — auto-route between HarmonyOS bridge and Wails/browser
// ---------------------------------------------------------------------------

/**
 * Unified clipboard API.
 *
 * Routes to the HarmonyOS bridge when isHarmonyOS() is true, otherwise falls
 * back to @wailsio/runtime Clipboard, and finally to the browser
 * navigator.clipboard API when Wails is unavailable (e.g. dev server).
 */
export const unifiedClipboard = {
  /**
   * Write text to the clipboard.
   * @returns true on success
   */
  async setText(text: string): Promise<boolean> {
    if (isHarmonyOS()) {
      return HarmonyOSBridge.clipboard.writeText(text)
    }
    if (typeof WailsClipboard.SetText === 'function') {
      try {
        await WailsClipboard.SetText(text)
        return true
      } catch {
        // fall through to browser API
      }
    }
    try {
      await navigator.clipboard.writeText(text)
      return true
    } catch {
      return false
    }
  },

  /**
   * Read text from the clipboard.
   * @returns the clipboard text, or empty string on failure
   */
  async text(): Promise<string> {
    if (isHarmonyOS()) {
      return HarmonyOSBridge.clipboard.readText()
    }
    if (typeof WailsClipboard.Text === 'function') {
      try {
        return await WailsClipboard.Text()
      } catch {
        // fall through to browser API
      }
    }
    try {
      return await navigator.clipboard.readText()
    } catch {
      return ''
    }
  },
}

/**
 * Unified notification API.
 *
 * Routes to the HarmonyOS bridge when isHarmonyOS() is true, otherwise falls
 * back to the browser Notification API. Notification permission is requested
 * automatically on first use when using the browser fallback.
 */
export const unifiedNotification = {
  /** Browser Notification instances keyed by id, for cancel support. */
  _browserInstances: new Map<number, Notification>(),

  /**
   * Show a notification.
   * @returns the notification id (HarmonyOS), or 0 (browser), or -1 on failure
   */
  async show(options: NotificationShowOptions): Promise<number> {
    if (isHarmonyOS()) {
      return HarmonyOSBridge.notification.show(options)
    }
    // Browser fallback
    if (typeof Notification === 'undefined') {
      return -1
    }
    try {
      if (Notification.permission !== 'granted') {
        const perm = await Notification.requestPermission()
        if (perm !== 'granted') {
          return -1
        }
      }
      const id = options.id ?? Date.now()
      const instance = new Notification(options.title, { body: options.body })
      unifiedNotification._browserInstances.set(id, instance)
      return id
    } catch {
      return -1
    }
  },

  /**
   * Request notification permission.
   * @returns true if granted
   */
  async requestPermission(): Promise<boolean> {
    if (isHarmonyOS()) {
      return HarmonyOSBridge.notification.requestPermission()
    }
    if (typeof Notification === 'undefined') {
      return false
    }
    try {
      const perm = await Notification.requestPermission()
      return perm === 'granted'
    } catch {
      return false
    }
  },

  /**
   * Cancel a notification by id.
   * @returns true on success
   */
  async cancel(id: number): Promise<boolean> {
    if (isHarmonyOS()) {
      return HarmonyOSBridge.notification.cancel(id)
    }
    const instance = unifiedNotification._browserInstances.get(id)
    if (instance !== undefined) {
      instance.close()
      unifiedNotification._browserInstances.delete(id)
      return true
    }
    return false
  },
}

/**
 * Unified file dialog API.
 *
 * Routes to the HarmonyOS bridge when isHarmonyOS() is true. On non-HarmonyOS
 * platforms, file dialogs are handled by the Go backend bindings (Wails), not
 * the Wails runtime, so this adapter throws to signal the caller should use
 * the appropriate Go binding instead.
 */
export const unifiedFileDialog = {
  /**
   * Open the file selection dialog.
   * @returns array of selected file URIs/paths
   * @throws HarmonyBridgeError on non-HarmonyOS (use Go binding instead)
   */
  open(options?: FileOpenDialogOptions): Promise<string[]> {
    if (isHarmonyOS()) {
      return HarmonyOSBridge.fileDialog.open(options)
    }
    // Desktop: file dialogs are provided by Go backend bindings, not Wails runtime.
    return Promise.reject(
      new HarmonyBridgeError(-1, 'fileDialog.open is not available on this platform; use the Go binding instead'),
    )
  },

  /**
   * Open the file save dialog.
   * @returns the save target path
   * @throws HarmonyBridgeError on non-HarmonyOS (use Go binding instead)
   */
  save(options?: FileSaveDialogOptions): Promise<string> {
    if (isHarmonyOS()) {
      return HarmonyOSBridge.fileDialog.save(options)
    }
    return Promise.reject(
      new HarmonyBridgeError(-1, 'fileDialog.save is not available on this platform; use the Go binding instead'),
    )
  },

  /**
   * Open the directory selection dialog.
   * @returns the selected directory path
   * @throws HarmonyBridgeError on non-HarmonyOS (use Go binding instead)
   */
  directory(options?: DirectoryDialogOptions): Promise<string> {
    if (isHarmonyOS()) {
      return HarmonyOSBridge.fileDialog.directory(options)
    }
    return Promise.reject(
      new HarmonyBridgeError(-1, 'fileDialog.directory is not available on this platform; use the Go binding instead'),
    )
  },
}