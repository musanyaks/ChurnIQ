"use client";

import { useEffect, useMemo, useRef, useState } from "react";

/* ------------------------------------------------------------------ */
/* helpers                                                             */
/* ------------------------------------------------------------------ */

function useMounted() {
  const [m, setM] = useState(false);
  useEffect(() => {
    const id = requestAnimationFrame(() => setM(true));
    return () => cancelAnimationFrame(id);
  }, []);
  return m;
}

function niceTicks(max: number, count = 4): number[] {
  if (max <= 0) return [0, 1];
  const raw = max / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const norm = raw / mag;
  const step = (norm >= 7.5 ? 10 : norm >= 3.5 ? 5 : norm >= 1.5 ? 2 : 1) * mag;
  const ticks: number[] = [];
  for (let v = 0; v <= max + step * 0.5; v += step) ticks.push(Number(v.toFixed(6)));
  return ticks;
}

/* ------------------------------------------------------------------ */
/* Risk gauge                                                          */
/* ------------------------------------------------------------------ */

export function RiskGauge({
  value,
  size = 190,
  color = "#FF4D3D",
  label,
  sublabel,
  ticks = true,
}: {
  value: number;
  size?: number;
  color?: string;
  label?: string;
  sublabel?: string;
  ticks?: boolean;
}) {
  const mounted = useMounted();
  const r = size / 2 - 16;
  const cx = size / 2;
  const cy = size / 2;
  const startAngle = 135;
  const sweep = 270;
  const circ = 2 * Math.PI * r;
  const arcLen = (sweep / 360) * circ;
  const shown = mounted ? Math.max(0, Math.min(1, value)) : 0;

  const polar = (angleDeg: number, radius: number) => {
    const a = ((angleDeg - 90) * Math.PI) / 180;
    return { x: cx + radius * Math.cos(a), y: cy + radius * Math.sin(a) };
  };

  return (
    <div className="relative" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <defs>
          <linearGradient id={`gauge-${color.slice(1)}`} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity="0.45" />
            <stop offset="100%" stopColor={color} />
          </linearGradient>
        </defs>
        <g transform={`rotate(${startAngle} ${cx} ${cy})`}>
          <circle
            cx={cx}
            cy={cy}
            r={r}
            fill="none"
            stroke="rgba(244,241,232,0.07)"
            strokeWidth={9}
            strokeDasharray={`${arcLen} ${circ}`}
            strokeLinecap="butt"
          />
          <circle
            cx={cx}
            cy={cy}
            r={r}
            fill="none"
            stroke={`url(#gauge-${color.slice(1)})`}
            strokeWidth={9}
            strokeDasharray={`${arcLen * shown} ${circ}`}
            strokeLinecap="butt"
            style={{ transition: "stroke-dasharray 1200ms cubic-bezier(0.2,0.8,0.25,1)", filter: `drop-shadow(0 0 8px ${color}66)` }}
          />
        </g>
        {ticks &&
          Array.from({ length: 28 }, (_, i) => {
            const angle = startAngle + (sweep * i) / 27;
            const active = i / 27 <= value;
            const outer = polar(angle, r - 10);
            const inner = polar(angle, r - (i % 7 === 0 ? 17 : 14));
            return (
              <line
                key={i}
                x1={inner.x}
                y1={inner.y}
                x2={outer.x}
                y2={outer.y}
                stroke={active ? color : "rgba(244,241,232,0.16)"}
                strokeWidth={i % 7 === 0 ? 1.6 : 1}
                opacity={active ? 0.95 : 0.6}
              />
            );
          })}
        <text x={cx} y={cy - 2} textAnchor="middle" className="numeral" fill="#F4F1E8" style={{ fontSize: size * 0.21, fontWeight: 700 }}>
          {(value * 100).toFixed(1)}%
        </text>
        {label && (
          <text x={cx} y={cy + size * 0.13} textAnchor="middle" fill={color} style={{ fontSize: 11, fontFamily: "var(--font-mono)", letterSpacing: "0.16em" }}>
            {label.toUpperCase()}
          </text>
        )}
        {sublabel && (
          <text x={cx} y={cy + size * 0.21} textAnchor="middle" fill="#8A9AAB" style={{ fontSize: 10 }}>
            {sublabel}
          </text>
        )}
      </svg>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Trend / line + area                                                 */
/* ------------------------------------------------------------------ */

export type Series = { name: string; color: string; points: Array<{ x: number | string; y: number }> };

/** Serializable number formatters — functions cannot cross the RSC boundary. */
export type Fmt = "dec2" | "percent1" | "percent0" | "int" | "ms" | "ratio";

export function applyFmt(v: number, f: Fmt): string {
  switch (f) {
    case "percent1":
      return `${(v * 100).toFixed(1)}%`;
    case "percent0":
      return `${(v * 100).toFixed(0)}%`;
    case "int":
      return Math.round(v).toLocaleString();
    case "ms":
      return `${v.toFixed(0)}ms`;
    case "ratio":
      return `${v.toFixed(2)}x`;
    default:
      return v.toFixed(2);
  }
}

export function TrendChart({
  series,
  height = 200,
  yFormat: yFormatProp,
  yFmt,
  xFormat: xFormatProp,
  xLabels,
  area = true,
  yMax,
}: {
  series: Series[];
  height?: number;
  yFormat?: (v: number) => string;
  yFmt?: Fmt;
  xFormat?: (x: number | string, i: number) => string;
  xLabels?: string[];
  area?: boolean;
  yMax?: number;
}) {
  const yFormat = yFormatProp ?? ((v: number) => applyFmt(v, yFmt ?? "dec2"));
  const xFormat = xFormatProp ?? ((x: number | string, i: number) => xLabels?.[i] ?? String(x).slice(0, 7));
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(720);
  const [hover, setHover] = useState<number | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => setWidth(Math.max(280, entries[0].contentRect.width)));
    ro.observe(el);
    setWidth(Math.max(280, el.clientWidth));
    return () => ro.disconnect();
  }, []);

  const pad = { l: 42, r: 12, t: 12, b: 22 };
  const all = series.flatMap((s) => s.points.map((p) => p.y));
  const max = yMax ?? Math.max(1e-6, ...(all.length ? all : [1]));
  const ticks = niceTicks(max, 4);
  const top = ticks[ticks.length - 1] || max;
  const n = Math.max(...series.map((s) => s.points.length), 1);
  const xAt = (i: number) => pad.l + (i * (width - pad.l - pad.r)) / Math.max(1, n - 1);
  const yAt = (v: number) => pad.t + (1 - v / top) * (height - pad.t - pad.b);

  return (
    <div ref={ref} className="relative w-full select-none">
      <svg width={width} height={height} className="overflow-visible">
        {ticks.map((t) => (
          <g key={t}>
            <line x1={pad.l} x2={width - pad.r} y1={yAt(t)} y2={yAt(t)} stroke="rgba(244,241,232,0.07)" strokeWidth={1} />
            <text x={pad.l - 8} y={yAt(t) + 3.5} textAnchor="end" fill="#5D6C7B" style={{ fontSize: 9.5, fontFamily: "var(--font-mono)" }}>
              {yFormat(t)}
            </text>
          </g>
        ))}
        {series.map((s, si) => {
          const d = s.points.map((p, i) => `${i === 0 ? "M" : "L"}${xAt(i).toFixed(1)},${yAt(p.y).toFixed(1)}`).join(" ");
          const areaD = `${d} L${xAt(s.points.length - 1).toFixed(1)},${yAt(0)} L${xAt(0).toFixed(1)},${yAt(0)} Z`;
          return (
            <g key={s.name}>
              {area && si === 0 && (
                <>
                  <defs>
                    <linearGradient id={`area-${si}-${s.color.slice(1)}`} x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor={s.color} stopOpacity="0.34" />
                      <stop offset="100%" stopColor={s.color} stopOpacity="0.01" />
                    </linearGradient>
                  </defs>
                  <path d={areaD} fill={`url(#area-${si}-${s.color.slice(1)})`} />
                </>
              )}
              <path d={d} fill="none" stroke={s.color} strokeWidth={1.9} className="draw-line" style={{ ["--dash" as string]: 3000, animationDelay: `${si * 120}ms` }} />
              {s.points.length <= 26 &&
                s.points.map((p, i) => <circle key={i} cx={xAt(i)} cy={yAt(p.y)} r={2} fill="#080D13" stroke={s.color} strokeWidth={1.4} />)}
            </g>
          );
        })}
        {hover !== null && (
          <g>
            <line x1={xAt(hover)} x2={xAt(hover)} y1={pad.t} y2={height - pad.b} stroke="rgba(242,169,59,0.5)" strokeDasharray="3 3" />
            {series.map((s) => {
              const p = s.points[hover];
              if (!p) return null;
              return <circle key={s.name} cx={xAt(hover)} cy={yAt(p.y)} r={3.6} fill={s.color} stroke="#080D13" strokeWidth={1.5} />;
            })}
          </g>
        )}
        {Array.from({ length: n }, (_, i) => i)
          .filter((i) => (n <= 14 ? true : i % Math.ceil(n / 8) === 0))
          .map((i) => (
            <text key={i} x={xAt(i)} y={height - 6} textAnchor="middle" fill="#5D6C7B" style={{ fontSize: 9.5, fontFamily: "var(--font-mono)" }}>
              {xFormat ? xFormat(series[0]?.points[i]?.x ?? "", i) : String(series[0]?.points[i]?.x ?? "").slice(0, 7)}
            </text>
          ))}
        <rect
          x={pad.l}
          y={pad.t}
          width={Math.max(0, width - pad.l - pad.r)}
          height={Math.max(0, height - pad.t - pad.b)}
          fill="transparent"
          onMouseMove={(e) => {
            const box = (e.target as SVGRectElement).getBoundingClientRect();
            const rel = (e.clientX - box.left) / Math.max(1, box.width);
            setHover(Math.max(0, Math.min(n - 1, Math.round(rel * (n - 1)))));
          }}
          onMouseLeave={() => setHover(null)}
        />
      </svg>
      {hover !== null && (
        <div
          className="pointer-events-none absolute z-20 min-w-[132px] -translate-x-1/2 rounded-[3px] border border-line bg-ink-950/95 px-2.5 py-1.5 shadow-xl"
          style={{ left: Math.min(width - 70, Math.max(70, xAt(hover))), top: 4 }}
        >
          <div className="font-mono text-[9.5px] uppercase tracking-wider text-faint">
            {xFormat ? xFormat(series[0]?.points[hover]?.x ?? "", hover) : String(series[0]?.points[hover]?.x ?? "")}
          </div>
          {series.map((s) => (
            <div key={s.name} className="mt-0.5 flex items-center justify-between gap-3">
              <span className="flex items-center gap-1.5 text-[11px] text-ivory-dim">
                <span className="h-1.5 w-1.5 rounded-full" style={{ background: s.color }} />
                {s.name}
              </span>
              <span className="numeral text-[11.5px] font-semibold text-ivory">{yFormat(s.points[hover]?.y ?? 0)}</span>
            </div>
          ))}
        </div>
      )}
      {series.length > 1 && (
        <div className="mt-1 flex flex-wrap items-center gap-3 pl-10">
          {series.map((s) => (
            <span key={s.name} className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-wider text-muted">
              <span className="h-[2px] w-4" style={{ background: s.color }} />
              {s.name}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Columns                                                             */
/* ------------------------------------------------------------------ */

export function ColumnChart({
  items,
  height = 180,
  valueFormat: valueFormatProp,
  valueFmt,
  yFormat: yFormatProp,
  yFmt,
}: {
  items: Array<{ label: string; value: number; color?: string; sub?: string }>;
  height?: number;
  valueFormat?: (v: number) => string;
  valueFmt?: Fmt;
  yFormat?: (v: number) => string;
  yFmt?: Fmt;
}) {
  const valueFormat = valueFormatProp ?? ((v: number) => applyFmt(v, valueFmt ?? "dec2"));
  const yFormat = yFormatProp ?? ((v: number) => applyFmt(v, yFmt ?? valueFmt ?? "dec2"));
  const [hover, setHover] = useState<number | null>(null);
  const max = Math.max(...items.map((i) => i.value), 1e-6);
  const ticks = niceTicks(max, 3);
  const top = ticks[ticks.length - 1] || max;
  const pad = { l: 34, r: 6, t: 10, b: 26 };

  return (
    <div className="relative w-full">
      <div className="relative" style={{ height, paddingLeft: pad.l, paddingRight: pad.r, paddingTop: pad.t, paddingBottom: pad.b }}>
        {ticks.map((t) => (
          <div key={t} className="absolute left-0 right-0" style={{ bottom: pad.b + (t / top) * (height - pad.t - pad.b) }}>
            <div className="h-px w-full bg-[rgba(244,241,232,0.07)]" />
            <span className="absolute -top-[7px] left-0 font-mono text-[9.5px] text-faint">{(yFormat ?? valueFormat)(t)}</span>
          </div>
        ))}
        <div className="flex h-full items-end gap-[3px]">
          {items.map((item, i) => {
            const color = item.color ?? "#F2A93B";
            const h = Math.max(1.5, (item.value / top) * 100);
            return (
              <div
                key={item.label + i}
                className="group relative flex-1"
                style={{ height: "100%" }}
                onMouseEnter={() => setHover(i)}
                onMouseLeave={() => setHover(null)}
              >
                <div
                  className="grow-y absolute bottom-0 w-full rounded-t-[2px] transition-[filter] duration-200"
                  style={{
                    height: `${h}%`,
                    background: `linear-gradient(180deg, ${color}, ${color}44)`,
                    animationDelay: `${i * 45}ms`,
                    filter: hover === i ? `drop-shadow(0 0 10px ${color}aa)` : "none",
                    opacity: hover === null || hover === i ? 1 : 0.55,
                  }}
                />
              </div>
            );
          })}
        </div>
        <div className="absolute bottom-0 left-0 right-0 flex gap-[3px]" style={{ paddingLeft: pad.l, paddingRight: pad.r }}>
          {items.map((item, i) => (
            <div key={item.label + i} className="flex-1 truncate text-center font-mono text-[9px] uppercase tracking-wide text-faint" title={item.label}>
              {item.label.length > 9 ? `${item.label.slice(0, 8)}…` : item.label}
            </div>
          ))}
        </div>
      </div>
      {hover !== null && (
        <div className="pointer-events-none absolute right-2 top-1 z-20 rounded-[3px] border border-line bg-ink-950/95 px-2 py-1 text-[11px] shadow-xl">
          <span className="text-muted">{items[hover].label}: </span>
          <span className="numeral font-semibold text-ivory">{valueFormat(items[hover].value)}</span>
          {items[hover].sub && <span className="ml-2 font-mono text-[10px] text-faint">{items[hover].sub}</span>}
        </div>
      )}
      <span className="sr-only">{items.map((i) => `${i.label} ${valueFormat(i.value)}`).join(", ")}</span>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Donut                                                               */
/* ------------------------------------------------------------------ */

export function Donut({
  slices,
  size = 172,
  thickness = 18,
  centerLabel,
  centerValue,
}: {
  slices: Array<{ label: string; value: number; color: string }>;
  size?: number;
  thickness?: number;
  centerLabel?: string;
  centerValue?: string;
}) {
  const mounted = useMounted();
  const [hover, setHover] = useState<number | null>(null);
  const total = slices.reduce((s, x) => s + x.value, 0) || 1;
  const r = size / 2 - thickness / 2 - 2;
  const circ = 2 * Math.PI * r;
  let acc = 0;

  return (
    <div className="flex items-center gap-4">
      <div className="relative" style={{ width: size, height: size }}>
        <svg width={size} height={size} className="-rotate-90">
          <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="rgba(244,241,232,0.05)" strokeWidth={thickness} />
          {slices.map((s, i) => {
            const frac = s.value / total;
            const dash = mounted ? frac * circ : 0;
            const el = (
              <circle
                key={s.label}
                cx={size / 2}
                cy={size / 2}
                r={r}
                fill="none"
                stroke={s.color}
                strokeWidth={hover === i ? thickness + 4 : thickness}
                strokeDasharray={`${dash} ${circ - dash}`}
                strokeDashoffset={-acc * circ}
                opacity={hover === null || hover === i ? 1 : 0.42}
                style={{ transition: "stroke-dasharray 900ms cubic-bezier(0.2,0.8,0.25,1), stroke-width 200ms, opacity 200ms", transitionDelay: `${i * 60}ms` }}
                onMouseEnter={() => setHover(i)}
                onMouseLeave={() => setHover(null)}
              />
            );
            acc += frac;
            return el;
          })}
        </svg>
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
          <span className="numeral text-[22px] font-bold leading-none text-ivory">
            {hover !== null ? `${((slices[hover].value / total) * 100).toFixed(1)}%` : centerValue}
          </span>
          <span className="mt-1 max-w-[80%] truncate text-center font-mono text-[9.5px] uppercase tracking-[0.14em] text-faint">
            {hover !== null ? slices[hover].label : centerLabel}
          </span>
        </div>
      </div>
      <ul className="min-w-0 flex-1 space-y-1.5">
        {slices.map((s, i) => (
          <li
            key={s.label}
            className="flex items-center justify-between gap-2 text-[12px] transition-opacity"
            style={{ opacity: hover === null || hover === i ? 1 : 0.5 }}
            onMouseEnter={() => setHover(i)}
            onMouseLeave={() => setHover(null)}
          >
            <span className="flex min-w-0 items-center gap-2">
              <span className="h-2 w-2 shrink-0 rounded-[1px]" style={{ background: s.color }} />
              <span className="truncate text-ivory-dim">{s.label}</span>
            </span>
            <span className="numeral shrink-0 font-semibold text-ivory">{s.value.toLocaleString()}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Curve (ROC / PR / calibration)                                      */
/* ------------------------------------------------------------------ */

export function CurveChart({
  points,
  color = "#F2A93B",
  reference = true,
  height = 210,
  xLabel,
  yLabel,
  fill = true,
  markers,
}: {
  points: Array<{ x: number; y: number }>;
  color?: string;
  reference?: boolean;
  height?: number;
  xLabel?: string;
  yLabel?: string;
  fill?: boolean;
  markers?: Array<{ x: number; y: number; label: string; color?: string }>;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const pad = { l: 34, r: 10, t: 10, b: 26 };
  const W = 340;
  const xAt = (v: number) => pad.l + v * (W - pad.l - pad.r);
  const yAt = (v: number) => pad.t + (1 - v) * (height - pad.t - pad.b);
  const d = points.map((p, i) => `${i === 0 ? "M" : "L"}${xAt(p.x).toFixed(1)},${yAt(p.y).toFixed(1)}`).join(" ");

  return (
    <div className="relative w-full">
      <svg viewBox={`0 0 ${W} ${height}`} className="w-full" style={{ height }}>
        {[0, 0.25, 0.5, 0.75, 1].map((t) => (
          <g key={t}>
            <line x1={pad.l} x2={W - pad.r} y1={yAt(t)} y2={yAt(t)} stroke="rgba(244,241,232,0.07)" />
            <text x={pad.l - 6} y={yAt(t) + 3} textAnchor="end" fill="#5D6C7B" style={{ fontSize: 9, fontFamily: "var(--font-mono)" }}>
              {t.toFixed(2)}
            </text>
            <text x={xAt(t)} y={height - 8} textAnchor="middle" fill="#5D6C7B" style={{ fontSize: 9, fontFamily: "var(--font-mono)" }}>
              {t.toFixed(2)}
            </text>
          </g>
        ))}
        {reference && <line x1={xAt(0)} y1={yAt(0)} x2={xAt(1)} y2={yAt(1)} stroke="rgba(244,241,232,0.22)" strokeDasharray="4 4" />}
        {fill && <path d={`${d} L${xAt(points[points.length - 1]?.x ?? 1)},${yAt(0)} L${xAt(points[0]?.x ?? 0)},${yAt(0)} Z`} fill={color} opacity={0.12} />}
        <path d={d} fill="none" stroke={color} strokeWidth={2} className="draw-line" style={{ ["--dash" as string]: 1400 }} />
        {markers?.map((m) => (
          <g key={m.label}>
            <circle cx={xAt(m.x)} cy={yAt(m.y)} r={4} fill={m.color ?? color} stroke="#080D13" strokeWidth={1.5} />
            <text x={xAt(m.x) + 7} y={yAt(m.y) - 6} fill={m.color ?? color} style={{ fontSize: 9.5, fontFamily: "var(--font-mono)" }}>
              {m.label}
            </text>
          </g>
        ))}
        {xLabel && (
          <text x={(W + pad.l) / 2} y={height - 0.5} textAnchor="middle" fill="#5D6C7B" style={{ fontSize: 9, fontFamily: "var(--font-mono)", letterSpacing: "0.1em" }}>
            {xLabel.toUpperCase()}
          </text>
        )}
        {hover !== null && points[hover] && (
          <g>
            <line x1={xAt(points[hover].x)} x2={xAt(points[hover].x)} y1={pad.t} y2={height - pad.b} stroke="rgba(242,169,59,0.45)" strokeDasharray="2 3" />
            <circle cx={xAt(points[hover].x)} cy={yAt(points[hover].y)} r={3.4} fill={color} />
          </g>
        )}
        <rect
          x={pad.l}
          y={pad.t}
          width={W - pad.l - pad.r}
          height={height - pad.t - pad.b}
          fill="transparent"
          onMouseMove={(e) => {
            const box = (e.target as SVGRectElement).getBoundingClientRect();
            const rel = (e.clientX - box.left) / box.width;
            let best = 0;
            let bd = Infinity;
            points.forEach((p, i) => {
              const dist = Math.abs(p.x - rel);
              if (dist < bd) {
                bd = dist;
                best = i;
              }
            });
            setHover(best);
          }}
          onMouseLeave={() => setHover(null)}
        />
      </svg>
      {hover !== null && points[hover] && (
        <div className="pointer-events-none absolute right-2 top-1 rounded-[3px] border border-line bg-ink-950/95 px-2 py-1 font-mono text-[10px] text-ivory-dim shadow-xl">
          x {points[hover].x.toFixed(3)} · y {points[hover].y.toFixed(3)}
        </div>
      )}
      {yLabel && <div className="eyebrow -mt-1 pl-1">{yLabel}</div>}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Confusion matrix                                                    */
/* ------------------------------------------------------------------ */

export function ConfusionMatrix({ c, threshold }: { c: { tp: number; fp: number; tn: number; fn: number }; threshold: number }) {
  const max = Math.max(c.tp, c.fp, c.tn, c.fn, 1);
  const cell = (label: string, value: number, color: string, note: string) => (
    <div className="panel-flat group relative flex flex-col justify-between overflow-hidden p-3" style={{ minHeight: 92 }}>
      <div
        className="absolute inset-0 origin-bottom transition-transform duration-500"
        style={{ background: `linear-gradient(180deg, ${color}22, ${color}08)`, transform: `scaleY(${Math.max(0.04, value / max)})` }}
      />
      <span className="eyebrow relative">{label}</span>
      <span className="numeral relative text-[26px] font-bold leading-none" style={{ color }}>
        {value.toLocaleString()}
      </span>
      <span className="relative text-[10.5px] leading-tight text-muted opacity-0 transition-opacity duration-200 group-hover:opacity-100">{note}</span>
    </div>
  );
  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <span className="eyebrow">decision threshold {(threshold * 100).toFixed(0)}%</span>
        <span className="font-mono text-[10px] text-faint">rows = actual · cols = predicted</span>
      </div>
      <div className="grid grid-cols-[64px_1fr_1fr] gap-2">
        <div />
        <div className="pb-1 text-center font-mono text-[10px] uppercase tracking-wider text-faint">pred: churn</div>
        <div className="pb-1 text-center font-mono text-[10px] uppercase tracking-wider text-faint">pred: stays</div>
        <div className="flex items-center justify-center font-mono text-[10px] uppercase tracking-wider text-faint [writing-mode:vertical-rl]">churned</div>
        {cell("True positive", c.tp, "#2BB673", "Caught — retention play fires")}
        {cell("False negative", c.fn, "#FF4D3D", "Missed — premium lost")}
        <div className="flex items-center justify-center font-mono text-[10px] uppercase tracking-wider text-faint [writing-mode:vertical-rl]">stayed</div>
        {cell("False positive", c.fp, "#F2A93B", "Unnecessary intervention cost")}
        {cell("True negative", c.tn, "#46B3A5", "Correctly left alone")}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* SHAP waterfall                                                      */
/* ------------------------------------------------------------------ */

export function Waterfall({
  baseline,
  finalValue,
  items,
  height = 320,
}: {
  baseline: number;
  finalValue: number;
  items: Array<{ label: string; impact: number; group?: string }>;
  height?: number;
}) {
  const rows = items.slice(0, 12);
  const lo = Math.min(0, baseline, finalValue, ...rows.map((r) => baseline + r.impact));
  const hi = Math.max(1, baseline, finalValue);
  let running = baseline;
  const rowH = Math.min(30, Math.max(20, (height - 62) / (rows.length + 2)));
  const W = 520;
  const pad = { l: 176, r: 54, t: 8, b: 26 };
  const xAt = (v: number) => pad.l + ((v - lo) / Math.max(1e-6, hi - lo)) * (W - pad.l - pad.r);

  const bars = rows.map((r, i) => {
    const start = running;
    running += r.impact;
    const x0 = xAt(start);
    const x1 = xAt(running);
    return { ...r, x: Math.min(x0, x1), w: Math.max(1.5, Math.abs(x1 - x0)), i, end: running };
  });

  return (
    <svg viewBox={`0 0 ${W} ${rowH * (rows.length + 2) + pad.t + pad.b}`} className="w-full">
      {[0, 0.25, 0.5, 0.75, 1].map((t) => {
        const v = lo + t * (hi - lo);
        return (
          <g key={t}>
            <line x1={xAt(v)} x2={xAt(v)} y1={pad.t} y2={rowH * (rows.length + 2) + pad.t} stroke="rgba(244,241,232,0.06)" />
            <text x={xAt(v)} y={rowH * (rows.length + 2) + pad.t + 14} textAnchor="middle" fill="#5D6C7B" style={{ fontSize: 9, fontFamily: "var(--font-mono)" }}>
              {(v * 100).toFixed(0)}%
            </text>
          </g>
        );
      })}
      <line x1={xAt(baseline)} x2={xAt(baseline)} y1={pad.t} y2={rowH * (rows.length + 2) + pad.t} stroke="rgba(244,241,232,0.28)" strokeDasharray="3 3" />

      <g>
        <text x={pad.l - 10} y={pad.t + rowH * 0.66} textAnchor="end" fill="#8A9AAB" style={{ fontSize: 11 }}>
          Book baseline
        </text>
        <rect x={xAt(0)} y={pad.t + rowH * 0.24} width={Math.max(2, xAt(baseline) - xAt(0))} height={rowH * 0.44} fill="#46B3A5" opacity={0.55} rx={1} />
        <text x={xAt(baseline) + 6} y={pad.t + rowH * 0.66} fill="#46B3A5" style={{ fontSize: 10.5, fontFamily: "var(--font-mono)" }}>
          {(baseline * 100).toFixed(1)}%
        </text>
      </g>

      {bars.map((b) => {
        const y = pad.t + rowH * (b.i + 1);
        const positive = b.impact >= 0;
        const color = positive ? (b.impact > 0.08 ? "#FF4D3D" : "#F2A93B") : "#2BB673";
        return (
          <g key={b.label + b.i} className="group">
            <text x={pad.l - 10} y={y + rowH * 0.62} textAnchor="end" fill="#CFD6DD" style={{ fontSize: 11 }}>
              {b.label.length > 26 ? `${b.label.slice(0, 25)}…` : b.label}
            </text>
            <rect
              x={b.x}
              y={y + rowH * 0.2}
              width={b.w}
              height={rowH * 0.5}
              fill={color}
              opacity={0.88}
              rx={1}
              className="grow-x"
              style={{ transformOrigin: `${xAt(baseline)}px 0`, animationDelay: `${b.i * 55}ms` }}
            />
            <text x={b.x + b.w + 6} y={y + rowH * 0.62} fill={color} style={{ fontSize: 10.5, fontFamily: "var(--font-mono)" }}>
              {positive ? "+" : "−"}
              {Math.abs(b.impact * 100).toFixed(1)}
            </text>
          </g>
        );
      })}

      <g>
        {(() => {
          const y = pad.t + rowH * (rows.length + 1);
          return (
            <>
              <text x={pad.l - 10} y={y + rowH * 0.66} textAnchor="end" fill="#F4F1E8" style={{ fontSize: 11.5, fontWeight: 700 }}>
                Predicted churn risk
              </text>
              <rect x={xAt(0)} y={y + rowH * 0.2} width={Math.max(2, xAt(finalValue) - xAt(0))} height={rowH * 0.5} fill="#FF4D3D" rx={1} />
              <text x={xAt(finalValue) + 6} y={y + rowH * 0.66} fill="#FF4D3D" style={{ fontSize: 11.5, fontFamily: "var(--font-mono)", fontWeight: 700 }}>
                {(finalValue * 100).toFixed(1)}%
              </text>
            </>
          );
        })()}
      </g>
    </svg>
  );
}

/* ------------------------------------------------------------------ */
/* Decile lift                                                         */
/* ------------------------------------------------------------------ */

export function DecileChart({
  deciles,
  height = 200,
}: {
  deciles: Array<{ decile: number; churnRate: number; lift: number; capture: number }>;
  height?: number;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const maxRate = Math.max(...deciles.map((d) => d.churnRate), 0.05);
  const pad = { l: 34, r: 34, t: 12, b: 26 };
  const W = 460;
  const bw = (W - pad.l - pad.r) / deciles.length;
  const yRate = (v: number) => pad.t + (1 - v / maxRate) * (height - pad.t - pad.b);
  const yCap = (v: number) => pad.t + (1 - v) * (height - pad.t - pad.b);
  const capturePath = deciles.map((d, i) => `${i === 0 ? "M" : "L"}${(pad.l + bw * (i + 0.5)).toFixed(1)},${yCap(d.capture).toFixed(1)}`).join(" ");

  return (
    <div className="relative">
      <svg viewBox={`0 0 ${W} ${height}`} className="w-full" style={{ height }}>
        {[0, 0.25, 0.5, 0.75, 1].map((t) => (
          <line key={t} x1={pad.l} x2={W - pad.r} y1={pad.t + t * (height - pad.t - pad.b)} y2={pad.t + t * (height - pad.t - pad.b)} stroke="rgba(244,241,232,0.06)" />
        ))}
        {deciles.map((d, i) => {
          const x = pad.l + bw * i + 3;
          const h = height - pad.b - yRate(d.churnRate);
          const color = i === 0 ? "#FF4D3D" : i < 3 ? "#FF8A3D" : "#F2A93B";
          return (
            <g key={d.decile} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
              <rect x={x} y={yRate(d.churnRate)} width={bw - 6} height={Math.max(1, h)} fill={color} opacity={hover === null || hover === i ? 0.85 : 0.4} rx={1} className="grow-y" style={{ animationDelay: `${i * 45}ms` }} />
              <text x={x + (bw - 6) / 2} y={height - 9} textAnchor="middle" fill="#5D6C7B" style={{ fontSize: 9, fontFamily: "var(--font-mono)" }}>
                D{d.decile}
              </text>
              <text x={x + (bw - 6) / 2} y={yRate(d.churnRate) - 4} textAnchor="middle" fill={color} style={{ fontSize: 9, fontFamily: "var(--font-mono)" }}>
                {d.lift.toFixed(1)}x
              </text>
            </g>
          );
        })}
        <path d={capturePath} fill="none" stroke="#46B3A5" strokeWidth={1.8} className="draw-line" style={{ ["--dash" as string]: 900 }} />
        {deciles.map((d, i) => (
          <circle key={d.decile} cx={pad.l + bw * (i + 0.5)} cy={yCap(d.capture)} r={2.2} fill="#46B3A5" />
        ))}
        <text x={pad.l - 6} y={pad.t + 6} textAnchor="end" fill="#5D6C7B" style={{ fontSize: 9, fontFamily: "var(--font-mono)" }}>
          {(maxRate * 100).toFixed(0)}%
        </text>
        <text x={W - pad.r + 6} y={pad.t + 6} fill="#46B3A5" style={{ fontSize: 9, fontFamily: "var(--font-mono)" }}>
          100%
        </text>
      </svg>
      {hover !== null && (
        <div className="pointer-events-none absolute left-1/2 top-0 -translate-x-1/2 rounded-[3px] border border-line bg-ink-950/95 px-2 py-1 font-mono text-[10px] text-ivory-dim shadow-xl">
          Decile {deciles[hover].decile} · churn {(deciles[hover].churnRate * 100).toFixed(1)}% · lift {deciles[hover].lift.toFixed(2)}x · capture {(deciles[hover].capture * 100).toFixed(0)}%
        </div>
      )}
      <div className="mt-1 flex items-center gap-4 pl-8">
        <span className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-wider text-muted">
          <span className="h-2 w-3 bg-ember" /> churn rate by risk decile
        </span>
        <span className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-wider text-muted">
          <span className="h-[2px] w-4 bg-lagoon" /> cumulative capture
        </span>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Sparkline + histogram                                               */
/* ------------------------------------------------------------------ */

export function Sparkline({ values, color = "#F2A93B", width = 120, height = 30, fill = true }: { values: number[]; color?: string; width?: number; height?: number; fill?: boolean }) {
  if (values.length < 2) return <svg width={width} height={height} />;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = Math.max(1e-6, max - min);
  const xAt = (i: number) => (i * width) / (values.length - 1);
  const yAt = (v: number) => height - 2 - ((v - min) / span) * (height - 4);
  const d = values.map((v, i) => `${i === 0 ? "M" : "L"}${xAt(i).toFixed(1)},${yAt(v).toFixed(1)}`).join(" ");
  return (
    <svg width={width} height={height} className="overflow-visible">
      {fill && <path d={`${d} L${width},${height} L0,${height} Z`} fill={color} opacity={0.13} />}
      <path d={d} fill="none" stroke={color} strokeWidth={1.6} className="draw-line" style={{ ["--dash" as string]: 600 }} />
      <circle cx={xAt(values.length - 1)} cy={yAt(values[values.length - 1])} r={2.4} fill={color} />
    </svg>
  );
}

export function RiskHistogram({ bins, height = 150 }: { bins: Array<{ bucket: number; count: number }>; height?: number }) {
  const [hover, setHover] = useState<number | null>(null);
  const max = Math.max(...bins.map((b) => b.count), 1);
  const colorFor = (bucket: number) => (bucket >= 0.75 ? "#FF4D3D" : bucket >= 0.55 ? "#FF8A3D" : bucket >= 0.35 ? "#F2C14E" : bucket >= 0.18 ? "#9AD1A8" : "#2BB673");
  return (
    <div className="relative">
      <div className="flex items-end gap-[2px]" style={{ height }}>
        {bins.map((b, i) => (
          <div
            key={b.bucket}
            className="group relative flex-1"
            style={{ height: "100%" }}
            onMouseEnter={() => setHover(i)}
            onMouseLeave={() => setHover(null)}
          >
            <div
              className="grow-y absolute bottom-0 w-full rounded-t-[1px]"
              style={{
                height: `${Math.max(1, (b.count / max) * 100)}%`,
                background: colorFor(b.bucket),
                opacity: hover === null || hover === i ? 0.9 : 0.4,
                animationDelay: `${i * 28}ms`,
              }}
            />
          </div>
        ))}
      </div>
      <div className="mt-1.5 flex justify-between font-mono text-[9.5px] text-faint">
        <span>0%</span>
        <span>25%</span>
        <span>50%</span>
        <span>75%</span>
        <span>100%</span>
      </div>
      {hover !== null && (
        <div className="pointer-events-none absolute -top-1 left-1/2 -translate-x-1/2 rounded-[3px] border border-line bg-ink-950/95 px-2 py-1 font-mono text-[10px] text-ivory-dim shadow-xl">
          {(bins[hover].bucket * 100).toFixed(0)}–{((bins[hover].bucket + 0.05) * 100).toFixed(0)}% risk · {bins[hover].count.toLocaleString()} customers
        </div>
      )}
    </div>
  );
}
