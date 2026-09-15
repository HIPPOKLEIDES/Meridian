import { useMemo, useState } from 'react';
import type { Area, DateKey, Habit, ID } from '../types';
import { addDays, diffDays, fmtDateShort, fmtHours, fmtDuration, fromKey, startOfWeek, WEEKDAY_LETTER } from '../lib/dates';
import { effectiveStart, isScheduled, strengthLabel, strengthSeries } from '../lib/habits';
import { useSize } from '../lib/hooks';
import { useStore } from '../store';

const pct = (v: number) => `${Math.round(v * 100)}%`;

/** Column/bar with a 4px rounded data-end and a square baseline. */
function topRounded(x: number, y: number, w: number, h: number, r = 4) {
  const rr = Math.max(0, Math.min(r, h / 2, w / 2));
  return `M${x} ${y + h}V${y + rr}Q${x} ${y} ${x + rr} ${y}H${x + w - rr}Q${x + w} ${y} ${x + w} ${y + rr}V${y + h}Z`;
}

export function StrengthChart({ habit, today, color }: { habit: Habit; today: DateKey; color: string }) {
  const [ref, { width }] = useSize<HTMLDivElement>();
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  const series = useMemo(() => strengthSeries(habit, today, today), [habit, today]);

  const H = 200;
  const pad = { l: 40, r: 44, t: 14, b: 26 };
  const innerW = Math.max(10, width - pad.l - pad.r);
  const innerH = H - pad.t - pad.b;

  if (series.length < 2) {
    return (
      <div ref={ref} className="chart-empty">
        Check this habit off a few times and its strength curve will appear here.
      </div>
    );
  }

  const first = series[0].date;
  const span = Math.max(1, diffDays(first, series[series.length - 1].date));
  const x = (d: DateKey) => pad.l + (diffDays(first, d) / span) * innerW;
  const y = (v: number) => pad.t + (1 - v) * innerH;
  const line = series.map((p, i) => `${i ? 'L' : 'M'}${x(p.date).toFixed(1)} ${y(p.value).toFixed(1)}`).join('');
  const area = `${line}L${x(series[series.length - 1].date).toFixed(1)} ${y(0)}L${x(first).toFixed(1)} ${y(0)}Z`;
  const last = series[series.length - 1];
  const hovered = hoverIdx !== null ? series[hoverIdx] : null;
  const mid = series[Math.floor(series.length / 2)];

  const onMove = (e: React.PointerEvent<SVGRectElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const frac = (e.clientX - rect.left) / rect.width;
    const target = frac * span;
    let best = 0;
    series.forEach((p, i) => {
      if (Math.abs(diffDays(first, p.date) - target) < Math.abs(diffDays(first, series[best].date) - target)) best = i;
    });
    setHoverIdx(best);
  };

  return (
    <div ref={ref} className="chart">
      {width > 0 && (
        <svg width={width} height={H} role="img" aria-label={`Habit strength, currently ${pct(last.value)}`}>
          {[0, 0.5, 1].map((v) => (
            <g key={v}>
              <line x1={pad.l} x2={pad.l + innerW} y1={y(v)} y2={y(v)} className={v === 0 ? 'axis-line' : 'grid-line'} />
              <text x={pad.l - 8} y={y(v)} className="axis-label" textAnchor="end" dominantBaseline="central">
                {pct(v)}
              </text>
            </g>
          ))}
          <line x1={pad.l} x2={pad.l + innerW} y1={y(0.9)} y2={y(0.9)} className="grid-line" />
          <text x={pad.l + 4} y={y(0.9) - 7} className="axis-label">
            engrained
          </text>
          <path d={area} fill={color} opacity={0.1} />
          <path d={line} fill="none" stroke={color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
          <circle cx={x(last.date)} cy={y(last.value)} r={4} fill={color} stroke="var(--surface)" strokeWidth={2} />
          <text x={x(last.date) + 8} y={y(last.value)} className="value-label" dominantBaseline="central">
            {pct(last.value)}
          </text>
          {[first, mid.date, last.date]
            .filter((d, i, arr) => arr.indexOf(d) === i)
            .map((d, i, arr) => (
              <text
                key={d}
                x={x(d)}
                y={H - 8}
                className="axis-label"
                textAnchor={i === 0 ? 'start' : i === arr.length - 1 ? 'end' : 'middle'}
              >
                {fmtDateShort(d)}
              </text>
            ))}
          {hovered && (
            <g pointerEvents="none">
              <line x1={x(hovered.date)} x2={x(hovered.date)} y1={pad.t} y2={y(0)} className="crosshair" />
              <circle cx={x(hovered.date)} cy={y(hovered.value)} r={4} fill={color} stroke="var(--surface)" strokeWidth={2} />
            </g>
          )}
          <rect
            x={pad.l}
            y={pad.t}
            width={innerW}
            height={innerH}
            fill="transparent"
            onPointerMove={onMove}
            onPointerLeave={() => setHoverIdx(null)}
          />
        </svg>
      )}
      {hovered && (
        <div
          className="tooltip"
          style={{ left: x(hovered.date), top: y(hovered.value) }}
        >
          <div className="tooltip-title">{fmtDateShort(hovered.date)}</div>
          <div className="tooltip-row">
            Strength {pct(hovered.value)} · {strengthLabel(hovered.value)}
          </div>
          <div className="tooltip-row muted">{hovered.done ? 'Completed' : 'Missed'}</div>
        </div>
      )}
    </div>
  );
}

/** Last N weeks of a habit as a grid; click a past day to toggle it. */
export function CompletionGrid({ habit, today, color, weeks = 18 }: { habit: Habit; today: DateKey; color: string; weeks?: number }) {
  const toggle = useStore((s) => s.toggleHabit);
  const weekStartsOn = useStore((s) => s.settings.weekStartsOn);
  const start = addDays(startOfWeek(today, weekStartsOn), -(weeks - 1) * 7);
  const rows = Array.from({ length: 7 }, (_, r) => (r + weekStartsOn) % 7);
  const habitStart = effectiveStart(habit);
  return (
    <div className="grid-chart" role="grid" aria-label="Completion history">
      <div className="grid-chart-days" aria-hidden="true">
        {rows.map((d, i) => (
          <span key={i}>{i % 2 === 0 ? WEEKDAY_LETTER[d] : ''}</span>
        ))}
      </div>
      <div className="grid-chart-cells" style={{ gridTemplateColumns: `repeat(${weeks}, 1fr)` }}>
        {Array.from({ length: weeks * 7 }, (_, i) => {
          const date = addDays(start, i);
          const future = date > today;
          const done = !!habit.log[date]?.done;
          const scheduled = isScheduled(habit, date);
          const state = future
            ? 'future'
            : done
              ? 'done'
              : date < habitStart
                ? 'before'
                : scheduled
                  ? date === today
                    ? 'pending'
                    : 'missed'
                  : 'off';
          const label = `${fromKey(date).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })}: ${
            { future: 'upcoming', done: 'done', pending: 'due today', missed: 'missed', off: 'not scheduled', before: 'before tracking started' }[state]
          }`;
          return (
            <button
              key={date}
              type="button"
              className={`grid-cell is-${state}`}
              style={state === 'done' ? { background: color } : undefined}
              title={label}
              aria-label={label}
              disabled={future}
              onClick={() => toggle(habit.id, date)}
            />
          );
        })}
      </div>
    </div>
  );
}

export interface DayAreaTotals {
  date: DateKey;
  byArea: Record<ID, number>;
}

const NICE_HOURS = [1, 2, 4, 6, 8, 10, 12, 16, 20, 24];

export function AreaColumns({ days, areas }: { days: DayAreaTotals[]; areas: (Area | { id: 'none'; name: string; slot: 0 })[] }) {
  const [ref, { width }] = useSize<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const H = 240;
  const pad = { l: 36, r: 8, t: 10, b: 26 };
  const innerW = Math.max(10, width - pad.l - pad.r);
  const innerH = H - pad.t - pad.b;
  const maxMin = Math.max(60, ...days.map((d) => Object.values(d.byArea).reduce((a, b) => a + b, 0)));
  const maxH = NICE_HOURS.find((h) => h * 60 >= maxMin) ?? Math.ceil(maxMin / 60);
  const ticks = [0, maxH / 2, maxH];
  const band = innerW / days.length;
  const colW = Math.min(24, band * 0.7);
  const y = (min: number) => pad.t + innerH - (min / (maxH * 60)) * innerH;
  const labelEvery = days.length > 14 ? 7 : days.length > 7 ? 2 : 1;
  const fill = (slot: number) => (slot ? `var(--series-${slot})` : 'var(--unassigned)');
  const hovered = hover !== null ? days[hover] : null;

  return (
    <div ref={ref} className="chart">
      {width > 0 && (
        <svg width={width} height={H} role="img" aria-label="Hours per day by area">
          {ticks.map((t) => (
            <g key={t}>
              <line x1={pad.l} x2={pad.l + innerW} y1={y(t * 60)} y2={y(t * 60)} className={t === 0 ? 'axis-line' : 'grid-line'} />
              <text x={pad.l - 8} y={y(t * 60)} className="axis-label" textAnchor="end" dominantBaseline="central">
                {t}h
              </text>
            </g>
          ))}
          {days.map((d, i) => {
            const cx = pad.l + band * i + band / 2;
            const segs = areas.map((a) => ({ a, min: d.byArea[a.id] ?? 0 })).filter((s) => s.min > 0);
            let acc = 0;
            return (
              <g key={d.date}>
                {hover === i && <rect x={cx - band / 2} y={pad.t} width={band} height={innerH} className="hover-band" />}
                {segs.map((s, si) => {
                  const y0 = y(acc);
                  acc += s.min;
                  const y1 = y(acc);
                  const top = si === segs.length - 1;
                  const h = Math.max(1, y0 - y1 - (si > 0 ? 2 : 0));
                  const yy = y0 - (si > 0 ? 2 : 0) - h;
                  return top ? (
                    <path key={s.a.id} d={topRounded(cx - colW / 2, yy, colW, h)} fill={fill(s.a.slot)} />
                  ) : (
                    <rect key={s.a.id} x={cx - colW / 2} y={yy} width={colW} height={h} fill={fill(s.a.slot)} />
                  );
                })}
                {(i % labelEvery === 0 || i === days.length - 1) && (days.length - 1 - i >= labelEvery / 2 || i === days.length - 1) && (
                  <text x={cx} y={H - 8} className="axis-label" textAnchor="middle">
                    {days.length <= 7
                      ? fromKey(d.date).toLocaleDateString(undefined, { weekday: 'short' })
                      : fmtDateShort(d.date)}
                  </text>
                )}
                <rect
                  x={cx - band / 2}
                  y={pad.t}
                  width={band}
                  height={innerH}
                  fill="transparent"
                  onPointerEnter={() => setHover(i)}
                  onPointerLeave={() => setHover(null)}
                />
              </g>
            );
          })}
        </svg>
      )}
      {hovered && hover !== null && (
        <div
          className="tooltip"
          style={{ left: pad.l + band * hover + band / 2, top: pad.t + 20 }}
        >
          <div className="tooltip-title">
            {fromKey(hovered.date).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })}
          </div>
          {areas
            .filter((a) => hovered.byArea[a.id])
            .map((a) => (
              <div key={a.id} className="tooltip-row tooltip-kv">
                <span>
                  <span className="dot" style={{ background: fill(a.slot) }} /> {a.name}
                </span>
                <b>{fmtDuration(hovered.byArea[a.id])}</b>
              </div>
            ))}
          {Object.keys(hovered.byArea).length === 0 ? (
            <div className="tooltip-row muted">Nothing logged</div>
          ) : (
            <div className="tooltip-row tooltip-kv muted">
              <span>Total</span>
              <b>{fmtHours(Object.values(hovered.byArea).reduce((a, b) => a + b, 0))}</b>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
