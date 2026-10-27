"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { IconArrowUpRight, IconChevron, IconClose, IconDownload, IconSearch } from "./icons";
import { Meter, RiskPill, Tag, Th, Td } from "./ui";
import type { CustomerListItem, CustomerListResult, FilterOptions } from "@/lib/dto";
import { formatKes, formatPct, timeAgo } from "@/lib/format";

type SortKey = "probability" | "premium" | "tenure" | "priority" | "name" | "revenueAtRisk";

const SORTS: Array<{ key: SortKey; label: string }> = [
  { key: "probability", label: "Risk" },
  { key: "priority", label: "Priority" },
  { key: "revenueAtRisk", label: "Revenue at risk" },
  { key: "premium", label: "Premium" },
  { key: "tenure", label: "Tenure" },
  { key: "name", label: "Name" },
];

export function ExplorerApp({
  initial,
  options,
}: {
  initial: CustomerListResult;
  options: FilterOptions;
}) {
  const [rows, setRows] = useState<CustomerListItem[]>(initial.rows);
  const [total, setTotal] = useState(initial.total);
  const [pages, setPages] = useState(initial.pages);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [loading, setLoading] = useState(false);
  const [q, setQ] = useState("");
  const [debounced, setDebounced] = useState("");
  const [filters, setFilters] = useState<Record<string, string>>({});
  const [sort, setSort] = useState<SortKey>("probability");
  const [dir, setDir] = useState<"asc" | "desc">("desc");
  const first = useRef(true);

  useEffect(() => {
    const id = setTimeout(() => setDebounced(q.trim()), 280);
    return () => clearTimeout(id);
  }, [q]);

  const query = useMemo(() => {
    const p = new URLSearchParams();
    if (debounced) p.set("q", debounced);
    Object.entries(filters).forEach(([k, v]) => v && p.set(k, v));
    p.set("sort", sort);
    p.set("dir", dir);
    p.set("page", String(page));
    p.set("pageSize", String(pageSize));
    return p.toString();
  }, [debounced, filters, sort, dir, page, pageSize]);

  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    let alive = true;
    setLoading(true);
    fetch(`/api/customers?${query}`, { cache: "no-store" })
      .then((r) => r.json())
      .then((d: CustomerListResult & { error?: string }) => {
        if (!alive || d.error) return;
        setRows(d.rows);
        setTotal(d.total);
        setPages(d.pages);
      })
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [query]);

  const setFilter = useCallback((key: string, value: string) => {
    setPage(1);
    setFilters((f) => ({ ...f, [key]: value }));
  }, []);

  const activeChips = Object.entries(filters).filter(([, v]) => v);

  const exportCsv = () => {
    const header = ["customer_id", "name", "email", "segment", "product_line", "county", "contract_type", "risk", "probability", "monthly_premium", "revenue_at_risk", "churned"];
    const lines = rows.map((r) =>
      [r.id, r.fullName, r.email, r.segment, r.productLine, r.county, r.contractType, r.riskLevel, r.probability.toFixed(4), r.premiumMonthly, r.revenueAtRisk, r.churn]
        .map((v) => `"${String(v).replace(/"/g, '""')}"`)
        .join(","),
    );
    const blob = new Blob([[header.join(","), ...lines].join("\n")], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `churniq-explorer-page${page}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const select = (key: string, label: string, values: string[]) => (
    <label className="block">
      <span className="eyebrow mb-1 block">{label}</span>
      <select className="select" value={filters[key] ?? ""} onChange={(e) => setFilter(key, e.target.value)}>
        <option value="">all</option>
        {values.map((v) => (
          <option key={v} value={v}>
            {v}
          </option>
        ))}
      </select>
    </label>
  );

  return (
    <div className="space-y-4">
      {/* control bar */}
      <div className="panel px-4 py-3">
        <div className="flex flex-wrap items-end gap-3">
          <label className="min-w-[240px] flex-1">
            <span className="eyebrow mb-1 block">search</span>
            <span className="relative block">
              <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-faint">
                <IconSearch size={14} />
              </span>
              <input className="input !pl-8 font-mono" placeholder="CIQ-10482 · jane wanjiru · +2547…" value={q} onChange={(e) => { setPage(1); setQ(e.target.value); }} />
            </span>
          </label>
          {select("segment", "segment", options.segments)}
          {select("productLine", "product line", options.products)}
          {select("county", "county", options.counties)}
          {select("riskLevel", "risk band", options.riskLevels)}
          {select("contractType", "billing", ["Monthly", "Quarterly", "Annual"])}
          {select("status", "policy status", ["Active", "Renewal Due", "Lapsed", "Cancelled"])}
          {select("churned", "label", ["yes", "no"])}
          <div className="flex items-center gap-2">
            <button className="btn" onClick={exportCsv}>
              <IconDownload size={13} /> csv
            </button>
            {(activeChips.length > 0 || q) && (
              <button
                className="btn"
                onClick={() => {
                  setFilters({});
                  setQ("");
                  setPage(1);
                }}
              >
                <IconClose size={13} /> clear
              </button>
            )}
          </div>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-line-soft pt-3">
          <span className="eyebrow">sort</span>
          {SORTS.map((s) => (
            <button
              key={s.key}
              onClick={() => {
                if (sort === s.key) setDir(dir === "desc" ? "asc" : "desc");
                else {
                  setSort(s.key);
                  setDir(s.key === "name" ? "asc" : "desc");
                }
                setPage(1);
              }}
              className={`rounded-[2px] border px-2 py-1 font-mono text-[10px] uppercase tracking-[0.1em] transition-colors ${
                sort === s.key ? "border-signal/60 bg-[#F2A93B14] text-signal" : "border-line text-muted hover:border-line hover:text-ivory-dim"
              }`}
            >
              {s.label}
              {sort === s.key && <span className="ml-1">{dir === "desc" ? "↓" : "↑"}</span>}
            </button>
          ))}
          <span className="ml-auto flex items-center gap-2">
            <span className="eyebrow">rows</span>
            <select className="select !w-auto !py-1" value={pageSize} onChange={(e) => { setPageSize(Number(e.target.value)); setPage(1); }}>
              {[15, 25, 50, 100].map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </span>
        </div>

        {activeChips.length > 0 && (
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            {activeChips.map(([k, v]) => (
              <button key={k} onClick={() => setFilter(k, "")} className="group">
                <Tag tone="signal">
                  {k}: {v}
                  <IconClose size={9} className="opacity-60 transition-opacity group-hover:opacity-100" />
                </Tag>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* results */}
      <div className="panel overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line-soft px-4 py-2.5">
          <div className="flex items-baseline gap-2">
            <span className="numeral text-[19px] font-bold text-ivory">{total.toLocaleString()}</span>
            <span className="eyebrow">matching policyholders</span>
            {loading && <span className="font-mono text-[10px] text-signal blink">querying…</span>}
          </div>
          <span className="font-mono text-[10.5px] text-faint">
            page {page} / {pages} · scored {rows[0] ? timeAgo(rows[0].scoredAt) : "—"}
          </span>
        </div>

        <div className="max-h-[62vh] overflow-auto">
          <table className="w-full min-w-[1020px] border-collapse">
            <thead>
              <tr>
                <Th>Customer</Th>
                <Th>Segment / product</Th>
                <Th>County</Th>
                <Th>Tenure</Th>
                <Th align="right">Premium / mo</Th>
                <Th>Risk</Th>
                <Th align="right">Revenue at risk</Th>
                <Th>Label</Th>
                <Th align="right" />
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={r.id} className="table-row rise" style={{ animationDelay: `${Math.min(i * 18, 320)}ms` }}>
                  <Td>
                    <Link href={`/customers/${r.id}`} className="group block">
                      <span className="block font-mono text-[10.5px] text-signal link-underline">{r.id}</span>
                      <span className="block text-[12.5px] font-medium text-ivory group-hover:text-signal">{r.fullName}</span>
                      <span className="block truncate font-mono text-[10px] text-faint">{r.email}</span>
                    </Link>
                  </Td>
                  <Td>
                    <span className="block text-[12px]">{r.segment}</span>
                    <span className="block font-mono text-[10px] text-faint">{r.productLine}</span>
                  </Td>
                  <Td className="font-mono text-[11px] text-muted">{r.county}</Td>
                  <Td className="numeral">{r.tenureMonths}m</Td>
                  <Td align="right" className="numeral">{formatKes(r.premiumMonthly, { compact: false })}</Td>
                  <Td>
                    <div className="flex items-center gap-2">
                      <span className="numeral w-[42px] text-[14px] font-bold" style={{ color: r.color }}>
                        {formatPct(r.probability, 0)}
                      </span>
                      <div className="w-14">
                        <Meter value={r.probability} color={r.color} height={5} delay={i * 18} />
                      </div>
                      <RiskPill level={r.riskLevel} size="xs" />
                    </div>
                  </Td>
                  <Td align="right" className="numeral font-semibold text-signal">{formatKes(r.revenueAtRisk)}</Td>
                  <Td>
                    {r.churn ? <Tag tone="bad">churned</Tag> : <Tag tone="ok">retained</Tag>}
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
                  <td colSpan={9} className="px-4 py-14 text-center text-[13px] text-muted">
                    No policyholders match these filters.
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
          <div className="flex items-center gap-1">
            {Array.from({ length: Math.min(7, pages) }, (_, i) => {
              const start = Math.max(1, Math.min(page - 3, pages - 6));
              const n = start + i;
              if (n > pages) return null;
              return (
                <button
                  key={n}
                  onClick={() => setPage(n)}
                  className={`h-7 w-7 rounded-[2px] border font-mono text-[11px] transition-colors ${
                    n === page ? "border-signal/60 bg-[#F2A93B14] text-signal" : "border-line text-muted hover:text-ivory"
                  }`}
                >
                  {n}
                </button>
              );
            })}
          </div>
          <button className="btn" disabled={page >= pages || loading} onClick={() => setPage((p) => Math.min(pages, p + 1))}>
            next <IconChevron size={12} />
          </button>
        </div>
      </div>
    </div>
  );
}
