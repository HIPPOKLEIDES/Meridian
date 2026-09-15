import { useCallback, useEffect, useRef, useState } from 'react';
import type { ID } from '../types';
import type { NoteNode } from './types';
import { findByTitle, useNotes } from './store';
import { linkedTitles, toggleTask } from './markdown';
import { NoteRender } from './NoteRender';
import { imageFrom, saveImage } from './assets';
import { Icon, Segmented } from '../components/common';

type Mode = 'edit' | 'split' | 'preview';

const MODE_KEY = 'meridian:note-mode';

/** Wraps the selection (or inserts at the cursor) and keeps the textarea focused. */
function applyEdit(el: HTMLTextAreaElement, value: string, setValue: (v: string) => void, edit: (sel: string) => { text: string; select?: [number, number] }) {
  const { selectionStart: s, selectionEnd: e } = el;
  const { text, select } = edit(value.slice(s, e));
  const next = value.slice(0, s) + text + value.slice(e);
  setValue(next);
  requestAnimationFrame(() => {
    el.focus();
    const [a, b] = select ? [s + select[0], s + select[1]] : [s + text.length, s + text.length];
    el.setSelectionRange(a, b);
  });
}

const linePrefix = (prefix: string) => (sel: string) => {
  const text = (sel || '').split('\n').map((l) => prefix + l).join('\n') || prefix;
  return { text };
};

export function NotePage({ note, onOpenNote }: { note: NoteNode; onOpenNote: (id: ID) => void }) {
  const notes = useNotes((s) => s.notes);
  const updateNote = useNotes((s) => s.updateNote);
  const addNote = useNotes((s) => s.addNote);
  const [value, setValue] = useState(note.content);
  const [mode, setModeState] = useState<Mode>(() => {
    try {
      return (localStorage.getItem(MODE_KEY) as Mode) || (note.content ? 'preview' : 'split');
    } catch {
      return 'split';
    }
  });
  const [picking, setPicking] = useState(false);
  const areaRef = useRef<HTMLTextAreaElement>(null);
  const saved = useRef(note.content);

  // Show edits from collaborators or other devices, unless there's unsaved typing here.
  const valueNow = useRef(value);
  valueNow.current = value;
  useEffect(() => {
    if (note.content === saved.current || valueNow.current !== saved.current) return;
    saved.current = note.content;
    setValue(note.content);
  }, [note.content]);

  const setMode = (m: Mode) => {
    setModeState(m);
    try {
      localStorage.setItem(MODE_KEY, m);
    } catch {
      /* per-viewer convenience only */
    }
  };

  // Debounced save while typing; flush when switching notes or leaving.
  useEffect(() => {
    if (value === saved.current) return;
    const t = setTimeout(() => {
      saved.current = value;
      updateNote(note.id, { content: value });
    }, 500);
    return () => clearTimeout(t);
  }, [value, note.id, updateNote]);
  useEffect(
    () => () => {
      const el = areaRef.current;
      if (el && el.value !== saved.current) updateNote(note.id, { content: el.value });
    },
    [note.id, updateNote],
  );

  const isMissing = useCallback((title: string) => !findByTitle(notes, note.projectId, title), [notes, note.projectId]);

  const openTitle = (title: string) => {
    const target = findByTitle(notes, note.projectId, title);
    if (target) onOpenNote(target.id);
    else if (confirm(`There's no page called “${title}” yet. Create it?`)) onOpenNote(addNote(note.projectId, note.parentId, 'page', title));
  };

  const edit = (fn: Parameters<typeof applyEdit>[3]) => areaRef.current && applyEdit(areaRef.current, value, setValue, fn);

  const insertImage = async (file: File) => {
    const id = await saveImage(file, file.name);
    edit(() => ({ text: `![${file.name.replace(/\.[^.]+$/, '')}](asset:${id})` }));
  };

  const backlinks = notes.filter(
    (n) =>
      n.id !== note.id &&
      ((n.kind === 'page' && linkedTitles(n.content).includes(note.title.trim().toLowerCase())) ||
        (n.kind === 'board' && n.board?.nodes.some((b) => b.type === 'card' && b.data.noteIds.includes(note.id)))),
  );
  const linkable = notes.filter((n) => n.projectId === note.projectId && (n.kind === 'page' || n.kind === 'board') && n.id !== note.id);

  return (
    <div className="note-page">
      <div className="note-toolbar">
        <Segmented<Mode>
          value={mode}
          onChange={setMode}
          options={[
            { value: 'edit', label: 'Write' },
            { value: 'split', label: 'Split' },
            { value: 'preview', label: 'Read' },
          ]}
        />
        {mode !== 'preview' && (
          <div className="md-buttons">
            <button type="button" className="btn icon ghost sm" title="Bold (Ctrl+B)" onClick={() => edit((s) => ({ text: `**${s || 'bold'}**`, select: [2, 2 + (s || 'bold').length] }))}>
              <b>B</b>
            </button>
            <button type="button" className="btn icon ghost sm" title="Italic (Ctrl+I)" onClick={() => edit((s) => ({ text: `*${s || 'italic'}*`, select: [1, 1 + (s || 'italic').length] }))}>
              <i>I</i>
            </button>
            <button type="button" className="btn ghost sm" title="Heading" onClick={() => edit(linePrefix('## '))}>
              H
            </button>
            <button type="button" className="btn icon ghost sm" title="Bulleted list" onClick={() => edit(linePrefix('- '))}>
              <Icon name="list" size={14} />
            </button>
            <button type="button" className="btn icon ghost sm" title="Checklist" onClick={() => edit(linePrefix('- [ ] '))}>
              <Icon name="tasks" size={14} />
            </button>
            <button type="button" className="btn ghost sm mono" title="Code" onClick={() => edit((s) => (s.includes('\n') ? { text: `\n\`\`\`\n${s}\n\`\`\`\n` } : { text: `\`${s || 'code'}\`` }))}>
              {'</>'}
            </button>
            <button type="button" className="btn ghost sm" title="Table" onClick={() => edit(() => ({ text: '\n| Item | Notes |\n| --- | --- |\n|  |  |\n' }))}>
              Table
            </button>
            <button type="button" className={`btn ghost sm${picking ? ' is-on' : ''}`} title="Link to another note" onClick={() => setPicking(!picking)}>
              [[Link]]
            </button>
            <label className="btn icon ghost sm" title="Insert image">
              <Icon name="upload" size={14} />
              <input
                type="file"
                accept="image/*"
                hidden
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) insertImage(f);
                  e.target.value = '';
                }}
              />
            </label>
          </div>
        )}
        <span className="spacer" />
        <span className="small muted">
          {value !== saved.current ? 'Saving…' : `Saved ${new Date(note.updatedAt).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}`}
        </span>
      </div>

      {picking && mode !== 'preview' && (
        <div className="note-picker">
          {linkable.length === 0 ? (
            <span className="small muted">No other pages in this project yet. Type [[New page title]] to link one you'll create.</span>
          ) : (
            linkable.map((n) => (
              <button
                key={n.id}
                type="button"
                className="chip"
                onClick={() => {
                  edit(() => ({ text: `[[${n.title}]]` }));
                  setPicking(false);
                }}
              >
                <Icon name={n.kind === 'board' ? 'flow' : 'list'} size={12} /> {n.title}
              </button>
            ))
          )}
        </div>
      )}

      <div className={`note-body is-${mode}`}>
        {mode !== 'preview' && (
          <textarea
            ref={areaRef}
            className="note-source"
            value={value}
            spellCheck
            placeholder={'# Heading\n\nWrite in markdown. HTML and <style> work too.\nLink pages with [[Page title]]. Paste or drop images.'}
            onChange={(e) => setValue(e.target.value)}
            onBlur={() => {
              if (value !== saved.current) {
                saved.current = value;
                updateNote(note.id, { content: value });
              }
            }}
            onKeyDown={(e) => {
              if (e.key === 'Tab') {
                e.preventDefault();
                edit(() => ({ text: '  ' }));
              } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'b') {
                e.preventDefault();
                edit((s) => ({ text: `**${s || 'bold'}**`, select: [2, 2 + (s || 'bold').length] }));
              } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'i') {
                e.preventDefault();
                edit((s) => ({ text: `*${s || 'italic'}*`, select: [1, 1 + (s || 'italic').length] }));
              }
            }}
            onPaste={(e) => {
              const f = imageFrom(e.clipboardData);
              if (f) {
                e.preventDefault();
                insertImage(f);
              }
            }}
            onDrop={(e) => {
              const f = imageFrom(e.dataTransfer);
              if (f) {
                e.preventDefault();
                insertImage(f);
              }
            }}
          />
        )}
        {mode !== 'edit' && (
          <div className="note-preview">
            {value.trim() ? (
              <NoteRender
                source={value}
                isMissing={isMissing}
                onNoteLink={openTitle}
                onToggleTask={(i) => {
                  const next = toggleTask(value, i);
                  setValue(next);
                  saved.current = next;
                  updateNote(note.id, { content: next });
                }}
              />
            ) : (
              <p className="muted">Nothing here yet. Switch to Write or Split to start.</p>
            )}
          </div>
        )}
      </div>

      {backlinks.length > 0 && (
        <div className="backlinks">
          <span className="small muted">Linked from</span>
          {backlinks.map((n) => (
            <button key={n.id} type="button" className="chip" onClick={() => onOpenNote(n.id)}>
              <Icon name={n.kind === 'board' ? 'flow' : 'list'} size={12} /> {n.title}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
