// @vitest-environment jsdom
// Regression tests for FE-01 (XSS via markdown-produced HTML in the
// AIMessage.vue v-html binding). sanitizeRenderedHtml now uses DOMPurify
// (OWASP-recommended) instead of regex-based stripping. These tests verify
// the same XSS attack vectors are blocked and that legitimate content
// (including <svg> task-list checkboxes) is preserved.

import { describe, expect, it } from 'vitest'
import { sanitizeRenderedHtml, escapeHtml, renderMarkdownHtml } from '../utils/markdown'

describe('sanitizeRenderedHtml (FE-01 XSS)', () => {
  it('strips javascript: URLs from link href', () => {
    const out = sanitizeRenderedHtml(
      '<a href="javascript:fetch(\'http://x\')" target="_blank">click</a>',
    )
    expect(out).not.toMatch(/javascript:/i)
    expect(out).not.toMatch(/fetch\(/i)
    expect(out).toMatch(/target="_blank"/) // other attrs preserved
    expect(out).toMatch(/>click</)
  })

  it('strips attribute-quote breakout in image src', () => {
    const out = sanitizeRenderedHtml('<img src="x" onerror="alert(1)" alt="alt">')
    expect(out).not.toMatch(/onerror/i)
    expect(out).not.toMatch(/alert\(/i)
    expect(out).toMatch(/<img/) // tag still present
  })

  it('strips slash-separated on* handlers with quoted values', () => {
    const out = sanitizeRenderedHtml('<a href="x"/onclick="alert(1)">x</a>')
    expect(out).not.toMatch(/onclick/i)
    expect(out).not.toMatch(/alert\(/i)
    expect(out).toMatch(/<a/) // tag still present
  })

  it('keeps slash URLs containing on…= segments intact (no false positive)', () => {
    const url = '<a href="https://example.com/online=1">x</a>'
    expect(sanitizeRenderedHtml(url)).toBe(url)
  })

  it('strips <script> tags and their content', () => {
    const out = sanitizeRenderedHtml('before<script>alert(1)</script>after')
    expect(out).not.toMatch(/<script/i)
    expect(out).not.toMatch(/alert\(/)
    expect(out).toMatch(/before/)
    expect(out).toMatch(/after/)
  })

  it('strips iframe / object / embed entirely', () => {
    const out = sanitizeRenderedHtml(
      '<iframe src="https://evil"></iframe><object data="x"></object><embed src="y">',
    )
    expect(out).not.toMatch(/iframe/i)
    expect(out).not.toMatch(/object/i)
    expect(out).not.toMatch(/embed/i)
  })

  it('preserves safe content unchanged', () => {
    const safe = '<p>hello <strong>world</strong></p>'
    expect(sanitizeRenderedHtml(safe)).toBe(safe)
  })
})

describe('markdown pipeline attribute-breakout hardening (FE-01 follow-up)', () => {
  it('escapeHtml escapes double quotes', () => {
    const out = escapeHtml('[x](x"/onerror="alert(1))')
    expect(out).not.toMatch(/"/)
    expect(out).toContain('&quot;')
  })

  it('renderMarkdownHtml output has no raw quotes from model content', () => {
    // With quotes escaped at the source, the link-syntax payload
    // [x](x"/onclick="alert(1)) lands inside the quoted href value with its
    // quotes entity-encoded — inert URL text that can never split into a
    // separate attribute.
    const out = sanitizeRenderedHtml(renderMarkdownHtml('[x](x"/onclick="alert(1))'))
    expect(out).toContain('href="x&quot;/onclick=&quot;alert(1"')
    expect(out).not.toMatch(/[\s/]"?onclick="\s*alert/)
  })

  it('renderMarkdownHtml keeps ordinary links working', () => {
    const out = renderMarkdownHtml('[docs](https://example.com/a?b=1)')
    expect(out).toContain('href="https://example.com/a?b=1"')
  })
})
// Tests for the DOMPurify migration: verify attack vectors that the previous
// regex sanitizer missed (mutation XSS, entity-encoding bypasses, tab/newline
// in URL schemes) and the functional fix for <svg> task-list checkboxes.
describe('sanitizeRenderedHtml (DOMPurify migration)', () => {
  it('preserves <svg> task-list checkboxes (previous regex deleted them)', () => {
    const svg =
      '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"><rect x="3" y="3" width="18" height="18" rx="2"></rect><path d="m9 12 2 2 4-4"></path></svg>'
    const out = sanitizeRenderedHtml(svg)
    expect(out).toMatch(/<svg/)
    expect(out).toMatch(/<rect/)
    expect(out).toMatch(/<path/)
  })

  it('strips <svg> with XSS payload (use href javascript:)', () => {
    const out = sanitizeRenderedHtml(
      '<svg><use href="data:text/html,<script>alert(1)</script>" /></svg>',
    )
    expect(out).not.toMatch(/<script/i)
    expect(out).not.toMatch(/alert\(/)
  })

  it('blocks entity-encoded javascript: URL (javascript&colon;)', () => {
    // The regex sanitizer only matched literal "javascript:" — browsers
    // decode &colon; to ":" before navigating. DOMPurify handles this.
    const out = sanitizeRenderedHtml('<a href="javascript&colon;alert(1)">x</a>')
    expect(out).not.toMatch(/javascript/i)
    expect(out).not.toMatch(/alert\(/)
  })

  it('blocks tab-separated javascript: URL (java\tscript:)', () => {
    // Browsers strip tabs/newlines in URLs before resolving the scheme.
    const out = sanitizeRenderedHtml('<a href="java\tscript:alert(1)">x</a>')
    expect(out).not.toMatch(/alert\(/)
  })

  it('blocks newline-separated javascript: URL', () => {
    const out = sanitizeRenderedHtml('<a href="java\nscript:alert(1)">x</a>')
    expect(out).not.toMatch(/alert\(/)
  })

  it('strips <style> tags (CSS injection)', () => {
    const out = sanitizeRenderedHtml(
      '<style>body{background:url(javascript:alert(1))}</style><p>text</p>',
    )
    expect(out).not.toMatch(/<style/i)
    expect(out).not.toMatch(/javascript/i)
    expect(out).toMatch(/<p>text<\/p>/)
  })

  it('strips <noscript> tags', () => {
    const out = sanitizeRenderedHtml('<noscript><p>hidden</p></noscript><p>visible</p>')
    expect(out).not.toMatch(/noscript/i)
    expect(out).toMatch(/visible/)
  })

  it('strips <form> and <input> tags', () => {
    const out = sanitizeRenderedHtml('<form action="javascript:alert(1)"><input name="x"></form>')
    expect(out).not.toMatch(/<form/i)
    expect(out).not.toMatch(/<input/i)
    expect(out).not.toMatch(/javascript/i)
  })

  it('strips <meta> refresh redirect', () => {
    const out = sanitizeRenderedHtml('<meta http-equiv="refresh" content="0;url=javascript:alert(1)">')
    expect(out).not.toMatch(/<meta/i)
    expect(out).not.toMatch(/javascript/i)
  })

  it('strips <base> tag (href hijacking)', () => {
    const out = sanitizeRenderedHtml('<base href="https://evil.com/"><a href="/path">link</a>')
    expect(out).not.toMatch(/<base/i)
    expect(out).not.toMatch(/evil\.com/)
  })

  it('strips <template> tags', () => {
    const out = sanitizeRenderedHtml('<template><script>alert(1)</script></template>')
    expect(out).not.toMatch(/<script/i)
    expect(out).not.toMatch(/alert\(/)
  })

  it('preserves safe data: image URIs', () => {
    const out = sanitizeRenderedHtml('<img src="data:image/png;base64,iVBORw0KGgo=" alt="img">')
    expect(out).toMatch(/<img/)
    expect(out).toMatch(/data:image\/png/)
  })

  it('strips dangerous data: text/html URIs', () => {
    const out = sanitizeRenderedHtml('<a href="data:text/html,<script>alert(1)</script>">x</a>')
    expect(out).not.toMatch(/<script/i)
    expect(out).not.toMatch(/alert\(/)
  })

  it('strips event handlers with unquoted values', () => {
    const out = sanitizeRenderedHtml('<img src=x onerror=alert(1)>')
    expect(out).not.toMatch(/onerror/i)
    expect(out).not.toMatch(/alert\(/)
  })

  it('preserves table, list, and blockquote structures', () => {
    const html = '<table><tr><th>A</th><td>B</td></tr></table><ul><li>item</li></ul><blockquote>quote</blockquote>'
    const out = sanitizeRenderedHtml(html)
    expect(out).toMatch(/<table/)
    expect(out).toMatch(/<th>A<\/th>/)
    expect(out).toMatch(/<ul><li>item<\/li><\/ul>/)
    expect(out).toMatch(/<blockquote>quote<\/blockquote>/)
  })
})
