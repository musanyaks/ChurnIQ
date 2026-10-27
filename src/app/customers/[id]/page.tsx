import Link from "next/link";
import { notFound } from "next/navigation";
import { BootGate } from "@/components/boot";
import { PlayActions, RefreshButton } from "@/components/controls";
import { Meter, Panel, RiskPill, SectionHead, StatTile, Tag, Td, Th, KeyValue } from "@/components/ui";
import { RiskGauge, Sparkline, Waterfall } from "@/components/charts";
import { IconArrowUpRight, IconChevron } from "@/components/icons";
import { platformState } from "@/lib/platform";
import { customer360 } from "@/lib/serving";
import { EVENT_STYLE, eventLabel, formatKes, formatPct, initials, timeAgo } from "@/lib/format";

export const dynamic = "force-dynamic";

const SECTIONS = [
  { id: "overview", label: "Overview" },
  { id: "profile", label: "Profile" },
  { id: "payments", label: "Payments" },
  { id: "support", label: "Support & claims" },
  { id: "usage", label: "Usage" },
  { id: "timeline", label: "Interactions" },
  { id: "evidence", label: "Model evidence" },
];

const TONE: Record<string, string> = { critical: "#FF4D3D", warn: "#F2A93B", info: "#46B3A5", ok: "#2BB673" };

export default async function Customer360Page({ params }: { params: Promise<{ id: string }> }) {
  const state = await platformState();
  if (!state.bootstrapped) return <BootGate />;
  const { id } = await params;
  const data = await customer360(id);
  if (!data) notFound();

  const c = data.customer;
  const pred = data.prediction;
  const probability = pred?.probability ?? 0;
  const risk = pred?.riskLevel ?? "Low";
  const color = probability >= 0.75 ? "#FF4D3D" : probability >= 0.55 ? "#FF8A3D" : probability >= 0.35 ? "#F2C14E" : "#2BB673";

  const payments = data.timeline.payments;
  const support = data.timeline.support;
  const usage = data.timeline.usage;

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-2 font-mono text-[10.5px] uppercase tracking-wider text-faint">
        <Link href="/explorer" className="transition-colors hover:text-signal">Customer Explorer</Link>
        <IconChevron size={11} />
        <span className="text-signal">{c.id}</span>
      </div>

      {/* identity header */}
      <div className="panel corner-ticks rise flex flex-wrap items-start gap-5 px-5 py-4">
        <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-[3px] border border-line bg-[rgba(242,169,59,0.08)] font-display text-[18px] font-bold text-signal">
          {initials(c.fullName)}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2.5">
            <h1 className="font-display text-[26px] font-bold leading-none tracking-tight text-ivory">{c.fullName}</h1>
            <RiskPill level={risk} />
            <Tag tone={c.churn ? "bad" : "ok"}>{c.churn ? "churned" : "retained"}</Tag>
            <Tag tone="muted">{c.status}</Tag>
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 font-mono text-[11px] text-muted">
            <span className="text-signal">{c.id}</span>
            <span>{c.email}</span>
            <span>{c.phone}</span>
            <span>{c.city}, {c.county}</span>
            <span>customer since {new Date(c.onboardedAt).getFullYear()}</span>
          </div>
          <div className="mt-2.5 flex flex-wrap gap-1.5">
            {[c.segment, c.productLine, `${c.contractType} billing`, `Plan ${c.planTier}`, c.channel, `${c.policiesHeld} policies`].map((t) => (
              <Tag key={t} tone="info">{t}</Tag>
            ))}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <RefreshButton label="re-read" />
          <Link href="/predict" className="btn">
            what-if scoring <IconArrowUpRight size={12} />
          </Link>
        </div>
      </div>

      {/* sticky section nav */}
      <nav className="sticky top-[52px] z-30 -mx-1 flex gap-1 overflow-x-auto border-b border-line-soft bg-[rgba(7,12,18,0.9)] px-1 py-1.5 backdrop-blur-xl">
        {SECTIONS.map((s) => (
          <a
            key={s.id}
            href={`#${s.id}`}
            className="shrink-0 rounded-[2px] border border-transparent px-2.5 py-1 font-mono text-[10.5px] uppercase tracking-[0.12em] text-muted transition-colors hover:border-line hover:text-signal"
          >
            {s.label}
          </a>
        ))}
      </nav>

      {/* overview */}
      <section id="overview" className="space-y-4 scroll-mt-28">
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatTile label="Churn probability" value={formatPct(probability)} tone={color} hint={`${pred?.runId ?? "champion model"} · scored ${pred ? timeAgo(pred.scoredAt) : "—"}`} />
          <StatTile label="Revenue at risk" value={formatKes(data.aggregates.revenueAtRisk)} tone="#F2A93B" hint={`${formatKes(data.aggregates.annualValue)} annual premium in force`} />
          <StatTile label="Lifetime premium" value={formatKes(c.lifetimePremium)} tone="#46B3A5" hint={`${c.tenureMonths} months tenure · ${formatKes(c.premiumMonthly, { compact: false })} / month`} />
          <StatTile label="Explanation cost" value={`${data.shapMs}ms`} tone="#37D39B" hint={`${data.attributions.length} feature attributions, 260 sampled coalitions`} />
        </div>

        <div className="grid gap-4 xl:grid-cols-[360px_minmax(0,1fr)]">
          <Panel eyebrow="live score" title="Non-renewal risk" ticks>
            <div className="flex flex-col items-center">
              <RiskGauge value={probability} size={210} color={color} label={risk} sublabel={pred ? formatKes(pred.revenueAtRisk) + " at risk" : undefined} />
              <div className="mt-2 w-full space-y-2 border-t border-line-soft pt-3">
                <KeyValue k="Book baseline" v={formatPct(data.baselineProb)} mono />
                <KeyValue k="Delta vs book" v={<span style={{ color }}>{probability >= data.baselineProb ? "+" : "−"}{formatPct(Math.abs(probability - data.baselineProb))}</span>} mono />
                <KeyValue k="Risk band action" v={risk} />
              </div>
              {data.riskHistory.length > 1 && (
                <div className="mt-3 w-full border-t border-line-soft pt-3">
                  <div className="eyebrow mb-1.5">streaming score history</div>
                  <Sparkline values={data.riskHistory.map((h) => h.value)} color={color} width={280} height={40} />
                  <div className="mt-1 flex justify-between font-mono text-[9.5px] text-faint">
                    <span>{data.riskHistory.length} re-scores</span>
                    <span>{timeAgo(data.riskHistory[data.riskHistory.length - 1].at)}</span>
                  </div>
                </div>
              )}
            </div>
          </Panel>

          <div className="space-y-4">
            <Panel eyebrow="explainable AI" title="Why this customer is at risk" note="Kernel SHAP contributions in probability points, summed from the book baseline to the final score.">
              <Waterfall baseline={data.baselineProb} finalValue={probability} items={data.attributions.slice(0, 11).map((a) => ({ label: a.label, impact: a.impact }))} />
            </Panel>

            <Panel eyebrow="next best action" title={data.play.play}>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <p className="max-w-xl text-[12.5px] leading-relaxed text-muted">{data.play.rationale}</p>
                <div className="flex items-center gap-2">
                  <Tag tone="signal">{data.play.owner}</Tag>
                  <Tag tone={data.play.priority === "Critical" ? "bad" : "info"}>{data.play.priority}</Tag>
                  {data.play.id > 0 && <PlayActions actionId={data.play.id} status={data.play.status} />}
                </div>
              </div>
              <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
                {[
                  { label: "play cost", value: formatKes(data.play.playCostKes, { compact: false }), tone: "#FF8A3D" },
                  { label: "expected save", value: formatKes(data.play.expectedSaveKes), tone: "#37D39B" },
                  { label: "ROI", value: `${data.play.roi.toFixed(1)}x`, tone: "#F2C14E" },
                  { label: "status", value: data.play.status, tone: "#46B3A5" },
                ].map((s) => (
                  <div key={s.label} className="panel-flat px-3 py-2">
                    <div className="eyebrow">{s.label}</div>
                    <div className="numeral mt-0.5 truncate text-[15px] font-semibold" style={{ color: s.tone }}>
                      {s.value}
                    </div>
                  </div>
                ))}
              </div>
              <div className="mt-3 space-y-0.5 border-t border-line-soft pt-3">
                <div className="eyebrow mb-1">driver groups</div>
                {data.drivers.map((d, i) => (
                  <div key={d.group} className="px-2 py-1">
                    <div className="flex items-baseline justify-between gap-3">
                      <span className="text-[12px] text-ivory-dim">{d.label}</span>
                      <span className="numeral text-[12px] font-semibold" style={{ color: d.impact >= 0 ? "#FF5C46" : "#2BB673" }}>
                        {d.impact >= 0 ? "+" : "−"}{Math.abs(d.impact * 100).toFixed(1)} pts
                      </span>
                    </div>
                    <Meter value={Math.abs(d.impact) / Math.max(0.001, ...data.drivers.map((x) => Math.abs(x.impact)))} color={d.impact >= 0 ? "#FF5C46" : "#2BB673"} height={4} delay={i * 55} />
                  </div>
                ))}
              </div>
            </Panel>
          </div>
        </div>
      </section>

      {/* profile */}
      <section id="profile" className="grid gap-4 scroll-mt-28 lg:grid-cols-3">
        <Panel eyebrow="01" title="Contract & value">
          <KeyValue k="Segment" v={c.segment} />
          <KeyValue k="Product line" v={c.productLine} />
          <KeyValue k="Plan tier" v={c.planTier} />
          <KeyValue k="Billing cadence" v={c.contractType} />
          <KeyValue k="Acquisition channel" v={c.channel} />
          <KeyValue k="Policies held" v={c.policiesHeld} mono />
          <KeyValue k="Monthly premium" v={formatKes(c.premiumMonthly, { compact: false })} mono />
          <KeyValue k="Lifetime premium" v={formatKes(c.lifetimePremium, { compact: false })} mono />
          <KeyValue k="Renewal window" v={`${c.renewalDueInDays} days`} mono />
        </Panel>
        <Panel eyebrow="02" title="Demographics & tenure">
          <KeyValue k="Age" v={`${c.age}`} mono />
          <KeyValue k="Gender" v={c.gender} />
          <KeyValue k="County" v={c.county} />
          <KeyValue k="City" v={c.city} />
          <KeyValue k="Tenure" v={`${c.tenureMonths} months`} mono />
          <KeyValue k="Onboarded" v={new Date(c.onboardedAt).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })} />
          <KeyValue k="Policy status" v={c.status} />
          <KeyValue k="Observed label" v={c.churn ? "did not renew" : "renewed"} mono />
        </Panel>
        <Panel eyebrow="03" title="Behavioural telemetry">
          {[
            { label: "Failed premium debits", value: c.paymentFailures, max: 8, tone: "#FF4D3D" },
            { label: "Days in arrears", value: c.latePaymentDays, max: 60, tone: "#FF8A3D" },
            { label: "Support tickets", value: c.supportTickets, max: 10, tone: "#F2C14E" },
            { label: "Complaints", value: c.complaints, max: 6, tone: "#FF5C46" },
            { label: "Claims lodged", value: c.claimsCount, max: 8, tone: "#46B3A5" },
            { label: "Weekly usage sessions", value: c.usageFrequency, max: 30, tone: "#37D39B" },
            { label: "Days since last login", value: c.lastLoginDays, max: 120, tone: "#FF8A3D" },
            { label: "M-PESA transactions / mo", value: c.mpesaActivity, max: 60, tone: "#2BB673" },
            { label: "CSAT (1–5)", value: c.satisfactionScore, max: 5, tone: "#F2C14E" },
            { label: "Agent engagement (0–10)", value: c.agentEngagement, max: 10, tone: "#46B3A5" },
            { label: "Renewal premium uplift %", value: c.premiumIncreasePct, max: 30, tone: "#FF5C46" },
            { label: "Discount %", value: c.discountPct, max: 35, tone: "#2BB673" },
          ].map((row, i) => (
            <div key={row.label} className="py-[3px]">
              <div className="flex items-baseline justify-between gap-3">
                <span className="truncate text-[11.5px] text-muted">{row.label}</span>
                <span className="numeral text-[12px] font-semibold text-ivory">{row.value}</span>
              </div>
              <Meter value={Math.min(1, row.value / row.max)} color={row.tone} height={4} delay={i * 40} />
            </div>
          ))}
        </Panel>
      </section>

      {/* payments / support / usage */}
      <div className="grid gap-4 scroll-mt-28 xl:grid-cols-3">
        <Panel id="payments" eyebrow="transactions + payments topic" title="Premium collection" note={`${data.aggregates.paidEvents} successful debits · ${data.aggregates.failedPayments} failures`}>
          <EventList events={payments} empty="No payment events on file." />
        </Panel>
        <Panel id="support" eyebrow="support_events topic" title="Service & claims" note={`${data.aggregates.tickets} tickets · ${data.aggregates.complaints} complaints · ${data.aggregates.claims} claims`}>
          <EventList events={support} empty="No support interactions recorded." />
        </Panel>
        <Panel id="usage" eyebrow="usage_events topic" title="Digital engagement" note={`${data.aggregates.sessions} sessions captured`}>
          <EventList events={usage} empty="No usage events recorded." />
        </Panel>
      </div>

      {/* full timeline */}
      <section id="timeline" className="scroll-mt-28">
        <Panel eyebrow="customer_events" title="Full interaction timeline" note="Every event consumed from the stream for this policyholder, with the score the platform recomputed after it landed." bodyClass="!p-0">
          <div className="max-h-[440px] overflow-auto">
            <table className="w-full min-w-[860px] border-collapse">
              <thead>
                <tr>
                  <Th>When</Th>
                  <Th>Topic</Th>
                  <Th>Event</Th>
                  <Th>Payload</Th>
                  <Th align="right">Score before</Th>
                  <Th align="right">Score after</Th>
                  <Th align="right">Δ</Th>
                </tr>
              </thead>
              <tbody>
                {data.events.slice(0, 120).map((e) => {
                  const tone = TONE[e.severity] ?? "#8A9AAB";
                  return (
                    <tr key={e.id} className="table-row">
                      <Td className="font-mono text-[10.5px] text-muted">{timeAgo(e.occurredAt)}</Td>
                      <Td className="font-mono text-[10.5px] text-faint">{e.topic}</Td>
                      <Td>
                        <span className="flex items-center gap-2">
                          <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: tone }} />
                          <span className="text-[12px] text-ivory-dim">{eventLabel(e.eventType)}</span>
                        </span>
                      </Td>
                      <Td className="max-w-[280px] truncate font-mono text-[10px] text-faint">{JSON.stringify(e.payload)}</Td>
                      <Td align="right" className="numeral text-[11.5px] text-muted">{e.scoreBefore !== null ? formatPct(e.scoreBefore) : "—"}</Td>
                      <Td align="right" className="numeral text-[11.5px] text-ivory">{e.scoreAfter !== null ? formatPct(e.scoreAfter) : "—"}</Td>
                      <Td align="right" className="numeral text-[11.5px] font-semibold" >
                        <span style={{ color: (e.riskDelta ?? 0) > 0 ? "#FF4D3D" : (e.riskDelta ?? 0) < 0 ? "#2BB673" : "#5D6C7B" }}>
                          {e.riskDelta === null ? "—" : `${e.riskDelta > 0 ? "+" : "−"}${Math.abs(e.riskDelta * 100).toFixed(1)}`}
                        </span>
                      </Td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Panel>
      </section>

      {/* model evidence */}
      <section id="evidence" className="grid gap-4 scroll-mt-28 xl:grid-cols-3">
        <Panel eyebrow="registry" title="Cross-model agreement" note="Same feature vector scored by every registered run.">
          {data.ensemble.map((m, i) => (
            <div key={m.runId} className="mb-2.5 last:mb-0">
              <div className="flex items-baseline justify-between gap-2">
                <span className="truncate text-[12px] text-ivory-dim">{m.algorithm}</span>
                <span className="numeral text-[12.5px] font-semibold" style={{ color: m.probability >= 0.55 ? "#FF8A3D" : "#37D39B" }}>
                  {formatPct(m.probability)}
                </span>
              </div>
              <Meter value={m.probability} color={m.stage === "production" ? "#F2A93B" : "#46B3A5"} height={5} delay={i * 60} />
              <div className="mt-0.5 flex items-center justify-between font-mono text-[9.5px] text-faint">
                <span>{m.stage}</span>
                <span>{m.runId}</span>
              </div>
            </div>
          ))}
        </Panel>

        <Panel eyebrow="attributions" title="Full feature contributions" bodyClass="!p-0">
          <div className="max-h-[360px] overflow-auto">
            <table className="w-full border-collapse">
              <thead>
                <tr>
                  <Th>Feature</Th>
                  <Th>Group</Th>
                  <Th align="right">Impact</Th>
                </tr>
              </thead>
              <tbody>
                {data.attributions.map((a) => (
                  <tr key={a.key} className="table-row">
                    <Td className="max-w-[190px] truncate text-[11.5px]">{a.label}</Td>
                    <Td className="font-mono text-[10px] text-faint">{a.group}</Td>
                    <Td align="right" className="numeral text-[11.5px] font-semibold">
                      <span style={{ color: a.impact >= 0 ? "#FF5C46" : "#2BB673" }}>
                        {a.impact >= 0 ? "+" : "−"}{Math.abs(a.impact * 100).toFixed(2)}
                      </span>
                    </Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>

        <Panel eyebrow="cohort" title="Similar customers" note="Same segment and product line, ranked by risk.">
          <ul className="space-y-2">
            {data.peers.map((p) => (
              <li key={p.id}>
                <Link href={`/customers/${p.id}`} className="group flex items-center justify-between gap-3 rounded-[3px] px-2 py-1.5 transition-colors hover:bg-[rgba(242,169,59,0.06)]">
                  <span className="min-w-0">
                    <span className="block truncate text-[12.5px] text-ivory group-hover:text-signal">{p.fullName}</span>
                    <span className="block font-mono text-[10px] text-faint">{p.id} · {formatKes(p.premiumMonthly * 12)}</span>
                  </span>
                  <span className="flex shrink-0 items-center gap-2">
                    <RiskPill level={p.riskLevel} size="xs" />
                    <span className="numeral text-[12.5px] font-bold" style={{ color: p.probability >= 0.55 ? "#FF8A3D" : "#37D39B" }}>
                      {formatPct(p.probability, 0)}
                    </span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
          <div className="mt-3 border-t border-line-soft pt-2.5">
            <div className="eyebrow mb-1.5">platform alerts for this customer</div>
            {data.events.filter((e) => e.severity === "critical").length > 0 ? (
              <p className="text-[11.5px] leading-relaxed text-muted">
                {data.events.filter((e) => e.severity === "critical").length} critical-grade events on the stream history —
                the alert bus raises a notification each time this customer crosses into the High or Critical band.
              </p>
            ) : (
              <p className="text-[11.5px] text-muted">No critical-grade events recorded for this policyholder.</p>
            )}
            <Link href="/stream" className="btn mt-2.5 inline-flex !px-2.5 !py-1">
              open stream <IconArrowUpRight size={12} />
            </Link>
          </div>
        </Panel>
      </section>

      <div className="flex items-center justify-between gap-3 rounded-[4px] border border-line-soft bg-[rgba(9,15,21,0.6)] px-4 py-3">
        <span className="font-mono text-[10.5px] uppercase tracking-wider text-faint">
          feature vector · {data.features.length} dimensions · {new Set(data.features.map((f) => f.group)).size} driver groups
        </span>
        <div className="flex gap-2">
          <Link href="/explorer" className="btn">back to explorer</Link>
          <Link href="/retention" className="btn btn-primary">retention queue</Link>
        </div>
      </div>
    </div>
  );
}

function EventList({ events, empty }: { events: Array<{ id: number; eventType: string; severity: string; occurredAt: Date; payload: Record<string, unknown> }>; empty: string }) {
  if (!events.length) return <p className="px-1 py-6 text-center text-[12px] text-muted">{empty}</p>;
  return (
    <ol className="relative space-y-3 border-l border-line-soft pl-4">
      {events.slice(0, 14).map((e, i) => {
        const tone = TONE[e.severity] ?? "#8A9AAB";
        const style = EVENT_STYLE[e.eventType];
        return (
          <li key={e.id} className="rise relative" style={{ animationDelay: `${i * 45}ms` }}>
            <span className="absolute -left-[21px] top-1.5 h-2 w-2 rounded-full ring-4 ring-ink-900" style={{ background: tone }} />
            <div className="flex items-baseline justify-between gap-2">
              <span className="text-[12.5px] font-medium text-ivory">{style?.label ?? eventLabel(e.eventType)}</span>
              <span className="shrink-0 font-mono text-[10px] text-faint">{timeAgo(e.occurredAt)}</span>
            </div>
            <div className="mt-0.5 flex flex-wrap gap-1.5">
              {Object.entries(e.payload).slice(0, 4).map(([k, v]) => (
                <span key={k} className="rounded-[2px] border border-line-soft bg-[rgba(9,15,21,0.7)] px-1.5 py-[1px] font-mono text-[9.5px] text-muted">
                  {k}: <span className="text-ivory-dim">{String(v)}</span>
                </span>
              ))}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
