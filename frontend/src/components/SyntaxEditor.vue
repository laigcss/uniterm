<template>
  <div ref="hostRef" class="syntax-editor" />
</template>

<script setup lang="ts">
import { ref, watch, onMounted, onBeforeUnmount, nextTick } from 'vue'
import { EditorState } from '@codemirror/state'
import { EditorView, keymap, lineNumbers, highlightActiveLine, highlightActiveLineGutter, drawSelection } from '@codemirror/view'
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands'
import { syntaxHighlighting, defaultHighlightStyle, bracketMatching, foldGutter, foldKeymap, StreamLanguage } from '@codemirror/language'
import { oneDark } from '@codemirror/theme-one-dark'
import { json } from '@codemirror/lang-json'
import { javascript } from '@codemirror/lang-javascript'
import { html } from '@codemirror/lang-html'
import { css } from '@codemirror/lang-css'
import { xml } from '@codemirror/lang-xml'
import { markdown } from '@codemirror/lang-markdown'
import { python } from '@codemirror/lang-python'
import { sql } from '@codemirror/lang-sql'
import { yaml } from '@codemirror/lang-yaml'
import { shell } from '@codemirror/legacy-modes/mode/shell'
import { properties } from '@codemirror/legacy-modes/mode/properties'
import { toml } from '@codemirror/legacy-modes/mode/toml'
import { dockerFile } from '@codemirror/legacy-modes/mode/dockerfile'
import { nginx } from '@codemirror/legacy-modes/mode/nginx'

const props = defineProps<{
  modelValue: string
  filePath?: string
}>()

const emit = defineEmits<{
  'update:modelValue': [value: string]
}>()

const hostRef = ref<HTMLElement | null>(null)
let view: EditorView | null = null
let applyingExternal = false

function extOf(path: string): string {
  const base = path.replace(/\\/g, '/').split('/').pop() || ''
  const lower = base.toLowerCase()
  // Common extensionless filenames
  if (lower === 'dockerfile' || lower.startsWith('dockerfile.')) return 'dockerfile'
  if (lower === 'makefile' || lower === 'gnumakefile') return 'makefile'
  if (lower === '.bashrc' || lower === '.zshrc' || lower === '.profile' || lower === '.bash_profile') return 'sh'
  if (lower === '.gitignore' || lower === '.dockerignore' || lower === '.env' || lower.endsWith('.env')) return 'conf'
  if (lower === 'nginx.conf' || lower.endsWith('.nginx')) return 'nginx'
  const i = lower.lastIndexOf('.')
  return i >= 0 ? lower.slice(i + 1) : ''
}

function languageExtension(path: string) {
  const ext = extOf(path || '')
  switch (ext) {
    case 'json':
    case 'jsonc':
    case 'json5':
      return json()
    case 'js':
    case 'mjs':
    case 'cjs':
    case 'jsx':
    case 'ts':
    case 'tsx':
      return javascript({ typescript: ext === 'ts' || ext === 'tsx', jsx: ext === 'jsx' || ext === 'tsx' })
    case 'html':
    case 'htm':
    case 'vue':
      return html()
    case 'css':
    case 'scss':
    case 'less':
      return css()
    case 'xml':
    case 'svg':
    case 'plist':
      return xml()
    case 'md':
    case 'markdown':
      return markdown()
    case 'py':
      return python()
    case 'sql':
      return sql()
    case 'yml':
    case 'yaml':
      return yaml()
    case 'sh':
    case 'bash':
    case 'zsh':
    case 'ksh':
    case 'fish':
      return StreamLanguage.define(shell)
    case 'conf':
    case 'cfg':
    case 'ini':
    case 'properties':
    case 'service':
    case 'desktop':
      return StreamLanguage.define(properties)
    case 'toml':
      return StreamLanguage.define(toml)
    case 'dockerfile':
      return StreamLanguage.define(dockerFile)
    case 'nginx':
      return StreamLanguage.define(nginx)
    default:
      // Heuristic for *.conf-like names containing "conf"
      if (/\.conf(\.|$)/i.test(path || '') || /\/conf\//i.test(path || '')) {
        return StreamLanguage.define(properties)
      }
      return []
  }
}

function buildExtensions(path: string) {
  return [
    lineNumbers(),
    highlightActiveLine(),
    highlightActiveLineGutter(),
    drawSelection(),
    history(),
    foldGutter(),
    bracketMatching(),
    syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
    oneDark,
    languageExtension(path),
    keymap.of([...defaultKeymap, ...historyKeymap, ...foldKeymap, indentWithTab]),
    EditorView.updateListener.of((update) => {
      if (!update.docChanged || applyingExternal) return
      emit('update:modelValue', update.state.doc.toString())
    }),
    EditorView.theme({
      '&': { height: '100%', fontSize: '13px' },
      '.cm-scroller': { fontFamily: 'var(--font-mono, ui-monospace, SFMono-Regular, Menlo, Consolas, monospace)', overflow: 'auto' },
      '.cm-content': { minHeight: '100%' },
      '.cm-gutters': { backgroundColor: 'transparent', border: 'none' },
    }),
    EditorView.lineWrapping,
  ]
}

function createEditor() {
  if (!hostRef.value) return
  view?.destroy()
  view = new EditorView({
    parent: hostRef.value,
    state: EditorState.create({
      doc: props.modelValue || '',
      extensions: buildExtensions(props.filePath || ''),
    }),
  })
}

function setDoc(text: string) {
  if (!view) return
  const cur = view.state.doc.toString()
  if (cur === text) return
  applyingExternal = true
  view.dispatch({
    changes: { from: 0, to: view.state.doc.length, insert: text },
  })
  applyingExternal = false
}

watch(() => props.modelValue, (v) => {
  setDoc(v ?? '')
})

watch(() => props.filePath, async () => {
  // Recreate editor when language changes with current content
  const text = view?.state.doc.toString() ?? props.modelValue
  await nextTick()
  createEditor()
  if (text !== props.modelValue) setDoc(text)
})

onMounted(() => {
  createEditor()
})

onBeforeUnmount(() => {
  view?.destroy()
  view = null
})

defineExpose({
  focus: () => view?.focus(),
  getValue: () => view?.state.doc.toString() ?? props.modelValue,
})
</script>

<style scoped>
.syntax-editor {
  height: 55vh;
  border: 1px solid var(--border-subtle);
  border-radius: 4px;
  overflow: hidden;
  background: #282c34;
}
.syntax-editor :deep(.cm-editor) {
  height: 100%;
}
.syntax-editor :deep(.cm-focused) {
  outline: none;
}
</style>
