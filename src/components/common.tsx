import { useEffect, type ReactNode } from 'react';
import type { Area, ID, Priority } from '../types';
import { priorityLabel } from '../lib/tasks';
import { useStore } from '../store';
import { sound } from '../lib/sound';

const ICONS: Record<string, ReactNode> = {
  check: <path d="M5 12.5l4.5 4.5L19 7.5" />,
  plus: <path d="M12 5v14M5 12h14" />,
  x: <path d="M18 6L6 18M6 6l12 12" />,
  left: <path d="M15 18l-6-6 6-6" />,
  right: <path d="M9 18l6-6-6-6" />,
  down: <path d="M6 9l6 6 6-6" />,
  trash: <path d="M4 7h16M9 7V4h6v3M6.5 7l1 13h9l1-13" />,
  edit: <path d="M4 20h4L19 9a2.8 2.8 0 0 0-4-4L4 16v4z" />,
  lock: (
    <>
      <rect x="5" y="11" width="14" height="10" rx="2" />
      <path d="M8 11V7.5a4 4 0 0 1 8 0V11" />
    </>
  ),
  play: <path d="M8 5l11 7-11 7z" fill="currentColor" />,
  stop: <rect x="6.5" y="6.5" width="11" height="11" rx="1.5" fill="currentColor" />,
  clock: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3.5 2" />
    </>
  ),
  tasks: (
    <>
      <rect x="4" y="4" width="16" height="16" rx="3" />
      <path d="M8.5 12l2.5 2.5 4.5-5" />
    </>
  ),
  habits: <path d="M17 3l3 3-3 3M4 11V9a3 3 0 0 1 3-3h13M7 21l-3-3 3-3M20 13v2a3 3 0 0 1-3 3H4" />,
  calendar: (
    <>
      <rect x="3.5" y="5" width="17" height="15.5" rx="2" />
      <path d="M8 3v4M16 3v4M3.5 10h17" />
    </>
  ),
  projects: <path d="M3.5 7.5a2 2 0 0 1 2-2h4l2 2h7a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z" />,
  areas: (
    <>
      <path d="M20.5 13.5A8.5 8.5 0 1 1 10.5 3.5v10z" />
      <path d="M14 3.2a8.5 8.5 0 0 1 6.8 6.8H14z" />
    </>
  ),
  settings: <path d="M4 21v-6M4 11V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1.5 15h5M9.5 8h5M17.5 16h5" />,
  flow: (
    <>
      <rect x="2.5" y="4" width="7" height="5" rx="1.5" />
      <rect x="14.5" y="4" width="7" height="5" rx="1.5" />
      <rect x="14.5" y="15" width="7" height="5" rx="1.5" />
      <path d="M9.5 6.5h5M12 6.5v11h2.5" />
    </>
  ),
  list: <path d="M9 6h11M9 12h11M9 18h11M4.5 6h.01M4.5 12h.01M4.5 18h.01" />,
  flame: <path d="M12 21a6 6 0 0 0 6-6c0-4-3-6-4-10-2 1.5-3 3.5-3 5.5C10 9 9 8 8.5 7 7 9 6 11.5 6 15a6 6 0 0 0 6 6z" />,
  layout: <path d="M4 6h5v5H4zM15 4h5v5h-5zM15 15h5v5h-5zM9 8.5h3.5V17H15M12.5 6.5H15" />,
  search: (
    <>
      <circle cx="11" cy="11" r="6.5" />
      <path d="M16 16l4.5 4.5" />
    </>
  ),
  copy: (
    <>
      <rect x="8.5" y="8.5" width="12" height="12" rx="2" />
      <path d="M15.5 8.5V5.5a2 2 0 0 0-2-2h-8a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h3" />
    </>
  ),
  heart:<path d="M12 20s-7.5-4.6-9.2-9.2C1.6 7.4 3.8 4.5 7 4.5c2 0 3.4 1.1 5 3 1.6-1.9 3-3 5-3 3.2 0 5.4 2.9 4.2 6.3C19.5 15.4 12 20 12 20z" />,
  wallet: (
    <>
      <path d="M4 7.5A2.5 2.5 0 0 1 6.5 5H18v3" />
      <rect x="4" y="8" width="17" height="11.5" rx="2.5" />
      <path d="M16.5 13.75h.01" />
    </>
  ),
  upload: <path d="M12 15V4M7.5 8.5 12 4l4.5 4.5M4.5 15v3a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2v-3" />,
  refresh: <path d="M20 11a8 8 0 0 0-14.5-4.5M4 4.5v4h4M4 13a8 8 0 0 0 14.5 4.5M20 19.5v-4h-4" />,
  journal: (
    <>
      <path d="M6 3.5h11a2 2 0 0 1 2 2v13a2 2 0 0 1-2 2H6z" />
      <path d="M6 3.5v17M9.5 8h6M9.5 11.5h4" />
    </>
  ),
  target: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <circle cx="12" cy="12" r="4.5" />
      <path d="M12 12h.01" />
    </>
  ),
  mail: (
    <>
      <rect x="3" y="5.5" width="18" height="13" rx="2" />
      <path d="M3.5 7l8.5 6 8.5-6" />
    </>
  ),
  link: <path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1" />,
  users: (
    <>
      <circle cx="9" cy="8.5" r="3.5" />
      <path d="M2.5 20a6.5 6.5 0 0 1 13 0M16 5.3a3.5 3.5 0 0 1 0 6.4M18 14.2a6.5 6.5 0 0 1 3.5 5.8" />
    </>
  ),
  grip: (
    <>
      <circle cx="9" cy="6" r="1.2" fill="currentColor" stroke="none" />
      <circle cx="15" cy="6" r="1.2" fill="currentColor" stroke="none" />
      <circle cx="9" cy="12" r="1.2" fill="currentColor" stroke="none" />
      <circle cx="15" cy="12" r="1.2" fill="currentColor" stroke="none" />
      <circle cx="9" cy="18" r="1.2" fill="currentColor" stroke="none" />
      <circle cx="15" cy="18" r="1.2" fill="currentColor" stroke="none" />
    </>
  ),
  tag: (
    <>
      <path d="M3.5 12.2V4.5a1 1 0 0 1 1-1h7.7l8.3 8.3a1.5 1.5 0 0 1 0 2.1l-6.1 6.1a1.5 1.5 0 0 1-2.1 0z" />
      <path d="M8 8h.01" />
    </>
  ),
};

export function Icon({ name, size = 16, className }: { name: keyof typeof ICONS | string; size?: number; className?: string }) {
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {ICONS[name]}
    </svg>
  );
}

export const areaColor = (area: Area | undefined | null) => (area ? `var(--series-${area.slot})` : 'var(--unassigned)');

export function useArea(id: ID | null | undefined) {
  return useStore((s) => (id ? s.areas.find((a) => a.id === id) : undefined));
}

export function AreaDot({ areaId, size = 8 }: { areaId: ID | null | undefined; size?: number }) {
  const area = useArea(areaId);
  return <span className="dot" style={{ width: size, height: size, background: areaColor(area) }} />;
}

export function AreaTag({ areaId }: { areaId: ID | null | undefined }) {
  const area = useArea(areaId);
  if (!area) return null;
  return (
    <span className="tag">
      <AreaDot areaId={areaId} />
      {area.name}
    </span>
  );
}

export function PriorityBadge({ priority, compact }: { priority: Priority; compact?: boolean }) {
  return (
    <span className={`prio prio-${priority}`} title={`${priorityLabel(priority)} priority`}>
      <span className="prio-bars" aria-hidden="true">
        <i />
        <i />
        <i />
      </span>
      {!compact && priorityLabel(priority)}
    </span>
  );
}

export function CheckButton({
  checked,
  onToggle,
  disabled,
  title,
  size = 'md',
}: {
  checked: boolean;
  onToggle: () => void;
  disabled?: boolean;
  title?: string;
  size?: 'sm' | 'md';
}) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      className={`check check-${size}${checked ? ' is-checked' : ''}`}
      disabled={disabled}
      title={title}
      onClick={(e) => {
        e.stopPropagation();
        sound(checked ? 'uncheck' : size === 'sm' ? 'tick' : 'check');
        onToggle();
      }}
    >
      {disabled && !checked ? <Icon name="lock" size={size === 'sm' ? 10 : 12} /> : checked && <Icon name="check" size={size === 'sm' ? 11 : 13} />}
    </button>
  );
}

export function Modal({
  title,
  onClose,
  children,
  footer,
  wide,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
}) {
  useEffect(() => sound('open'), []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`modal${wide ? ' modal-wide' : ''}`} role="dialog" aria-modal="true" aria-label={title}>
        <header className="modal-head">
          <h2>{title}</h2>
          <button className="btn icon ghost" onClick={onClose} aria-label="Close">
            <Icon name="x" />
          </button>
        </header>
        <div className="modal-body">{children}</div>
        {footer && <footer className="modal-foot">{footer}</footer>}
      </div>
    </div>
  );
}

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: ReactNode }) {
  return (
    <label className="field">
      <span className="field-label">{label}</span>
      {children}
      {hint && <span className="field-hint">{hint}</span>}
    </label>
  );
}

export function Segmented<T extends string | number>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: { value: T; label: ReactNode; disabled?: boolean; title?: string }[];
  onChange: (v: T) => void;
}) {
  return (
    <div className="seg" role="radiogroup">
      {options.map((o) => (
        <button
          key={String(o.value)}
          type="button"
          role="radio"
          aria-checked={o.value === value}
          className={o.value === value ? 'is-on' : ''}
          disabled={o.disabled}
          title={o.title}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function AreaSelect({
  value,
  onChange,
  emptyLabel = 'No area',
}: {
  value: ID | null;
  onChange: (id: ID | null) => void;
  emptyLabel?: string;
}) {
  const areas = useStore((s) => s.areas);
  return (
    <select className="input" value={value ?? ''} onChange={(e) => onChange(e.target.value || null)}>
      <option value="">{emptyLabel}</option>
      {areas.map((a) => (
        <option key={a.id} value={a.id}>
          {a.name}
        </option>
      ))}
    </select>
  );
}

export function Progress({ value, label }: { value: number; label?: string }) {
  const pct = Math.max(0, Math.min(1, value));
  return (
    <span className="progress" role="progressbar" aria-valuenow={Math.round(pct * 100)} aria-valuemin={0} aria-valuemax={100} aria-label={label}>
      <span style={{ width: `${pct * 100}%` }} />
    </span>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="empty">{children}</div>;
}
