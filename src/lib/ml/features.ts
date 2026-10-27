import type { CustomerRow } from "@/lib/synthesize";

/**
 * Feature engineering for ChurnIQ.
 *
 * Mirrors `feature_engineering/` in the reference architecture: raw CRM,
 * transactional and usage columns are transformed into behavioural,
 * transactional and profile features, then one-hot encoded into a stable,
 * versioned vector consumed by both the offline trainer and the online scorer.
 *
 * NOTE: `status` is deliberately excluded — lapsed/cancelled states are a
 * direct consequence of the label and would leak the target.
 */

export type FeatureGroup =
  | "payments"
  | "engagement"
  | "support"
  | "loyalty"
  | "pricing"
  | "profile"
  | "contract";

export const GROUP_META: Record<FeatureGroup, { label: string; color: string; blurb: string }> = {
  payments: {
    label: "Payments & collections",
    color: "#FF5C46",
    blurb: "M-PESA debit failures, premium arrears, wallet activity",
  },
  engagement: {
    label: "Product engagement",
    color: "#F2A93B",
    blurb: "App/USSD sessions, dormancy, usage velocity",
  },
  support: {
    label: "Support & claims friction",
    color: "#E8734A",
    blurb: "Tickets, complaints, claim settlement experience",
  },
  loyalty: {
    label: "Tenure & loyalty",
    color: "#2BB673",
    blurb: "Policy tenure, cross-hold, CSAT/NPS, agent contact",
  },
  pricing: {
    label: "Pricing & value",
    color: "#57C7D4",
    blurb: "Premium level, uplift at renewal, discounts, lifetime value",
  },
  profile: {
    label: "Customer profile",
    color: "#9AA7B4",
    blurb: "Demographics and geography",
  },
  contract: {
    label: "Contract & distribution",
    color: "#C6A15B",
    blurb: "Billing cadence, plan tier, segment, acquisition channel",
  },
};

export const GROUP_ORDER: FeatureGroup[] = [
  "payments",
  "engagement",
  "support",
  "loyalty",
  "pricing",
  "contract",
  "profile",
];

type NumericSpec = {
  key: string;
  label: string;
  group: FeatureGroup;
  get: (c: CustomerRow) => number;
  format?: (v: number) => string;
};

const log1p = (v: number) => Math.log1p(Math.max(0, v));

const NUMERIC: NumericSpec[] = [
  // ---- payments ----
  { key: "payment_failures", label: "Failed premium debits", group: "payments", get: (c) => c.paymentFailures, format: (v) => `${v.toFixed(0)} failures` },
  { key: "late_payment_days", label: "Days in premium arrears", group: "payments", get: (c) => c.latePaymentDays, format: (v) => `${v.toFixed(0)} days` },
  {
    key: "payment_stress_index",
    label: "Payment stress index",
    group: "payments",
    get: (c) => c.paymentFailures * 0.6 + c.latePaymentDays / 30,
    format: (v) => v.toFixed(2),
  },
  { key: "mpesa_activity", label: "M-PESA wallet activity", group: "payments", get: (c) => c.mpesaActivity, format: (v) => `${v.toFixed(1)} txn/mo` },

  // ---- engagement ----
  { key: "usage_frequency", label: "Weekly product usage", group: "engagement", get: (c) => c.usageFrequency, format: (v) => `${v.toFixed(1)} sessions` },
  { key: "last_login_days", label: "Days since last login", group: "engagement", get: (c) => log1p(c.lastLoginDays), format: (v) => `${Math.round(Math.expm1(v))} days` },
  { key: "login_frequency", label: "Logins (90d)", group: "engagement", get: (c) => c.loginFrequency, format: (v) => `${v.toFixed(0)} logins` },
  {
    key: "engagement_velocity",
    label: "Engagement velocity",
    group: "engagement",
    get: (c) => (c.usageFrequency * 12) / (c.tenureMonths + 1),
    format: (v) => v.toFixed(2),
  },
  {
    key: "dormancy_ratio",
    label: "Dormancy ratio",
    group: "engagement",
    get: (c) => c.lastLoginDays / Math.max(1, c.tenureMonths * 3),
    format: (v) => v.toFixed(2),
  },

  // ---- support ----
  { key: "support_tickets", label: "Support tickets", group: "support", get: (c) => c.supportTickets, format: (v) => `${v.toFixed(0)} tickets` },
  { key: "complaints", label: "Complaints filed", group: "support", get: (c) => c.complaints, format: (v) => `${v.toFixed(0)} complaints` },
  { key: "claims_count", label: "Claims lodged", group: "support", get: (c) => c.claimsCount, format: (v) => `${v.toFixed(0)} claims` },
  { key: "claim_settlement_days", label: "Claim settlement time", group: "support", get: (c) => log1p(c.claimSettlementDays), format: (v) => `${Math.round(Math.expm1(v))} days` },
  {
    key: "friction_load",
    label: "Friction load per policy year",
    group: "support",
    get: (c) => (c.supportTickets + 2 * c.complaints) / (c.tenureMonths / 12 + 0.25),
    format: (v) => v.toFixed(2),
  },

  // ---- loyalty ----
  { key: "tenure_months", label: "Tenure", group: "loyalty", get: (c) => log1p(c.tenureMonths), format: (v) => `${Math.round(Math.expm1(v))} months` },
  { key: "policies_held", label: "Policies held", group: "loyalty", get: (c) => c.policiesHeld, format: (v) => `${v.toFixed(0)} policies` },
  { key: "agent_engagement", label: "Agent engagement score", group: "loyalty", get: (c) => c.agentEngagement, format: (v) => v.toFixed(1) },
  { key: "satisfaction_score", label: "CSAT", group: "loyalty", get: (c) => c.satisfactionScore, format: (v) => `${v.toFixed(1)} / 5` },
  { key: "nps_score", label: "NPS", group: "loyalty", get: (c) => c.npsScore, format: (v) => v.toFixed(0) },

  // ---- pricing ----
  { key: "premium_monthly", label: "Monthly premium", group: "pricing", get: (c) => log1p(c.premiumMonthly), format: (v) => `KES ${Math.round(Math.expm1(v)).toLocaleString()}` },
  { key: "lifetime_premium", label: "Lifetime premium", group: "pricing", get: (c) => log1p(c.lifetimePremium), format: (v) => `KES ${Math.round(Math.expm1(v)).toLocaleString()}` },
  { key: "premium_increase_pct", label: "Renewal premium uplift", group: "pricing", get: (c) => c.premiumIncreasePct, format: (v) => `${v.toFixed(1)}%` },
  { key: "discount_pct", label: "Discount received", group: "pricing", get: (c) => c.discountPct, format: (v) => `${v.toFixed(0)}%` },
  {
    key: "value_per_interaction",
    label: "Value per interaction",
    group: "pricing",
    get: (c) => log1p(c.lifetimePremium / (c.supportTickets + c.claimsCount + 1)),
    format: (v) => `KES ${Math.round(Math.expm1(v)).toLocaleString()}`,
  },

  // ---- profile ----
  { key: "age", label: "Age", group: "profile", get: (c) => c.age, format: (v) => `${v.toFixed(0)} yrs` },
  { key: "renewal_due_days", label: "Renewal window", group: "profile", get: (c) => c.renewalDueInDays, format: (v) => `${v.toFixed(0)} days` },
];

const CATEGORICAL: Array<{ field: keyof CustomerRow; group: FeatureGroup; levels: readonly string[] }> = [
  { field: "contractType", group: "contract", levels: ["Monthly", "Quarterly", "Annual"] },
  { field: "planTier", group: "contract", levels: ["Jamii", "Plus", "Premium", "Biashara"] },
  { field: "segment", group: "contract", levels: ["Consumer", "SME", "Enterprise", "Corporate"] },
  { field: "channel", group: "contract", levels: ["Field Agent", "Bancassurance", "Digital App / USSD", "Broker", "Telco Bundle"] },
  {
    field: "productLine",
    group: "contract",
    levels: [
      "Motor Cover",
      "Health Cover",
      "Life & Education",
      "Agri-Index Cover",
      "SME Biashara Pack",
      "Mobile Wallet Cover",
      "Domestic Travel",
    ],
  },
];

export type FeatureMeta = {
  key: string;
  label: string;
  group: FeatureGroup;
  kind: "numeric" | "categorical";
  format?: (v: number) => string;
};

export const FEATURE_META: FeatureMeta[] = [
  ...NUMERIC.map<FeatureMeta>((n) => ({ key: n.key, label: n.label, group: n.group, kind: "numeric", format: n.format })),
  ...CATEGORICAL.flatMap<FeatureMeta>((cat) =>
    cat.levels.slice(1).map((level) => ({
      key: `${String(cat.field)}_${level.toLowerCase().replace(/[^a-z0-9]+/g, "_")}`,
      label: `${cat.field === "contractType" ? "Billing" : cat.field === "planTier" ? "Plan" : cat.field === "segment" ? "Segment" : cat.field === "channel" ? "Channel" : "Product"}: ${level}`,
      group: cat.group,
      kind: "categorical",
    })),
  ),
];

export const FEATURE_COUNT = FEATURE_META.length;

export function vectorize(c: CustomerRow): number[] {
  const out = new Array<number>(FEATURE_COUNT);
  let i = 0;
  for (; i < NUMERIC.length; i += 1) out[i] = NUMERIC[i].get(c);
  for (const cat of CATEGORICAL) {
    const value = String(c[cat.field]);
    const idx = cat.levels.indexOf(value);
    for (let l = 1; l < cat.levels.length; l += 1) {
      out[i] = idx === l ? 1 : 0;
      i += 1;
    }
  }
  return out;
}

export function buildMatrix(rows: CustomerRow[]): number[][] {
  return rows.map(vectorize);
}

/** Raw (human-readable) value of every numeric feature for a customer. */
export function numericSnapshot(c: CustomerRow): Array<{ key: string; label: string; group: FeatureGroup; value: number; display: string }> {
  return NUMERIC.map((n) => {
    const v = n.get(c);
    return { key: n.key, label: n.label, group: n.group, value: v, display: n.format ? n.format(v) : v.toFixed(2) };
  });
}

/* ------------------------------------------------------------------ */
/* Histogram binning (LightGBM-style)                                  */
/* ------------------------------------------------------------------ */

export const MAX_BINS = 32;

/** Quantile bin edges per feature. `binIndex(x, edges)` -> [0, edges.length] */
export function buildBins(X: number[][]): number[][] {
  const n = X.length;
  const p = FEATURE_COUNT;
  const bins: number[][] = [];
  for (let f = 0; f < p; f += 1) {
    const col = new Float64Array(n);
    for (let i = 0; i < n; i += 1) col[i] = X[i][f];
    const sorted = Array.from(col).sort((a, b) => a - b);
    const uniq: number[] = [];
    for (let i = 0; i < sorted.length; i += 1) {
      if (i === 0 || sorted[i] !== sorted[i - 1]) uniq.push(sorted[i]);
    }
    if (uniq.length <= MAX_BINS) {
      // edges = midpoints between consecutive unique values
      const edges: number[] = [];
      for (let i = 1; i < uniq.length; i += 1) edges.push((uniq[i - 1] + uniq[i]) / 2);
      bins.push(edges);
      continue;
    }
    const edges: number[] = [];
    for (let b = 1; b < MAX_BINS; b += 1) {
      const q = sorted[Math.floor((b / MAX_BINS) * n)];
      if (edges.length === 0 || q > edges[edges.length - 1]) edges.push(q);
    }
    bins.push(edges);
  }
  return bins;
}

export function binIndex(value: number, edges: number[]): number {
  let lo = 0;
  let hi = edges.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (value <= edges[mid]) hi = mid;
    else lo = mid + 1;
  }
  return lo;
}

export function binMatrix(X: number[][], bins: number[][]): Uint8Array[] {
  return X.map((row) => {
    const b = new Uint8Array(FEATURE_COUNT);
    for (let f = 0; f < FEATURE_COUNT; f += 1) b[f] = binIndex(row[f], bins[f]);
    return b;
  });
}

export function binVector(x: number[], bins: number[][]): Uint8Array {
  const b = new Uint8Array(FEATURE_COUNT);
  for (let f = 0; f < FEATURE_COUNT; f += 1) b[f] = binIndex(x[f], bins[f]);
  return b;
}
