import type { CustomerRow } from "@/lib/synthesize";
import { FEATURE_META, buildMatrix, type FeatureGroup } from "./features";
import { groupDrivers, meanVector } from "./explain";
import {
  GradientBoosting,
  LogisticRegression,
  MODEL_CATALOG,
  RandomForest,
  restoreModel,
  type ChurnModel,
  type ModelKind,
  type SerializedModel,
} from "./models";
import { evaluateModel, prAuc, type BusinessInputs, type FullMetrics } from "./metrics";
import { mulberry32 } from "@/lib/synthesize";

export const BUSINESS_INPUTS: BusinessInputs = {
  avgAnnualPremium: 78_400,
  interventionCost: 1_450,
  saveRate: 0.31,
  recoverableShare: 0.82,
};

export const RISK_BANDS = [
  { level: "Critical", min: 0.75, color: "#FF4D3D", action: "Intervene within 24h" },
  { level: "High", min: 0.55, color: "#FF8A3D", action: "Intervene within 72h" },
  { level: "Elevated", min: 0.35, color: "#F2C14E", action: "Monitor + soft touch" },
  { level: "Moderate", min: 0.18, color: "#9AD1A8", action: "Lifecycle nurture" },
  { level: "Low", min: 0, color: "#2BB673", action: "No action required" },
] as const;

export type RiskLevel = (typeof RISK_BANDS)[number]["level"];

export function riskLevel(p: number): RiskLevel {
  for (const band of RISK_BANDS) if (p >= band.min) return band.level;
  return "Low";
}

export function riskColor(level: string): string {
  return RISK_BANDS.find((b) => b.level === level)?.color ?? "#9AA7B4";
}

export function riskAction(level: string): string {
  return RISK_BANDS.find((b) => b.level === level)?.action ?? "";
}

/* ------------------------------------------------------------------ */
/* Retention playbook                                                  */
/* ------------------------------------------------------------------ */

export const PLAYBOOK: Record<FeatureGroup, { play: string; rationale: string; owner: string; costKes: number; saveRate: number }> = {
  payments: {
    play: "Payment rescue — M-PESA auto-pay migration + 14-day grace",
    rationale: "Repeated debit failures are the dominant churn signal; remove the friction before the lapse notice.",
    owner: "Collections Squad",
    costKes: 900,
    saveRate: 0.34,
  },
  engagement: {
    play: "Re-activation — guided onboarding + USSD/WhatsApp usage nudges",
    rationale: "Dormancy and falling session volume precede non-renewal; rebuild the usage habit loop.",
    owner: "Lifecycle Marketing",
    costKes: 450,
    saveRate: 0.24,
  },
  support: {
    play: "Service recovery — executive care escalation + claims fast-track",
    rationale: "Open complaints and slow claim settlement drive advocacy collapse.",
    owner: "Customer Care Lead",
    costKes: 1_800,
    saveRate: 0.31,
  },
  loyalty: {
    play: "Loyalty lock-in — multi-policy bundle + named customer-success manager",
    rationale: "Thin tenure and low cross-hold leave no switching cost; manufacture one.",
    owner: "Retention Desk",
    costKes: 2_600,
    saveRate: 0.29,
  },
  pricing: {
    play: "Price defence — renewal premium freeze + loyalty discount review",
    rationale: "Above-inflation renewal uplift is pushing the customer to a competitor quote.",
    owner: "Pricing & Underwriting",
    costKes: 3_200,
    saveRate: 0.36,
  },
  contract: {
    play: "Contract restructure — move monthly billing to annual with 8% uplift discount",
    rationale: "Monthly cadence creates 12 churn decision points a year; annualise to cut exposure.",
    owner: "Sales Ops",
    costKes: 1_200,
    saveRate: 0.33,
  },
  profile: {
    play: "Renewal outreach — scheduled field-agent visit inside the renewal window",
    rationale: "No behavioural red flag; protect the relationship ahead of the renewal date.",
    owner: "Field Agent Network",
    costKes: 700,
    saveRate: 0.18,
  },
};

export function annualValue(c: Pick<CustomerRow, "premiumMonthly" | "policiesHeld">): number {
  return Math.round(c.premiumMonthly * 12 * Math.max(1, c.policiesHeld));
}

export type Play = {
  play: string;
  rationale: string;
  owner: string;
  priority: string;
  probability: number;
  annualValueKes: number;
  playCostKes: number;
  expectedSaveKes: number;
  roi: number;
};

export function recommendPlay(
  c: CustomerRow,
  probability: number,
  drivers: Array<{ group: FeatureGroup; impact: number }>,
  priority: string,
): Play {
  const top = drivers.filter((d) => d.impact > 0)[0] ?? drivers[0] ?? { group: "profile" as FeatureGroup, impact: 0 };
  const spec = PLAYBOOK[top.group] ?? PLAYBOOK.profile;
  const value = annualValue(c);
  const recovered = probability * value * spec.saveRate * BUSINESS_INPUTS.recoverableShare;
  const expectedSaveKes = Math.round(recovered - spec.costKes);
  return {
    play: spec.play,
    rationale: spec.rationale,
    owner: spec.owner,
    priority,
    probability,
    annualValueKes: value,
    playCostKes: spec.costKes,
    expectedSaveKes,
    roi: spec.costKes > 0 ? recovered / spec.costKes : 0,
  };
}

export function priorityBand(score: number, thresholds: { critical: number; high: number; medium: number }): string {
  if (score >= thresholds.critical) return "Critical";
  if (score >= thresholds.high) return "High";
  if (score >= thresholds.medium) return "Medium";
  return "Low";
}

/* ------------------------------------------------------------------ */
/* Training                                                            */
/* ------------------------------------------------------------------ */

export function hashDataset(rows: CustomerRow[]): string {
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  const str = `${rows.length}`;
  for (let i = 0; i < str.length; i += 1) {
    h1 = Math.imul(h1 ^ str.charCodeAt(i), 16777619) >>> 0;
  }
  for (const r of rows) {
    const s = `${r.id}${r.tenureMonths}${r.premiumMonthly}${r.paymentFailures}${r.churn}`;
    for (let i = 0; i < s.length; i += 1) {
      h2 = Math.imul(h2 ^ s.charCodeAt(i), 16777619) >>> 0;
      h1 = (Math.imul(h1, 31) + s.charCodeAt(i)) >>> 0;
    }
  }
  return `${(h1 >>> 0).toString(16).padStart(8, "0")}${(h2 >>> 0).toString(16).padStart(8, "0")}`;
}

function stratifiedSplit(rows: CustomerRow[], testShare: number, rng: () => number) {
  const pos = rows.filter((r) => r.churn === 1);
  const neg = rows.filter((r) => r.churn === 0);
  const shuffle = <T,>(arr: T[]) => {
    const a = [...arr];
    for (let i = a.length - 1; i > 0; i -= 1) {
      const j = Math.floor(rng() * (i + 1)) % (i + 1);
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  };
  const cut = <T,>(arr: T[]) => {
    const s = shuffle(arr);
    const k = Math.max(1, Math.round(s.length * testShare));
    return { test: s.slice(0, k), train: s.slice(k) };
  };
  const p = cut(pos);
  const n = cut(neg);
  return { train: [...p.train, ...n.train], test: [...p.test, ...n.test] };
}

export function permutationImportance(
  model: ChurnModel,
  X: number[][],
  y: number[],
  rng: () => number,
  sample = 700,
): Array<{ feature: string; group: string; importance: number }> {
  const idx = X.length > sample ? X.map((_, i) => i).sort(() => rng() - 0.5).slice(0, sample) : X.map((_, i) => i);
  const Xs = idx.map((i) => X[i]);
  const ys = idx.map((i) => y[i]);
  const base = prAuc(ys, model.predictBatch(Xs));
  const out: Array<{ feature: string; group: string; importance: number }> = [];

  for (let f = 0; f < FEATURE_META.length; f += 1) {
    const original = Xs.map((row) => row[f]);
    const perm = [...original].sort(() => rng() - 0.5);
    Xs.forEach((row, i) => {
      row[f] = perm[i];
    });
    const score = prAuc(ys, model.predictBatch(Xs));
    Xs.forEach((row, i) => {
      row[f] = original[i];
    });
    out.push({
      feature: FEATURE_META[f].label,
      group: FEATURE_META[f].group,
      importance: Math.max(0, base - score),
    });
  }
  const max = Math.max(...out.map((o) => o.importance), 1e-9);
  return out.map((o) => ({ ...o, importance: o.importance / max })).sort((a, b) => b.importance - a.importance);
}

export type TrainedRun = {
  id: string;
  algorithm: string;
  version: string;
  kind: ModelKind;
  artifact: SerializedModel;
  metrics: FullMetrics;
  params: Record<string, unknown>;
  featureImportance: Array<{ feature: string; group: string; importance: number }>;
  trainRows: number;
  testRows: number;
  trainingMs: number;
};

export type SuiteResult = {
  runs: TrainedRun[];
  productionRunId: string;
  datasetHash: string;
  trainRows: number;
  testRows: number;
  featureCount: number;
  churnRate: number;
  selection: { runId: string; score: number; reason: string }[];
};

export function trainSuite(rows: CustomerRow[], seed = 7): SuiteResult {
  const rng = mulberry32(seed);
  const { train, test } = stratifiedSplit(rows, 0.22, rng);
  const Xtrain = buildMatrix(train);
  const ytrain = train.map((r) => r.churn);
  const Xtest = buildMatrix(test);
  const ytest = test.map((r) => r.churn);
  const datasetHash = hashDataset(rows);
  const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, "");

  const runs: TrainedRun[] = [];
  for (const spec of MODEL_CATALOG) {
    const started = Date.now();
    let model: ChurnModel;
    if (spec.kind === "logistic_regression") {
      model = LogisticRegression.fit(Xtrain, ytrain, { l2: 0.012, lr: 0.35, iterations: 420 });
    } else if (spec.kind === "random_forest") {
      model = RandomForest.fit(Xtrain, ytrain, { trees: 45, depth: 9, minDataInLeaf: 12, featureFraction: 0.38 }, rng);
    } else {
      model = GradientBoosting.fit(
        Xtrain,
        ytrain,
        { trees: 90, depth: 4, learningRate: 0.09, lambda: 1.2, featureFraction: 0.85, subsample: 0.9 },
        rng,
      );
    }
    const trainingMs = Date.now() - started;
    const pTest = model.predictBatch(Xtest);
    const metrics = evaluateModel(ytest, pTest, BUSINESS_INPUTS);
    const importance = permutationImportance(model, Xtest, ytest, rng);
    runs.push({
      id: `${spec.kind}-${stamp}-${datasetHash.slice(0, 6)}`,
      algorithm: spec.name,
      version: `v1.${runs.length + 1}.${stamp}`,
      kind: spec.kind,
      artifact: model.serialize(),
      metrics,
      params: { ...spec.defaultParams, trainRows: train.length, testRows: test.length },
      featureImportance: importance.slice(0, 18),
      trainRows: train.length,
      testRows: test.length,
      trainingMs,
    });
  }

  // Composite selection: ranking quality first, business value as tie-breaker.
  const bestBusiness = Math.max(...runs.map((r) => r.metrics.business.netValueKes), 1);
  const selection = runs.map((r) => {
    const score = 0.42 * r.metrics.prAuc + 0.28 * r.metrics.rocAuc + 0.3 * Math.max(0, r.metrics.business.netValueKes / bestBusiness);
    return { runId: r.id, score, reason: `PR-AUC ${r.metrics.prAuc.toFixed(3)} · ROC-AUC ${r.metrics.rocAuc.toFixed(3)} · net value KES ${(r.metrics.business.netValueKes / 1000).toFixed(0)}k` };
  });
  const winner = runs
    .map((r) => selection.find((s) => s.runId === r.id)!)
    .sort((a, b) => b.score - a.score)[0];

  return {
    runs,
    productionRunId: winner.runId,
    datasetHash,
    trainRows: train.length,
    testRows: test.length,
    featureCount: FEATURE_META.length,
    churnRate: rows.reduce((s, r) => s + r.churn, 0) / rows.length,
    selection,
  };
}

/* ------------------------------------------------------------------ */
/* Serving helpers                                                     */
/* ------------------------------------------------------------------ */

export function loadModel(artifact: SerializedModel): ChurnModel {
  return restoreModel(artifact);
}

export type ScoredRow = {
  probability: number;
  riskLevel: RiskLevel;
  revenueAtRisk: number;
  priorityScore: number;
  drivers: Array<{ label: string; group: string; impact: number; raw: number }>;
};

/** Batch scorer used by the offline pipeline and the streaming micro-batch. */
export function scoreRows(
  rows: CustomerRow[],
  model: ChurnModel,
  background: number[][],
  opts: { driversFor?: number } = {},
): Map<string, ScoredRow> {
  const driversFor = opts.driversFor ?? 900;
  const X = buildMatrix(rows);
  const baselineMean = meanVector(background.length ? background : X.slice(0, Math.min(40, X.length)));
  const bg = background.length ? background.slice(0, 4) : X.slice(0, 4);
  const probs = model.predictBatch(X);

  const ranked = rows.map((r, i) => ({ r, i, p: probs[i] })).sort((a, b) => b.p - a.p);
  const explainSet = new Set(ranked.slice(0, driversFor).map((x) => x.i));

  const out = new Map<string, ScoredRow>();
  rows.forEach((row, i) => {
    const p = probs[i];
    const level = riskLevel(p);
    const value = annualValue(row);
    const drivers = explainSet.has(i)
      ? groupDrivers(model, X[i], bg, baselineMean)
          .filter((d) => Math.abs(d.impact) > 1e-5)
          .map((d) => ({ label: d.label, group: d.group, impact: d.impact, raw: 0 }))
      : [];
    out.set(row.id, {
      probability: p,
      riskLevel: level,
      revenueAtRisk: Math.round(p * value * BUSINESS_INPUTS.recoverableShare),
      priorityScore: p * value,
      drivers,
    });
  });
  return out;
}

export function priorityThresholds(scores: number[]) {
  const sorted = [...scores].sort((a, b) => b - a);
  const q = (frac: number) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * frac))] ?? 0;
  return { critical: q(0.08), high: q(0.22), medium: q(0.45) };
}
