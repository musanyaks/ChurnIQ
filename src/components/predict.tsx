"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { RiskGauge, Waterfall } from "./charts";
import { Tabs } from "./controls";
import { BarRow, Meter, Panel, RiskPill, StatTile, Tag, Td, Th } from "./ui";
import { IconArrowUpRight, IconDownload, IconPredict, IconRefresh, IconUpload } from "./icons";
import { formatKes, formatPct } from "@/lib/format";

type Driver = { group: string; label: string; impact: number };
type Attribution = { key: string; label: string; group: string; impact: number; raw: number };
type ScoreResult = {
  probability: number;
  baseline: number;
  riskLevel: string;
  color: string;
  action: string;
  revenueAtRisk: number;
  annualValue: number;
  attributions: Attribution[];
  drivers: Driver[];
  play: { play: string; rationale: string; owner: string; priority: string; playCostKes: number; expectedSaveKes: number; roi: number; annualValueKes: number };
  ensemble: Array<{ algorithm: string; stage: string; probability: number }>;
  algorithm: string;
  runId: string;
};

type CsvRow = {
  line: number;
  id: string;
  probability: number;
  riskLevel: string;
  revenueAtRisk: number;
  drivers: Driver[];
  play: string;
  owner: string;
};

const NUMERIC_FIELDS: Array<{ key: string; label: string; min: number; max: number; step: number; group: string }> = [
  { key: "tenureMonths", label: "Tenure (months)", min: 0, max: 108, step: 1, group: "Loyalty" },
  { key: "premiumMonthly", label: "Monthly premium (KES)", min: 200, max: 400000, step: 100, group: "Value" },
  { key: "policiesHeld", label: "Policies held", min: 1, max: 8, step: 1, group: "Value" },
  { key: "paymentFailures", label: "Failed premium debits", min: 0, max: 12, step: 1, group: "Payments" },
  { key: "latePaymentDays", label: "Days in arrears", min: 0, max: 90, step: 1, group: "Payments" },
  { key: "supportTickets", label: "Support tickets", min: 0, max: 12, step: 1, group: "Service" },
  { key: "complaints", label: "Complaints filed", min: 0, max: 8, step: 1, group: "Service" },
  { key: "claimsCount", label: "Claims lodged", min: 0, max: 10, step: 1, group: "Service" },
  { key: "claimSettlementDays", label: "Claim settlement days", min: 0, max: 140, step: 1, group: "Service" },
  { key: "lastLoginDays", label: "Days since last login", min: 0, max: 180, step: 1, group: "Engagement" },
  { key: "usageFrequency", label: "Weekly usage sessions", min: 0, max: 30, step: 0.5, group: "Engagement" },
  { key: "loginFrequency", label: "Logins (90 days)", min: 0, max: 130, step: 1, group: "Engagement" },
  { key: "mpesaActivity", label: "M-PESA transactions / mo", min: 0, max: 60, step: 1, group: "Engagement" },
  { key: "satisfactionScore", label: "CSAT (1–5)", min: 1, max: 5, step: 0.5, group: "Sentiment" },
  { key: "npsScore", label: "NPS (−100–100)", min: -100, max: 100, step: 1, group: "Sentiment" },
  { key: "discountPct", label: "Discount (%)", min: 0, max: 35, step: 1, group: "Pricing" },
  { key: "premiumIncreasePct", label: "Renewal uplift (%)", min: -4, max: 34, step: 0.5, group: "Pricing" },
  { key: "agentEngagement", label: "Agent engagement (0–10)", min: 0, max: 10, step: 0.1, group: "Loyalty" },
  { key: "age", label: "Age", min: 18, max: 75, step: 1, group: "Profile" },
];

const CATEGORICALS: Array<{ key: string; label: string; values: string[] }> = [
  { key: "segment", label: "Segment", values: ["Consumer", "SME", "Enterprise", "Corporate"] },
  { key: "productLine", label: "Product line", values: ["Motor Cover", "Health Cover", "Life & Education", "Agri-Index Cover", "SME Biashara Pack", "Mobile Wallet Cover", "Domestic Travel"] },
  { key: "contractType", label: "Billing cadence", values: ["Monthly", "Quarterly", "Annual"] },
  { key: "planTier", label: "Plan tier", values: ["Jamii", "Plus", "Premium", "Biashara"] },
  { key: "channel", label: "Acquisition channel", values: ["Field Agent", "Bancassurance", "Digital App / USSD", "Broker", "Telco Bundle"] },
  { key: "county", label: "County", values: ["Nairobi", "Mombasa", "Kisumu", "Nakuru", "Uasin Gishu", "Kiambu", "Machakos", "Kajiado", "Nyeri", "Meru"] },
];

const SCENARIOS: Record<string, Record<string, number | string>> = {
  "Healthy renewer": {
    tenureMonths: 46, premiumMonthly: 8200, policiesHeld: 3, paymentFailures: 0, latePaymentDays: 0, supportTickets: 1,
    complaints: 0, claimsCount: 1, claimSettlementDays: 12, lastLoginDays: 2, usageFrequency: 16, loginFrequency: 74,
    mpesaActivity: 31, satisfactionScore: 4.5, npsScore: 58, discountPct: 14, premiumIncreasePct: 3, agentEngagement: 6.4, age: 41,
    segment: "SME", contractType: "Annual", planTier: "Premium",
  },
  "Payment distress": {
    tenureMonths: 9, premiumMonthly: 3400, policiesHeld: 1, paymentFailures: 4, latePaymentDays: 28, supportTickets: 5,
    complaints: 2, claimsCount: 1, claimSettlementDays: 52, lastLoginDays: 26, usageFrequency: 3.5, loginFrequency: 9,
    mpesaActivity: 6, satisfactionScore: 2, npsScore: -38, discountPct: 0, premiumIncreasePct: 14, agentEngagement: 0.8, age: 29,
    segment: "Consumer", contractType: "Monthly", planTier: "Jamii",
  },
  "Disengaged digital": {
    tenureMonths: 22, premiumMonthly: 1250, policiesHeld: 1, paymentFailures: 1, latePaymentDays: 6, supportTickets: 2,
    complaints: 0, claimsCount: 0, claimSettlementDays: 0, lastLoginDays: 64, usageFrequency: 0.8, loginFrequency: 2,
    mpesaActivity: 3, satisfactionScore: 3, npsScore: 4, discountPct: 5, premiumIncreasePct: 8, agentEngagement: 0.4, age: 26,
    segment: "Consumer", contractType: "Monthly", planTier: "Jamii", channel: "Digital App / USSD",
  },
  "Price-shocked corporate": {
    tenureMonths: 61, premiumMonthly: 186000, policiesHeld: 4, paymentFailures: 0, latePaymentDays: 11, supportTickets: 7,
    complaints: 3, claimsCount: 5, claimSettlementDays: 78, lastLoginDays: 18, usageFrequency: 7, loginFrequency: 22,
    mpesaActivity: 12, satisfactionScore: 2.5, npsScore: -22, discountPct: 2, premiumIncreasePct: 24, agentEngagement: 2.1, age: 52,
    segment: "Corporate", contractType: "Annual", planTier: "Biashara", channel: "Broker",
  },
};

const DEFAULTS: Record<string, number | string> = SCENARIOS["Healthy renewer"];

const CSV_TEMPLATE = `customer_id,tenure_months,monthly_premium,support_tickets,complaints,payment_failures,last_login_days,usage_frequency,satisfaction_score,contract_type,segment,plan_tier,product_line,premium_increase_pct,late_payment_days,claims_count,claim_settlement_days,mpesa_activity,discount_pct,age
CIQ-90001,14,23000,6,2,2,19,3.5,2.5,Monthly,SME,Premium,Motor Cover,12,18,1,44,9,4,34
CIQ-90002,52,8400,1,0,0,3,17,4.5,Annual,Consumer,Plus,Health Cover,3,0,2,11,28,12,45
CIQ-90003,7,1200,4,1,3,41,1.2,2.0,Monthly,Consumer,Jamii,Mobile Wallet Cover,16,26,0,0,4,0,24`;

export function PredictApp() {
  const [tab, setTab] = useState("form");
  const [form, setForm] = useState<Record<string, number | string>>(DEFAULTS);
  const [result, setResult] = useState<ScoreResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [latency, setLatency] = useState<number | null>(null);

  const [csvText, setCsvText] = useState(CSV_TEMPLATE);
  const [csvRows, setCsvRows] = useState<CsvRow[] | null>(null);
  const [csvBusy, setCsvBusy] = useState(false);
  const [csvError, setCsvError] = useState<string | null>(null);

  const set = (key: string, value: number | string) => setForm((f) => ({ ...f, [key]: value }));

  const score = async () => {
    setBusy(true);
    setError(null);
    const started = performance.now();
    try {
      const res = await fetch("/api/predict", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ mode: "form", input: form }),
      });
      const data = (await res.json()) as ScoreResult & { error?: string };
      if (data.error) throw new Error(data.error);
      setResult(data);
      setLatency(performance.now() - started);
    } catch (e) {
      setError(e instanceof Error ? e.message : "scoring failed");
    } finally {
      setBusy(false);
    }
  };

  const scoreCsv = async () => {
    setCsvBusy(true);
    setCsvError(null);
    try {
      const res = await fetch("/api/predict", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ mode: "csv", text: csvText }),
      });
      const data = (await res.json()) as { results?: CsvRow[]; error?: string };
      if (data.error) throw new Error(data.error);
      setCsvRows(data.results ?? []);
    } catch (e) {
      setCsvError(e instanceof Error ? e.message : "batch scoring failed");
    } finally {
      setCsvBusy(false);
    }
  };

  const onFile = (file: File) => {
    const reader = new FileReader();
    reader.onload = () => setCsvText(String(reader.result ?? ""));
    reader.readAsText(file);
  };

  const download = (name: string, text: string) => {
    const blob = new Blob([text], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    a.click();
    URL.revokeObjectURL(url);
  };

  const csvSummary = useMemo(() => {
    if (!csvRows?.length) return null;
    const high = csvRows.filter((r) => r.probability >= 0.55).length;
    const exposure = csvRows.reduce((s, r) => s + r.revenueAtRisk, 0);
    return { count: csvRows.length, high, exposure, avg: csvRows.reduce((s, r) => s + r.probability, 0) / csvRows.length };
  }, [csvRows]);

  return (
    <div className="space-y-4">
      <div className="panel px-4 py-2">
        <Tabs
          active={tab}
          onChange={setTab}
          tabs={[
            { key: "form", label: "single profile" },
            { key: "csv", label: "csv batch scoring" },
          ]}
        />
      </div>

      {tab === "form" ? (
        <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)]">
          {/* inputs */}
          <div className="space-y-4">
            <Panel
              eyebrow="scoring input"
              title="Customer profile"
              note="Adjust the features the champion model consumes. Everything is scored server-side against the registered production artefact."
              actions={
                <div className="flex flex-wrap gap-1.5">
                  {Object.keys(SCENARIOS).map((s) => (
                    <button key={s} className="btn !px-2 !py-1 !text-[10px]" onClick={() => setForm({ ...DEFAULTS, ...SCENARIOS[s] })}>
                      {s}
                    </button>
                  ))}
                </div>
              }
            >
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {CATEGORICALS.map((c) => (
                  <label key={c.key} className="block">
                    <span className="eyebrow mb-1 block">{c.label}</span>
                    <select className="select" value={String(form[c.key] ?? c.values[0])} onChange={(e) => set(c.key, e.target.value)}>
                      {c.values.map((v) => (
                        <option key={v} value={v}>
                          {v}
                        </option>
                      ))}
                    </select>
                  </label>
                ))}
              </div>

              <div className="mt-5 grid gap-x-5 gap-y-4 sm:grid-cols-2">
                {NUMERIC_FIELDS.map((f) => (
                  <label key={f.key} className="block">
                    <span className="mb-1 flex items-baseline justify-between gap-2">
                      <span className="eyebrow">{f.label}</span>
                      <span className="numeral text-[12.5px] font-semibold text-signal">{String(form[f.key] ?? f.min)}</span>
                    </span>
                    <input
                      type="range"
                      className="h-1.5 w-full cursor-pointer appearance-none rounded-full bg-[rgba(244,241,232,0.1)] accent-[#F2A93B]"
                      min={f.min}
                      max={f.max}
                      step={f.step}
                      value={Number(form[f.key] ?? f.min)}
                      onChange={(e) => set(f.key, Number(e.target.value))}
                    />
                  </label>
                ))}
              </div>

              <div className="mt-5 flex flex-wrap items-center gap-2 border-t border-line-soft pt-4">
                <button className="btn btn-primary" onClick={score} disabled={busy}>
                  {busy ? <IconRefresh size={14} className="spin" /> : <IconPredict size={14} />}
                  {busy ? "scoring…" : "predict churn"}
                </button>
                <button className="btn" onClick={() => { setForm({ ...DEFAULTS }); setResult(null); }}>
                  <IconRefresh size={13} /> reset
                </button>
                {latency !== null && result && (
                  <span className="font-mono text-[10.5px] text-muted">
                    {result.runId} · {latency.toFixed(0)} ms round trip
                  </span>
                )}
              </div>
              {error && <div className="mt-3 rounded-[3px] border border-[#FF4D3D55] bg-[#FF4D3D0c] px-3 py-2 font-mono text-[11px] text-oxide">{error}</div>}
            </Panel>
          </div>

          {/* output */}
          <div className="space-y-4">
            {!result ? (
              <Panel className="flex min-h-[420px] flex-col items-center justify-center text-center" eyebrow="awaiting input" title="No score yet">
                <div className="flex flex-col items-center gap-3 py-10">
                  <span className="text-signal">
                    <IconPredict size={42} />
                  </span>
                  <p className="max-w-sm text-[13px] leading-relaxed text-muted">
                    Configure a profile — or load one of the four scenarios — and run it through the champion model. You will get a
                    probability, a SHAP-style explanation, the revenue at stake and a costed retention play.
                  </p>
                </div>
              </Panel>
            ) : (
              <>
                <Panel eyebrow="real-time prediction" title={`${result.riskLevel} churn risk`} ticks>
                  <div className="flex flex-col items-center gap-5 sm:flex-row">
                    <RiskGauge value={result.probability} color={result.color} label={result.riskLevel} sublabel={result.action} />
                    <div className="min-w-0 flex-1 space-y-3">
                      <div className="flex flex-wrap items-center gap-2">
                        <RiskPill level={result.riskLevel} />
                        <Tag tone="info">{result.algorithm}</Tag>
                      </div>
                      <StatTile label="Revenue at risk" value={formatKes(result.revenueAtRisk)} tone="#F2A93B" hint={`${formatPct(result.probability)} × ${formatKes(result.annualValue)} annual premium × 82% recoverable`} />
                      <div className="panel-flat px-3 py-2">
                        <div className="eyebrow mb-1.5">model agreement</div>
                        {result.ensemble.map((m) => (
                          <div key={m.algorithm} className="mb-1.5 last:mb-0">
                            <div className="flex items-baseline justify-between gap-2">
                              <span className="truncate text-[11.5px] text-ivory-dim">{m.algorithm}</span>
                              <span className="numeral text-[12px] font-semibold" style={{ color: m.probability >= 0.55 ? "#FF8A3D" : "#37D39B" }}>
                                {formatPct(m.probability)}
                              </span>
                            </div>
                            <Meter value={m.probability} color={m.stage === "production" ? "#F2A93B" : "#46B3A5"} height={4} />
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                </Panel>

                <Panel eyebrow="explainable AI" title="Why this score?" note="Sampled-coalition kernel SHAP over a 60-row background sample, renormalised so contributions add up exactly to the prediction gap.">
                  <Waterfall baseline={result.baseline} finalValue={result.probability} items={result.attributions.slice(0, 11).map((a) => ({ label: a.label, impact: a.impact }))} />
                </Panel>

                <Panel eyebrow="recommended action" title={result.play.play}>
                  <p className="text-[12.5px] leading-relaxed text-muted">{result.play.rationale}</p>
                  <div className="mt-3 grid gap-3 sm:grid-cols-4">
                    {[
                      { label: "owner", value: result.play.owner, tone: "#46B3A5" },
                      { label: "play cost", value: formatKes(result.play.playCostKes, { compact: false }), tone: "#FF8A3D" },
                      { label: "expected save", value: formatKes(result.play.expectedSaveKes), tone: "#37D39B" },
                      { label: "ROI", value: `${result.play.roi.toFixed(1)}x`, tone: "#F2C14E" },
                    ].map((s) => (
                      <div key={s.label} className="panel-flat px-3 py-2">
                        <div className="eyebrow">{s.label}</div>
                        <div className="numeral mt-0.5 text-[15px] font-semibold" style={{ color: s.tone }}>
                          {s.value}
                        </div>
                      </div>
                    ))}
                  </div>
                  <div className="mt-3 space-y-0.5 border-t border-line-soft pt-3">
                    <div className="eyebrow mb-1">driver groups</div>
                    {result.drivers.slice(0, 5).map((d, i) => (
                      <BarRow key={d.group} label={d.label} value={Math.abs(d.impact)} max={Math.max(...result.drivers.map((x) => Math.abs(x.impact)), 0.001)} display={`${d.impact >= 0 ? "+" : "−"}${Math.abs(d.impact * 100).toFixed(1)} pts`} color={d.impact >= 0 ? "#FF5C46" : "#2BB673"} delay={i * 50} />
                    ))}
                  </div>
                  <Link href="/retention" className="btn mt-4 inline-flex">
                    open retention center <IconArrowUpRight size={12} />
                  </Link>
                </Panel>
              </>
            )}
          </div>
        </div>
      ) : (
        <div className="grid gap-4 xl:grid-cols-[minmax(0,0.95fr)_minmax(0,1.05fr)]">
          <Panel
            eyebrow="batch inference"
            title="Upload a customer extract"
            note="Header names are mapped to feature-store columns (snake_case). Missing columns fall back to book medians, so a partial CRM extract still scores."
            actions={
              <button className="btn" onClick={() => download("churniq-template.csv", CSV_TEMPLATE)}>
                <IconDownload size={13} /> template
              </button>
            }
          >
            <label className="mb-3 flex cursor-pointer items-center justify-center gap-2 rounded-[3px] border border-dashed border-line px-4 py-6 text-center transition-colors hover:border-signal/50 hover:bg-[rgba(242,169,59,0.04)]">
              <IconUpload size={18} className="text-signal" />
              <span>
                <span className="block text-[12.5px] text-ivory-dim">Drop a CSV or click to browse</span>
                <span className="block font-mono text-[10px] text-faint">header row required · comma separated</span>
              </span>
              <input type="file" accept=".csv,text/csv" className="hidden" onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])} />
            </label>
            <textarea
              className="input h-[220px] resize-y font-mono !text-[11px] leading-relaxed"
              value={csvText}
              spellCheck={false}
              onChange={(e) => setCsvText(e.target.value)}
            />
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <button className="btn btn-primary" onClick={scoreCsv} disabled={csvBusy}>
                {csvBusy ? <IconRefresh size={13} className="spin" /> : <IconPredict size={13} />}
                {csvBusy ? "scoring batch…" : "score batch"}
              </button>
              <button className="btn" onClick={() => setCsvText(CSV_TEMPLATE)}>
                <IconRefresh size={12} /> load sample
              </button>
              <span className="font-mono text-[10.5px] text-faint">{Math.max(0, csvText.trim().split(/\r?\n/).length - 1)} data rows</span>
            </div>
            {csvError && <div className="mt-3 rounded-[3px] border border-[#FF4D3D55] bg-[#FF4D3D0c] px-3 py-2 font-mono text-[11px] text-oxide">{csvError}</div>}
          </Panel>

          <div className="space-y-4">
            {csvSummary && (
              <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                <StatTile label="Rows scored" value={csvSummary.count.toLocaleString()} tone="#F4F1E8" />
                <StatTile label="Mean risk" value={formatPct(csvSummary.avg)} tone="#46B3A5" />
                <StatTile label="High / critical" value={csvSummary.high.toLocaleString()} tone="#FF4D3D" />
                <StatTile label="Exposure" value={formatKes(csvSummary.exposure)} tone="#F2A93B" />
              </div>
            )}
            <Panel
              eyebrow="batch output"
              title="Scored rows"
              bodyClass="!p-0"
              actions={
                csvRows?.length ? (
                  <button
                    className="btn"
                    onClick={() =>
                      download(
                        "churniq-scored.csv",
                        [
                          "customer_id,probability,risk_level,revenue_at_risk_kes,leading_driver,play,owner",
                          ...csvRows.map((r) => `${r.id},${r.probability.toFixed(4)},${r.riskLevel},${r.revenueAtRisk},"${r.drivers[0]?.label ?? ""}","${r.play}","${r.owner}"`),
                        ].join("\n"),
                      )
                    }
                  >
                    <IconDownload size={13} /> export
                  </button>
                ) : undefined
              }
            >
              {!csvRows ? (
                <div className="px-4 py-16 text-center text-[13px] text-muted">Score a batch to see per-row probabilities, leading drivers and the dispatched play.</div>
              ) : (
                <div className="max-h-[560px] overflow-auto">
                  <table className="w-full min-w-[760px] border-collapse">
                    <thead>
                      <tr>
                        <Th>Customer</Th>
                        <Th align="right">Risk</Th>
                        <Th>Band</Th>
                        <Th align="right">Exposure</Th>
                        <Th>Leading driver</Th>
                        <Th>Play · owner</Th>
                      </tr>
                    </thead>
                    <tbody>
                      {csvRows.map((r, i) => (
                        <tr key={r.id + r.line} className="table-row rise" style={{ animationDelay: `${Math.min(i * 25, 300)}ms` }}>
                          <Td className="font-mono text-[11px] text-signal">{r.id}</Td>
                          <Td align="right" className="numeral font-semibold" >
                            <span style={{ color: r.probability >= 0.75 ? "#FF4D3D" : r.probability >= 0.55 ? "#FF8A3D" : r.probability >= 0.35 ? "#F2C14E" : "#37D39B" }}>
                              {formatPct(r.probability)}
                            </span>
                          </Td>
                          <Td><RiskPill level={r.riskLevel} size="xs" /></Td>
                          <Td align="right" className="numeral">{formatKes(r.revenueAtRisk)}</Td>
                          <Td className="max-w-[180px] truncate text-[11.5px] text-muted">{r.drivers[0]?.label ?? "—"}</Td>
                          <Td className="max-w-[260px]">
                            <span className="block truncate text-[11.5px] text-ivory-dim">{r.play}</span>
                            <span className="block truncate font-mono text-[10px] text-faint">{r.owner}</span>
                          </Td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Panel>
          </div>
        </div>
      )}
    </div>
  );
}
