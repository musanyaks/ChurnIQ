"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import {
  IconAlert,
  IconCheck,
  IconClose,
  IconCpu,
  IconDatabase,
  IconExecutive,
  IconExplorer,
  IconLab,
  IconOps,
  IconPredict,
  IconRadar,
  IconRetention,
  IconStream,
  LogoMark,
} from "./icons";

type NavItem = { href: string; label: string; index: string; Icon: typeof IconExecutive; group: string };

const NAV: NavItem[] = [
  { href: "/", label: "Executive Dashboard", index: "01", Icon: IconExecutive, group: "Intelligence" },
  { href: "/explorer", label: "Customer Explorer", index: "02", Icon: IconExplorer, group: "Intelligence" },
  { href: "/predict", label: "Churn Prediction", index: "03", Icon: IconPredict, group: "Intelligence" },
  { href: "/customers/CIQ-10000", label: "Customer 360", index: "04", Icon: IconRadar, group: "Intelligence" },
  { href: "/retention", label: "Retention Center", index: "05", Icon: IconRetention, group: "Decisioning" },
  { href: "/models", label: "Model Lab", index: "06", Icon: IconLab, group: "Decisioning" },
  { href: "/stream", label: "Real-Time Stream", index: "07", Icon: IconStream, group: "Platform" },
  { href: "/monitoring", label: "Platform Health", index: "08", Icon: IconOps, group: "Platform" },
];

type Status = {
  ok: boolean;
  bootstrapped: boolean;
  production?: string;
  algorithm?: string;
  openAlerts?: number;
  criticalAlerts?: number;
  eventsLast10m?: number;
  bookAvgRisk?: number;
  customers?: number;
  latestAlert?: { id: number; severity: string; title: string; body: string; customerId: string | null } | null;
};

function useClock() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);
  return now;
}

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const [drawer, setDrawer] = useState(false);
  const [status, setStatus] = useState<Status | null>(null);
  const [toast, setToast] = useState<{ id: number; title: string; body: string; severity: string; customerId: string | null } | null>(null);
  const [alertsOpen, setAlertsOpen] = useState(false);
  const [alerts, setAlerts] = useState<Array<{ id: number; severity: string; title: string; body: string; createdAt: string; customerId: string | null }>>([]);
  const lastAlert = useRef<number>(0);
  const now = useClock();

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/status", { cache: "no-store" });
      const data = (await res.json()) as Status;
      setStatus(data);
      if (data.latestAlert && data.latestAlert.id !== lastAlert.current) {
        const isNew = lastAlert.current !== 0;
        lastAlert.current = data.latestAlert.id;
        if (isNew && (data.latestAlert.severity === "critical" || data.latestAlert.severity === "high")) {
          setToast(data.latestAlert);
          setTimeout(() => setToast(null), 7000);
        }
      }
    } catch {
      setStatus((s) => (s ? { ...s, ok: false } : { ok: false, bootstrapped: false }));
    }
  }, []);

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, 12000);
    return () => clearInterval(id);
  }, [refresh]);

  useEffect(() => {
    setDrawer(false);
    setAlertsOpen(false);
  }, [pathname]);

  const loadAlerts = async () => {
    setAlertsOpen((v) => !v);
    try {
      const res = await fetch("/api/alerts?limit=14", { cache: "no-store" });
      const data = (await res.json()) as { alerts: Array<{ id: number; severity: string; title: string; body: string; createdAt: string; customerId: string | null }> };
      setAlerts(data.alerts);
    } catch {
      /* ignore */
    }
  };

  const groups = Array.from(new Set(NAV.map((n) => n.group)));
  const isCustomer360 = pathname.startsWith("/customers/");

  const navList = (
    <nav className="flex flex-col gap-5">
      {groups.map((group) => (
        <div key={group}>
          <div className="eyebrow mb-2 px-3">{group}</div>
          <ul className="space-y-[2px]">
            {NAV.filter((n) => n.group === group).map((item) => {
              const active = item.href === "/" ? pathname === "/" : pathname.startsWith(item.href) || (isCustomer360 && item.index === "04");
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    className={`group relative flex items-center gap-2.5 rounded-[3px] px-3 py-2 transition-all duration-200 ${
                      active ? "bg-[rgba(242,169,59,0.1)] text-ivory" : "text-muted hover:bg-[rgba(244,241,232,0.04)] hover:text-ivory-dim"
                    }`}
                  >
                    <span
                      className={`absolute left-0 top-1/2 h-0 w-[2px] -translate-y-1/2 bg-signal transition-all duration-300 ${active ? "h-[62%]" : "group-hover:h-[38%]"}`}
                    />
                    <item.Icon size={16} className={active ? "text-signal" : "text-faint transition-colors group-hover:text-signal"} />
                    <span className="flex-1 truncate text-[12.5px] font-medium">{item.label}</span>
                    <span className={`font-mono text-[9.5px] ${active ? "text-signal" : "text-faint/60"}`}>{item.index}</span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );

  return (
    <div className="relative z-10 min-h-screen">
      <div className="mx-auto flex w-full max-w-[1680px]">
        {/* sidebar */}
        <aside className="sticky top-0 hidden h-screen w-[248px] shrink-0 flex-col border-r border-line-soft bg-[rgba(7,12,18,0.86)] px-3 py-5 backdrop-blur-xl lg:flex">
          <Link href="/" className="group mb-6 flex items-center gap-2.5 px-2">
            <span className="text-signal transition-transform duration-500 group-hover:rotate-[8deg]">
              <LogoMark size={30} />
            </span>
            <span>
              <span className="block font-display text-[17px] font-bold leading-none tracking-[0.14em] text-ivory">CHURN<span className="text-signal">IQ</span></span>
              <span className="mt-1 block font-mono text-[8.5px] uppercase tracking-[0.18em] text-faint">Retention Intelligence · KE</span>
            </span>
          </Link>
          <div className="flex-1 overflow-y-auto pr-1">{navList}</div>
          <div className="mt-4 space-y-2 border-t border-line-soft pt-4">
            <div className="panel-flat px-2.5 py-2">
              <div className="eyebrow mb-1">Production model</div>
              <div className="flex items-center gap-1.5 text-[11.5px] text-ivory">
                <IconCpu size={13} className="text-mint" />
                <span className="truncate">{status?.algorithm ?? "—"}</span>
              </div>
              <div className="mt-1 truncate font-mono text-[9.5px] text-faint">{status?.production ?? "registry empty"}</div>
            </div>
            <div className="flex items-center justify-between px-1 font-mono text-[9.5px] uppercase tracking-wider text-faint">
              <span className="flex items-center gap-1.5">
                <IconDatabase size={12} className="text-lagoon" />
                {(status?.customers ?? 0).toLocaleString()} rows
              </span>
              <span className={`flex items-center gap-1.5 ${status?.ok ? "text-mint" : "text-oxide"}`}>
                <span className={`h-1.5 w-1.5 rounded-full ${status?.ok ? "bg-mint blink" : "bg-oxide"}`} />
                {status?.ok ? "live" : "offline"}
              </span>
            </div>
          </div>
        </aside>

        {/* mobile drawer */}
        {drawer && (
          <div className="fixed inset-0 z-50 lg:hidden">
            <button className="absolute inset-0 bg-ink-950/80 backdrop-blur-sm" onClick={() => setDrawer(false)} aria-label="Close navigation" />
            <div className="slide-in absolute left-0 top-0 h-full w-[268px] overflow-y-auto border-r border-line-soft bg-ink-900 px-3 py-5">
              <div className="mb-5 flex items-center justify-between px-2">
                <span className="flex items-center gap-2 text-signal">
                  <LogoMark size={26} /> <span className="font-display text-[15px] font-bold tracking-[0.14em] text-ivory">CHURNIQ</span>
                </span>
                <button className="btn !px-2 !py-1" onClick={() => setDrawer(false)} aria-label="Close">
                  <IconClose size={14} />
                </button>
              </div>
              {navList}
            </div>
          </div>
        )}

        {/* main */}
        <div className="min-w-0 flex-1">
          <header className="sticky top-0 z-40 flex items-center gap-3 border-b border-line-soft bg-[rgba(7,12,18,0.82)] px-4 py-2.5 backdrop-blur-xl md:px-6">
            <button className="btn !px-2 !py-1.5 lg:hidden" onClick={() => setDrawer(true)} aria-label="Open navigation">
              <span className="flex flex-col gap-[3px]">
                <span className="block h-[1.5px] w-4 bg-current" />
                <span className="block h-[1.5px] w-4 bg-current" />
                <span className="block h-[1.5px] w-2.5 bg-current" />
              </span>
            </button>

            <div className="hidden items-center gap-2 md:flex">
              <span className="eyebrow">Nairobi</span>
              <span className="numeral text-[13px] font-semibold text-ivory-dim">
                {now.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false })}
              </span>
              <span className="eyebrow">EAT</span>
            </div>

            <div className="ml-auto flex items-center gap-2 md:gap-3">
              <div className="hidden items-center gap-2 rounded-[3px] border border-line-soft bg-[rgba(9,15,21,0.7)] px-2.5 py-1.5 sm:flex">
                <span className="eyebrow">book risk</span>
                <span className="numeral text-[13px] font-bold text-signal">{((status?.bookAvgRisk ?? 0) * 100).toFixed(1)}%</span>
                <span className="h-3 w-px bg-line" />
                <span className="eyebrow">events/10m</span>
                <span className="numeral text-[13px] font-semibold text-lagoon">{status?.eventsLast10m ?? 0}</span>
              </div>

              <div className="relative">
                <button
                  className={`btn relative !px-2.5 ${alertsOpen ? "!border-signal/60 !text-signal" : ""}`}
                  onClick={loadAlerts}
                  aria-label="Alerts"
                >
                  <IconAlert size={14} />
                  {(status?.openAlerts ?? 0) > 0 && (
                    <span
                      className={`absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full px-1 font-mono text-[9px] font-bold text-ink-950 ${
                        (status?.criticalAlerts ?? 0) > 0 ? "bg-oxide pulse-ring" : "bg-signal"
                      }`}
                    >
                      {status?.openAlerts}
                    </span>
                  )}
                </button>
                {alertsOpen && (
                  <div className="rise absolute right-0 top-[calc(100%+8px)] z-50 w-[340px] overflow-hidden rounded-[4px] border border-line bg-ink-900/98 shadow-2xl backdrop-blur-xl">
                    <div className="flex items-center justify-between border-b border-line-soft px-3 py-2">
                      <span className="eyebrow">Alert bus</span>
                      <button className="text-faint transition-colors hover:text-ivory" onClick={() => setAlertsOpen(false)} aria-label="Close alerts">
                        <IconClose size={13} />
                      </button>
                    </div>
                    <ul className="max-h-[340px] overflow-y-auto">
                      {alerts.length === 0 && <li className="px-3 py-6 text-center text-xs text-muted">No alerts recorded yet.</li>}
                      {alerts.map((a) => (
                        <li key={a.id} className="border-b border-line-soft px-3 py-2 last:border-0">
                          <div className="flex items-center gap-2">
                            <span
                              className="h-1.5 w-1.5 shrink-0 rounded-full"
                              style={{ background: a.severity === "critical" ? "#FF4D3D" : a.severity === "high" ? "#FF8A3D" : "#46B3A5" }}
                            />
                            <span className="truncate text-[12px] font-semibold text-ivory">{a.title}</span>
                          </div>
                          <p className="mt-1 line-clamp-2 text-[11px] leading-snug text-muted">{a.body}</p>
                          {a.customerId && (
                            <Link href={`/customers/${a.customerId}`} className="mt-1 inline-block font-mono text-[10px] text-signal link-underline">
                              open customer 360 →
                            </Link>
                          )}
                        </li>
                      ))}
                    </ul>
                    <Link href="/stream" className="block border-t border-line-soft px-3 py-2 text-center font-mono text-[10px] uppercase tracking-wider text-signal hover:bg-[rgba(242,169,59,0.07)]">
                      open real-time stream
                    </Link>
                  </div>
                )}
              </div>
            </div>
          </header>

          <main className="px-4 py-5 md:px-6 md:py-7">{children}</main>

          <footer className="mt-8 border-t border-line-soft px-4 py-5 text-[11px] text-faint md:px-6">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <span className="font-mono uppercase tracking-[0.14em]">
                ChurnIQ · Real-time customer churn & retention intelligence · synthetic Kenyan insurance book
              </span>
              <span className="flex items-center gap-1.5 font-mono uppercase tracking-[0.14em] text-mint">
                <IconCheck size={12} /> pipeline healthy
              </span>
            </div>
          </footer>
        </div>
      </div>

      {toast && (
        <div className="ticker-row fixed bottom-5 right-5 z-50 w-[330px] overflow-hidden rounded-[4px] border border-[#FF4D3D55] bg-[rgba(20,10,10,0.96)] shadow-2xl backdrop-blur-xl">
          <div className="flex items-start gap-2.5 px-3 py-2.5">
            <span className="mt-[3px] h-2 w-2 shrink-0 rounded-full bg-oxide pulse-ring" />
            <div className="min-w-0 flex-1">
              <div className="font-mono text-[9.5px] uppercase tracking-[0.16em] text-oxide">live risk alert</div>
              <div className="mt-0.5 truncate text-[13px] font-semibold text-ivory">{toast.title}</div>
              <p className="mt-1 line-clamp-3 text-[11.5px] leading-snug text-ivory-dim">{toast.body}</p>
              {toast.customerId && (
                <Link href={`/customers/${toast.customerId}`} className="mt-1.5 inline-block font-mono text-[10px] uppercase tracking-wider text-signal link-underline">
                  inspect →
                </Link>
              )}
            </div>
            <button className="text-faint transition-colors hover:text-ivory" onClick={() => setToast(null)} aria-label="Dismiss alert">
              <IconClose size={13} />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
