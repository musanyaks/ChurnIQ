"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { IconArrowUpRight, IconChevron, IconRefresh } from "./icons";
import { PlayActions } from "./controls";
import { Meter, RiskPill, Tag, Td, Th } from "./ui";
import type { RetentionRow } from "@/lib/dto";
import { formatKes, formatPct, timeAgo } from "@/lib/format";

const PRIORITIES = ["Critical", "High", "Medium", "Low"];
const STATUSES = ["queued", "backlog", "contacted", "saved", "lost", "snoozed"];
const SORTS = [
  { key: "probability", label: "churn risk" },
  { key: "expected", label: "expected save" },
  { key: "roi", label: "ROI" },
  { key: "value", label: "customer value" },
];

export function RetentionApp({ initial }: { initial: { rows: RetentionRow[]; total: number; pages: number } }) {
  const [rows, setRows] = useState<RetentionRow[]>(initial.rows);
  const [total, setTotal] = useState(initial.total);
  const [pages, setPages] = useState(initial.pages);
  const [page, setPage] = useState(1);
  const [priority, setPriority] = useState("");
  const [status, setStatus] = useState("");
  const [sort, setSort] = useState("probability");
  const [q, setQ] = useState("");
  const [debounced, setDebounced] = useState("");
  const [loading, setLoading] = useState(false);
  const first = useRef(true);

  useEffect(() => {
    const id = setTimeout(() => setDebounced(q.trim()), 280);
    return () => clearTimeout(id);
  }, [q]);

  const query = useMemo(() => {
    const p = new URLSearchParams();
    if (priority) p.set("priority", priority);
    if (status) p.set("status", status);
    if (debounced) p.set("q", debounced);
    p.set("sort", sort);
    p.set("page", String(page));
    p.set("pageSize", "30");
    return p.toString();
  }, [priority, status, debounced, sort, page]);

  const load = useCallback(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    setLoading(true);
    fetch(`/api/retention?${query}`, { cache: "no-store" })
      .then((r) => r.json())
      .then((d: { rows: RetentionRow[]; total: number; pages: number; error?: string }) => {
        if (d.error) return;
        setRows(d.rows.map((r) => ({ ...r, updatedAt: typeof r.updatedAt === "string" ? r.updatedAt : new Date(r.updatedAt).toISOString() })));
        setTotal(d.total);
        setPages(d.pages);
      })
      .finally(() => setLoading(false));
  }, [query]);

  useEffect(load, [load]);

  const totals = useMemo(() => {
    const expected = rows.reduce((s, r) => s + r.expectedSaveKes, 0);
    const cost = rows.reduce((s, r) => s + r.playCostKes, 0);
    return { expected, cost, roi: cost > 0 ? expected / cost : 0 };
  }, [rows]);

  return (
    <div className="space-y-4">
      <div className="panel px-4 py-3">
        <div className="flex flex-wrap items-end gap-3">
          <label className="min-w-[220px] flex-1">
            <span className="eyebrow mb-1 block">find customer</span>
            <input className="input font-mono" placeholder="CIQ-10482 · jane wanjiru" value={q} onChange={(e) => { setPage(1); setQ(e.target.value); }} />
          </label>
          <label className="block">
            <span className="eyebrow mb-1 block">priority</span>
            <select className="select" value={priority} onChange={(e) => { setPage(1); setPriority(e.target.value); }}>
              <option value="">all</option>
              {PRIORITIES.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="eyebrow mb-1 block">play status</span>
            <select className="select" value={status} onChange={(e) => { setPage(1); setStatus(e.target.value); }}>
              <option value="">all</option>
              {STATUSES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </label>
          <div className="flex items-end gap-1.5">
            {SORTS.map((s) => (
              <button
                key={s.key}
                onClick={() => { setSort(s.key); setPage(1); }}
                className={`rounded-[2px] border px-2 py-1.5 font-mono text-[10px] uppercase tracking-[0.1em] transition-colors ${
                  sort === s.key ? "border-signal/60 bg-[#F2A93B14] text-signal" : "border-line text-muted hover:text-ivory-dim"
                }`}
              >
                {s.label}
              </button>
            ))}
          </div>
          <button className="btn" onClick={load} disabled={loading}>
            <IconRefresh size={13} className={loading ? "spin" : ""} /> reload
          </button>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-4 border-t border-line-soft pt-3 font-mono text-[10.5px] uppercase tracking-wider text-faint">
          <span>
            <span className="numeral text-[15px] font-bold text-ivory">{total.toLocaleString()}</span> plays in queue
          </span>
          <span>
            page view · <span className="text-mint">{formatKes(totals.expected)}</span> expected save vs{" "}
            <span className="text-ember">{formatKes(totals.cost)}</span> cost
          </span>
          {loading && <span className="text-signal blink">querying…</span>}
        </div>
      </div>

      <div className="panel overflow-hidden">
        <div className="max-h-[64vh] overflow-auto">
          <table className="w-full min-w-[1160px] border-collapse">
            <thead>
              <tr>
                <Th>Priority</Th>
                <Th>Customer</Th>
                <Th align="right">Churn</Th>
                <Th align="right">Annual value</Th>
                <Th>Dispatched play</Th>
                <Th>Owner</Th>
                <Th align="right">Expected save</Th>
                <Th align="right">ROI</Th>
                <Th>Workflow</Th>
                <Th align="right" />
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={r.actionId} className="table-row rise" style={{ animationDelay: `${Math.min(i * 16, 280)}ms` }}>
                  <Td>
                    <div className="flex items-center gap-2">
                      <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: r.priority === "Critical" ? "#FF4D3D" : r.priority === "High" ? "#FF8A3D" : r.priority === "Medium" ? "#F2C14E" : "#2BB673" }} />
                      <span className="font-mono text-[10.5px] uppercase tracking-wider text-ivory-dim">{r.priority}</span>
                    </div>
                    <span className="mt-1 block font-mono text-[9.5px] text-faint">updated {timeAgo(r.updatedAt)}</span>
                  </Td>
                  <Td>
                    <Link href={`/customers/${r.id}`} className="group block">
                      <span className="block font-mono text-[10.5px] text-signal link-underline">{r.id}</span>
                      <span className="block text-[12.5px] font-medium text-ivory group-hover:text-signal">{r.fullName}</span>
                      <span className="block font-mono text-[10px] text-faint">
                        {r.segment} · {r.productLine} · {r.county}
                      </span>
                    </Link>
                  </Td>
                  <Td align="right">
                    <div className="flex items-center justify-end gap-2">
                      <div className="w-12">
                        <Meter value={r.probability} color={r.color} height={5} delay={i * 16} />
                      </div>
                      <span className="numeral w-[42px] text-[13px] font-bold" style={{ color: r.color }}>
                        {formatPct(r.probability, 0)}
                      </span>
                    </div>
                    <span className="mt-1 flex justify-end"><RiskPill level={r.priority === "Critical" ? "Critical" : r.priority === "High" ? "High" : r.priority === "Medium" ? "Elevated" : "Low"} size="xs" /></span>
                  </Td>
                  <Td align="right" className="numeral">{formatKes(r.annualValue)}</Td>
                  <Td className="max-w-[300px]">
                    <span className="block truncate text-[12px] text-ivory-dim" title={r.play}>{r.play}</span>
                    <span className="mt-0.5 flex flex-wrap items-center gap-1">
                      {(r.drivers ?? []).slice(0, 2).map((d) => (
                        <Tag key={d.label} tone={d.impact >= 0 ? "bad" : "ok"}>
                          {d.label} {d.impact >= 0 ? "+" : "−"}
                          {Math.abs(d.impact * 100).toFixed(0)}
                        </Tag>
                      ))}
                    </span>
                  </Td>
                  <Td className="font-mono text-[10.5px] text-muted">{r.owner}</Td>
                  <Td align="right" className="numeral font-semibold text-mint">{formatKes(r.expectedSaveKes)}</Td>
                  <Td align="right" className="numeral" >
                    <span style={{ color: r.roi >= 3 ? "#37D39B" : r.roi >= 1 ? "#F2C14E" : "#FF8A3D" }}>{r.roi.toFixed(1)}x</span>
                  </Td>
                  <Td>
                    <PlayActions actionId={r.actionId} status={r.status} />
                  </Td>
                  <Td align="right">
                    <Link href={`/customers/${r.id}`} className="inline-block text-faint transition-colors hover:text-signal">
                      <IconArrowUpRight size={15} />
                    </Link>
                  </Td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={10} className="px-4 py-14 text-center text-[13px] text-muted">
                    No plays match this filter.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <div className="flex items-center justify-between gap-3 border-t border-line-soft px-4 py-2.5">
          <button className="btn" disabled={page <= 1 || loading} onClick={() => setPage((p) => Math.max(1, p - 1))}>
            <IconChevron size={12} className="rotate-180" /> prev
          </button>
          <span className="font-mono text-[10.5px] text-faint">page {page} / {pages}</span>
          <button className="btn" disabled={page >= pages || loading} onClick={() => setPage((p) => Math.min(pages, p + 1))}>
            next <IconChevron size={12} />
          </button>
        </div>
      </div>
    </div>
  );
}
