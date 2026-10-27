"use client";

import { useRouter } from "next/navigation";
import { useState, type ReactNode } from "react";
import { IconCheck, IconClose, IconCpu, IconRefresh, IconTrend } from "./icons";

export function RefreshButton({ label = "refresh" }: { label?: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  return (
    <button
      className="btn"
      onClick={() => {
        setBusy(true);
        router.refresh();
        setTimeout(() => setBusy(false), 650);
      }}
    >
      <IconRefresh size={13} className={busy ? "spin" : ""} />
      {label}
    </button>
  );
}

export function ModelActions({
  runs,
  productionId,
}: {
  runs: Array<{ id: string; algorithm: string; stage: string; prAuc: number; netValueKes: number }>;
  productionId: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const promote = async (runId: string) => {
    setBusy(runId);
    setMessage(null);
    try {
      const res = await fetch("/api/models", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "promote", runId }),
      });
      const data = (await res.json()) as { promoted?: { scored: number }; error?: string };
      setMessage(data.error ? `failed: ${data.error}` : `${runId} promoted · ${data.promoted?.scored ?? 0} customers re-scored`);
      router.refresh();
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "promotion failed");
    } finally {
      setBusy(null);
    }
  };

  const retrain = async () => {
    setBusy("retrain");
    setMessage(null);
    try {
      const res = await fetch("/api/models", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "retrain" }),
      });
      const data = (await res.json()) as { runs?: Array<{ algorithm: string; prAuc: number }>; promoted?: { runId: string }; error?: string };
      setMessage(
        data.error
          ? `failed: ${data.error}`
          : `retrained ${data.runs?.length ?? 0} models · champion ${data.promoted?.runId ?? "—"}`,
      );
      router.refresh();
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "retrain failed");
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="flex flex-col items-end gap-2">
      <div className="flex flex-wrap items-center gap-2">
        {runs
          .filter((r) => r.id !== productionId)
          .slice(0, 3)
          .map((r) => (
            <button key={r.id} className="btn" disabled={busy !== null} onClick={() => promote(r.id)} title={`Promote ${r.id}`}>
              <IconTrend size={13} />
              {busy === r.id ? "promoting…" : `promote ${r.algorithm.split(" ")[0]}`}
            </button>
          ))}
        <button className="btn btn-primary" disabled={busy !== null} onClick={retrain}>
          {busy === "retrain" ? <IconRefresh size={13} className="spin" /> : <IconCpu size={13} />}
          {busy === "retrain" ? "retraining suite…" : "retrain suite"}
        </button>
      </div>
      {message && <div className="font-mono text-[10.5px] text-mint">{message}</div>}
    </div>
  );
}

export function ResetPipeline() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const run = async () => {
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch("/api/monitoring", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "reset" }),
      });
      const data = (await res.json()) as { report?: { totalMs: number; customers: number }; error?: string };
      setMessage(data.error ? data.error : `re-ingested ${data.report?.customers ?? 0} customers in ${((data.report?.totalMs ?? 0) / 1000).toFixed(1)}s`);
      setConfirming(false);
      router.refresh();
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "reset failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex items-center gap-2">
      {message && <span className="font-mono text-[10.5px] text-mint">{message}</span>}
      {confirming ? (
        <>
          <span className="font-mono text-[10px] uppercase tracking-wider text-oxide">truncate &amp; rebuild?</span>
          <button className="btn btn-danger" disabled={busy} onClick={run}>
            {busy ? <IconRefresh size={13} className="spin" /> : <IconCheck size={13} />}
            {busy ? "rebuilding…" : "confirm"}
          </button>
          <button className="btn" disabled={busy} onClick={() => setConfirming(false)}>
            <IconClose size={13} />
            cancel
          </button>
        </>
      ) : (
        <button className="btn" onClick={() => setConfirming(true)}>
          <IconRefresh size={13} />
          re-ingest book
        </button>
      )}
    </div>
  );
}

export function AckButton({ id }: { id: number }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  return (
    <button
      className="btn !px-2 !py-1"
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        await fetch("/api/alerts", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ id }) });
        setBusy(false);
        router.refresh();
      }}
    >
      <IconCheck size={12} />
      ack
    </button>
  );
}

export function PlayActions({ actionId, status }: { actionId: number; status: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const next: Array<{ key: string; label: string; tone?: "ok" | "bad" }> =
    status === "saved" || status === "lost"
      ? [{ key: "queued", label: "reopen" }]
      : [
          { key: "contacted", label: "mark contacted" },
          { key: "saved", label: "saved", tone: "ok" },
          { key: "lost", label: "lost", tone: "bad" },
          { key: "snoozed", label: "snooze" },
        ];

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {next.map((n) => (
        <button
          key={n.key}
          className={`btn !px-2 !py-1 !text-[10px] ${n.tone === "ok" ? "!border-[#2BB67355] !text-mint hover:!border-mint" : n.tone === "bad" ? "!border-[#FF4D3D44] !text-oxide/80 hover:!border-oxide" : ""}`}
          disabled={busy !== null}
          onClick={async () => {
            setBusy(n.key);
            await fetch("/api/retention", {
              method: "PATCH",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ actionId, status: n.key }),
            });
            setBusy(null);
            router.refresh();
          }}
        >
          {busy === n.key ? <IconRefresh size={11} className="spin" /> : null}
          {n.label}
        </button>
      ))}
    </div>
  );
}

export function Tabs({
  tabs,
  active,
  onChange,
}: {
  tabs: Array<{ key: string; label: string; badge?: ReactNode }>;
  active: string;
  onChange: (key: string) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-1 border-b border-line-soft">
      {tabs.map((t) => {
        const on = t.key === active;
        return (
          <button
            key={t.key}
            onClick={() => onChange(t.key)}
            className={`relative flex items-center gap-2 px-3 py-2 font-mono text-[10.5px] uppercase tracking-[0.14em] transition-colors ${
              on ? "text-signal" : "text-faint hover:text-ivory-dim"
            }`}
          >
            {t.label}
            {t.badge}
            <span className={`absolute inset-x-0 -bottom-px h-[2px] bg-signal transition-transform duration-300 ${on ? "scale-x-100" : "scale-x-0"}`} />
          </button>
        );
      })}
    </div>
  );
}
