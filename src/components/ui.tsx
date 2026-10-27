import type { ReactNode } from "react";

export const RISK_COLOR: Record<string, string> = {
  Critical: "#FF4D3D",
  High: "#FF8A3D",
  Elevated: "#F2C14E",
  Moderate: "#9AD1A8",
  Low: "#2BB673",
};

export const PRIORITY_COLOR: Record<string, string> = {
  Critical: "#FF4D3D",
  High: "#FF8A3D",
  Medium: "#F2C14E",
  Low: "#2BB673",
};

export function Panel({
  id,
  title,
  eyebrow,
  note,
  actions,
  children,
  className = "",
  bodyClass = "",
  ticks = false,
}: {
  id?: string;
  title?: ReactNode;
  eyebrow?: string;
  note?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClass?: string;
  ticks?: boolean;
}) {
  return (
    <section id={id} className={`panel ${ticks ? "corner-ticks" : ""} ${className}`}>
      {(title || actions || eyebrow) && (
        <header className="flex items-start justify-between gap-4 border-b border-line-soft px-4 py-3">
          <div className="min-w-0">
            {eyebrow && <div className="eyebrow mb-1">{eyebrow}</div>}
            {title && <h2 className="font-display text-[15px] font-semibold tracking-tight text-ivory">{title}</h2>}
            {note && <p className="mt-1 text-xs leading-relaxed text-muted">{note}</p>}
          </div>
          {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
        </header>
      )}
      <div className={`px-4 py-4 ${bodyClass}`}>{children}</div>
    </section>
  );
}

export function SectionHead({
  index,
  title,
  note,
  right,
}: {
  index?: string;
  title: string;
  note?: ReactNode;
  right?: ReactNode;
}) {
  return (
    <div className="mb-4 flex flex-wrap items-end justify-between gap-3 border-b border-line-soft pb-3">
      <div className="flex items-baseline gap-3">
        {index && <span className="font-mono text-[11px] tracking-[0.22em] text-signal">{index}</span>}
        <div>
          <h1 className="font-display text-2xl font-bold tracking-tight text-ivory md:text-[28px]">{title}</h1>
          {note && <p className="mt-1 max-w-2xl text-[13px] leading-relaxed text-muted">{note}</p>}
        </div>
      </div>
      {right && <div className="flex items-center gap-2">{right}</div>}
    </div>
  );
}

export function StatTile({
  label,
  value,
  suffix,
  hint,
  tone = "#F4F1E8",
  accent = false,
  children,
  delay = 0,
}: {
  label: string;
  value: ReactNode;
  suffix?: string;
  hint?: ReactNode;
  tone?: string;
  accent?: boolean;
  children?: ReactNode;
  delay?: number;
}) {
  return (
    <div
      className={`panel panel-hover rise overflow-hidden px-4 py-3.5 ${accent ? "corner-ticks" : ""}`}
      style={{ animationDelay: `${delay}ms` }}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="eyebrow truncate">{label}</span>
        <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: tone, boxShadow: `0 0 8px ${tone}` }} />
      </div>
      <div className="mt-2 flex items-baseline gap-1.5">
        <span className="numeral text-[30px] font-bold leading-none" style={{ color: tone }}>
          {value}
        </span>
        {suffix && <span className="font-mono text-[11px] uppercase tracking-wider text-faint">{suffix}</span>}
      </div>
      {children && <div className="mt-2.5">{children}</div>}
      {hint && <div className="mt-2 text-[11px] leading-snug text-muted">{hint}</div>}
    </div>
  );
}

export function RiskPill({ level, size = "sm" }: { level: string; size?: "xs" | "sm" }) {
  const color = RISK_COLOR[level] ?? PRIORITY_COLOR[level] ?? "#8A9AAB";
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-[2px] border font-mono uppercase tracking-[0.12em] ${
        size === "xs" ? "px-1.5 py-[1px] text-[9px]" : "px-2 py-[3px] text-[10px]"
      }`}
      style={{ borderColor: `${color}55`, background: `${color}14`, color }}
    >
      <span className="h-1.5 w-1.5 rounded-full" style={{ background: color }} />
      {level}
    </span>
  );
}

export function Meter({
  value,
  color = "#F2A93B",
  height = 6,
  track = "rgba(244,241,232,0.07)",
  delay = 0,
}: {
  value: number;
  color?: string;
  height?: number;
  track?: string;
  delay?: number;
}) {
  return (
    <div className="w-full overflow-hidden rounded-[1px]" style={{ height, background: track }}>
      <div
        className="grow-x h-full rounded-[1px]"
        style={{
          width: `${Math.max(0, Math.min(1, value)) * 100}%`,
          background: `linear-gradient(90deg, ${color}88, ${color})`,
          boxShadow: `0 0 12px -2px ${color}`,
          animationDelay: `${delay}ms`,
        }}
      />
    </div>
  );
}

export function BarRow({
  label,
  value,
  max,
  display,
  color = "#F2A93B",
  sub,
  delay = 0,
  href,
}: {
  label: string;
  value: number;
  max: number;
  display?: string;
  color?: string;
  sub?: string;
  delay?: number;
  href?: string;
}) {
  const pct = max > 0 ? Math.max(0.015, value / max) : 0;
  const inner = (
    <>
      <div className="flex items-baseline justify-between gap-3">
        <span className="truncate text-[12.5px] text-ivory-dim">{label}</span>
        <span className="numeral shrink-0 text-[12.5px] font-semibold" style={{ color }}>
          {display ?? value.toFixed(2)}
        </span>
      </div>
      <div className="mt-1.5 h-[5px] w-full overflow-hidden rounded-[1px] bg-[rgba(244,241,232,0.06)]">
        <div
          className="grow-x h-full"
          style={{
            width: `${pct * 100}%`,
            background: `linear-gradient(90deg, ${color}66, ${color})`,
            animationDelay: `${delay}ms`,
          }}
        />
      </div>
      {sub && <div className="mt-1 font-mono text-[10px] uppercase tracking-wider text-faint">{sub}</div>}
    </>
  );
  return href ? (
    <a href={href} className="group block rounded-[3px] px-2 py-1.5 transition-colors hover:bg-[rgba(242,169,59,0.06)]">
      {inner}
    </a>
  ) : (
    <div className="px-2 py-1.5">{inner}</div>
  );
}

export function Tag({ children, tone = "muted" }: { children: ReactNode; tone?: "muted" | "signal" | "ok" | "bad" | "info" }) {
  const map = {
    muted: "border-line text-muted",
    signal: "border-[#F2A93B55] bg-[#F2A93B12] text-signal",
    ok: "border-[#2BB67355] bg-[#2BB67312] text-mint",
    bad: "border-[#FF4D3D55] bg-[#FF4D3D12] text-oxide",
    info: "border-[#46B3A555] bg-[#46B3A512] text-lagoon",
  } as const;
  return (
    <span className={`inline-flex items-center gap-1 rounded-[2px] border px-1.5 py-[2px] font-mono text-[10px] uppercase tracking-[0.1em] ${map[tone]}`}>
      {children}
    </span>
  );
}

export function KeyValue({ k, v, mono = false }: { k: string; v: ReactNode; mono?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-line-soft py-1.5 last:border-0">
      <dt className="shrink-0 text-[11.5px] text-muted">{k}</dt>
      <dd className={`truncate text-right text-[12.5px] text-ivory ${mono ? "font-mono" : ""}`}>{v}</dd>
    </div>
  );
}

export function StatLine({ label, value, tone }: { label: string; value: ReactNode; tone?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-1">
      <span className="eyebrow">{label}</span>
      <span className="numeral text-[15px] font-semibold" style={{ color: tone ?? "#F4F1E8" }}>
        {value}
      </span>
    </div>
  );
}

export function EmptyState({ title, body }: { title: string; body?: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 px-6 py-12 text-center">
      <div className="h-10 w-10 rotate-45 border border-line" />
      <p className="font-display text-sm font-semibold text-ivory-dim">{title}</p>
      {body && <p className="max-w-sm text-xs leading-relaxed text-muted">{body}</p>}
    </div>
  );
}

export function Th({ children, className = "", align = "left" }: { children?: ReactNode; className?: string; align?: "left" | "right" | "center" }) {
  return (
    <th
      className={`sticky top-0 z-10 whitespace-nowrap border-b border-line bg-ink-850/95 px-3 py-2 font-mono text-[10px] uppercase tracking-[0.14em] text-faint backdrop-blur ${
        align === "right" ? "text-right" : align === "center" ? "text-center" : "text-left"
      } ${className}`}
    >
      {children}
    </th>
  );
}

export function Td({ children, className = "", align = "left" }: { children?: ReactNode; className?: string; align?: "left" | "right" | "center" }) {
  return (
    <td
      className={`whitespace-nowrap border-b border-line-soft px-3 py-2 text-[12.5px] text-ivory-dim ${
        align === "right" ? "text-right" : align === "center" ? "text-center" : "text-left"
      } ${className}`}
    >
      {children}
    </td>
  );
}
