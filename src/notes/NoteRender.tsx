import { useEffect, useRef } from 'react';
import { renderMarkdown } from './markdown';
import { assetUrl, useAssetsVersion } from './assets';

/** Base typography for note pages. Theme tokens (--ink, --surface…) inherit into the shadow root. */
const BASE_CSS = `
:host { display: block; color: var(--ink); font: 15px/1.6 var(--font); overflow-wrap: anywhere; }
.note { min-height: 100%; }
h1, h2, h3, h4 { line-height: 1.25; margin: 1.4em 0 0.5em; letter-spacing: -0.01em; }
h1 { font-size: 1.8em; } h2 { font-size: 1.4em; } h3 { font-size: 1.15em; }
.note > :first-child { margin-top: 0; }
p, ul, ol, blockquote, pre, table { margin: 0 0 0.9em; }
ul, ol { padding-left: 1.4em; }
li > ul, li > ol { margin: 0.2em 0; }
a { color: var(--series-1); }
a.note-link { text-decoration: none; border-bottom: 1px dashed currentColor; cursor: pointer; }
a.note-link.is-missing { color: var(--critical); }
code { font: 0.9em ui-monospace, 'Cascadia Mono', Consolas, monospace; background: var(--surface-2); padding: 0.1em 0.35em; border-radius: 4px; }
pre { background: var(--surface-2); padding: 12px 14px; border-radius: 8px; overflow-x: auto; }
pre code { background: none; padding: 0; }
blockquote { border-left: 3px solid var(--axis); margin-left: 0; padding-left: 12px; color: var(--ink-2); }
table { border-collapse: collapse; display: block; overflow-x: auto; }
th, td { border: 1px solid var(--grid); padding: 6px 10px; text-align: left; }
th { background: var(--surface-2); }
img { max-width: 100%; border-radius: 6px; }
img[data-missing] { outline: 1px dashed var(--critical); min-width: 40px; min-height: 20px; }
hr { border: 0; border-top: 1px solid var(--grid); margin: 1.5em 0; }
li:has(> input[type=checkbox]) { list-style: none; margin-left: -1.3em; }
input[type=checkbox] { margin-right: 0.45em; cursor: pointer; accent-color: var(--good); }
.pixelated, img.pixel { image-rendering: pixelated; }
`;

export function NoteRender({
  source,
  isMissing,
  onNoteLink,
  onToggleTask,
  allowStyles = true,
  className,
}: {
  source: string;
  /** Whether a [[title]] has no matching note, to style it as missing. */
  isMissing?: (title: string) => boolean;
  onNoteLink?: (title: string) => void;
  onToggleTask?: (index: number) => void;
  allowStyles?: boolean;
  className?: string;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const assetsVersion = useAssetsVersion();
  const handlers = useRef({ onNoteLink, onToggleTask });
  handlers.current = { onNoteLink, onToggleTask };

  useEffect(() => {
    const host = hostRef.current!;
    const root = host.shadowRoot ?? host.attachShadow({ mode: 'open' });
    root.innerHTML = `<style>${BASE_CSS}</style><div class="note">${renderMarkdown(source, { allowStyles })}</div>`;
    root.querySelectorAll<HTMLAnchorElement>('a.note-link').forEach((a) => {
      if (isMissing?.(a.dataset.noteTitle ?? '')) a.classList.add('is-missing');
    });
    let alive = true;
    root.querySelectorAll<HTMLImageElement>('img[src^="asset:"]').forEach((img) => {
      const id = img.getAttribute('src')!.slice('asset:'.length);
      img.removeAttribute('src');
      assetUrl(id).then((url) => {
        if (!alive) return;
        if (url) img.src = url;
        else img.setAttribute('data-missing', '');
      });
    });
    return () => {
      alive = false;
    };
  }, [source, isMissing, allowStyles, assetsVersion]);

  useEffect(() => {
    const root = hostRef.current!.shadowRoot!;
    const onClick = (e: Event) => {
      const target = e.target as HTMLElement;
      const link = target.closest?.('a.note-link') as HTMLAnchorElement | null;
      if (link) {
        e.preventDefault();
        e.stopPropagation();
        handlers.current.onNoteLink?.(link.dataset.noteTitle ?? '');
        return;
      }
      if (target instanceof HTMLInputElement && target.type === 'checkbox') {
        if (!handlers.current.onToggleTask) {
          e.preventDefault();
          return;
        }
        const boxes = [...root.querySelectorAll('li input[type=checkbox]')];
        handlers.current.onToggleTask(boxes.indexOf(target));
      }
    };
    root.addEventListener('click', onClick);
    return () => root.removeEventListener('click', onClick);
  }, []);

  return <div ref={hostRef} className={className} />;
}
