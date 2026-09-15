import { useState, type CSSProperties } from 'react';
import { addTag, hasTag, normalizeTag, removeTag, tagSlot } from '../lib/tags';
import { Icon } from './common';

const tagStyle = (tag: string) => ({ '--tag': `var(--series-${tagSlot(tag)})` }) as CSSProperties;

/** Read-only tag chips. The dot carries the color; the text stays in normal ink. */
export function TaskTags({ tags, max = 3 }: { tags?: string[]; max?: number }) {
  if (!tags?.length) return null;
  const shown = tags.slice(0, max);
  return (
    <span className="task-tags">
      {shown.map((t) => (
        <span key={t} className="task-tag" style={tagStyle(t)}>
          {t}
        </span>
      ))}
      {tags.length > max && <span className="task-tag is-more">+{tags.length - max}</span>}
    </span>
  );
}

/** Toggleable tag chips for filtering. */
export function TagFilter({ tags, selected, onChange }: { tags: string[]; selected: string[]; onChange: (tags: string[]) => void }) {
  if (!tags.length) return null;
  return (
    <div className="tag-filter" role="group" aria-label="Filter by tag">
      <span className="small muted">
        <Icon name="tag" size={12} /> Tags
      </span>
      {tags.map((t) => {
        const on = hasTag(selected, t);
        return (
          <button
            key={t}
            type="button"
            role="checkbox"
            aria-checked={on}
            className={`task-tag is-toggle${on ? ' is-on' : ''}`}
            style={tagStyle(t)}
            onClick={() => onChange(on ? removeTag(selected, t) : addTag(selected, t))}
          >
            {t}
          </button>
        );
      })}
      {selected.length > 0 && (
        <button type="button" className="link small" onClick={() => onChange([])}>
          Clear
        </button>
      )}
    </div>
  );
}

/** Editable tags: type and press Enter or comma; suggestions come from tags already in use. */
export function TagInput({ tags, onChange, suggestions }: { tags: string[]; onChange: (tags: string[]) => void; suggestions: string[] }) {
  const [draft, setDraft] = useState('');
  const query = normalizeTag(draft).toLocaleLowerCase();
  const options = suggestions.filter((s) => !hasTag(tags, s) && (!query || s.toLocaleLowerCase().includes(query))).slice(0, 8);
  const commit = (value: string) => {
    const next = addTag(tags, value);
    if (next.length !== tags.length) onChange(next);
    setDraft('');
  };

  return (
    <div className="tag-input-wrap">
      <div className="tag-editor">
        {tags.map((t) => (
          <span key={t} className="task-tag is-editable" style={tagStyle(t)}>
            {t}
            <button type="button" aria-label={`Remove tag ${t}`} onClick={() => onChange(removeTag(tags, t))}>
              <Icon name="x" size={11} />
            </button>
          </span>
        ))}
        <input
          className="input bare tag-editor-input"
          value={draft}
          placeholder={tags.length ? 'Add tag' : 'Add tags, e.g. art, needs review'}
          aria-label="Add a tag"
          onChange={(e) => {
            const value = e.target.value;
            if (value.includes(',')) {
              let next = tags;
              for (const part of value.split(',').slice(0, -1)) next = addTag(next, part);
              if (next !== tags) onChange(next);
              setDraft(value.split(',').at(-1) ?? '');
            } else {
              setDraft(value);
            }
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && draft.trim()) {
              e.preventDefault();
              e.stopPropagation();
              commit(draft);
            } else if (e.key === 'Backspace' && !draft && tags.length) {
              onChange(tags.slice(0, -1));
            }
          }}
          onBlur={() => draft.trim() && commit(draft)}
        />
      </div>
      {options.length > 0 && (
        <div className="tag-suggestions">
          {options.map((s) => (
            <button
              key={s}
              type="button"
              className="task-tag is-toggle"
              style={tagStyle(s)}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => commit(s)}
            >
              <Icon name="plus" size={10} /> {s}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
