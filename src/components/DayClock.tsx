import { useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import type { DateKey, ID, Minutes } from '../types';
import { useStore } from '../store';
import { useUI } from '../ui';
import { assignLanes, planForDate } from '../lib/plan';
import { fmtClock, fmtDuration, fmtHours, nowMinutes, toKey } from '../lib/dates';
import { byId } from '../lib/tasks';
import { useNow } from '../lib/hooks';

const S = 480;
const C = S / 2;
const PLAN = { r0: 160, r1: 200 };
const LOG = { r0: 124, r1: 150 };
const GAP_PX = 2;
const SNAP = 15;

const polar = (r: number, m: number): [number, number] => {
  const a = (m / 1440) * Math.PI * 2 - Math.PI / 2;
  return [C + r * Math.cos(a), C + r * Math.sin(a)];
};

const pt = (p: [number, number]) => `${p[0].toFixed(2)} ${p[1].toFixed(2)}`;

/** Annular sector from minute m0 to m1 between radii r0 < r1. */
function sector(r0: number, r1: number, m0: number, m1: number) {
  m1 = Math.min(m1, m0 + 1439.5);
  const large = m1 - m0 > 720 ? 1 : 0;
  return `M ${pt(polar(r1, m0))} A ${r1} ${r1} 0 ${large} 1 ${pt(polar(r1, m1))} L ${pt(polar(r0, m1))} A ${r0} ${r0} 0 ${large} 0 ${pt(polar(r0, m0))} Z`;
}

/** Arc path along radius r for text; reversed on the lower half so labels stay upright. */
function labelArc(r: number, m0: number, m1: number) {
  const mid = (m0 + m1) / 2;
  const flip = mid > 360 && mid < 1080;
  const large = m1 - m0 > 720 ? 1 : 0;
  return flip
    ? `M ${pt(polar(r, m1))} A ${r} ${r} 0 ${large} 0 ${pt(polar(r, m0))}`
    : `M ${pt(polar(r, m0))} A ${r} ${r} 0 ${large} 1 ${pt(polar(r, m1))}`;
}

/** Shave a surface-colored gap off both ends of an arc, measured in pixels at radius r. */
const gapMinutes = (r: number) => (GAP_PX / 2 / (2 * Math.PI * r)) * 1440;

const truncate = (s: string, n: number) => (s.length <= n ? s : s.slice(0, Math.max(1, n - 1)) + '…');

interface Arc {
  key: string;
  ring: 'plan' | 'log';
  kind: 'block' | 'habit' | 'entry' | 'timer';
  id: ID | null;
  title: string;
  start: Minutes;
  end: Minutes;
  slot: number | null;
  areaName: string | null;
  pending?: boolean;
  lane: number;
  lanes: number;
}

type Drag = { ring: 'plan' | 'log'; a: number; b: number };

export function DayClock({ date }: { date: DateKey }) {
  const blocks = useStore((s) => s.blocks);
  const habits = useStore((s) => s.habits);
  const entries = useStore((s) => s.entries);
  const timer = useStore((s) => s.timer);
  const areaList = useStore((s) => s.areas);
  const open = useUI((s) => s.open);
  const now = useNow(15_000);
  const isToday = date === toKey(now);
  const nowMin = nowMinutes(now);

  const svgRef = useRef<SVGSVGElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<{ arc: Arc; x: number; y: number } | null>(null);
  const [drag, setDrag] = useState<Drag | null>(null);

  const plan = useMemo(() => planForDate({ blocks, habits }, date), [blocks, habits, date]);

  const arcs = useMemo(() => {
    const areas = byId(areaList);
    const area = (id: ID | null) => (id ? areas[id] : undefined);
    const planLanes = assignLanes(plan);
    const out: Arc[] = plan.map((p, i) => ({
      key: p.key,
      ring: 'plan',
      kind: p.kind,
      id: p.id,
      title: p.title,
      start: p.start,
      end: p.end,
      slot: area(p.areaId)?.slot ?? null,
      areaName: area(p.areaId)?.name ?? null,
      pending: p.kind === 'habit' && !p.done,
      lane: planLanes.lanes[i],
      lanes: planLanes.count,
    }));
    const logged: Omit<Arc, 'lane' | 'lanes'>[] = entries
      .filter((e) => e.date === date)
      .map((e) => ({
        key: `e:${e.id}`,
        ring: 'log',
        kind: 'entry',
        id: e.id,
        title: e.label,
        start: e.start,
        end: e.end,
        slot: area(e.areaId)?.slot ?? null,
        areaName: area(e.areaId)?.name ?? null,
      }));
    if (timer) {
      const started = new Date(timer.startedAt);
      const startDay = toKey(started);
      if (isToday && startDay <= date) {
        logged.push({
          key: 'timer',
          ring: 'log',
          kind: 'timer',
          id: null,
          title: timer.label || 'Timer',
          start: startDay === date ? nowMinutes(started) : 0,
          end: Math.max(nowMin, (startDay === date ? nowMinutes(started) : 0) + 1),
          slot: area(timer.areaId)?.slot ?? null,
          areaName: area(timer.areaId)?.name ?? null,
        });
      }
    }
    const logLanes = assignLanes(logged);
    return [...out, ...logged.map((l, i) => ({ ...l, lane: logLanes.lanes[i], lanes: logLanes.count }))];
  }, [plan, entries, timer, areaList, date, isToday, nowMin]);

  const toMinute = (e: { clientX: number; clientY: number }) => {
    const rect = svgRef.current!.getBoundingClientRect();
    const scale = S / rect.width;
    const x = (e.clientX - rect.left) * scale - C;
    const y = (e.clientY - rect.top) * scale - C;
    let deg = (Math.atan2(y, x) * 180) / Math.PI + 90;
    if (deg < 0) deg += 360;
    return (deg / 360) * 1440;
  };

  const snap = (m: number) => Math.max(0, Math.min(1440, Math.round(m / SNAP) * SNAP));

  const beginDrag = (ring: 'plan' | 'log') => (e: ReactPointerEvent) => {
    if (e.button !== 0) return;
    svgRef.current!.setPointerCapture(e.pointerId);
    const m = toMinute(e);
    setHover(null);
    setDrag({ ring, a: m, b: m });
  };

  const moveDrag = (e: ReactPointerEvent) => {
    if (!drag) return;
    const m = toMinute(e);
    // Unwrap so dragging across midnight doesn't jump to the other side of the dial.
    const candidates = [m - 1440, m, m + 1440];
    const next = candidates.reduce((best, c) => (Math.abs(c - drag.b) < Math.abs(best - drag.b) ? c : best));
    setDrag({ ...drag, b: Math.max(0, Math.min(1440, next)) });
  };

  const endDrag = () => {
    if (!drag) return;
    let start = snap(Math.min(drag.a, drag.b));
    let end = snap(Math.max(drag.a, drag.b));
    if (end - start < SNAP) {
      start = Math.min(snap(drag.a - SNAP / 2), 1380);
      end = start + 60;
    }
    setDrag(null);
    if (drag.ring === 'plan') open({ kind: 'block', id: null, draft: { date, start, end } });
    else open({ kind: 'entry', id: null, draft: { date, start, end } });
  };

  const openArc = (arc: Arc) => {
    if (!arc.id) return;
    if (arc.kind === 'block') open({ kind: 'block', id: arc.id, on: date });
    else if (arc.kind === 'habit') open({ kind: 'habit', id: arc.id });
    else if (arc.kind === 'entry') open({ kind: 'entry', id: arc.id });
  };

  const showHover = (arc: Arc, e: ReactPointerEvent) => {
    if (drag) return;
    const rect = wrapRef.current!.getBoundingClientRect();
    setHover({ arc, x: e.clientX - rect.left, y: e.clientY - rect.top });
  };

  // Center readout
  const current = isToday ? plan.find((p) => p.start <= nowMin && nowMin < p.end) : undefined;
  const next = isToday ? plan.find((p) => p.start > nowMin) : undefined;
  const plannedMin = plan.reduce((s, p) => s + p.end - p.start, 0);
  const loggedMin = arcs.filter((a) => a.ring === 'log').reduce((s, a) => s + a.end - a.start, 0);

  const renderArc = (arc: Arc) => {
    const ring = arc.ring === 'plan' ? PLAN : LOG;
    const laneW = (ring.r1 - ring.r0 - GAP_PX * (arc.lanes - 1)) / arc.lanes;
    let r1 = ring.r1 - arc.lane * (laneW + GAP_PX);
    let r0 = r1 - laneW;
    const g = gapMinutes(r1);
    const m0 = arc.start + g;
    const m1 = arc.end - g;
    if (m1 <= m0) return null;
    const fill = arc.slot ? `var(--series-${arc.slot})` : 'var(--unassigned)';
    const ink = arc.slot ? `var(--on-series-${arc.slot})` : 'var(--ink)';
    // Pending habits are drawn hollow; inset them so the outline stays inside the lane.
    if (arc.pending) {
      r0 += 0.75;
      r1 -= 0.75;
    }
    const rMid = (r0 + r1) / 2;
    const arcLen = ((m1 - m0) / 1440) * 2 * Math.PI * rMid;
    const fits = Math.floor((arcLen - 14) / 6.4);
    const showLabel = arc.ring === 'plan' && laneW >= 16 && fits >= 4;
    const pathId = `lbl-${arc.key.replace(/[^a-z0-9]/gi, '')}`;
    const prefix = arc.kind === 'habit' && !arc.pending ? '✓ ' : '';
    return (
      <g
        key={arc.key}
        className={`clock-arc${arc.pending ? ' is-pending' : ''}${arc.kind === 'timer' ? ' is-running' : ''}`}
        onPointerMove={(e) => showHover(arc, e)}
        onPointerLeave={() => setHover(null)}
        onClick={() => openArc(arc)}
        role={arc.id ? 'button' : undefined}
        aria-label={`${arc.title}, ${fmtClock(arc.start)} to ${fmtClock(arc.end)}`}
      >
        <path d={sector(r0, r1, m0, m1)} fill={fill} color={fill} className="clock-arc-fill" />
        {showLabel && (
          <>
            <path id={pathId} d={labelArc(rMid, m0, m1)} fill="none" stroke="none" />
            <text className="clock-arc-label" fill={arc.pending ? 'var(--ink)' : ink} dominantBaseline="central">
              <textPath href={`#${pathId}`} startOffset="50%" textAnchor="middle">
                {truncate(prefix + arc.title, fits)}
              </textPath>
            </text>
          </>
        )}
      </g>
    );
  };

  const dragArc = drag && (() => {
    const ring = drag.ring === 'plan' ? PLAN : LOG;
    const a = snap(Math.min(drag.a, drag.b));
    const b = snap(Math.max(drag.a, drag.b));
    return { path: b > a ? sector(ring.r0, ring.r1, a, b) : null, a, b };
  })();

  return (
    <div className="clock" ref={wrapRef}>
      <svg
        ref={svgRef}
        viewBox={`0 0 ${S} ${S}`}
        className={`clock-svg${drag ? ' is-dragging' : ''}`}
        onPointerMove={moveDrag}
        onPointerUp={endDrag}
        onPointerCancel={() => setDrag(null)}
      >
        {/* Tracks double as drag-to-create targets */}
        <path
          className="clock-track"
          d={sector(PLAN.r0, PLAN.r1, 0, 1439.99)}
          onPointerDown={beginDrag('plan')}
        >
          <title>Drag to block out time</title>
        </path>
        <path className="clock-track" d={sector(LOG.r0, LOG.r1, 0, 1439.99)} onPointerDown={beginDrag('log')}>
          <title>Drag to log time spent</title>
        </path>

        {Array.from({ length: 24 }, (_, h) => {
          const m = h * 60;
          const major = h % 3 === 0;
          const [x0, y0] = polar(LOG.r0, m);
          const [x1, y1] = polar(PLAN.r1, m);
          const [tx0, ty0] = polar(PLAN.r1 + 4, m);
          const [tx1, ty1] = polar(PLAN.r1 + (major ? 12 : 8), m);
          const [lx, ly] = polar(PLAN.r1 + 25, m);
          return (
            <g key={h} className="clock-hour">
              <line x1={x0} y1={y0} x2={x1} y2={y1} className="clock-grid" />
              <line x1={tx0} y1={ty0} x2={tx1} y2={ty1} className={major ? 'clock-tick major' : 'clock-tick'} />
              {major && (
                <text x={lx} y={ly} className="clock-hour-label" textAnchor="middle" dominantBaseline="central">
                  {String(h).padStart(2, '0')}
                </text>
              )}
            </g>
          );
        })}

        {arcs.map(renderArc)}

        {dragArc?.path && <path d={dragArc.path} className="clock-drag" />}

        {isToday && (
          <g className="clock-hand" pointerEvents="none">
            <line
              x1={polar(LOG.r0 - 10, nowMin)[0]}
              y1={polar(LOG.r0 - 10, nowMin)[1]}
              x2={polar(PLAN.r1 + 6, nowMin)[0]}
              y2={polar(PLAN.r1 + 6, nowMin)[1]}
            />
            <circle cx={polar(PLAN.r1 + 6, nowMin)[0]} cy={polar(PLAN.r1 + 6, nowMin)[1]} r={4.5} />
          </g>
        )}

        <g className="clock-center" pointerEvents="none">
          {dragArc ? (
            <>
              <text x={C} y={C - 10} textAnchor="middle" className="clock-big">
                {fmtClock(dragArc.a)}–{fmtClock(dragArc.b)}
              </text>
              <text x={C} y={C + 22} textAnchor="middle" className="clock-sub">
                {drag.ring === 'plan' ? 'Block out' : 'Log'} {fmtDuration(Math.max(SNAP, dragArc.b - dragArc.a))}
              </text>
            </>
          ) : isToday ? (
            <>
              <text x={C} y={C - 18} textAnchor="middle" className="clock-big">
                {fmtClock(nowMin)}
              </text>
              <text x={C} y={C + 14} textAnchor="middle" className="clock-sub">
                {current ? truncate(`Now · ${current.title}`, 26) : 'Unplanned time'}
              </text>
              <text x={C} y={C + 34} textAnchor="middle" className="clock-muted">
                {next ? truncate(`Next · ${fmtClock(next.start)} ${next.title}`, 28) : 'Nothing else planned'}
              </text>
            </>
          ) : (
            <>
              <text x={C} y={C - 8} textAnchor="middle" className="clock-mid">
                {fmtHours(plannedMin)} planned
              </text>
              <text x={C} y={C + 18} textAnchor="middle" className="clock-sub">
                {fmtHours(loggedMin)} logged
              </text>
            </>
          )}
        </g>
      </svg>

      {hover && (
        <div
          className="tooltip"
          style={{ left: hover.x, top: hover.y }}
          role="tooltip"
        >
          <div className="tooltip-title">
            <span className="dot" style={{ background: hover.arc.slot ? `var(--series-${hover.arc.slot})` : 'var(--unassigned)' }} />
            {hover.arc.title || 'Untitled'}
          </div>
          <div className="tooltip-row">
            {fmtClock(hover.arc.start)}–{fmtClock(hover.arc.end)} · {fmtDuration(hover.arc.end - hover.arc.start)}
          </div>
          <div className="tooltip-row muted">
            {hover.arc.kind === 'habit'
              ? hover.arc.pending
                ? 'Habit · not done yet'
                : 'Habit · done'
              : hover.arc.kind === 'block'
                ? 'Planned block'
                : hover.arc.kind === 'timer'
                  ? 'Timer running'
                  : 'Logged time'}
            {hover.arc.areaName && ` · ${hover.arc.areaName}`}
          </div>
        </div>
      )}

      <div className="clock-key">
        <span>
          <i className="key-ring plan" /> Outer ring: planned
        </span>
        <span>
          <i className="key-ring log" /> Inner ring: logged
        </span>
        <span className="muted">Drag a ring to add</span>
      </div>
    </div>
  );
}
