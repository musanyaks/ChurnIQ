"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { IconCheck, IconCpu, IconDatabase, IconLayers, IconRefresh, IconStream, LogoMark } from "./icons";

type Stage = { stage: string; detail: string; ms: number };

type Report = {
  stages: Stage[];
  totalMs: number;
  customers: number;
  events: number;
  features: number;
  productionRunId: string;
  productionAlgorithm: string;
  churnRate: number;
  highRisk: number;
  revenueAtRisk: number;
  models: Array<{ algorithm: string; prAuc: number; rocAuc: number; f1: number; trainingMs: number }>;
};

const PLANNED = [
  { key: "ingest", label: "Ingest source systems", note: "CRM · transactions · usage extracts" },
  { key: "load", label: "Load event stream", note: "5 Kafka topics → PostgreSQL landing zone" },
  { key: "feature_store", label: "Materialise feature store", note: "behavioural · transactional · profile features" },
  { key: "train", label: "Train model suite", note: "logistic regression · random forest · gradient boosting" },
  { key: "register", label: "Register & promote", note: "MLflow-style registry, champion selection" },
  { key: "score", label: "Batch score the book", note: "risk, revenue-at-risk, retention plays" },
  { key: "telemetry", label: "Backfill telemetry", note: "Prometheus-style samples for monitoring" },
];

export function BootGate({ reason }: { reason?: string }) {
  const router = useRouter();
  const [phase, setPhase] = useState<"idle" | "running" | "done" | "error">("idle");
  const [progress, setProgress] = useState(0);
  const [report, setReport] = useState<Report | null>(null);
  const [error, setError] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => () => {
    if (timer.current) clearInterval(timer.current);
  }, []);

  const start = async () => {
    setPhase("running");
    setError(null);
    setProgress(2);
    timer.current = setInterval(() => {
      setProgress((p) => (p < 88 ? p + Math.max(0.4, (92 - p) * 0.035) : p));
    }, 180);
    try {
      const res = await fetch("/api/bootstrap", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ force: false }) });
      const data = (await res.json()) as { report?: Report; error?: string };
      if (!res.ok || !data.report) throw new Error(data.error ?? `bootstrap failed (${res.status})`);
      setReport(data.report);
      setProgress(100);
      setPhase("done");
      setTimeout(() => router.refresh(), 1400);
    } catch (e) {
      setError(e instanceof Error ? e.message : "unknown error");
      setPhase("error");
    } finally {
      if (timer.current) clearInterval(timer.current);
    }
  };

  const activeIndex = Math.min(PLANNED.length - 1, Math.floor((progress / 100) * PLANNED.length));

  return (
    <div className="flex min-h-[calc(100vh-160px)] items-center justify-center py-10">
      <div className="panel corner-ticks rise w-full max-w-[720px] p-7">
        <div className="flex items-center gap-3">
          <span className="text-signal">
            <LogoMark size={38} />
          </span>
          <div>
            <div className="eyebrow">cold start</div>
            <h1 className="font-display text-[26px] font-bold leading-tight tracking-tight text-ivory">
              Boot the ChurnIQ pipeline
            </h1>
          </div>
        </div>

        <p className="mt-4 max-w-xl text-[13px] leading-relaxed text-muted">
          {reason ?? "No churn intelligence has been materialised yet."} The first run synthesises a Kenyan insurance
          book, streams 12 months of behavioural events through the feature store, trains three competing models,
          promotes a champion and scores every policyholder.
        </p>

        <div className="mt-6 space-y-[3px]">
          {PLANNED.map((s, i) => {
            const done = report ? (report.stages.find((x) => x.stage === s.key)?.ms ?? 0) > 0 : false;
            const active = !report && phase === "running" && i === activeIndex;
            return (
              <div
                key={s.key}
                className={`flex items-center gap-3 rounded-[3px] border px-3 py-2 transition-colors duration-300 ${
                  done ? "border-[#2BB67344] bg-[#2BB6730c]" : active ? "border-[#F2A93B55] bg-[#F2A93B0c]" : "border-line-soft bg-[rgba(9,15,21,0.5)]"
                }`}
              >
                <span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border ${done ? "border-mint text-mint" : active ? "border-signal text-signal" : "border-line text-faint"}`}>
                  {done ? <IconCheck size={11} strokeWidth={2.4} /> : <span className="font-mono text-[9px]">{i + 1}</span>}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className={`truncate text-[12.5px] font-medium ${done || active ? "text-ivory" : "text-muted"}`}>{s.label}</span>
                    {done && (
                      <span className="numeral shrink-0 font-mono text-[10px] text-mint">
                        {((report?.stages.find((x) => x.stage === s.key)?.ms ?? 0) / 1000).toFixed(1)}s
                      </span>
                    )}
                    {active && <span className="shrink-0 font-mono text-[10px] text-signal blink">running…</span>}
                  </div>
                  <div className="truncate font-mono text-[10px] text-faint">{s.note}</div>
                </div>
              </div>
            );
          })}
        </div>

        <div className="mt-5">
          <div className="h-[3px] w-full overflow-hidden rounded-full bg-[rgba(244,241,232,0.07)]">
            <div
              className="h-full rounded-full bg-gradient-to-r from-signal to-oxide transition-[width] duration-300 ease-out"
              style={{ width: `${progress}%` }}
            />
          </div>
          <div className="mt-1.5 flex justify-between font-mono text-[10px] text-faint">
            <span>{phase === "done" ? "pipeline ready" : phase === "error" ? "failed" : phase === "running" ? "executing stages" : "awaiting trigger"}</span>
            <span>{progress.toFixed(0)}%</span>
          </div>
        </div>

        {error && (
          <div className="mt-4 rounded-[3px] border border-[#FF4D3D55] bg-[#FF4D3D0c] px-3 py-2 font-mono text-[11px] text-oxide">{error}</div>
        )}

        {report ? (
          <div className="mt-5 grid gap-3 sm:grid-cols-3">
            {[
              { label: "policyholders", value: report.customers.toLocaleString(), Icon: IconDatabase, tone: "#46B3A5" },
              { label: "stream events", value: report.events.toLocaleString(), Icon: IconStream, tone: "#F2A93B" },
              { label: "features", value: String(report.features), Icon: IconLayers, tone: "#2BB673" },
            ].map((s) => (
              <div key={s.label} className="panel-flat px-3 py-2.5">
                <div className="flex items-center gap-2">
                  <s.Icon size={14} className="shrink-0" />
                  <span className="eyebrow">{s.label}</span>
                </div>
                <div className="numeral mt-1 text-[22px] font-bold" style={{ color: s.tone }}>
                  {s.value}
                </div>
              </div>
            ))}
            <div className="panel-flat px-3 py-2.5 sm:col-span-3">
              <div className="flex items-center gap-2">
                <IconCpu size={14} className="text-mint" />
                <span className="eyebrow">champion model</span>
              </div>
              <div className="mt-1 flex flex-wrap items-baseline justify-between gap-2">
                <span className="font-display text-[16px] font-semibold text-ivory">{report.productionAlgorithm}</span>
                <span className="font-mono text-[10.5px] text-faint">
                  {report.productionRunId} · {((report.totalMs ?? 0) / 1000).toFixed(1)}s end-to-end
                </span>
              </div>
              <div className="mt-2 grid gap-1.5 sm:grid-cols-3">
                {report.models.map((m) => (
                  <div key={m.algorithm} className="flex items-center justify-between gap-2 border-t border-line-soft pt-1.5">
                    <span className="truncate text-[11px] text-muted">{m.algorithm}</span>
                    <span className="numeral shrink-0 text-[11.5px] font-semibold text-ivory">PR-AUC {m.prAuc.toFixed(3)}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        ) : (
          <div className="mt-6 flex flex-wrap items-center gap-3">
            <button className="btn btn-primary" onClick={start} disabled={phase === "running"}>
              {phase === "running" ? <IconRefresh size={14} className="spin" /> : <IconCpu size={14} />}
              {phase === "running" ? "running pipeline" : "run end-to-end pipeline"}
            </button>
            {phase === "error" && (
              <button className="btn" onClick={start}>
                retry
              </button>
            )}
            <span className="font-mono text-[10.5px] text-faint">≈15–25s · writes ~2.4K customers, ~27K events, 3 model runs</span>
          </div>
        )}
      </div>
    </div>
  );
}
