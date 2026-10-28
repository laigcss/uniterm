// Markdown helpers shared by surfaces that render markdown into v-html
// (AI messages, update changelog). Keep in sync with
// AIMessage.sanitize.test.ts, which mirrors sanitizeRenderedHtml.

import DOMPurify from 'dompurify'

// Sanitize markdown-produced HTML before it's assigned to v-html.
// Uses DOMPurify (OWASP-recommended, industry-standard) for robust XSS
// prevention. This replaces the previous regex-based sanitizer (FE-01)
// which had fundamental weaknesses:
//   - regex cannot prevent mutation XSS (browser HTML parsing "mutations")
//   - entity-encoding bypasses (javascript&colon;)
//   - tab/newline bypasses in URL schemes (java\tscript:)
//   - incorrectly stripped legitimate <svg> checkboxes synthesized by the
//     markdown renderer for task lists
// DOMPurify parses with the real browser DOM API, handles all known attack
// vectors, and is continuously maintained. Defense in depth is preserved:
// every caller still escapes its input first (see escapeHtml), so no raw
// tag/quote from model or user content can reach here.
export function sanitizeRenderedHtml(html: string): string {
  return DOMPurify.sanitize(html, {
    // Enable both HTML and SVG profiles — the markdown renderer synthesizes
    // <svg> checkboxes for task lists (see AIMessageItem.vue renderMarkdown).
    // The previous regex sanitizer deleted all <svg>, breaking checkboxes.
    USE_PROFILES: { html: true, svg: true, svgFilters: true },
    // Explicitly allow target/rel — renderMarkdown synthesizes
    // target="_blank" rel="noopener" on links. DOMPurify auto-adds
    // rel="noopener noreferrer" to target="_blank" anchors for safety.
    ADD_ATTR: ['target', 'rel'],
    // Forbid tags that DOMPurify's html+svg profiles allow but are
    // unnecessary for markdown output and carry XSS risk.
    FORBID_TAGS: ['form', 'input', 'textarea', 'select', 'button', 'noscript', 'template'],
  })
}

// Escape HTML-significant characters (including quotes — a raw double quote
// in renderer-synthesized attributes would let `on*=` handlers break out).
// Shared by the markdown pipeline and surfaces that escape model/user text
// before v-html (AIMessage.vue).
export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function renderInline(md: string): string {
  return md
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>')
}

// Minimal markdown renderer covering the constructs release notes use:
// headings, unordered lists, bold, inline code, links, horizontal rules and
// paragraphs. The output must still go through sanitizeRenderedHtml before
// being bound to v-html.
export function renderMarkdownHtml(source: string): string {
  const lines = escapeHtml(source).split(/\r?\n/)
  const out: string[] = []
  let listOpen = false
  const closeList = () => {
    if (listOpen) {
      out.push('</ul>')
      listOpen = false
    }
  }
  for (const raw of lines) {
    const line = raw.trimEnd()
    if (!line.trim()) {
      closeList()
      continue
    }
    const heading = line.match(/^(#{1,6})\s+(.*)$/)
    if (heading) {
      closeList()
      const level = heading[1].length
      out.push(`<h${level}>${renderInline(heading[2])}</h${level}>`)
      continue
    }
    if (/^(-{3,}|\*{3,})$/.test(line.trim())) {
      closeList()
      out.push('<hr>')
      continue
    }
    const item = line.match(/^\s*[-*]\s+(.*)$/)
    if (item) {
      if (!listOpen) {
        out.push('<ul>')
        listOpen = true
      }
      out.push(`<li>${renderInline(item[1])}</li>`)
      continue
    }
    closeList()
    out.push(`<p>${renderInline(line)}</p>`)
  }
  closeList()
  return out.join('\n')
}
