import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import type { DateKey, ID, Task } from '../types';
import { useStore } from '../store';
import { useUI } from '../ui';
import { Empty, Icon, PriorityBadge } from '../components/common';
import { addDays, diffDays, fmtMonth, fromKey, monthGrid, todayKey, WEEKDAY_SHORT } from '../lib/dates';
import { byId, compareTasks, isLocked, taskArea, taskSpan } from '../lib/tasks';
import { isScheduled } from '../lib/habits';
import { navigate } from '../lib/hooks';
import { useTasksForMe } from '../cloud/ui/Assignees';

/** Rows of task bars per week before the rest collapse into "+N more". */
const MAX_LANES = 5;

interface Segment {
  task: Task;
  col: number;
  len: number;
  lane: number;
  contLeft: boolean;
  contRight: boolean;
}

export function CalendarView({ month }: { month?: string }) {
  const today = todayKey();
  const [year, monthIdx] = month && /^\d{4}-\d{2}$/.test(month)
    ? [Number(month.slice(0, 4)), Number(month.slice(5)) - 1]
    : [fromKey(today).getFullYear(), fromKey(today).getMonth()];
  const weekStartsOn = useStore((s) => s.settings.weekStartsOn);
  const tasks = useStore((s) => s.tasks);
  const projects = useStore((s) => s.projects);
  const areas = useStore((s) => s.areas);
  const habits = useStore((s) => s.habits);
  const updateTask = useStore((s) => s.updateTask);
  const open = useUI((s) => s.open);
  const [showDone, setShowDone] = useState(true);

  const cells = monthGrid(year, monthIdx, weekStartsOn);
  const weeks = Array.from({ length: 6 }, (_, i) => cells.slice(i * 7, i * 7 + 7));
  const taskMap = useMemo(() => byId(tasks), [tasks]);
  const projectMap = useMemo(() => byId(projects), [projects]);
  const areaMap = useMemo(() => byId(areas), [areas]);

  const mine = useTasksForMe(tasks);
  const dated = mine.filter((t) => taskSpan(t) && (showDone || t.status !== 'done'));
  const unscheduled = mine.filter((t) => !taskSpan(t) && t.status !== 'done').sort(compareTasks);

  // Drag across days to create a multi-day task.
  const [sel, setSel] = useState<{ a: DateKey; b: DateKey } | null>(null);
  const selRef = useRef(sel);
  selRef.current = sel;
  useEffect(() => {
    const up = () => {
      const s = selRef.current;
      if (!s) return;
      setSel(null);
      const [startDate, endDate] = s.a <= s.b ? [s.a, s.b] : [s.b, s.a];
      open({ kind: 'task', id: null, draft: { startDate, endDate } });
    };
    window.addEventListener('mouseup', up);
    return () => window.removeEventListener('mouseup', up);
  }, [open]);

  // Drag a task (bar or unscheduled chip) onto a day to (re)schedule it, keeping its length.
  const dragInfo = useRef<{ taskId: ID; offset: number; length: number } | null>(null);
  const [dropAt, setDropAt] = useState<DateKey | null>(null);
  const dropRange = dropAt && dragInfo.current
    ? [addDays(dropAt, -dragInfo.current.offset), addDays(dropAt, -dragInfo.current.offset + dragInfo.current.length - 1)]
    : null;

  const drop = (date: DateKey) => {
    const info = dragInfo.current;
    setDropAt(null);
    if (!info) return;
    const startDate = addDays(date, -info.offset);
    updateTask(info.taskId, { startDate, endDate: addDays(startDate, info.length - 1) });
    dragInfo.current = null;
  };

  const inSel = (d: DateKey) => {
    if (sel) return (sel.a <= d && d <= sel.b) || (sel.b <= d && d <= sel.a);
    if (dropRange) return dropRange[0] <= d && d <= dropRange[1];
    return false;
  };

  const monthParam = (offset: number) => {
    const dt = new Date(year, monthIdx + offset, 1);
    return `calendar/${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}`;
  };

  const barColor = (t: Task) => {
    const area = areaMap[taskArea(t, projectMap) ?? ''];
    return area ? `var(--series-${area.slot})` : 'var(--unassigned)';
  };

  return (
    <div className="page page-wide">
      <header className="page-head">
        <div>
          <h1>{fmtMonth(year, monthIdx)}</h1>
          <p className="page-sub">Drag across days to add a task. Drag a task to move it.</p>
        </div>
        <div className="date-nav">
          <label className="toggle small">
            <input type="checkbox" checked={showDone} onChange={(e) => setShowDone(e.target.checked)} /> Show done
          </label>
          <button className="btn icon" aria-label="Previous month" onClick={() => navigate(monthParam(-1))}>
            <Icon name="left" />
          </button>
          <button className="btn" onClick={() => navigate('calendar')}>
            This month
          </button>
          <button className="btn icon" aria-label="Next month" onClick={() => navigate(monthParam(1))}>
            <Icon name="right" />
          </button>
        </div>
      </header>

      <div className="calendar-layout">
        <div className={`calendar${sel ? ' is-selecting' : ''}`} onDragEnd={() => setDropAt(null)}>
          <div className="cal-head">
            {weeks[0].map((d) => (
              <span key={d}>{WEEKDAY_SHORT[fromKey(d).getDay()]}</span>
            ))}
          </div>
          {weeks.map((week) => {
            const ws = week[0];
            const we = week[6];
            const segs: Segment[] = dated
              .map((task) => {
                const [s, e] = taskSpan(task)!;
                if (e < ws || s > we) return null;
                const a = s < ws ? ws : s;
                const b = e > we ? we : e;
                return { task, col: diffDays(ws, a), len: diffDays(a, b) + 1, lane: 0, contLeft: s < ws, contRight: e > we };
              })
              .filter((x): x is Segment => !!x)
              .sort((x, y) => x.col - y.col || y.len - x.len || compareTasks(x.task, y.task));
            const laneEnds: number[] = [];
            const hidden = new Array(7).fill(0);
            for (const seg of segs) {
              let lane = laneEnds.findIndex((end) => end < seg.col);
              if (lane === -1) lane = laneEnds.length;
              laneEnds[lane] = seg.col + seg.len - 1;
              seg.lane = lane;
              if (lane >= MAX_LANES) for (let c = seg.col; c < seg.col + seg.len; c++) hidden[c]++;
            }
            const lanes = Math.max(2, Math.min(MAX_LANES, laneEnds.length));
            return (
              <div key={ws} className="cal-week" style={{ gridTemplateRows: `28px repeat(${lanes}, 24px) minmax(22px, 1fr)` }}>
                {week.map((d, i) => {
                  const inMonth = fromKey(d).getMonth() === monthIdx;
                  const scheduled = d <= today ? habits.filter((h) => !h.archived && isScheduled(h, d)) : [];
                  const doneCount = scheduled.filter((h) => h.log[d]?.done).length;
                  return (
                    <div
                      key={d}
                      className={`cal-day${inMonth ? '' : ' is-outside'}${d === today ? ' is-today' : ''}${inSel(d) ? ' is-selected' : ''}`}
                      style={{ gridColumn: i + 1, gridRow: '1 / -1' }}
                      onMouseDown={(e) => {
                        if (e.button === 0) {
                          e.preventDefault();
                          setSel({ a: d, b: d });
                        }
                      }}
                      onMouseEnter={() => sel && setSel({ ...sel, b: d })}
                      onDragOver={(e) => {
                        e.preventDefault();
                        if (dropAt !== d) setDropAt(d);
                      }}
                      onDrop={(e) => {
                        e.preventDefault();
                        drop(d);
                      }}
                    >
                      <div className="cal-day-head">
                        <button
                          className="cal-date"
                          onMouseDown={(e) => e.stopPropagation()}
                          onClick={() => navigate(d === today ? 'today' : `today/${d}`)}
                          title="Open this day"
                        >
                          {fromKey(d).getDate()}
                        </button>
                        {scheduled.length > 0 && (
                          <span className="cal-habits" title={`${doneCount} of ${scheduled.length} habits done`}>
                            <Icon name="habits" size={11} /> {doneCount}/{scheduled.length}
                          </span>
                        )}
                      </div>
                      {hidden[i] > 0 && (
                        <button
                          className="cal-more"
                          onMouseDown={(e) => e.stopPropagation()}
                          onClick={() => navigate(`today/${d}`)}
                        >
                          +{hidden[i]} more
                        </button>
                      )}
                    </div>
                  );
                })}
                {segs
                  .filter((s) => s.lane < MAX_LANES)
                  .map((seg) => {
                    const locked = seg.task.status !== 'done' && isLocked(seg.task, taskMap);
                    return (
                      <div
                        key={seg.task.id}
                        className={`cal-bar${seg.task.status === 'done' ? ' is-done' : ''}${seg.contLeft ? ' cont-left' : ''}${seg.contRight ? ' cont-right' : ''}`}
                        style={{ gridColumn: `${seg.col + 1} / span ${seg.len}`, gridRow: seg.lane + 2, '--bar': barColor(seg.task) } as CSSProperties}
                        draggable
                        title={seg.task.title}
                        onMouseDown={(e) => e.stopPropagation()}
                        onClick={() => open({ kind: 'task', id: seg.task.id })}
                        onDragStart={(e) => {
                          const [s, en] = taskSpan(seg.task)!;
                          const rect = e.currentTarget.getBoundingClientRect();
                          const dayW = rect.width / seg.len;
                          const inSeg = Math.min(seg.len - 1, Math.floor((e.clientX - rect.left) / dayW));
                          dragInfo.current = {
                            taskId: seg.task.id,
                            offset: inSeg + diffDays(s, addDays(ws, seg.col)),
                            length: diffDays(s, en) + 1,
                          };
                          e.dataTransfer.effectAllowed = 'move';
                          e.dataTransfer.setData('text/plain', seg.task.title);
                        }}
                      >
                        {locked && <Icon name="lock" size={11} />}
                        {seg.task.status === 'done' && <Icon name="check" size={11} />}
                        <span className="cal-bar-text">{seg.task.title}</span>
                      </div>
                    );
                  })}
              </div>
            );
          })}
        </div>

        <aside className="card unscheduled">
          <h3 className="card-title">Unscheduled</h3>
          <p className="small muted">Drag onto a day to schedule.</p>
          {unscheduled.length === 0 ? (
            <Empty>Everything open has a date.</Empty>
          ) : (
            <div className="unscheduled-list">
              {unscheduled.map((t) => (
                <div
                  key={t.id}
                  className="unscheduled-item"
                  draggable
                  style={{ '--bar': barColor(t) } as CSSProperties}
                  onDragStart={(e) => {
                    dragInfo.current = { taskId: t.id, offset: 0, length: 1 };
                    e.dataTransfer.effectAllowed = 'move';
                    e.dataTransfer.setData('text/plain', t.title);
                  }}
                  onClick={() => open({ kind: 'task', id: t.id })}
                >
                  <span className="unscheduled-title">{t.title}</span>
                  <PriorityBadge priority={t.priority} compact />
                </div>
              ))}
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}
