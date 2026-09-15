import DOMPurify from 'dompurify';
import { Marked, type Tokens } from 'marked';

/**
 * Markdown → sanitized HTML for note pages.
 * - GitHub-flavored markdown (tables, task lists, fenced code).
 * - Raw HTML and <style> are allowed; scripts, event handlers and javascript: URLs are stripped.
 *   Pages render inside a shadow root, so a page's CSS only styles that page.
 * - [[Page title]] and [[Page title|shown text]] become links to other notes.
 * - Images can point at uploaded files with `asset:<id>`; the renderer swaps in the real URL.
 */
const wikiLink = {
  name: 'wikiLink',
  level: 'inline' as const,
  start: (src: string) => src.indexOf('[['),
  tokenizer(src: string) {
    const m = /^\[\[([^\]|\n]+)(?:\|([^\]\n]+))?\]\]/.exec(src);
    if (!m) return undefined;
    return { type: 'wikiLink', raw: m[0], title: m[1].trim(), label: (m[2] ?? m[1]).trim() };
  },
  renderer(token: Tokens.Generic) {
    const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
    return `<a class="note-link" href="#" data-note-title="${esc(token.title)}">${esc(token.label)}</a>`;
  },
};

const marked = new Marked({ gfm: true, breaks: false });
marked.use({ extensions: [wikiLink] });

DOMPurify.addHook('uponSanitizeAttribute', (_node, data) => {
  // Keep uploaded-image references; they're resolved to blob URLs after sanitizing.
  if (data.attrName === 'src' && data.attrValue.startsWith('asset:')) data.forceKeepAttr = true;
});
DOMPurify.addHook('afterSanitizeAttributes', (node) => {
  if (node.tagName === 'A' && node.getAttribute('href') && !node.classList.contains('note-link')) {
    node.setAttribute('target', '_blank');
    node.setAttribute('rel', 'noopener noreferrer');
  }
  // Task-list checkboxes are clickable in the preview.
  if (node.tagName === 'INPUT' && node.getAttribute('type') === 'checkbox') node.removeAttribute('disabled');
});

export function renderMarkdown(src: string, options: { allowStyles?: boolean } = {}): string {
  const html = marked.parse(src, { async: false }) as string;
  return DOMPurify.sanitize(html, {
    ADD_TAGS: options.allowStyles === false ? [] : ['style'],
    FORBID_TAGS: options.allowStyles === false ? ['style'] : [],
    FORBID_ATTR: options.allowStyles === false ? ['style'] : [],
    ADD_ATTR: ['target'],
    FORCE_BODY: true,
  });
}

/** Line indexes (in source order) of task-list items, so a click in the preview can toggle the source. */
export function toggleTask(src: string, index: number): string {
  let i = -1;
  let inFence = false;
  return src
    .split('\n')
    .map((line) => {
      if (/^\s*(```|~~~)/.test(line)) inFence = !inFence;
      if (inFence) return line;
      const m = /^(\s*(?:[-*+]|\d+[.)])\s+\[)([ xX])(\].*)$/.exec(line);
      if (!m) return line;
      i++;
      return i === index ? `${m[1]}${m[2] === ' ' ? 'x' : ' '}${m[3]}` : line;
    })
    .join('\n');
}

/** Titles referenced with [[…]] in a page, for backlinks. */
export const linkedTitles = (src: string) => [...src.matchAll(/\[\[([^\]|\n]+)(?:\|[^\]\n]+)?\]\]/g)].map((m) => m[1].trim().toLowerCase());
