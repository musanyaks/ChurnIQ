import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  alerts,
  customerEvents,
  customers,
  featureStore,
  modelRuns,
  pipelineMetrics,
  predictions,
  retentionActions,
} from "@/db/schema";
import { generateDataset, mulberry32, type CustomerRow } from "@/lib/synthesize";
import { FEATURE_META, GROUP_META, GROUP_ORDER, buildMatrix, vectorize, type FeatureGroup } from "@/lib/ml/features";
import { groupDrivers, meanVector } from "@/lib/ml/explain";
import { restoreModel, type ChurnModel } from "@/lib/ml/models";
import {
  BUSINESS_INPUTS,
  annualValue,
  priorityBand,
  priorityThresholds,
  recommendPlay,
  riskAction,
  riskLevel,
  scoreRows,
  trainSuite,
} from "@/lib/ml/pipeline";
import { psiVerdict } from "@/lib/ml/metrics";

export const CUSTOMER_COUNT = 2_400;
export type DbCustomer = typeof customers.$inferSelect;
export type DbPrediction = typeof predictions.$inferSelect;
export type DbRun = typeof modelRuns.$inferSelect;

type GlobalCache = {
  production?: { runId: string; model: ChurnModel; run: DbRun };
  background?: number[][];
  baselineMean?: number[];
  bootstrapping?: Promise<BootReport> | null;
};
const g = globalThis as typeof globalThis & { __ciq?: GlobalCache };
const cache = (): GlobalCache => (g.__ciq ??= {});

export function clearModelCache() {
  cache().production = undefined;
  cache().background = undefined;
  cache().baselineMean = undefined;
}

async function insertChunks<T>(table: Parameters<typeof db.insert>[0], rows: T[], size = 400) {
  for (let i = 0; i < rows.length; i += size) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await db.insert(table as any).values(rows.slice(i, i + size) as any);
  }
}

export async function recordMetric(stage: string, metric: string, label: string, value: number) {
  await db.insert(pipelineMetrics).values({ stage, metric, label, value, recordedAt: new Date() });
}

/* ------------------------------------------------------------------ */
/* Bootstrap state                                                     */
/* ------------------------------------------------------------------ */

export async function platformState() {
  const [c] = await db
    .select({
      customers: sql<number>`(select count(*)::int from ${customers})`,
      runs: sql<number>`(select count(*)::int from ${modelRuns})`,
      events: sql<number>`(select count(*)::int from ${customerEvents})`,
      predictions: sql<number>`(select count(*)::int from ${predictions})`,
    })
    .from(customers)
    .limit(1);
  return {
    bootstrapped: (c?.customers ?? 0) > 0 && (c?.runs ?? 0) > 0,
    customers: c?.customers ?? 0,
    runs: c?.runs ?? 0,
    events: c?.events ?? 0,
    predictions: c?.predictions ?? 0,
  };
}

export type Stage = { stage: string; detail: string; ms: number };
export type BootReport = {
  stages: Stage[];
  totalMs: number;
  customers: number;
  events: number;
  features: number;
  productionRunId: string;
  productionAlgorithm: string;
  churnRate: number;
  highRisk: number;
  revenueAtRisk: number;
  models: Array<{ algorithm: string; prAuc: number; rocAuc: number; f1: number; trainingMs: number }>;
};

export async function bootstrap(force = false): Promise<BootReport> {
  const c = cache();
  if (!force && c.bootstrapping) return c.bootstrapping;
  const promise = runBootstrap(force).finally(() => {
    cache().bootstrapping = null;
  });
  c.bootstrapping = promise;
  return promise;
}

async function runBootstrap(force: boolean): Promise<BootReport> {
  const stages: Stage[] = [];
  const started = Date.now();
  const mark = (stage: string, detail: string) => stages.push({ stage, detail, ms: Date.now() - started });

  if (!force) {
    const state = await platformState();
    if (state.bootstrapped) {
      mark("verify", `existing book of ${state.customers.toLocaleString()} policyholders re-used`);
      const run = await getProduction();
      const [agg] = await db
        .select({
          highRisk: sql<number>`count(*) filter (where ${predictions.probability} >= 0.55)::int`,
          revenueAtRisk: sql<number>`coalesce(sum(${predictions.revenueAtRisk}),0)::float`,
        })
        .from(predictions)
        .where(eq(predictions.runId, run.run.id));
      return {
        stages,
        totalMs: Date.now() - started,
        customers: state.customers,
        events: state.events,
        features: FEATURE_META.length,
        productionRunId: run.run.id,
        productionAlgorithm: run.run.algorithm,
        churnRate: 0,
        highRisk: agg?.highRisk ?? 0,
        revenueAtRisk: agg?.revenueAtRisk ?? 0,
        models: [],
      };
    }
  }

  if (force) {
    await db.execute(
      sql`truncate table ${customers}, ${customerEvents}, ${featureStore}, ${modelRuns}, ${predictions}, ${retentionActions}, ${alerts}, ${pipelineMetrics} restart identity cascade`,
    );
    clearModelCache();
  }

  /* 1 — ingestion: CRM + transactions + usage extracts */
  const dataset = generateDataset(CUSTOMER_COUNT, 20260214);
  mark("ingest", `${dataset.customers.length.toLocaleString()} policyholder records + ${dataset.events.length.toLocaleString()} Kafka events across 5 topics`);

  /* 2 — load into the warehouse */
  await insertChunks(customers, dataset.customers, 400);
  await insertChunks(customerEvents, dataset.events, 1_500);
  mark("load", `bulk-loaded into PostgreSQL (${dataset.events.length.toLocaleString()} stream rows, 6 partitions)`);

  /* 3 — feature store materialisation */
  const X = buildMatrix(dataset.customers);
  const baseline = featureBaseline(X);
  const bgIdx = stratifiedBackground(dataset.customers, 60);
  const bg = bgIdx.map((i) => X[i]);
  const fsRows = dataset.customers.map((row, i) => ({
    customerId: row.id,
    version: 1,
    vector: X[i],
    groupTotals: groupTotalsOf(row),
    computedAt: new Date(),
  }));
  await insertChunks(featureStore, fsRows, 400);
  mark("feature_store", `${FEATURE_META.length} features x ${dataset.customers.length.toLocaleString()} entities, 7 driver groups, p10/p50/p90 baseline captured`);

  /* 4 — train the suite */
  const suite = trainSuite(dataset.customers, 7);
  mark(
    "train",
    `${suite.runs.length} models trained on ${suite.trainRows.toLocaleString()} rows / held-out ${suite.testRows.toLocaleString()} rows`,
  );

  /* 5 — registry */
  const stamp = new Date();
  await insertChunks(
    modelRuns,
    suite.runs.map((r) => ({
      id: r.id,
      algorithm: r.algorithm,
      version: r.version,
      status: r.id === suite.productionRunId ? "active" : "candidate",
      stage: r.id === suite.productionRunId ? "production" : "staging",
      metrics: { ...(r.metrics as unknown as Record<string, unknown>), baseline },
      params: r.params,
      featureImportance: r.featureImportance,
      artifact: r.artifact as unknown as Record<string, unknown>,
      trainRows: r.trainRows,
      testRows: r.testRows,
      trainingMs: r.trainingMs,
      datasetHash: suite.datasetHash,
      createdAt: stamp,
      promotedAt: r.id === suite.productionRunId ? stamp : null,
    })),
    10,
  );
  mark("register", `registered ${suite.runs.length} runs · promoted ${suite.productionRunId} to production`);

  /* 6 — batch scoring + decisioning */
  const model = restoreModel(suite.runs.find((r) => r.id === suite.productionRunId)!.artifact);
  cache().production = {
    runId: suite.productionRunId,
    model,
    run: (await db.select().from(modelRuns).where(eq(modelRuns.id, suite.productionRunId)).limit(1))[0],
  };
  cache().background = bg;
  cache().baselineMean = meanVector(bg);

  const scored = scoreRows(dataset.customers, model, bg, { driversFor: 1_100 });
  const thresholds = priorityThresholds(Array.from(scored.values(), (s) => s.priorityScore));
  const now = new Date();

  const predRows = dataset.customers.map((row) => {
    const s = scored.get(row.id)!;
    return {
      customerId: row.id,
      runId: suite.productionRunId,
      probability: Number(s.probability.toFixed(5)),
      riskLevel: s.riskLevel,
      revenueAtRisk: s.revenueAtRisk,
      priorityScore: Math.round(s.priorityScore),
      drivers: s.drivers.slice(0, 4),
      latencyMs: 2,
      scoredAt: now,
    };
  });
  await insertChunks(predictions, predRows, 500);

  const actionRows = dataset.customers
    .filter((row) => (scored.get(row.id)?.probability ?? 0) >= 0.3)
    .map((row) => {
      const s = scored.get(row.id)!;
      const band = priorityBand(s.priorityScore, thresholds);
      const play = recommendPlay(row, s.probability, s.drivers as Array<{ group: FeatureGroup; impact: number }>, band);
      return {
        customerId: row.id,
        runId: suite.productionRunId,
        play: play.play,
        rationale: play.rationale,
        owner: play.owner,
        priority: band,
        status: band === "Critical" ? "queued" : "backlog",
        probability: Number(s.probability.toFixed(5)),
        annualValue: play.annualValueKes,
        playCostKes: play.playCostKes,
        expectedSaveKes: play.expectedSaveKes,
        roi: Number(play.roi.toFixed(2)),
        createdAt: now,
        updatedAt: now,
      };
    });
  await insertChunks(retentionActions, actionRows, 500);
  mark("score", `scored ${predRows.length.toLocaleString()} customers · ${actionRows.length.toLocaleString()} retention plays queued`);

  /* 7 — alerts */
  const critical = [...predRows].sort((a, b) => b.probability - a.probability).slice(0, 6);
  type AlertSeed = {
    severity: string;
    source: string;
    title: string;
    body: string;
    customerId: string | null;
    acknowledged: boolean;
    createdAt: Date;
  };
  const alertRows: AlertSeed[] = critical.map((p) => {
    const row = dataset.customers.find((c) => c.id === p.customerId)!;
    return {
      severity: p.riskLevel === "Critical" ? "critical" : "high",
      source: "batch_scoring",
      title: `${p.riskLevel} risk · ${row.id}`,
      body: `${row.fullName} (${row.segment}, ${row.productLine}) scored ${(p.probability * 100).toFixed(1)}% non-renewal risk. ${riskAction(p.riskLevel)}.`,
      customerId: row.id,
      acknowledged: false,
      createdAt: now,
    };
  });
  alertRows.push({
    severity: "info",
    source: "registry",
    title: `Production model promoted · ${suite.productionRunId}`,
    body: `Selected on PR-AUC / ROC-AUC / net business value. Challengers remain in staging for shadow scoring.`,
    customerId: null,
    acknowledged: false,
    createdAt: now,
  });
  await insertChunks(alerts, alertRows, 50);

  /* 8 — telemetry backfill so dashboards open with history */
  const rng = mulberry32(99);
  const telemetry: Array<{ stage: string; metric: string; label: string; value: number; recordedAt: Date }> = [];
  const avgProb = predRows.reduce((s, p) => s + p.probability, 0) / predRows.length;
  for (let i = 47; i >= 0; i -= 1) {
    const at = new Date(Date.now() - i * 30 * 60_000);
    const drift = Math.sin(i / 5) * 0.006 + (rng() - 0.5) * 0.008;
    telemetry.push({ stage: "scoring", metric: "avg_risk", label: "book", value: Math.max(0.01, avgProb + drift), recordedAt: at });
    telemetry.push({ stage: "scoring", metric: "latency_ms", label: "p95", value: 8 + rng() * 14, recordedAt: at });
    telemetry.push({ stage: "ingest", metric: "throughput_eps", label: "kafka", value: 180 + rng() * 260, recordedAt: at });
    telemetry.push({ stage: "ingest", metric: "consumer_lag", label: "spark", value: 20 + rng() * 260, recordedAt: at });
  }
  await insertChunks(pipelineMetrics, telemetry, 500);
  mark("telemetry", "24h of Prometheus-style samples backfilled (risk, latency, throughput, consumer lag)");

  return {
    stages,
    totalMs: Date.now() - started,
    customers: dataset.customers.length,
    events: dataset.events.length,
    features: FEATURE_META.length,
    productionRunId: suite.productionRunId,
    productionAlgorithm: suite.runs.find((r) => r.id === suite.productionRunId)!.algorithm,
    churnRate: suite.churnRate,
    highRisk: predRows.filter((p) => p.probability >= 0.55).length,
    revenueAtRisk: predRows.reduce((s, p) => s + p.revenueAtRisk, 0),
    models: suite.runs.map((r) => ({
      algorithm: r.algorithm,
      prAuc: r.metrics.prAuc,
      rocAuc: r.metrics.rocAuc,
      f1: r.metrics.f1,
      trainingMs: r.trainingMs,
    })),
  };
}

/* ------------------------------------------------------------------ */
/* Baseline / background helpers                                       */
/* ------------------------------------------------------------------ */

function bucketOf(v: number, edges: number[]): number {
  let i = 0;
  while (i < edges.length && v > edges[i]) i += 1;
  return i;
}

/**
 * Training-time reference distribution per feature: decile edges (deduplicated,
 * so discrete and one-hot columns stay valid) plus the exact proportion of the
 * training population that fell in each bucket. Drift is then measured against
 * real expected proportions instead of an assumed 10% per bin.
 */
export function featureBaseline(X: number[][]) {
  return FEATURE_META.map((f, i) => {
    const col = X.map((row) => row[i]).sort((a, b) => a - b);
    const n = Math.max(1, col.length);
    const q = (frac: number) => col[Math.min(col.length - 1, Math.floor(frac * col.length))] ?? 0;
    const mean = col.reduce((s, v) => s + v, 0) / n;
    const sd = Math.sqrt(col.reduce((s, v) => s + (v - mean) ** 2, 0) / n);
    const deciles = [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9].map(q);
    const edges = Array.from(new Set(deciles));
    const counts = new Array<number>(edges.length + 1).fill(0);
    for (const v of col) counts[bucketOf(v, edges)] += 1;
    const raw = counts.map((c) => Math.max(c / n, 1e-4));
    const sum = raw.reduce((a, b) => a + b, 0);
    return {
      key: f.key,
      label: f.label,
      group: f.group,
      mean,
      sd,
      deciles,
      edges,
      expected: raw.map((r) => r / sum),
    };
  });
}

export type BaselineFeature = ReturnType<typeof featureBaseline>[number];

function groupTotalsOf(row: CustomerRow): Record<string, number> {
  const totals: Record<string, number> = {};
  for (const g of GROUP_ORDER) totals[g] = 0;
  FEATURE_META.forEach((f) => {
    if (f.kind !== "numeric") return;
    // reuse the vectorizer for consistency
    void row;
  });
  const v = vectorize(row);
  FEATURE_META.forEach((f, i) => {
    totals[f.group] += Math.abs(v[i]);
  });
  return totals;
}

function stratifiedBackground(rows: CustomerRow[], n: number): number[] {
  const pos = rows.map((r, i) => ({ i, c: r.churn })).filter((x) => x.c === 1).map((x) => x.i);
  const neg = rows.map((r, i) => ({ i, c: r.churn })).filter((x) => x.c === 0).map((x) => x.i);
  const rng = mulberry32(4242);
  const take = (arr: number[], k: number) => {
    const copy = [...arr];
    for (let i = copy.length - 1; i > 0; i -= 1) {
      const j = Math.floor(rng() * (i + 1)) % (i + 1);
      [copy[i], copy[j]] = [copy[j], copy[i]];
    }
    return copy.slice(0, k);
  };
  return [...take(pos, Math.round(n * 0.45)), ...take(neg, n - Math.round(n * 0.45))];
}

/* ------------------------------------------------------------------ */
/* Registry access                                                     */
/* ------------------------------------------------------------------ */

export async function getProduction(): Promise<{ run: DbRun; model: ChurnModel }> {
  const c = cache();
  if (c.production) return { run: c.production.run, model: c.production.model };
  const rows = await db.select().from(modelRuns).where(eq(modelRuns.stage, "production")).orderBy(desc(modelRuns.promotedAt)).limit(1);
  const run = rows[0] ?? (await db.select().from(modelRuns).orderBy(desc(modelRuns.createdAt)).limit(1))[0];
  if (!run) throw new Error("NO_PRODUCTION_MODEL");
  const model = restoreModel(run.artifact as unknown as Parameters<typeof restoreModel>[0]);
  c.production = { runId: run.id, run, model };
  return { run, model };
}

export async function getBackground(): Promise<{ bg: number[][]; mean: number[] }> {
  const c = cache();
  if (c.background && c.baselineMean) return { bg: c.background, mean: c.baselineMean };
  const rows = await db
    .select({ vector: featureStore.vector, churn: customers.churn })
    .from(featureStore)
    .innerJoin(customers, eq(customers.id, featureStore.customerId))
    .limit(400);
  const pos = rows.filter((r) => r.churn === 1).slice(0, 26).map((r) => r.vector);
  const neg = rows.filter((r) => r.churn === 0).slice(0, 34).map((r) => r.vector);
  const bg = [...pos, ...neg];
  c.background = bg;
  c.baselineMean = meanVector(bg);
  return { bg, mean: c.baselineMean };
}

export async function promoteRun(runId: string) {
  const all = await db.select({ id: modelRuns.id }).from(modelRuns);
  for (const r of all) {
    await db
      .update(modelRuns)
      .set({
        stage: r.id === runId ? "production" : "staging",
        status: r.id === runId ? "active" : "candidate",
        promotedAt: r.id === runId ? new Date() : null,
      })
      .where(eq(modelRuns.id, r.id));
  }
  clearModelCache();
  const { run, model } = await getProduction();
  const rows = await db.select().from(customers);
  const { bg } = await getBackground();
  const scored = scoreRows(rows, model, bg, { driversFor: 1_100 });
  const thresholds = priorityThresholds(Array.from(scored.values(), (s) => s.priorityScore));
  const now = new Date();

  await insertChunks(
    predictions,
    rows.map((row) => {
      const s = scored.get(row.id)!;
      return {
        customerId: row.id,
        runId: run.id,
        probability: Number(s.probability.toFixed(5)),
        riskLevel: s.riskLevel,
        revenueAtRisk: s.revenueAtRisk,
        priorityScore: Math.round(s.priorityScore),
        drivers: s.drivers.slice(0, 4),
        latencyMs: 2,
        scoredAt: now,
      };
    }),
    500,
  );

  const actionRows = rows
    .filter((row) => (scored.get(row.id)?.probability ?? 0) >= 0.3)
    .map((row) => {
      const s = scored.get(row.id)!;
      const band = priorityBand(s.priorityScore, thresholds);
      const play = recommendPlay(row, s.probability, s.drivers as Array<{ group: FeatureGroup; impact: number }>, band);
      return {
        customerId: row.id,
        runId: run.id,
        play: play.play,
        rationale: play.rationale,
        owner: play.owner,
        priority: band,
        status: band === "Critical" ? "queued" : "backlog",
        probability: Number(s.probability.toFixed(5)),
        annualValue: play.annualValueKes,
        playCostKes: play.playCostKes,
        expectedSaveKes: play.expectedSaveKes,
        roi: Number(play.roi.toFixed(2)),
        createdAt: now,
        updatedAt: now,
      };
    });
  await db.delete(retentionActions);
  await insertChunks(retentionActions, actionRows, 500);
  await db.insert(alerts).values({
    severity: "info",
    source: "registry",
    title: `Model promoted · ${run.algorithm}`,
    body: `${run.id} is now serving all ${rows.length.toLocaleString()} customers. Previous production run moved to staging.`,
    acknowledged: false,
    createdAt: now,
  });
  await recordMetric("registry", "promotion", run.id, 1);
  return { runId: run.id, algorithm: run.algorithm, scored: rows.length };
}

/* ------------------------------------------------------------------ */
/* Drift & monitoring                                                  */
/* ------------------------------------------------------------------ */

export async function driftReport(sampleSize = 900) {
  const { run } = await getProduction();
  const metrics = run.metrics as unknown as { baseline?: BaselineFeature[] };
  const baseline = metrics.baseline ?? [];
  const rows = await db
    .select({ vector: featureStore.vector, computedAt: featureStore.computedAt })
    .from(featureStore)
    .limit(sampleSize);
  const X = rows.map((r) => r.vector);
  if (!baseline.length || !X.length) return { features: [], groups: [], scoreDrift: 0 };

  const features = baseline.map((b, i) => {
    const actual = X.map((row) => row[i] ?? 0);
    const edges = b.edges?.length ? b.edges : Array.from(new Set(b.deciles));
    const expected = b.expected?.length ? b.expected : new Array(edges.length + 1).fill(1 / (edges.length + 1));
    const value = psiFromHistogram(edges, expected, actual);
    const verdict = psiVerdict(value);
    return {
      key: b.key,
      label: b.label,
      group: b.group as FeatureGroup,
      psi: value,
      tone: verdict.tone,
      verdict: verdict.label,
      meanNow: actual.reduce((s, v) => s + v, 0) / Math.max(1, actual.length),
      meanTrain: b.mean,
      sdTrain: b.sd,
    };
  });

  const groups = GROUP_ORDER.map((grp) => {
    const inGroup = features.filter((f) => f.group === grp);
    const avg = inGroup.reduce((s, f) => s + f.psi, 0) / Math.max(1, inGroup.length);
    const worst = [...inGroup].sort((a, b) => b.psi - a.psi)[0];
    const verdict = psiVerdict(avg);
    return {
      group: grp,
      label: GROUP_META[grp].label,
      color: GROUP_META[grp].color,
      psi: avg,
      tone: verdict.tone,
      verdict: verdict.label,
      worstFeature: worst?.label ?? "—",
    };
  });

  return { features: features.sort((a, b) => b.psi - a.psi), groups, sampleSize: X.length };
}

/**
 * Population Stability Index against the stored training histogram:
 * PSI = Σ (actual% − expected%) · ln(actual% / expected%).
 */
export function psiFromHistogram(edges: number[], expected: number[], actual: number[]): number {
  if (!actual.length || !expected.length) return 0;
  const counts = new Array<number>(edges.length + 1).fill(0);
  for (const v of actual) counts[bucketOf(v, edges)] += 1;
  let total = 0;
  for (let i = 0; i < counts.length; i += 1) {
    const pa = Math.max(counts[i] / actual.length, 1e-4);
    const pe = Math.max(expected[i] ?? 1 / counts.length, 1e-4);
    total += (pa - pe) * Math.log(pa / pe);
  }
  return total;
}

/* ------------------------------------------------------------------ */
/* Streaming micro-batch (Kafka -> Spark -> feature store -> scoring)   */
/* ------------------------------------------------------------------ */

const EVENT_RECIPES: Array<{
  topic: string;
  eventType: string;
  severity: "critical" | "warn" | "info";
  weight: number;
  risky: boolean;
}> = [
  { topic: "payments", eventType: "mpesa_debit_failed", severity: "critical", weight: 16, risky: true },
  { topic: "support_events", eventType: "complaint_filed", severity: "critical", weight: 9, risky: true },
  { topic: "support_events", eventType: "ticket_opened", severity: "warn", weight: 14, risky: true },
  { topic: "usage_events", eventType: "session_dropped", severity: "warn", weight: 15, risky: true },
  { topic: "transactions", eventType: "claim_submitted", severity: "warn", weight: 8, risky: true },
  { topic: "customer_events", eventType: "premium_increase_notice", severity: "warn", weight: 7, risky: true },
  { topic: "transactions", eventType: "premium_paid", severity: "info", weight: 18, risky: false },
  { topic: "usage_events", eventType: "app_session", severity: "info", weight: 20, risky: false },
  { topic: "customer_events", eventType: "agent_call_completed", severity: "info", weight: 8, risky: false },
  { topic: "customer_events", eventType: "policy_viewed", severity: "info", weight: 12, risky: false },
];

function applyEvent(row: DbCustomer, recipe: (typeof EVENT_RECIPES)[number], rng: () => number): { payload: Record<string, unknown>; mutated: Partial<DbCustomer> } {
  const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
  switch (recipe.eventType) {
    case "mpesa_debit_failed": {
      const amount = row.premiumMonthly;
      return {
        payload: { amount, reason: ["insufficient_funds", "wrong_pin", "network_timeout", "limit_exceeded"][Math.floor(rng() * 4) % 4], channel: "M-PESA STK Push", retries: 1 + Math.floor(rng() * 3) },
        mutated: {
          paymentFailures: row.paymentFailures + 1,
          latePaymentDays: row.latePaymentDays + 2 + Math.floor(rng() * 9),
          satisfactionScore: Math.round(clamp(row.satisfactionScore - 0.25, 1, 5) * 2) / 2,
          mpesaActivity: Math.round(clamp(row.mpesaActivity - rng() * 2, 0, 60) * 10) / 10,
        },
      };
    }
    case "complaint_filed":
      return {
        payload: { channel: ["IRA_portal", "social_media", "call_centre", "branch"][Math.floor(rng() * 4) % 4], escalated: rng() < 0.45 },
        mutated: {
          complaints: row.complaints + 1,
          satisfactionScore: Math.round(clamp(row.satisfactionScore - 0.5, 1, 5) * 2) / 2,
          npsScore: Math.round(clamp(row.npsScore - 14, -100, 100)),
        },
      };
    case "ticket_opened":
      return {
        payload: { category: ["claims_status", "billing", "policy_change", "app_access"][Math.floor(rng() * 4) % 4], firstResponseMins: 4 + Math.floor(rng() * 400) },
        mutated: { supportTickets: row.supportTickets + 1 },
      };
    case "session_dropped":
      return {
        payload: { surface: ["mobile_app", "ussd_*126#", "web_portal"][Math.floor(rng() * 3) % 3], dropPct: 15 + Math.floor(rng() * 55) },
        mutated: {
          usageFrequency: Math.round(clamp(row.usageFrequency - 1 - rng() * 2.5, 0, 30) * 10) / 10,
          lastLoginDays: Math.round(clamp(row.lastLoginDays + 3 + rng() * 9, 0, 220)),
          loginFrequency: Math.max(0, row.loginFrequency - Math.floor(rng() * 8)),
        },
      };
    case "claim_submitted":
      return {
        payload: { claimAmount: Math.round(row.premiumMonthly * (2 + rng() * 18)), status: "in_review" },
        mutated: {
          claimsCount: row.claimsCount + 1,
          claimSettlementDays: Math.round(clamp((row.claimSettlementDays * row.claimsCount + 12 + rng() * 40) / (row.claimsCount + 1), 0, 140)),
        },
      };
    case "premium_increase_notice":
      return {
        payload: { increasePct: Math.round((row.premiumIncreasePct + 1.5 + rng() * 4) * 10) / 10 },
        mutated: { premiumIncreasePct: Math.round(clamp(row.premiumIncreasePct + 1.5 + rng() * 4, -4, 45) * 10) / 10 },
      };
    case "premium_paid":
      return {
        payload: { amount: row.premiumMonthly, method: ["M-PESA", "bank_transfer", "card"][Math.floor(rng() * 3) % 3], receipt: `QGH${100000 + Math.floor(rng() * 899999)}` },
        mutated: {
          latePaymentDays: Math.max(0, row.latePaymentDays - 6),
          satisfactionScore: Math.round(clamp(row.satisfactionScore + 0.1, 1, 5) * 2) / 2,
          mpesaActivity: Math.round(clamp(row.mpesaActivity + rng() * 2, 0, 60) * 10) / 10,
        },
      };
    case "app_session":
      return {
        payload: { surface: ["mobile_app", "ussd_*126#", "whatsapp_bot"][Math.floor(rng() * 3) % 3], minutes: 1 + Math.floor(rng() * 22) },
        mutated: {
          usageFrequency: Math.round(clamp(row.usageFrequency + 0.4 + rng(), 0, 30) * 10) / 10,
          lastLoginDays: Math.floor(rng() * 3),
          loginFrequency: row.loginFrequency + 1 + Math.floor(rng() * 3),
        },
      };
    case "agent_call_completed":
      return {
        payload: { durationMins: 3 + Math.floor(rng() * 28), outcome: ["renewal_intent_confirmed", "objection_raised", "callback_requested"][Math.floor(rng() * 3) % 3] },
        mutated: {
          agentEngagement: Math.round(clamp(row.agentEngagement + 0.4 + rng() * 0.8, 0, 10) * 10) / 10,
          satisfactionScore: Math.round(clamp(row.satisfactionScore + 0.2, 1, 5) * 2) / 2,
        },
      };
    default:
      return {
        payload: { surface: "mobile_app" },
        mutated: { renewalDueInDays: Math.max(0, row.renewalDueInDays - 1) },
      };
  }
}

export type StreamTick = {
  generatedAt: string;
  events: Array<{
    id: number;
    customerId: string;
    customerName: string;
    segment: string;
    topic: string;
    eventType: string;
    severity: string;
    payload: Record<string, unknown>;
    partition: number;
    streamOffset: number;
    lagMs: number;
    scoreBefore: number;
    scoreAfter: number;
    riskDelta: number;
    riskLevel: string;
    premiumMonthly: number;
    occurredAt: string;
  }>;
  alerts: Array<{ id: number; severity: string; title: string; body: string; customerId: string | null }>;
  movers: Array<{ customerId: string; name: string; delta: number; after: number; riskLevel: string }>;
  topicCounts: Record<string, number>;
  throughputEps: number;
  latencyMs: number;
  scoredCount: number;
  bookAvgRisk: number;
};

export async function ingestStream(count = 14): Promise<StreamTick> {
  const started = Date.now();
  const { run, model } = await getProduction();
  const { bg, mean } = await getBackground();
  const rng = Math.random;

  const pool = await db
    .select({
      id: customers.id,
      probability: predictions.probability,
    })
    .from(customers)
    .innerJoin(predictions, and(eq(predictions.customerId, customers.id), eq(predictions.runId, run.id)))
    .orderBy(sql`random()`)
    .limit(Math.min(900, count * 40));

  // bias the sample towards higher-risk customers, as a real event stream would
  pool.sort((a, b) => (b.probability ?? 0) - (a.probability ?? 0));
  const chosenIds = pool.slice(0, Math.max(count * 3, 24)).map((p) => p.id);
  const rows = await db.select().from(customers).where(inArray(customers.id, chosenIds));

  const previous = new Map(
    (
      await db
        .select({ customerId: predictions.customerId, probability: predictions.probability, riskLevel: predictions.riskLevel })
        .from(predictions)
        .where(and(eq(predictions.runId, run.id), inArray(predictions.customerId, chosenIds)))
    ).map((p) => [p.customerId, p]),
  );

  const now = new Date();
  const totalEvents = Math.max(1, count);
  const touched = new Map<string, DbCustomer>();
  const created: Array<Omit<typeof customerEvents.$inferInsert, "id">> = [];
  const topicCounts: Record<string, number> = {};

  for (let e = 0; e < totalEvents; e += 1) {
    const riskyBias = rng() < 0.62;
    const candidates = rows.filter((r) => {
      const prob = previous.get(r.id)?.probability ?? 0.2;
      return riskyBias ? prob > 0.32 : prob <= 0.62;
    });
    const row = (candidates.length ? candidates : rows)[Math.floor(rng() * Math.max(1, candidates.length || rows.length)) % Math.max(1, candidates.length || rows.length)];
    if (!row) continue;
    const weighted = EVENT_RECIPES.filter((r) => (riskyBias ? true : !r.risky));
    const totalWeight = weighted.reduce((s, r) => s + r.weight, 0);
    let roll = rng() * totalWeight;
    let recipe = weighted[0];
    for (const w of weighted) {
      roll -= w.weight;
      if (roll <= 0) {
        recipe = w;
        break;
      }
    }

    const working = (touched.get(row.id) ?? row) as DbCustomer;
    const { payload, mutated } = applyEvent(working, recipe, rng);
    const next: DbCustomer = { ...working, ...mutated, updatedAt: now };
    touched.set(row.id, next);
    topicCounts[recipe.topic] = (topicCounts[recipe.topic] ?? 0) + 1;

    created.push({
      customerId: row.id,
      topic: recipe.topic,
      eventType: recipe.eventType,
      severity: recipe.severity,
      payload,
      partition: Math.floor(rng() * 6),
      streamOffset: 0,
      lagMs: 40 + Math.floor(rng() * 780),
      processed: true,
      occurredAt: new Date(now.getTime() - Math.floor(rng() * 4_000)),
      ingestedAt: now,
    });
  }

  // Spark micro-batch: persist mutations, refresh the online feature store, rescore.
  for (const [id, row] of touched) {
    await db.update(customers).set(row).where(eq(customers.id, id));
  }

  const touchedRows = Array.from(touched.values());
  const vectors = touchedRows.map(vectorize);
  const probs = model.predictBatch(vectors);
  const latencyMs = Date.now() - started;

  const newAlerts: Array<{ severity: string; source: string; title: string; body: string; customerId: string | null; acknowledged: boolean; createdAt: Date }> = [];
  const scoredByCustomer = new Map<string, { p: number; level: string }>();

  const perCustomer = touchedRows.map((row, i) => {
    const p = probs[i];
    const level = riskLevel(p);
    const before = previous.get(row.id)?.probability ?? 0;
    const beforeLevel = previous.get(row.id)?.riskLevel ?? riskLevel(before);
    const value = annualValue(row);
    const drivers = groupDrivers(model, vectors[i], bg.slice(0, 4), mean)
      .filter((d) => Math.abs(d.impact) > 1e-4)
      .slice(0, 4)
      .map((d) => ({ label: d.label, group: d.group, impact: Number(d.impact.toFixed(5)), raw: 0 }));
    scoredByCustomer.set(row.id, { p, level });
    return { row, i, p, level, before, beforeLevel, value, drivers };
  });

  for (const c of perCustomer) {
    const crossed = c.beforeLevel !== c.level && c.p - c.before > 0.02;
    if ((c.level === "Critical" || c.level === "High") && (crossed || c.p > 0.86)) {
      newAlerts.push({
        severity: c.level === "Critical" ? "critical" : "high",
        source: "streaming",
        title: `${c.level} risk detected live · ${c.row.id}`,
        body: `${c.row.fullName} moved ${(c.before * 100).toFixed(1)}% → ${(c.p * 100).toFixed(1)}% after ${created.filter((x) => x.customerId === c.row.id).length || 1} new event(s). Leading driver: ${c.drivers[0]?.label ?? "—"}. ${riskAction(c.level)}.`,
        customerId: c.row.id,
        acknowledged: false,
        createdAt: now,
      });
    }
  }

  // attach before/after to each raw event
  const insertedEvents: Array<{ id: number; customerId: string; eventType: string }> = [];
  for (const ev of created) {
    const score = scoredByCustomer.get(ev.customerId);
    const before = previous.get(ev.customerId)?.probability ?? 0;
    const [ins] = await db
      .insert(customerEvents)
      .values({
        ...ev,
        scoreBefore: Number(before.toFixed(5)),
        scoreAfter: score ? Number(score.p.toFixed(5)) : null,
        riskDelta: score ? Number((score.p - before).toFixed(5)) : null,
      })
      .returning({ id: customerEvents.id, customerId: customerEvents.customerId, eventType: customerEvents.eventType });
    insertedEvents.push(ins);
  }

  // online feature store refresh (versioned)
  for (const c of perCustomer) {
    await db
      .insert(featureStore)
      .values({ customerId: c.row.id, version: 1, vector: vectors[c.i], groupTotals: groupTotalsOf(c.row), computedAt: now })
      .onConflictDoUpdate({
        target: featureStore.customerId,
        set: { vector: vectors[c.i], groupTotals: groupTotalsOf(c.row), version: sql`${featureStore.version} + 1`, computedAt: now },
      });
  }

  const predUpserts = perCustomer.map((c) => {
    const band = c.level === "Critical" || c.level === "High" ? c.level : c.level === "Elevated" ? "Medium" : "Low";
    const play = recommendPlay(c.row, c.p, c.drivers as Array<{ group: FeatureGroup; impact: number }>, band);
    return {
      prediction: {
        customerId: c.row.id,
        runId: run.id,
        probability: Number(c.p.toFixed(5)),
        riskLevel: c.level,
        revenueAtRisk: Math.round(c.p * c.value * BUSINESS_INPUTS.recoverableShare),
        priorityScore: Math.round(c.p * c.value),
        drivers: c.drivers,
        latencyMs,
        scoredAt: now,
      },
      action: {
        customerId: c.row.id,
        runId: run.id,
        play: play.play,
        rationale: play.rationale,
        owner: play.owner,
        priority: band,
        status: band === "Critical" || band === "High" ? "queued" : "backlog",
        probability: Number(c.p.toFixed(5)),
        annualValue: play.annualValueKes,
        playCostKes: play.playCostKes,
        expectedSaveKes: play.expectedSaveKes,
        roi: Number(play.roi.toFixed(2)),
        createdAt: now,
        updatedAt: now,
      },
    };
  });

  for (const u of predUpserts) {
    await db
      .insert(predictions)
      .values(u.prediction)
      .onConflictDoUpdate({
        target: [predictions.customerId, predictions.runId],
        set: {
          probability: u.prediction.probability,
          riskLevel: u.prediction.riskLevel,
          revenueAtRisk: u.prediction.revenueAtRisk,
          priorityScore: u.prediction.priorityScore,
          drivers: u.prediction.drivers,
          latencyMs,
          scoredAt: now,
        },
      });
    await db
      .insert(retentionActions)
      .values(u.action)
      .onConflictDoUpdate({
        target: [retentionActions.customerId, retentionActions.runId],
        set: {
          play: u.action.play,
          rationale: u.action.rationale,
          owner: u.action.owner,
          priority: u.action.priority,
          probability: u.action.probability,
          annualValue: u.action.annualValue,
          playCostKes: u.action.playCostKes,
          expectedSaveKes: u.action.expectedSaveKes,
          roi: u.action.roi,
          updatedAt: now,
        },
      });
  }

  let alertRows: Array<{ id: number; severity: string; title: string; body: string; customerId: string | null }> = [];
  if (newAlerts.length) {
    alertRows = await db.insert(alerts).values(newAlerts.slice(0, 6)).returning({ id: alerts.id, severity: alerts.severity, title: alerts.title, body: alerts.body, customerId: alerts.customerId });
  }

  const bookAgg = await db
    .select({ avg: sql<number>`avg(${predictions.probability})::float` })
    .from(predictions)
    .where(eq(predictions.runId, run.id));
  const bookAvgRisk = bookAgg[0]?.avg ?? 0;

  await recordMetric("scoring", "avg_risk", "book", bookAvgRisk);
  await recordMetric("scoring", "latency_ms", "p95", latencyMs);
  await recordMetric("ingest", "throughput_eps", "kafka", created.length / Math.max(0.05, latencyMs / 1000));
  await recordMetric("ingest", "consumer_lag", "spark", Math.round(30 + rng() * 220));
  await recordMetric("feature_store", "refresh_rows", "online", touchedRows.length);

  const nameById = new Map(touchedRows.map((r) => [r.id, r]));
  const eventsFinal = created.map((ev, i) => {
    const row = nameById.get(ev.customerId);
    const score = scoredByCustomer.get(ev.customerId);
    const before = previous.get(ev.customerId)?.probability ?? 0;
    return {
      id: insertedEvents[i]?.id ?? 0,
      customerId: ev.customerId,
      customerName: row?.fullName ?? "—",
      segment: row?.segment ?? "—",
      topic: ev.topic,
      eventType: ev.eventType,
      severity: ev.severity,
      payload: ev.payload,
      partition: ev.partition,
      streamOffset: insertedEvents[i]?.id ?? 0,
      lagMs: ev.lagMs,
      scoreBefore: Number(before.toFixed(4)),
      scoreAfter: Number((score?.p ?? before).toFixed(4)),
      riskDelta: Number(((score?.p ?? before) - before).toFixed(4)),
      riskLevel: score?.level ?? riskLevel(before),
      premiumMonthly: row?.premiumMonthly ?? 0,
      occurredAt: ev.occurredAt.toISOString(),
    };
  });

  const movers = touchedRows
    .map((row) => {
      const before = previous.get(row.id)?.probability ?? 0;
      const score = scoredByCustomer.get(row.id);
      return {
        customerId: row.id,
        name: row.fullName,
        delta: (score?.p ?? before) - before,
        after: score?.p ?? before,
        riskLevel: score?.level ?? riskLevel(before),
      };
    })
    .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))
    .slice(0, 6);

  return {
    generatedAt: now.toISOString(),
    events: eventsFinal.sort((a, b) => b.streamOffset - a.streamOffset),
    alerts: alertRows,
    movers,
    topicCounts,
    throughputEps: created.length / Math.max(0.05, latencyMs / 1000),
    latencyMs,
    scoredCount: touchedRows.length,
    bookAvgRisk,
  };
}
