import { useState } from 'react';
import type { DateKey } from '../types';
import type { DailyPoint, LinearFit } from '../health/projection';
import { valueAt } from '../health/projection';
import { addDays, diffDays, fmtDateShort } from '../lib/dates';
import { useSize } from '../lib/hooks';

/** Round tick values spanning [min, max]. */
export function niceTicks(min: number, max: number, count = 4): number[] {
  if (min === max) {
    const pad = Math.abs(min) * 0.1 || 1;
    min -= pad;
    max += pad;
  }
  const raw = (max - min) / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? raw;
  const start = Math.floor(min / step) * step;
  const ticks: number[] = [];
  for (let v = start; v <= max + step * 0.5; v += step) ticks.push(Math.round(v * 1e6) / 1e6);
  if (ticks[ticks.length - 1] < max) ticks.push(ticks[ticks.length - 1] + step);
  return ticks;
}

export interface Projection {
  /** Fitted trend over the recent window. */
  fit: LinearFit;
  from: DateKey;
  /** Where the dashed projection ends (the estimated arrival date). */
  to: DateKey;
  early: DateKey | null;
  late: DateKey | null;
}

export function TrendChart({
  points,
  color,
  format,
  height = 220,
  target,
  targetLabel = 'Goal',
  projection,
  deadline,
  deadlineLabel = 'Deadline',
  yMin,
  yMax,
}: {
  deadlineLabel?: string;
  points: DailyPoint[];
  color: string;
  format: (v: number) => string;
  height?: number;
  target?: number | null;
  targetLabel?: string;
  projection?: Projection | null;
  deadline?: DateKey | null;
  yMin?: number;
  yMax?: number;
}) {
  const [ref, { width }] = useSize<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);

  if (points.length === 0) {
    return (
      <div ref={ref} className="chart-empty">
        No readings yet.
      </div>
    );
  }

  const pad = { l: 44, r: 16, t: 18, b: 26 };
  const innerW = Math.max(10, width - pad.l - pad.r);
  const innerH = height - pad.t - pad.b;

  const first = points[0].date;
  const last = points[points.length - 1].date;
  const cap = addDays(last, 400);
  let xEnd = last;
  for (const d of [projection?.to, projection?.late, projection?.early, deadline]) if (d && d > xEnd) xEnd = d < cap ? d : cap;
  const span = Math.max(1, diffDays(first, xEnd));
  const x = (d: DateKey) => pad.l + (Math.min(span, diffDays(first, d)) / span) * innerW;

  const values = points.map((p) => p.value);
  if (target !== null && target !== undefined) values.push(target);
  const lo = yMin ?? Math.min(...values);
  const hi = yMax ?? Math.max(...values);
  const ticks = yMin !== undefined && yMax !== undefined ? niceTicks(yMin, yMax, 5).filter((t) => t >= yMin && t <= yMax) : niceTicks(lo, hi, 4);
  const d0 = yMin ?? ticks[0];
  const d1 = yMax ?? ticks[ticks.length - 1];
  const y = (v: number) => pad.t + (1 - (v - d0) / (d1 - d0 || 1)) * innerH;

  const line = points.map((p, i) => `${i ? 'L' : 'M'}${x(p.date).toFixed(1)} ${y(p.value).toFixed(1)}`).join('');
  const dots = points.length <= 45;
  const lastPoint = points[points.length - 1];
  const hovered = hover !== null ? points[hover] : null;

  let cone: string | null = null;
  let trend: string | null = null;
  if (projection && target !== null && target !== undefined) {
    const fromV = valueAt(projection.fit, projection.from);
    const nowV = valueAt(projection.fit, last);
    trend = `M${x(projection.from)} ${y(fromV)}L${x(last)} ${y(nowV)}L${x(projection.to)} ${y(target)}`;
    if (projection.early) {
      const lateX = projection.late ? x(projection.late) : x(xEnd);
      const lateY = projection.late ? y(target) : y(nowV);
      cone = `M${x(last)} ${y(nowV)}L${x(projection.early)} ${y(target)}L${lateX} ${lateY}Z`;
    }
  }

  const onMove = (e: React.PointerEvent<SVGRectElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const px = e.clientX - rect.left + pad.l;
    let best = 0;
    points.forEach((p, i) => {
      if (Math.abs(x(p.date) - px) < Math.abs(x(points[best].date) - px)) best = i;
    });
    setHover(best);
  };

  const xLabels = [first, last, ...(xEnd !== last ? [xEnd] : [])];

  return (
    <div ref={ref} className="chart">
      {width > 0 && (
        <svg width={width} height={height} role="img" aria-label={`Trend, latest ${format(lastPoint.value)}`}>
          {ticks.map((t) => (
            <g key={t}>
              <line x1={pad.l} x2={pad.l + innerW} y1={y(t)} y2={y(t)} className="grid-line" />
              <text x={pad.l - 8} y={y(t)} className="axis-label" textAnchor="end" dominantBaseline="central">
                {format(t)}
              </text>
            </g>
          ))}
          {xEnd > last && <rect x={x(last)} y={pad.t} width={x(xEnd) - x(last)} height={innerH} className="future-band" />}
          {deadline && deadline <= xEnd && (
            <g>
              <line x1={x(deadline)} x2={x(deadline)} y1={pad.t} y2={pad.t + innerH} className="marker-line" />
              <text x={x(deadline) - 4} y={pad.t - 6} className="axis-label" textAnchor="end">
                {deadlineLabel} {fmtDateShort(deadline)}
              </text>
            </g>
          )}
          {target !== null && target !== undefined && (
            <g>
              <line x1={pad.l} x2={pad.l + innerW} y1={y(target)} y2={y(target)} className="target-line" />
              <text x={pad.l + 4} y={y(target) - 6 < pad.t + 8 ? y(target) + 14 : y(target) - 6} className="axis-label target-label">
                {targetLabel} {format(target)}
              </text>
            </g>
          )}
          {cone && <path d={cone} fill={color} opacity={0.1} />}
          <path d={line} fill="none" stroke={color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
          {dots &&
            points.map((p) => <circle key={p.date} cx={x(p.date)} cy={y(p.value)} r={2.5} fill={color} />)}
          {trend && <path d={trend} fill="none" stroke="var(--ink-2)" strokeWidth={1.5} strokeDasharray="5 4" />}
          {projection && target !== null && target !== undefined && projection.to <= xEnd && (
            <circle cx={x(projection.to)} cy={y(target)} r={5} fill="var(--surface)" stroke="var(--ink)" strokeWidth={2} />
          )}
          <circle cx={x(lastPoint.date)} cy={y(lastPoint.value)} r={4.5} fill={color} stroke="var(--surface)" strokeWidth={2} />
          {xLabels.map((d, i) => (
            <text
              key={`${d}-${i}`}
              x={x(d)}
              y={height - 8}
              className="axis-label"
              textAnchor={i === 0 ? 'start' : i === xLabels.length - 1 ? 'end' : 'middle'}
            >
              {i === 1 && xLabels.length === 3 && x(xEnd) - x(last) < 70 ? '' : fmtDateShort(d)}
            </text>
          ))}
          {hovered && (
            <g pointerEvents="none">
              <line x1={x(hovered.date)} x2={x(hovered.date)} y1={pad.t} y2={pad.t + innerH} className="crosshair" />
              <circle cx={x(hovered.date)} cy={y(hovered.value)} r={4.5} fill={color} stroke="var(--surface)" strokeWidth={2} />
            </g>
          )}
          <rect
            x={pad.l}
            y={pad.t}
            width={Math.max(0, x(last) - pad.l + 8)}
            height={innerH}
            fill="transparent"
            onPointerMove={onMove}
            onPointerLeave={() => setHover(null)}
          />
        </svg>
      )}
      {hovered && (
        <div className="tooltip" style={{ left: x(hovered.date), top: y(hovered.value) }}>
          <div className="tooltip-title">{fmtDateShort(hovered.date)}</div>
          <div className="tooltip-row">{format(hovered.value)}</div>
        </div>
      )}
    </div>
  );
}

export function Sparkline({ points, color, width = 96, height = 28 }: { points: DailyPoint[]; color: string; width?: number; height?: number }) {
  if (points.length < 2) return <svg width={width} height={height} aria-hidden="true" />;
  const vals = points.map((p) => p.value);
  const lo = Math.min(...vals);
  const hi = Math.max(...vals);
  const first = points[0].date;
  const span = Math.max(1, diffDays(first, points[points.length - 1].date));
  const x = (d: DateKey) => 3 + (diffDays(first, d) / span) * (width - 6);
  const y = (v: number) => 3 + (1 - (v - lo) / (hi - lo || 1)) * (height - 6);
  const path = points.map((p, i) => `${i ? 'L' : 'M'}${x(p.date).toFixed(1)} ${y(p.value).toFixed(1)}`).join('');
  const lastP = points[points.length - 1];
  return (
    <svg width={width} height={height} aria-hidden="true" className="sparkline">
      <path d={path} fill="none" stroke="var(--axis)" strokeWidth={1.5} strokeLinejoin="round" />
      <circle cx={x(lastP.date)} cy={y(lastP.value)} r={3} fill={color} />
    </svg>
  );
}

/** Grouped (side-by-side) columns with a per-group hover tooltip. */
export function ColumnChart({
  groups,
  series,
  format,
  axisFormat = format,
  height = 230,
  highlight,
}: {
  groups: { key: string; label: string; title?: string; values: number[] }[];
  series: { name: string; color: string }[];
  format: (v: number) => string;
  axisFormat?: (v: number) => string;
  height?: number;
  /** Group keys to emphasize; the others are drawn faded. */
  highlight?: Set<string>;
}) {
  const [ref, { width }] = useSize<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const pad = { l: 52, r: 8, t: 10, b: 26 };
  const innerW = Math.max(10, width - pad.l - pad.r);
  const innerH = height - pad.t - pad.b;
  const max = Math.max(1, ...groups.flatMap((g) => g.values));
  const ticks = niceTicks(0, max, 3);
  const top = ticks[ticks.length - 1];
  const y = (v: number) => pad.t + innerH - (v / top) * innerH;
  const band = innerW / Math.max(1, groups.length);
  const colW = Math.max(3, Math.min(24, (band * 0.72 - (series.length - 1) * 2) / series.length));
  const labelEvery = Math.ceil(groups.length / Math.max(1, Math.floor(innerW / 64)));
  const hovered = hover !== null ? groups[hover] : null;

  return (
    <div ref={ref} className="chart">
      {width > 0 && (
        <svg width={width} height={height} role="img" aria-label={series.map((s) => s.name).join(' and ')}>
          {ticks.map((t) => (
            <g key={t}>
              <line x1={pad.l} x2={pad.l + innerW} y1={y(t)} y2={y(t)} className={t === 0 ? 'axis-line' : 'grid-line'} />
              <text x={pad.l - 8} y={y(t)} className="axis-label" textAnchor="end" dominantBaseline="central">
                {axisFormat(t)}
              </text>
            </g>
          ))}
          {groups.map((g, gi) => {
            const cx = pad.l + band * gi + band / 2;
            const totalW = series.length * colW + (series.length - 1) * 2;
            return (
              <g key={g.key} opacity={highlight && !highlight.has(g.key) ? 0.35 : 1}>
                {hover === gi && <rect x={cx - band / 2} y={pad.t} width={band} height={innerH} className="hover-band" />}
                {g.values.map((v, si) => {
                  if (v <= 0) return null;
                  const bx = cx - totalW / 2 + si * (colW + 2);
                  const h = Math.max(1, y(0) - y(v));
                  const r = Math.min(4, h / 2, colW / 2);
                  const top = y(0) - h;
                  return (
                    <path
                      key={si}
                      d={`M${bx} ${y(0)}V${top + r}Q${bx} ${top} ${bx + r} ${top}H${bx + colW - r}Q${bx + colW} ${top} ${bx + colW} ${top + r}V${y(0)}Z`}
                      fill={series[si].color}
                    />
                  );
                })}
                {(gi % labelEvery === 0 || gi === groups.length - 1) && (groups.length - 1 - gi >= labelEvery / 2 || gi === groups.length - 1) && (
                  <text x={cx} y={height - 8} className="axis-label" textAnchor="middle">
                    {g.label}
                  </text>
                )}
                <rect
                  x={cx - band / 2}
                  y={pad.t}
                  width={band}
                  height={innerH}
                  fill="transparent"
                  onPointerEnter={() => setHover(gi)}
                  onPointerLeave={() => setHover(null)}
                />
              </g>
            );
          })}
        </svg>
      )}
      {hovered && hover !== null && (
        <div className="tooltip" style={{ left: pad.l + band * hover + band / 2, top: pad.t + 24 }}>
          <div className="tooltip-title">{hovered.title ?? hovered.label}</div>
          {series.map((s, si) => (
            <div key={s.name} className="tooltip-row tooltip-kv">
              <span>
                <span className="dot" style={{ background: s.color }} /> {s.name}
              </span>
              <b>{format(hovered.values[si] ?? 0)}</b>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
