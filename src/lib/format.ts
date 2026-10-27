export function formatKes(v: number, opts: { compact?: boolean } = {}): string {
  const compact = opts.compact ?? true;
  const abs = Math.abs(v);
  if (compact) {
    if (abs >= 1_000_000_000) return `KES ${(v / 1_000_000_000).toFixed(2)}B`;
    if (abs >= 1_000_000) return `KES ${(v / 1_000_000).toFixed(2)}M`;
    if (abs >= 10_000) return `KES ${(v / 1_000).toFixed(1)}K`;
    return `KES ${Math.round(v).toLocaleString()}`;
  }
  return `KES ${Math.round(v).toLocaleString()}`;
}

export function formatKesShort(v: number): string {
  const abs = Math.abs(v);
  if (abs >= 1_000_000_000) return `${(v / 1_000_000_000).toFixed(2)}B`;
  if (abs >= 1_000_000) return `${(v / 1_000_000).toFixed(2)}M`;
  if (abs >= 1_000) return `${(v / 1_000).toFixed(0)}K`;
  return `${Math.round(v)}`;
}

export function formatPct(v: number, digits = 1): string {
  return `${(v * 100).toFixed(digits)}%`;
}

export function formatNum(v: number): string {
  return Math.round(v).toLocaleString();
}

export function formatDate(d: Date | string): string {
  const date = typeof d === "string" ? new Date(d) : d;
  return date.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}

export function formatDateTime(d: Date | string): string {
  const date = typeof d === "string" ? new Date(d) : d;
  return date.toLocaleString("en-GB", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
}

export function timeAgo(d: Date | string, now = Date.now()): string {
  const date = typeof d === "string" ? new Date(d) : d;
  const secs = Math.max(1, Math.round((now - date.getTime()) / 1000));
  if (secs < 60) return `${secs}s ago`;
  const mins = Math.round(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.round(hrs / 24);
  if (days < 31) return `${days}d ago`;
  const months = Math.round(days / 30.44);
  if (months < 12) return `${months}mo ago`;
  return `${(months / 12).toFixed(1)}y ago`;
}

export function initials(name: string): string {
  return name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? "")
    .join("");
}

export const EVENT_STYLE: Record<string, { tone: "critical" | "warn" | "info" | "ok"; label: string }> = {
  mpesa_debit_failed: { tone: "critical", label: "M-PESA debit failed" },
  complaint_filed: { tone: "critical", label: "Complaint filed" },
  policy_cancelled: { tone: "critical", label: "Policy cancelled" },
  policy_lapsed: { tone: "critical", label: "Policy lapsed" },
  renewal_notice_ignored: { tone: "warn", label: "Renewal notice ignored" },
  ticket_opened: { tone: "warn", label: "Support ticket" },
  claim_submitted: { tone: "warn", label: "Claim submitted" },
  session_dropped: { tone: "warn", label: "Usage drop-off" },
  premium_increase_notice: { tone: "warn", label: "Premium uplift notice" },
  premium_paid: { tone: "ok", label: "Premium paid" },
  app_session: { tone: "info", label: "App / USSD session" },
  policy_viewed: { tone: "info", label: "Policy viewed" },
  agent_call_completed: { tone: "ok", label: "Agent call completed" },
  retention_play_dispatched: { tone: "ok", label: "Retention play dispatched" },
  score_recomputed: { tone: "info", label: "Risk score recomputed" },
};

export function eventLabel(t: string): string {
  return EVENT_STYLE[t]?.label ?? t.replace(/_/g, " ");
}
