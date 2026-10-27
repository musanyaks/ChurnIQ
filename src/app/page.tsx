import Link from "next/link";
import { BootGate } from "@/components/boot";
import { RefreshButton } from "@/components/controls";
import { ColumnChart, Donut, RiskHistogram, Sparkline, TrendChart } from "@/components/charts";
import { BarRow, KeyValue, Meter, Panel, RiskPill, SectionHead, StatTile, Tag } from "@/components/ui";
import { IconArrowUpRight, IconMoney, IconTrend } from "@/components/icons";
import { platformState } from "@/lib/platform";
import { executiveSummary } from "@/lib/serving";
import { formatKes, formatPct, timeAgo } from "@/lib/format";

export const dynamic = "force-dynamic";

const SEGMENT_COLOR: Record<string, string> = {
  Consumer: "#FF8A3D",
  SME: "#F2A93B",
  Enterprise: "#46B3A5",
  Corporate: "#6F93B8",
};

function rateColor(rate: number) {
  if (rate >= 0.3) return "#FF4D3D";
  if (rate >= 0.22) return "#FF8A3D";
  if (rate >= 0.15) return "#F2C14E";
  return "#37D39B";
}

export default async function ExecutivePage() {
  const state = await platformState();
  if (!state.bootstrapped) {
    return <BootGate reason="The churn intelligence layer has not been materialised in PostgreSQL yet." />;
  }
  const data = await executiveSummary();
  const k = data.kpi;

  const riskSeries = data.riskSeries.slice(-56);
  const riskPoints = riskSeries.map((r, i) => ({ x: i, y: r.value }));
  const trend = data.trend.slice(-12);
  const maxRate = Math.max(...data.segments.map((s) => s.churnRate), 0.01);

  return (
    <div className="space-y-5">
      <SectionHead
        index="01"
        title="Executive Dashboard"
        note="Non-renewal exposure across the Kenyan insurance book — who will leave, how much premium travels with them, and where the retention budget earns its keep."
        right={
          <>
            <Tag tone="ok">
              <span className="h-1.5 w-1.5 rounded-full bg-mint blink" />
              {data.algorithm}
            </Tag>
            <span className="hidden font-mono text-[10px] uppercase tracking-wider text-faint sm:inline">
              scored {timeAgo(data.scoredAt)}
            </span>
            <RefreshButton />
          </>
        }
      />

      {/* KPI strip */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <StatTile label="Policyholders" value={k.total.toLocaleString()} tone="#F4F1E8" delay={0} hint={`${k.active.toLocaleString()} active · ${(k.total - k.active).toLocaleString()} lapsed or cancelled`}>
          <Sparkline values={trend.map((t) => t.events)} color="#46B3A5" width={150} height={26} />
        </StatTile>
        <StatTile label="Observed non-renewal" value={formatPct(k.churnRate)} tone="#FF8A3D" delay={60} hint={`${k.churned.toLocaleString()} policies lost in the trailing 12 months`}>
          <Sparkline values={trend.map((t) => t.lapses)} color="#FF8A3D" width={150} height={26} />
        </StatTile>
        <StatTile label="High + critical risk" value={k.highRisk.toLocaleString()} tone="#FF4D3D" delay={120} hint={`${k.critical.toLocaleString()} customers above the 75% intervention threshold`}>
          <Meter value={k.highRisk / Math.max(1, k.total)} color="#FF4D3D" />
        </StatTile>
        <StatTile label="Revenue at risk" value={formatKes(k.revenueAtRisk)} tone="#F2A93B" accent delay={180} hint={`${formatPct(k.revenueAtRisk / Math.max(1, k.bookValue))} of ${formatKes(k.bookValue)} annual premium`}>
          <Meter value={k.revenueAtRisk / Math.max(1, k.bookValue)} color="#F2A93B" />
        </StatTile>
        <StatTile label="Retention rate" value={formatPct(k.retentionRate)} tone="#37D39B" delay={240} hint={`${formatKes(k.annualPremium)} annualised premium currently in force`}>
          <Meter value={k.retentionRate} color="#37D39B" />
        </StatTile>
        <StatTile label="Mean predicted risk" value={formatPct(k.avgRisk)} tone="#46B3A5" delay={300} hint="Book-wide average of the champion model's probability output">
          <Sparkline values={riskSeries.slice(-24).map((r) => r.value)} color="#46B3A5" width={150} height={26} />
        </StatTile>
      </div>

      {/* trend + opportunity */}
      <div className="grid gap-4 xl:grid-cols-3">
        <Panel
          className="xl:col-span-2"
          eyebrow="signal 01"
          title="Churn risk trend"
          note="Rolling mean predicted non-renewal risk for the whole book, refreshed by every streaming micro-batch."
          actions={<Tag tone="info">{riskSeries.length} samples</Tag>}
          ticks
        >
          <TrendChart
            series={[{ name: "Book risk", color: "#F2A93B", points: riskPoints }]}
            height={218}
            yFmt="percent1"
            xLabels={riskSeries.map((r) =>
              new Date(r.at).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false }),
            )}
          />
          <div className="mt-3 grid grid-cols-2 gap-3 border-t border-line-soft pt-3 md:grid-cols-4">
            {[
              { label: "Observed lapses", value: trend.reduce((s, t) => s + t.lapses, 0).toLocaleString(), tone: "#FF8A3D" },
              { label: "Failed debits", value: trend.reduce((s, t) => s + t.failures, 0).toLocaleString(), tone: "#FF4D3D" },
              { label: "Complaints", value: trend.reduce((s, t) => s + t.complaints, 0).toLocaleString(), tone: "#F2C14E" },
              { label: "Support tickets", value: trend.reduce((s, t) => s + t.tickets, 0).toLocaleString(), tone: "#46B3A5" },
            ].map((s) => (
              <div key={s.label}>
                <div className="eyebrow">{s.label}</div>
                <div className="numeral mt-0.5 text-[19px] font-bold" style={{ color: s.tone }}>
                  {s.value}
                </div>
              </div>
            ))}
          </div>
        </Panel>

        <Panel eyebrow="signal 02" title="Retention opportunity" note="Customers banded by intervention urgency.">
          <Donut
            size={168}
            slices={data.riskCounts.map((r) => ({ label: r.level, value: r.count, color: r.color }))}
            centerLabel="book"
            centerValue={k.total.toLocaleString()}
          />
          <ul className="mt-4 space-y-2 border-t border-line-soft pt-3">
            {data.riskCounts.map((r) => (
              <li key={r.level} className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="h-1.5 w-1.5 rounded-full" style={{ background: r.color }} />
                    <span className="text-[12.5px] font-medium text-ivory">{r.level}</span>
                  </div>
                  <span className="mt-0.5 block truncate font-mono text-[10px] uppercase tracking-wider text-faint">{r.action}</span>
                </div>
                <div className="text-right">
                  <div className="numeral text-[13px] font-semibold text-ivory">{r.count.toLocaleString()}</div>
                  <div className="font-mono text-[10px] text-muted">{formatKes(r.revenueAtRisk)}</div>
                </div>
              </li>
            ))}
          </ul>
        </Panel>
      </div>

      {/* three-up analytics */}
      <div className="grid gap-4 xl:grid-cols-3">
        <Panel eyebrow="signal 03" title="Observed non-renewals by month" note="Lapse and cancellation events consumed from the customer_events topic.">
          <ColumnChart
            items={trend.map((t) => ({
              label: new Date(`${t.month}-01T00:00:00Z`).toLocaleDateString("en-GB", { month: "short", timeZone: "UTC" }),
              value: t.lapses,
              color: "#FF8A3D",
              sub: `${(t.churnRate * 100).toFixed(1)}% of book`,
            }))}
            height={188}
            valueFmt="int"
          />
        </Panel>

        <Panel eyebrow="signal 04" title="Churn by segment" note="Observed rate against model-predicted risk.">
          <div className="space-y-1">
            {data.segments.map((s, i) => (
              <div key={s.key} className="px-2 py-1.5">
                <div className="flex items-baseline justify-between gap-3">
                  <span className="text-[12.5px] text-ivory-dim">{s.key}</span>
                  <span className="flex items-baseline gap-2">
                    <span className="numeral text-[12.5px] font-semibold" style={{ color: rateColor(s.churnRate) }}>
                      {formatPct(s.churnRate)}
                    </span>
                    <span className="font-mono text-[10px] text-faint">pred {formatPct(s.avgRisk, 0)}</span>
                  </span>
                </div>
                <div className="mt-1.5 flex gap-[3px]">
                  <div className="h-[5px] flex-1 overflow-hidden rounded-[1px] bg-[rgba(244,241,232,0.06)]">
                    <div className="grow-x h-full" style={{ width: `${(s.churnRate / maxRate) * 100}%`, background: SEGMENT_COLOR[s.key] ?? "#F2A93B", animationDelay: `${i * 60}ms` }} />
                  </div>
                </div>
                <div className="mt-1 flex justify-between font-mono text-[10px] text-faint">
                  <span>{s.customers.toLocaleString()} customers</span>
                  <span>{formatKes(s.revenueAtRisk)} at risk</span>
                </div>
              </div>
            ))}
          </div>
        </Panel>

        <Panel eyebrow="signal 05" title="Predicted risk distribution" note="Every scored policyholder, binned into 5-point risk buckets.">
          <RiskHistogram bins={data.histogram} height={188} />
          <div className="mt-3 flex items-center justify-between border-t border-line-soft pt-2 font-mono text-[10px] uppercase tracking-wider text-faint">
            <span>mass above 55%</span>
            <span className="numeral text-[13px] font-semibold text-oxide">{k.highRisk.toLocaleString()}</span>
          </div>
        </Panel>
      </div>

      {/* high risk table + county */}
      <div className="grid gap-4 xl:grid-cols-3">
        <Panel
          className="xl:col-span-2"
          eyebrow="signal 06"
          title="Highest-risk customers"
          note="Ranked by champion-model probability with the leading churn driver attached."
          actions={
            <Link href="/explorer" className="btn !px-2.5 !py-1">
              open explorer <IconArrowUpRight size={12} />
            </Link>
          }
          bodyClass="!p-0"
        >
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] border-collapse">
              <thead>
                <tr>
                  {["Customer", "Segment / product", "Risk", "Monthly premium", "Revenue at risk", "Leading driver", ""].map((h, i) => (
                    <th
                      key={h}
                      className={`border-b border-line bg-ink-850/90 px-3 py-2 font-mono text-[10px] uppercase tracking-[0.14em] text-faint ${i >= 3 && i <= 4 ? "text-right" : "text-left"}`}
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.topAtRisk.map((c, i) => {
                  const driver = c.drivers?.[0];
                  return (
                    <tr key={c.id} className="table-row rise" style={{ animationDelay: `${i * 40}ms` }}>
                      <td className="border-b border-line-soft px-3 py-2.5">
                        <Link href={`/customers/${c.id}`} className="group block">
                          <span className="block font-mono text-[11px] text-signal link-underline">{c.id}</span>
                          <span className="block text-[12.5px] font-medium text-ivory group-hover:text-signal">{c.name}</span>
                        </Link>
                      </td>
                      <td className="border-b border-line-soft px-3 py-2.5">
                        <span className="block text-[12px] text-ivory-dim">{c.segment}</span>
                        <span className="block font-mono text-[10px] text-faint">{c.productLine} · {c.county}</span>
                      </td>
                      <td className="border-b border-line-soft px-3 py-2.5">
                        <div className="flex items-center gap-2">
                          <span className="numeral w-[46px] text-[15px] font-bold" style={{ color: c.color }}>
                            {(c.probability * 100).toFixed(0)}%
                          </span>
                          <div className="w-16">
                            <Meter value={c.probability} color={c.color} height={5} delay={i * 40} />
                          </div>
                        </div>
                        <span className="mt-1 block"><RiskPill level={c.riskLevel} size="xs" /></span>
                      </td>
                      <td className="numeral border-b border-line-soft px-3 py-2.5 text-right text-[12.5px]">{formatKes(c.premiumMonthly * 12, { compact: false }).replace("KES ", "KES ")}</td>
                      <td className="numeral border-b border-line-soft px-3 py-2.5 text-right text-[12.5px] font-semibold text-signal">{formatKes(c.revenueAtRisk)}</td>
                      <td className="border-b border-line-soft px-3 py-2.5">
                        {driver ? (
                          <div className="w-[168px]">
                            <span className="block truncate text-[11.5px] text-ivory-dim">{driver.label}</span>
                            <div className="mt-1 h-[4px] w-full overflow-hidden rounded-[1px] bg-[rgba(244,241,232,0.06)]">
                              <div className="grow-x h-full bg-oxide" style={{ width: `${Math.min(100, Math.abs(driver.impact) * 320)}%`, animationDelay: `${i * 40}ms` }} />
                            </div>
                            <span className="mt-0.5 block font-mono text-[9.5px] text-faint">+{(driver.impact * 100).toFixed(1)} pts</span>
                          </div>
                        ) : (
                          <span className="font-mono text-[10px] text-faint">—</span>
                        )}
                      </td>
                      <td className="border-b border-line-soft px-3 py-2.5 text-right">
                        <Link href={`/customers/${c.id}`} className="text-faint transition-colors hover:text-signal">
                          <IconArrowUpRight size={15} />
                        </Link>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Panel>

        <Panel eyebrow="signal 07" title="Revenue at risk by county" note="Expected recoverable premium exposure, top 10 counties.">
          <div className="space-y-0.5">
            {(() => {
              const max = Math.max(...data.counties.map((c) => c.revenueAtRisk), 1);
              return data.counties.map((c, i) => (
                <BarRow
                  key={c.key}
                  label={c.key}
                  value={c.revenueAtRisk}
                  max={max}
                  display={formatKes(c.revenueAtRisk)}
                  color={i === 0 ? "#FF4D3D" : i < 3 ? "#FF8A3D" : "#F2A93B"}
                  sub={`${c.customers.toLocaleString()} customers · ${formatPct(c.churnRate, 0)} churned`}
                  delay={i * 50}
                />
              ));
            })()}
          </div>
        </Panel>
      </div>

      {/* breakdown grid */}
      <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-4">
        <Panel eyebrow="signal 08" title="By product line">
          {(() => {
            const max = Math.max(...data.products.map((p) => p.churnRate), 0.01);
            return (
              <div className="space-y-0.5">
                {data.products.map((p, i) => (
                  <BarRow key={p.key} label={p.key} value={p.churnRate} max={max} display={formatPct(p.churnRate)} color={rateColor(p.churnRate)} sub={`${p.customers.toLocaleString()} policies · pred ${formatPct(p.avgRisk, 0)}`} delay={i * 45} />
                ))}
              </div>
            );
          })()}
        </Panel>

        <Panel eyebrow="signal 09" title="By acquisition channel">
          {(() => {
            const max = Math.max(...data.channels.map((p) => p.churnRate), 0.01);
            return (
              <div className="space-y-0.5">
                {data.channels.map((p, i) => (
                  <BarRow key={p.key} label={p.key} value={p.churnRate} max={max} display={formatPct(p.churnRate)} color={rateColor(p.churnRate)} sub={`${p.customers.toLocaleString()} customers · pred ${formatPct(p.avgRisk, 0)}`} delay={i * 45} />
                ))}
              </div>
            );
          })()}
        </Panel>

        <Panel eyebrow="signal 10" title="By billing cadence">
          {(() => {
            const max = Math.max(...data.contracts.map((p) => p.churnRate), 0.01);
            return (
              <div className="space-y-0.5">
                {data.contracts.map((p, i) => (
                  <BarRow key={p.key} label={`${p.key} billing`} value={p.churnRate} max={max} display={formatPct(p.churnRate)} color={rateColor(p.churnRate)} sub={`${p.customers.toLocaleString()} customers · pred ${formatPct(p.avgRisk, 0)}`} delay={i * 45} />
                ))}
                <div className="mt-3 border-t border-line-soft pt-2">
                  <div className="eyebrow mb-1.5">Plan tier</div>
                  {data.plans.map((p) => (
                    <div key={p.key} className="flex items-center justify-between gap-2 py-0.5">
                      <span className="text-[12px] text-ivory-dim">{p.key}</span>
                      <span className="numeral text-[12px] font-semibold" style={{ color: rateColor(p.churnRate) }}>
                        {formatPct(p.churnRate)}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            );
          })()}
        </Panel>

        <Panel eyebrow="signal 11" title="Retention pipeline economics" note="Value of the queued play book against its delivery cost.">
          <div className="space-y-0.5">
            <KeyValue k="Plays queued" v={<span className="text-signal">{data.retention.queued.toLocaleString()}</span>} mono />
            <KeyValue k="In contact" v={data.retention.contacted.toLocaleString()} mono />
            <KeyValue k="Saved to date" v={<span className="text-mint">{data.retention.saved.toLocaleString()}</span>} mono />
            <KeyValue k="Expected save" v={formatKes(data.retention.expected)} mono />
            <KeyValue k="Play delivery cost" v={formatKes(data.retention.cost)} mono />
          </div>
          <div className="mt-3 border-t border-line-soft pt-3">
            <div className="flex items-baseline justify-between">
              <span className="eyebrow">portfolio ROI</span>
              <span className="numeral text-[24px] font-bold text-mint">
                {(data.retention.expected / Math.max(1, data.retention.cost)).toFixed(1)}x
              </span>
            </div>
            <Meter value={Math.min(1, data.retention.expected / Math.max(1, data.retention.cost) / 6)} color="#37D39B" height={7} />
            <p className="mt-2 text-[11px] leading-relaxed text-muted">
              Assumptions: {formatPct(data.businessInputs.saveRate, 0)} of flagged true churners saved, intervention cost{" "}
              {formatKes(data.businessInputs.interventionCost, { compact: false })}, {formatPct(data.businessInputs.recoverableShare, 0)} of
              annual premium recoverable.
            </p>
          </div>
        </Panel>
      </div>

      {/* value + tenure */}
      <div className="grid gap-4 xl:grid-cols-2">
        <Panel eyebrow="signal 12" title="Churn by customer value band" note="Annual premium in force per policyholder (all policies held).">
          <ColumnChart
            items={data.valueBands.map((b) => ({ label: b.label, value: b.churnRate, color: rateColor(b.churnRate), sub: `${b.customers.toLocaleString()} customers` }))}
            height={180}
            valueFmt="percent1"
            yFmt="percent0"
          />
          <div className="mt-2 grid grid-cols-5 gap-2 border-t border-line-soft pt-2">
            {data.valueBands.map((b) => (
              <div key={b.label} className="text-center">
                <div className="eyebrow truncate">{b.label}</div>
                <div className="numeral mt-0.5 text-[12px] font-semibold text-ivory-dim">{formatKes(b.revenueAtRisk)}</div>
              </div>
            ))}
          </div>
        </Panel>

        <Panel eyebrow="signal 13" title="Churn by tenure band" note="Early-tenure policyholders carry the steepest non-renewal gradient.">
          <ColumnChart
            items={data.tenureBands.map((b, i) => ({ label: b.label, value: b.churnRate, color: i === 0 ? "#FF4D3D" : i === 1 ? "#FF8A3D" : "#F2C14E", sub: `${b.customers.toLocaleString()} customers` }))}
            height={180}
            valueFmt="percent1"
            yFmt="percent0"
          />
          <div className="mt-2 flex items-center gap-2 border-t border-line-soft pt-2 text-[11.5px] text-muted">
            <IconTrend size={14} className="text-signal" />
            <span>
              Model-predicted risk tracks the observed gradient within{" "}
              <span className="numeral text-ivory">{formatPct(Math.abs(data.tenureBands[0].avgRisk - data.tenureBands[0].churnRate))}</span> on the highest band.
            </span>
          </div>
        </Panel>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 rounded-[4px] border border-line-soft bg-[rgba(9,15,21,0.6)] px-4 py-3">
        <div className="flex items-center gap-3">
          <IconMoney size={18} className="text-signal" />
          <div>
            <div className="eyebrow">next best action</div>
            <div className="text-[13px] text-ivory-dim">
              {data.retention.queued.toLocaleString()} plays queued · {formatKes(data.retention.expected)} expected save · open the retention centre to dispatch them
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Link href="/retention" className="btn btn-primary">
            retention center
          </Link>
          <Link href="/stream" className="btn">
            live stream
          </Link>
        </div>
      </div>
    </div>
  );
}
