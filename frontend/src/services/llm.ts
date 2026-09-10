import { ChatCompletion } from '../../bindings/github.com/ys-ll/uniterm/app'
import { Events } from '@wailsio/runtime'
import { useSettingsStore } from '../stores/settingsStore'
// A3: AVAILABLE_TOOLS now lives in ./tools (registry-derived). Re-exported
// here so existing callers that import from './llm' keep working.
export { AVAILABLE_TOOLS } from './tools'

export interface ChatOptions {
  system: string
  messages: Array<Record<string, unknown>>
  tools?: Array<{
    name: string
    description: string
    input_schema: object
  }>
  onChunk?: (chunk: string) => void
  onToolUse?: (tool: { id: string; name: string; input: Record<string, unknown> }) => void
}

export class ChatCancelledError extends Error {
  constructor() {
    super('Chat was cancelled by user')
    this.name = 'ChatCancelledError'
  }
}

export class ChatTimeoutError extends Error {
  constructor() {
    super('Chat request timed out')
    this.name = 'ChatTimeoutError'
  }
}

function isCancellationError(raw: string): boolean {
  const lower = raw.toLowerCase()
  return lower.includes('context canceled') || lower.includes('context cancelled')
}

function formatAPIError(raw: string): string {
  // Parse Go backend error format: "HTTP <code>: <json body>"
  const match = raw.match(/^HTTP\s+(\d+):\s*(.+)/)
  if (!match) return `API Error: ${raw}`

  const code = match[1]
  const bodyStr = match[2]
  try {
    const body = JSON.parse(bodyStr)
    const msg = body?.error?.message || body?.message || bodyStr
    return `API Error: ${code} ${msg}`
  } catch {
    return `API Error: ${code} ${bodyStr}`
  }
}

export async function chat(options: ChatOptions): Promise<void> {
  const settingsStore = useSettingsStore()
  const activeModel = settingsStore.activeModel

  const apiKey = activeModel?.apiKey || ''
  const baseURL = activeModel?.baseURL || ''
  const model = activeModel?.model || ''
  const protocol = activeModel?.protocol || 'anthropic'
  const userAgent = activeModel?.userAgent || ''
  const proxyId = activeModel?.proxyId || ''

  if (!apiKey) throw new Error('API key not configured')

  const requestBody: Record<string, unknown> = {
    model,
    max_tokens: 16384,
    system: options.system,
    messages: options.messages,
    tools: options.tools,
  }

  const requestJSON = JSON.stringify(requestBody)

  let responseText: string
  // Streamed tokens are emitted via Wails events. Some protocol paths (notably
  // OpenAI before the text-buffer flush fix) returned empty content[].text in
  // the final JSON while still emitting ai:token — so callers that only read
  // onChunk from the final payload (DB/Mongo assistants) saw empty results.
  // Accumulate tokens as a fallback; do NOT forward them to onChunk here (the
  // agent already listens to ai:token and would double-append).
  let streamedText = ''
  const unsubToken =Events.On('ai:token', (ev) => { const data: any = ev.data; 
    const text = typeof data === 'string' ? data : (data?.text ?? data?.Text ?? '')
    if (text) streamedText += text
   })
  try {
    responseText = await ChatCompletion(apiKey, baseURL, model, requestJSON, protocol, userAgent, proxyId)
  } catch (e: any) {
    const raw = e?.message || String(e)
    if (isCancellationError(raw)) {
      throw new ChatCancelledError()
    }
    if (raw.includes('AI_REQUEST_TIMEOUT')) {
      throw new ChatTimeoutError()
    }
    throw new Error(formatAPIError(raw))
  } finally {
    unsubToken?.()
  }

  let json: any
  try {
    json = JSON.parse(responseText)
  } catch (e: any) {
    throw new Error(`Failed to parse LLM response: ${e.message}`)
  }

  if (json.error) {
    const errMsg = json.error.message || JSON.stringify(json.error)
    throw new Error(`LLM API error: ${errMsg}`)
  }

  const rawContent = json.content
  if (!Array.isArray(rawContent)) {
    throw new Error('Unexpected Anthropic response: content is not an array')
  }

  // Store raw message for history preservation
  ;(options as any)._rawApiMsg = {
    role: json.role || 'assistant',
    content: rawContent
  }

  // Dispatch text and tool_use blocks.
  let finalText = ''
  for (const block of rawContent) {
    switch (block.type) {
      case 'text':
        finalText += block.text || ''
        break
      case 'tool_use':
        options.onToolUse?.({
          id: block.id,
          name: block.name,
          input: block.input || {}
        })
        break
    }
  }
  const textOut = finalText || streamedText
  if (textOut) {
    options.onChunk?.(textOut)
  }
}

