"use client";

import { useMemo, useState } from "react";
import { TrendChart } from "./charts";
import { Meter } from "./ui";
import { formatKes, formatPct } from "@/lib/format";

export type SweepPoint = {
  t: number;
  accuracy: number;
  precision: number;
  recall: number;
  f1: number;
  flagged: number;
  tp: number;
  fp: number;
  fn: number;
  netValueKes: number;
  recoveredKes: number;
  interventionCostKes: number;
};

export function ThresholdLab({ sweep, optimum }: { sweep: SweepPoint[]; optimum: number }) {
  const [t, setT] = useState(optimum);
  const point = useMemo(() => sweep.reduce((best, p) => (Math.abs(p.t - t) < Math.abs(best.t - t) ? p : best), sweep[0]), [sweep, t]);
  const maxAbs = Math.max(...sweep.map((p) => Math.abs(p.netValueKes)), 1);

  const series = [
    { name: "Recall", color: "#FF8A3D", points: sweep.map((p) => ({ x: p.t, y: p.recall })) },
    { name: "Precision", color: "#46B3A5", points: sweep.map((p) => ({ x: p.t, y: p.precision })) },
    { name: "F1", color: "#F2C14E", points: sweep.map((p) => ({ x: p.t, y: p.f1 })) },
    { name: "Accuracy", color: "#5D6C7B", points: sweep.map((p) => ({ x: p.t, y: p.accuracy })) },
  ];

  return (
    <div className="space-y-4">
      <div>
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <span className="eyebrow">decision threshold</span>
          <span className="numeral text-[22px] font-bold text-signal">{(point.t * 100).toFixed(0)}%</span>
        </div>
        <input
          type="range"
          min={0.02}
          max={0.96}
          step={0.02}
          value={point.t}
          onChange={(e) => setT(Number(e.target.value))}
          className="mt-2 h-1.5 w-full cursor-pointer appearance-none rounded-full bg-[rgba(244,241,232,0.1)] accent-[#F2A93B]"
        />
        <div className="mt-1 flex justify-between font-mono text-[9.5px] text-faint">
          <span>2% — flag everyone</span>
          <span>50% — naive default</span>
          <span>96% — flag almost nobody</span>
        </div>
      </div>

      <TrendChart series={series} height={190} yFormat={(v) => v.toFixed(2)} xFormat={(x) => `${(Number(x) * 100).toFixed(0)}%`} area={false} yMax={1} />

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {[
          { label: "Accuracy", value: formatPct(point.accuracy), tone: "#8A9AAB", note: "the vanity metric" },
          { label: "Recall", value: formatPct(point.recall), tone: "#FF8A3D", note: `${point.tp} churners caught` },
          { label: "Precision", value: formatPct(point.precision), tone: "#46B3A5", note: `${point.fp} false alarms` },
          { label: "Flagged", value: point.flagged.toLocaleString(), tone: "#F2C14E", note: "customers contacted" },
        ].map((s) => (
          <div key={s.label} className="panel-flat px-3 py-2">
            <div className="eyebrow">{s.label}</div>
            <div className="numeral mt-0.5 text-[19px] font-bold" style={{ color: s.tone }}>
              {s.value}
            </div>
            <div className="mt-0.5 text-[10.5px] text-faint">{s.note}</div>
          </div>
        ))}
      </div>

      <div className="panel-flat px-3 py-3">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <span className="eyebrow">net business value at this threshold</span>
          <span className="numeral text-[24px] font-bold" style={{ color: point.netValueKes >= 0 ? "#37D39B" : "#FF4D3D" }}>
            {formatKes(point.netValueKes)}
          </span>
        </div>
        <div className="mt-2 grid gap-2 sm:grid-cols-3">
          {[
            { label: "Premium recovered", value: point.recoveredKes, color: "#37D39B" },
            { label: "Intervention spend", value: -point.interventionCostKes, color: "#FF8A3D" },
            { label: "Premium lost (missed)", value: -(point.fn * 78400 * 0.82), color: "#FF4D3D" },
          ].map((b) => (
            <div key={b.label}>
              <div className="flex items-baseline justify-between gap-2">
                <span className="text-[11px] text-muted">{b.label}</span>
                <span className="numeral text-[12px] font-semibold" style={{ color: b.color }}>
                  {formatKes(b.value)}
                </span>
              </div>
              <Meter value={Math.abs(b.value) / Math.max(1, maxAbs * 3)} color={b.color} height={4} />
            </div>
          ))}
        </div>
        <p className="mt-2.5 border-t border-line-soft pt-2 text-[11.5px] leading-relaxed text-muted">
          A model that predicts &ldquo;stays&rdquo; for everybody scores{" "}
          <span className="numeral text-ivory">{formatPct(sweep[sweep.length - 1]?.accuracy ?? 0.8)}</span> accuracy at the 96% threshold and
          catches <span className="numeral text-oxide">{sweep[sweep.length - 1]?.tp ?? 0}</span> churners. Value, not accuracy, picks the
          operating point — the platform defaults to the F1-optimal cut at{" "}
          <span className="numeral text-signal">{(optimum * 100).toFixed(0)}%</span>.
        </p>
      </div>
    </div>
  );
}
