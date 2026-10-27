"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { IconAlert, IconArrowUpRight, IconCpu, IconDatabase, IconLayers, IconPause, IconPlay, IconStream, IconTrend } from "./icons";
import { Meter, Panel, RiskPill, StatTile, Tag, Td, Th } from "./ui";
import { Sparkline, TrendChart } from "./charts";
import type { AlertDto, StreamEventDto } from "@/lib/dto";
import { EVENT_STYLE, eventLabel, formatKes, formatPct, timeAgo } from "@/lib/format";

type Tick = {
  events: Array<StreamEventDto & { customerName: string; riskLevel: string; premiumMonthly: number }>;
  alerts: Array<{ id: number; severity: string; title: string; body: string; customerId: string | null }>;
  movers: Array<{ customerId: string; name: string; delta: number; after: number; riskLevel: string }>;
  topicCounts: Record<string, number>;
  throughputEps: number;
  latencyMs: number;
  scoredCount: number;
  bookAvgRisk: number;
};

type Book = { avgRisk: number; critical: number; high: number; revenueAtRisk: number };

const TOPIC_COLOR: Record<string, string> = {
  payments: "#FF4D3D",
  support_events: "#FF8A3D",
  transactions: "#F2C14E",
  usage_events: "#46B3A5",
  customer_events: "#2BB673",
};

export function StreamApp({
  initialEvents,
  initialAlerts,
  initialBook,
  initialTopics,
  runId,
}: {
  initialEvents: StreamEventDto[];
  initialAlerts: AlertDto[];
  initialBook: Book;
  initialTopics: Array<{ topic: string; count: number }>;
  runId: string;
}) {
  const [events, setEvents] = useState<StreamEventDto[]>(initialEvents);
  const [alerts, setAlerts] = useState<AlertDto[]>(initialAlerts);
  const [book, setBook] = useState<Book>(initialBook);
  const [topics, setTopics] = useState(initialTopics);
  const [live, setLive] = useState(false);
  const [burst, setBurst] = useState(12);
  const [tick, setTick] = useState<Tick | null>(null);
  const [ticks, setTicks] = useState(0);
  const [busy, setBusy] = useState(false);
  const [riskHistory, setRiskHistory] = useState<number[]>([initialBook.avgRisk]);
  const [latencyHistory, setLatencyHistory] = useState<number[]>([]);
  const [error, setError] = useState<string | null>(null);
  const inFlight = useRef(false);

  const ingest = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/stream", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ count: burst }),
      });
      const data = (await res.json()) as Tick & { error?: string };
      if (data.error) throw new Error(data.error);
      setTick(data);
      setTicks((t) => t + 1);
      setEvents((prev) => [...data.events.map((e) => ({ ...e, occurredAt: e.occurredAt })), ...prev].slice(0, 90));
      setBook((b) => ({ ...b, avgRisk: data.bookAvgRisk }));
      setRiskHistory((h) => [...h, data.bookAvgRisk].slice(-48));
      setLatencyHistory((h) => [...h, data.latencyMs].slice(-48));
      setTopics((prev) => {
        const next = [...prev];
        Object.entries(data.topicCounts).forEach(([topic, count]) => {
          const found = next.find((n) => n.topic === topic);
          if (found) found.count += count;
          else next.push({ topic, count });
        });
        return next;
      });
      if (data.alerts?.length) {
        setAlerts((prev) => [
          ...data.alerts.map((a) => ({ ...a, source: "streaming", customerId: a.customerId, acknowledged: false, createdAt: new Date().toISOString() })),
          ...prev,
        ].slice(0, 30));
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "ingest failed");
      setLive(false);
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }, [burst]);

  useEffect(() => {
    if (!live) return;
    const id = setInterval(ingest, 2600);
    return () => clearInterval(id);
  }, [live, ingest]);

  const maxTopic = Math.max(...topics.map((t) => t.count), 1);
  const maxMover = Math.max(...(tick?.movers ?? []).map((m) => Math.abs(m.delta)), 0.001);

  const stages = [
    { label: "Source systems", note: "CRM · core insurance · M-PESA", metric: `${events.length.toLocaleString()} events in buffer`, Icon: IconDatabase, color: "#6F93B8" },
    { label: "Kafka topics", note: "5 topics · 6 partitions", metric: `${topics.length} active topics`, Icon: IconStream, color: "#46B3A5" },
    { label: "Spark micro-batch", note: "stream → feature mutation", metric: tick ? `${tick.latencyMs} ms window` : "idle", Icon: IconLayers, color: "#F2C14E" },
    { label: "Online feature store", note: "44 features · versioned", metric: tick ? `${tick.scoredCount} entities refreshed` : "2,400 entities", Icon: IconDatabase, color: "#F2A93B" },
    { label: "Champion model", note: runId, metric: tick ? `${tick.throughputEps.toFixed(0)} events/s scored` : "ready", Icon: IconCpu, color: "#FF8A3D" },
    { label: "Dashboard & alerts", note: "decisioning surface", metric: `${alerts.filter((a) => !a.acknowledged).length} open alerts`, Icon: IconAlert, color: "#FF4D3D" },
  ];

  return (
    <div className="space-y-4">
      {/* control deck */}
      <div className="panel corner-ticks px-4 py-3">
        <div className="flex flex-wrap items-center gap-3">
          <button className={`btn ${live ? "btn-danger" : "btn-primary"}`} onClick={() => setLive((v) => !v)}>
            {live ? <IconPause size={13} /> : <IconPlay size={13} />}
            {live ? "pause stream" : "go live"}
          </button>
          <button className="btn" onClick={ingest} disabled={busy}>
            <IconTrend size={13} className={busy ? "spin" : ""} />
            emit burst
          </button>
          <label className="flex items-center gap-2">
            <span className="eyebrow">events / burst</span>
            <select className="select !w-auto !py-1" value={burst} onChange={(e) => setBurst(Number(e.target.value))}>
              {[4, 8, 12, 24, 40].map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </label>
          <div className="ml-auto flex flex-wrap items-center gap-4">
            <span className="flex items-center gap-2 font-mono text-[10.5px] uppercase tracking-wider">
              <span className={`h-2 w-2 rounded-full ${live ? "bg-mint blink" : busy ? "bg-signal" : "bg-faint"}`} />
              <span className={live ? "text-mint" : "text-muted"}>{live ? "consuming" : busy ? "micro-batch running" : "paused"}</span>
            </span>
            <span className="font-mono text-[10.5px] text-faint">{ticks} micro-batches · {events.length} events in buffer</span>
          </div>
        </div>
        {error && <div className="mt-2 rounded-[3px] border border-[#FF4D3D55] bg-[#FF4D3D0c] px-3 py-1.5 font-mono text-[11px] text-oxide">{error}</div>}
      </div>

      {/* topology */}
      <Panel eyebrow="streaming topology" title="Event → feature → score → decision" note="Every event mutates the customer's raw telemetry, refreshes the online feature vector, re-scores with the production artefact and re-writes the retention play.">
        <div className="grid gap-2 md:grid-cols-3 xl:grid-cols-6">
          {stages.map((s, i) => (
            <div key={s.label} className="relative">
              <div className="panel-flat panel-hover h-full px-3 py-2.5" style={{ borderTop: `2px solid ${s.color}` }}>
                <div className="flex items-center gap-2">
                  <span className="shrink-0" style={{ color: s.color }}>
                    <s.Icon size={15} />
                  </span>
                  <span className="truncate text-[12px] font-semibold text-ivory">{s.label}</span>
                </div>
                <div className="mt-1 truncate font-mono text-[9.5px] uppercase tracking-wider text-faint">{s.note}</div>
                <div className="mt-1.5 truncate text-[11px]" style={{ color: s.color }}>
                  {s.metric}
                </div>
              </div>
              {i < stages.length - 1 && (
                <div className="pointer-events-none absolute -right-2 top-1/2 hidden h-[2px] w-4 -translate-y-1/2 xl:block">
                  <div className={`flow-line h-full w-full ${live ? "" : "opacity-25"}`} />
                </div>
              )}
            </div>
          ))}
        </div>
      </Panel>

      {/* book stats */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile label="Book mean risk" value={formatPct(book.avgRisk)} tone="#F2A93B" hint={`${riskHistory.length} streaming samples`}>
          <Sparkline values={riskHistory.length > 1 ? riskHistory : [book.avgRisk, book.avgRisk]} color="#F2A93B" width={160} height={26} />
        </StatTile>
        <StatTile label="Critical band" value={(book.critical ?? 0).toLocaleString()} tone="#FF4D3D" hint="above 75% non-renewal probability" />
        <StatTile label="High band" value={(book.high ?? 0).toLocaleString()} tone="#FF8A3D" hint="55–75% probability" />
        <StatTile label="Revenue at risk" value={formatKes(book.revenueAtRisk ?? 0)} tone="#F2C14E" hint="probability-weighted recoverable premium" />
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
        {/* ticker */}
        <Panel
          eyebrow="consumer group · churniq-scoring"
          title="Live event ticker"
          note="Offsets are PostgreSQL sequence positions standing in for Kafka partition offsets."
          bodyClass="!p-0"
          actions={<Tag tone={live ? "ok" : "muted"}>{live ? "streaming" : "paused"}</Tag>}
        >
          <div className="max-h-[520px] overflow-auto">
            <table className="w-full min-w-[820px] border-collapse">
              <thead>
                <tr>
                  <Th>Offset</Th>
                  <Th>Partition</Th>
                  <Th>Topic</Th>
                  <Th>Event</Th>
                  <Th>Customer</Th>
                  <Th align="right">Before</Th>
                  <Th align="right">After</Th>
                  <Th align="right">Δ risk</Th>
                  <Th align="right">Lag</Th>
                </tr>
              </thead>
              <tbody>
                {events.slice(0, 60).map((e, i) => {
                  const style = EVENT_STYLE[e.eventType];
                  const tone = style?.tone === "critical" ? "#FF4D3D" : style?.tone === "warn" ? "#F2A93B" : style?.tone === "ok" ? "#2BB673" : "#46B3A5";
                  const delta = e.riskDelta ?? 0;
                  return (
                    <tr key={`${e.id}-${i}`} className={`table-row ${i === 0 ? "ticker-row" : ""}`}>
                      <Td className="font-mono text-[10.5px] text-faint">#{e.streamOffset || e.id}</Td>
                      <Td className="font-mono text-[10.5px] text-muted">p{e.partition}</Td>
                      <Td>
                        <span className="flex items-center gap-1.5 font-mono text-[10.5px]" style={{ color: TOPIC_COLOR[e.topic] ?? "#8A9AAB" }}>
                          <span className="h-1.5 w-1.5 rounded-full" style={{ background: TOPIC_COLOR[e.topic] ?? "#8A9AAB" }} />
                          {e.topic}
                        </span>
                      </Td>
                      <Td>
                        <span className="flex items-center gap-2">
                          <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: tone }} />
                          <span className="text-[12px] text-ivory-dim">{style?.label ?? eventLabel(e.eventType)}</span>
                        </span>
                        <span className="mt-0.5 block max-w-[220px] truncate font-mono text-[9.5px] text-faint">{JSON.stringify(e.payload)}</span>
                      </Td>
                      <Td>
                        <Link href={`/customers/${e.customerId}`} className="group block">
                          <span className="block font-mono text-[10px] text-signal link-underline">{e.customerId}</span>
                          <span className="block max-w-[150px] truncate text-[11.5px] text-ivory-dim group-hover:text-signal">
                            {(e as StreamEventDto & { name?: string }).name ?? ""}
                          </span>
                        </Link>
                      </Td>
                      <Td align="right" className="numeral text-[11.5px] text-muted">{e.scoreBefore !== null ? formatPct(e.scoreBefore) : "—"}</Td>
                      <Td align="right" className="numeral text-[11.5px] font-semibold text-ivory">{e.scoreAfter !== null ? formatPct(e.scoreAfter) : "—"}</Td>
                      <Td align="right" className="numeral text-[11.5px] font-bold">
                        <span style={{ color: delta > 0.001 ? "#FF4D3D" : delta < -0.001 ? "#2BB673" : "#5D6C7B" }}>
                          {delta > 0 ? "+" : delta < 0 ? "−" : ""}
                          {Math.abs(delta * 100).toFixed(1)}
                        </span>
                      </Td>
                      <Td align="right" className="font-mono text-[10.5px] text-faint">{e.lagMs}ms</Td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Panel>

        <div className="space-y-4">
          {/* movers */}
          <Panel eyebrow="biggest movements" title="Risk movers this batch" note="Largest score deltas produced by the latest micro-batch.">
            {!tick?.movers?.length ? (
              <p className="py-6 text-center text-[12px] text-muted">Emit a burst to see score movement.</p>
            ) : (
              <div className="space-y-2.5">
                {tick.movers.map((mv, i) => (
                  <Link key={mv.customerId + i} href={`/customers/${mv.customerId}`} className="group block rounded-[3px] px-2 py-1.5 transition-colors hover:bg-[rgba(242,169,59,0.06)]">
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="truncate text-[12.5px] text-ivory group-hover:text-signal">{mv.name}</span>
                      <span className="numeral shrink-0 text-[12.5px] font-bold" style={{ color: mv.delta >= 0 ? "#FF4D3D" : "#2BB673" }}>
                        {mv.delta >= 0 ? "+" : "−"}
                        {Math.abs(mv.delta * 100).toFixed(1)} pts
                      </span>
                    </div>
                    <div className="mt-1 flex items-center gap-2">
                      <div className="flex-1">
                        <Meter value={mv.after} color={mv.delta >= 0 ? "#FF4D3D" : "#2BB673"} height={4} />
                      </div>
                      <span className="numeral w-[38px] text-right text-[11px] text-muted">{formatPct(mv.after, 0)}</span>
                      <RiskPill level={mv.riskLevel} size="xs" />
                    </div>
                    <span className="mt-0.5 block font-mono text-[9.5px] text-faint">{mv.customerId}</span>
                  </Link>
                ))}
              </div>
            )}
          </Panel>

          {/* alert bus */}
          <Panel eyebrow="alert bus" title="Streaming alerts" note="Raised the moment a customer crosses into High or Critical.">
            <ul className="max-h-[290px] space-y-2 overflow-y-auto pr-1">
              {alerts.length === 0 && <li className="py-6 text-center text-[12px] text-muted">No alerts yet.</li>}
              {alerts.slice(0, 14).map((a) => {
                const color = a.severity === "critical" ? "#FF4D3D" : a.severity === "high" ? "#FF8A3D" : "#46B3A5";
                return (
                  <li key={a.id} className="ticker-row rounded-[3px] border px-2.5 py-2" style={{ borderColor: `${color}33`, background: `${color}0a` }}>
                    <div className="flex items-start gap-2">
                      <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: color }} />
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-[12px] font-semibold text-ivory">{a.title}</div>
                        <p className="mt-0.5 line-clamp-2 text-[11px] leading-snug text-muted">{a.body}</p>
                        <div className="mt-1 flex items-center justify-between gap-2">
                          <span className="font-mono text-[9.5px] uppercase tracking-wider text-faint">{timeAgo(a.createdAt)}</span>
                          {a.customerId && (
                            <Link href={`/customers/${a.customerId}`} className="flex items-center gap-1 font-mono text-[10px] text-signal link-underline">
                              customer 360 <IconArrowUpRight size={10} />
                            </Link>
                          )}
                        </div>
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          </Panel>
        </div>
      </div>

      {/* throughput + topics */}
      <div className="grid gap-4 xl:grid-cols-3">
        <Panel className="xl:col-span-2" eyebrow="pipeline telemetry" title="Micro-batch latency & book risk" note="Each point is one streaming micro-batch: end-to-end window latency and the resulting book-level mean risk.">
          <TrendChart
            series={[
              { name: "Book risk", color: "#F2A93B", points: riskHistory.map((v, i) => ({ x: i, y: v })) },
            ]}
            height={170}
            yFormat={(v) => `${(v * 100).toFixed(1)}%`}
            xFormat={(_, i) => `t${i}`}
          />
          <div className="mt-3 grid grid-cols-2 gap-3 border-t border-line-soft pt-3 md:grid-cols-4">
            {[
              { label: "last window", value: tick ? `${tick.latencyMs} ms` : "—", tone: "#46B3A5" },
              { label: "p95 window", value: latencyHistory.length ? `${Math.max(...latencyHistory)} ms` : "—", tone: "#F2C14E" },
              { label: "throughput", value: tick ? `${tick.throughputEps.toFixed(0)}/s` : "—", tone: "#FF8A3D" },
              { label: "entities refreshed", value: tick ? String(tick.scoredCount) : "—", tone: "#37D39B" },
            ].map((s) => (
              <div key={s.label}>
                <div className="eyebrow">{s.label}</div>
                <div className="numeral mt-0.5 text-[18px] font-bold" style={{ color: s.tone }}>
                  {s.value}
                </div>
              </div>
            ))}
          </div>
        </Panel>

        <Panel eyebrow="topic volumes" title="Events by Kafka topic" note="Cumulative consumption since the stream page opened.">
          <div className="space-y-2">
            {topics
              .slice()
              .sort((a, b) => b.count - a.count)
              .map((t, i) => (
                <div key={t.topic}>
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="font-mono text-[11px] text-ivory-dim">{t.topic}</span>
                    <span className="numeral text-[12px] font-semibold" style={{ color: TOPIC_COLOR[t.topic] ?? "#8A9AAB" }}>
                      {t.count.toLocaleString()}
                    </span>
                  </div>
                  <Meter value={t.count / maxTopic} color={TOPIC_COLOR[t.topic] ?? "#8A9AAB"} height={5} delay={i * 60} />
                </div>
              ))}
          </div>
          <div className="mt-3 border-t border-line-soft pt-2.5 text-[11.5px] leading-relaxed text-muted">
            Bursts are written to <span className="font-mono text-ivory-dim">customer_events</span>, applied to the raw telemetry
            columns, re-materialised in <span className="font-mono text-ivory-dim">feature_store</span> and re-scored against{" "}
            <span className="font-mono text-signal">{runId}</span>.
          </div>
        </Panel>
      </div>
    </div>
  );
}
