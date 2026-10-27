import { BootGate } from "@/components/boot";
import { AckButton, ModelActions, ResetPipeline } from "@/components/controls";
import { TrendChart } from "@/components/charts";
import { BarRow, KeyValue, Meter, Panel, SectionHead, StatTile, Tag, Td, Th } from "@/components/ui";
import { IconCheck, IconAlert, IconCpu, IconDatabase, IconLayers, IconStream } from "@/components/icons";
import { monitoring, recentAlerts } from "@/lib/serving";
import { driftReport, platformState } from "@/lib/platform";
import { formatKes, formatPct, timeAgo } from "@/lib/format";

export const dynamic = "force-dynamic";

export const metadata = { title: "Platform Health · ChurnIQ" };

export default async function MonitoringPage() {
  const state = await platformState();
  if (!state.bootstrapped) return <BootGate />;

  const [data, drift] = await Promise.all([monitoring(), driftReport(900)]);
  const q = data.quality;

  const checks = [
    { label: "Policyholder rows", value: q?.customers ?? 0, ok: (q?.customers ?? 0) > 0, note: "customers table" },
    { label: "Feature vectors materialised", value: (q?.customers ?? 0) - (q?.missingVectors ?? 0), ok: (q?.missingVectors ?? 0) === 0, note: `${q?.missingVectors ?? 0} entities without a vector` },
    { label: "Stale feature rows (> 7d)", value: q?.staleFeatures ?? 0, ok: (q?.staleFeatures ?? 0) < 50, note: "online store freshness" },
    { label: "Unscored customers", value: q?.unscored ?? 0, ok: (q?.unscored ?? 0) === 0, note: "batch scoring coverage" },
    { label: "Unprocessed stream events", value: q?.unprocessedEvents ?? 0, ok: (q?.unprocessedEvents ?? 0) === 0, note: "consumer backlog" },
    { label: "Events ingested (24h)", value: q?.events24h ?? 0, ok: true, note: "stream throughput" },
    { label: "Negative / zero premiums", value: q?.negativePremium ?? 0, ok: (q?.negativePremium ?? 0) === 0, note: "schema sanity" },
    { label: "Duplicate customer ids", value: q?.duplicateIds ?? 0, ok: (q?.duplicateIds ?? 0) === 0, note: "primary key integrity" },
  ];

  const stages = [
    { label: "Ingestion", note: "5 Kafka topics → landing zone", Icon: IconStream, ok: (q?.unprocessedEvents ?? 0) === 0, metric: `${(q?.events24h ?? 0).toLocaleString()} events / 24h` },
    { label: "Feature store", note: "44 features, versioned vectors", Icon: IconLayers, ok: (q?.missingVectors ?? 0) === 0, metric: `${((q?.customers ?? 0) - (q?.missingVectors ?? 0)).toLocaleString()} entities` },
    { label: "Training", note: "3 families, held-out validation", Icon: IconCpu, ok: data.registry.length >= 3, metric: `${data.registry.length} registered runs` },
    { label: "Registry", note: "champion + challengers", Icon: IconDatabase, ok: Boolean(data.production), metric: data.production?.version ?? "—" },
    { label: "Serving", note: "batch + streaming scoring", Icon: IconCheck, ok: (q?.unscored ?? 0) === 0, metric: `${data.latency.length ? Math.round(data.latency[data.latency.length - 1].value) : 0} ms p95` },
    { label: "Alerting", note: "risk + drift notifications", Icon: IconAlert, ok: true, metric: `${data.alertCounts.reduce((s, a) => s + a.open, 0)} open alerts` },
  ];

  const toSeries = (arr: Array<{ at: string; value: number }>) => arr.slice(-64).map((p, i) => ({ x: i, y: p.value }));
  const tickLabels = (arr: Array<{ at: string; value: number }>) =>
    arr.slice(-64).map((p) => new Date(p.at).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false }));

  return (
    <div className="space-y-5">
      <SectionHead
        index="08"
        title="Platform Health"
        note="MLOps control room: pipeline stage health, serving SLOs, data-quality gates, feature drift against the training baseline, and the model registry."
        right={
          <>
            <a className="btn" href="/api/metrics" target="_blank" rel="noreferrer">
              /metrics
            </a>
            <ResetPipeline />
          </>
        }
      />

      {/* stage health */}
      <div className="grid gap-3 md:grid-cols-3 xl:grid-cols-6">
        {stages.map((s, i) => (
          <div key={s.label} className="panel panel-hover rise px-3 py-2.5" style={{ animationDelay: `${i * 55}ms`, borderLeft: `2px solid ${s.ok ? "#2BB673" : "#FF4D3D"}` }}>
            <div className="flex items-center gap-2">
              <span className={s.ok ? "text-mint" : "text-oxide"}>
                <s.Icon size={15} />
              </span>
              <span className="truncate text-[12.5px] font-semibold text-ivory">{s.label}</span>
              <span className={`ml-auto h-1.5 w-1.5 rounded-full ${s.ok ? "bg-mint blink" : "bg-oxide"}`} />
            </div>
            <div className="mt-1 truncate font-mono text-[9.5px] uppercase tracking-wider text-faint">{s.note}</div>
            <div className="mt-1 truncate text-[11.5px] text-ivory-dim">{s.metric}</div>
          </div>
        ))}
      </div>

      {/* SLOs */}
      <div className="grid gap-4 xl:grid-cols-2">
        <Panel eyebrow="serving slo" title="Scoring latency (p95, ms)" note="End-to-end window latency for streaming micro-batches, including feature refresh and model inference.">
          <TrendChart series={[{ name: "p95 latency", color: "#46B3A5", points: toSeries(data.latency) }]} height={170} yFmt="ms" xLabels={tickLabels(data.latency)} />
        </Panel>
        <Panel eyebrow="ingest slo" title="Stream throughput (events / s)" note="Producer rate observed by the consumer group.">
          <TrendChart series={[{ name: "throughput", color: "#F2A93B", points: toSeries(data.throughput) }]} height={170} yFmt="int" xLabels={tickLabels(data.throughput)} />
        </Panel>
        <Panel eyebrow="consumer health" title="Consumer lag (records)" note="Backlog between the topic head and the scoring consumer.">
          <TrendChart series={[{ name: "lag", color: "#FF8A3D", points: toSeries(data.lag) }]} height={170} yFmt="int" xLabels={tickLabels(data.lag)} />
        </Panel>
        <Panel eyebrow="model output" title="Book mean predicted risk" note="Drift in the model's own output distribution is the earliest warning of stale features.">
          <TrendChart series={[{ name: "mean risk", color: "#FF4D3D", points: toSeries(data.risk) }]} height={170} yFmt="percent1" xLabels={tickLabels(data.risk)} />
        </Panel>
      </div>

      {/* drift */}
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)]">
        <Panel eyebrow="population stability index" title="Feature drift by driver group" note={`PSI measured on ${drift.sampleSize ?? 0} live feature vectors against the training baseline stored with the champion run.`}>
          <div className="space-y-1">
            {drift.groups.map((grp, i) => (
              <div key={grp.group} className="px-2 py-1.5">
                <div className="flex items-baseline justify-between gap-3">
                  <span className="flex items-center gap-2 text-[12.5px] text-ivory-dim">
                    <span className="h-2 w-2 rounded-[1px]" style={{ background: grp.color }} />
                    {grp.label}
                  </span>
                  <span className="flex items-baseline gap-2">
                    <span className="numeral text-[12.5px] font-semibold" style={{ color: grp.tone === "ok" ? "#37D39B" : grp.tone === "warn" ? "#F2C14E" : "#FF4D3D" }}>
                      {grp.psi.toFixed(3)}
                    </span>
                    <Tag tone={grp.tone === "ok" ? "ok" : grp.tone === "warn" ? "signal" : "bad"}>{grp.verdict}</Tag>
                  </span>
                </div>
                <div className="mt-1.5">
                  <Meter value={Math.min(1, grp.psi / 0.5)} color={grp.tone === "ok" ? "#37D39B" : grp.tone === "warn" ? "#F2C14E" : "#FF4D3D"} height={4} delay={i * 55} />
                </div>
                <div className="mt-1 font-mono text-[9.5px] uppercase tracking-wider text-faint">largest contributor: {grp.worstFeature}</div>
              </div>
            ))}
          </div>
          <div className="mt-3 border-t border-line-soft pt-2 text-[11.5px] leading-relaxed text-muted">
            PSI &lt; 0.10 stable · 0.10–0.25 moderate shift · &gt; 0.25 significant drift requiring retraining. Live streaming bursts
            mutate the raw telemetry, so this panel moves as the event stream runs.
          </div>
        </Panel>

        <Panel eyebrow="drift detail" title="Top drifting features" bodyClass="!p-0">
          <div className="max-h-[420px] overflow-auto">
            <table className="w-full min-w-[620px] border-collapse">
              <thead>
                <tr>
                  <Th>Feature</Th>
                  <Th>Group</Th>
                  <Th align="right">Train μ</Th>
                  <Th align="right">Live μ</Th>
                  <Th align="right">PSI</Th>
                  <Th>Verdict</Th>
                </tr>
              </thead>
              <tbody>
                {drift.features.slice(0, 22).map((f) => (
                  <tr key={f.key} className="table-row">
                    <Td className="max-w-[220px] truncate text-[12px]">{f.label}</Td>
                    <Td className="font-mono text-[10px] text-faint">{f.group}</Td>
                    <Td align="right" className="numeral text-[11.5px] text-muted">{f.meanTrain.toFixed(2)}</Td>
                    <Td align="right" className="numeral text-[11.5px] text-ivory">{f.meanNow.toFixed(2)}</Td>
                    <Td align="right" className="numeral text-[11.5px] font-semibold" >
                      <span style={{ color: f.tone === "ok" ? "#37D39B" : f.tone === "warn" ? "#F2C14E" : "#FF4D3D" }}>{f.psi.toFixed(3)}</span>
                    </Td>
                    <Td><Tag tone={f.tone === "ok" ? "ok" : f.tone === "warn" ? "signal" : "bad"}>{f.verdict}</Tag></Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
      </div>

      {/* registry + quality */}
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
        <Panel
          eyebrow="model registry"
          title="Runs, versions and promotion"
          note="Promoting a challenger re-scores the entire book and rewrites every retention play against the new artefact."
          actions={<ModelActions runs={data.registry} productionId={data.production?.id ?? ""} />}
          bodyClass="!p-0"
        >
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] border-collapse">
              <thead>
                <tr>
                  <Th>Algorithm</Th>
                  <Th>Stage</Th>
                  <Th align="right">PR-AUC</Th>
                  <Th align="right">ROC-AUC</Th>
                  <Th align="right">Net value</Th>
                  <Th>Registered</Th>
                </tr>
              </thead>
              <tbody>
                {data.registry.map((r, i) => (
                  <tr key={r.id} className={`table-row rise ${r.stage === "production" ? "bg-[rgba(242,169,59,0.06)]" : ""}`} style={{ animationDelay: `${i * 40}ms` }}>
                    <Td>
                      <span className="block text-[12.5px] font-medium text-ivory">{r.algorithm}</span>
                      <span className="block font-mono text-[10px] text-faint">{r.version} · {r.trainingMs}ms</span>
                    </Td>
                    <Td>{r.stage === "production" ? <Tag tone="signal">production</Tag> : <Tag tone="muted">staging</Tag>}</Td>
                    <Td align="right" className="numeral">{r.prAuc.toFixed(4)}</Td>
                    <Td align="right" className="numeral">{r.rocAuc.toFixed(4)}</Td>
                    <Td align="right" className="numeral font-semibold text-mint">{formatKes(r.netValueKes)}</Td>
                    <Td className="font-mono text-[10.5px] text-muted">{timeAgo(r.createdAt)}</Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>

        <div className="space-y-4">
          <Panel eyebrow="data quality gates" title="Warehouse checks" note="Run on every page load against the live tables.">
            <div className="grid gap-2 sm:grid-cols-2">
              {checks.map((c) => (
                <div key={c.label} className="panel-flat px-2.5 py-2">
                  <div className="flex items-center gap-2">
                    <span className={`flex h-4 w-4 items-center justify-center rounded-full ${c.ok ? "bg-[#2BB67322] text-mint" : "bg-[#FF4D3D22] text-oxide"}`}>
                      {c.ok ? <IconCheck size={10} strokeWidth={2.6} /> : <IconAlert size={10} />}
                    </span>
                    <span className="truncate text-[11.5px] text-ivory-dim">{c.label}</span>
                  </div>
                  <div className="numeral mt-1 text-[17px] font-bold" style={{ color: c.ok ? "#F4F1E8" : "#FF4D3D" }}>
                    {c.value.toLocaleString()}
                  </div>
                  <div className="truncate font-mono text-[9.5px] uppercase tracking-wider text-faint">{c.note}</div>
                </div>
              ))}
            </div>
          </Panel>

          <Panel eyebrow="observability" title="Topics, alerts and storage">
            <div className="space-y-1.5">
              {data.topics.map((t, i) => (
                <BarRow
                  key={t.topic}
                  label={t.topic}
                  value={t.count}
                  max={Math.max(...data.topics.map((x) => x.count), 1)}
                  display={t.count.toLocaleString()}
                  color={["#FF4D3D", "#FF8A3D", "#F2C14E", "#46B3A5", "#2BB673"][i % 5]}
                  sub={`last write ${timeAgo(t.last)}`}
                  delay={i * 50}
                />
              ))}
            </div>
            <div className="mt-3 grid grid-cols-2 gap-2 border-t border-line-soft pt-3">
              {data.alertCounts.map((a) => (
                <div key={a.severity} className="panel-flat px-2.5 py-2">
                  <div className="eyebrow">{a.severity}</div>
                  <div className="numeral mt-0.5 text-[17px] font-bold" style={{ color: a.severity === "critical" ? "#FF4D3D" : a.severity === "high" ? "#FF8A3D" : "#46B3A5" }}>
                    {a.count.toLocaleString()}
                  </div>
                  <div className="font-mono text-[9.5px] uppercase tracking-wider text-faint">{a.open} open</div>
                </div>
              ))}
            </div>
            <div className="mt-3 border-t border-line-soft pt-2">
              <KeyValue k="PostgreSQL size" v={stateSize(data)} mono />
              <KeyValue k="Scrape endpoint" v={<a className="font-mono text-[11px] text-signal link-underline" href="/api/metrics" target="_blank" rel="noreferrer">GET /api/metrics</a>} />
              <KeyValue k="Cost assumptions" v={`${formatKes(data.businessInputs.interventionCost, { compact: false })} / play · ${formatPct(data.businessInputs.saveRate, 0)} save rate`} />
            </div>
          </Panel>
        </div>
      </div>

      <RecentAlerts />
    </div>
  );
}

function stateSize(data: Awaited<ReturnType<typeof monitoring>>) {
  return `${(data.registry.length ?? 0)} runs · ${(data.quality?.customers ?? 0).toLocaleString()} customers`;
}

async function RecentAlerts() {
  const rows = await recentAlerts(12, false);
  return (
    <Panel eyebrow="alert bus" title="Recent notifications" note="Risk crossings from the streaming layer plus registry and retention events." bodyClass="!p-0">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[760px] border-collapse">
          <thead>
            <tr>
              <Th>Severity</Th>
              <Th>Source</Th>
              <Th>Alert</Th>
              <Th>Raised</Th>
              <Th align="right">Action</Th>
            </tr>
          </thead>
          <tbody>
            {rows.map((a) => (
              <tr key={a.id} className="table-row">
                <Td>
                  <Tag tone={a.severity === "critical" ? "bad" : a.severity === "high" ? "signal" : "info"}>{a.severity}</Tag>
                </Td>
                <Td className="font-mono text-[10.5px] text-muted">{a.source}</Td>
                <Td>
                  <span className="block text-[12.5px] text-ivory">{a.title}</span>
                  <span className="block max-w-[520px] truncate text-[11px] text-muted">{a.body}</span>
                </Td>
                <Td className="font-mono text-[10.5px] text-faint">{timeAgo(a.createdAt)}</Td>
                <Td align="right">
                  <div className="flex items-center justify-end gap-2">
                    {a.customerId && (
                      <a href={`/customers/${a.customerId}`} className="font-mono text-[10px] uppercase tracking-wider text-signal link-underline">
                        360
                      </a>
                    )}
                    {a.acknowledged ? <Tag tone="ok">acked</Tag> : <AckButton id={a.id} />}
                  </div>
                </Td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}
