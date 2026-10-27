import { and, asc, desc, eq, gt, ilike, inArray, isNotNull, ne, or, sql } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import { db } from "@/db";
import { alerts, customerEvents, customers, featureStore, modelRuns, pipelineMetrics, predictions, retentionActions } from "@/db/schema";
import type { CustomerRow } from "@/lib/synthesize";
import { FEATURE_META, GROUP_META, GROUP_ORDER, vectorize, type FeatureGroup } from "@/lib/ml/features";
import { attributionsToDrivers, kernelShap, type Attribution } from "@/lib/ml/explain";
import { restoreModel } from "@/lib/ml/models";
import {
  BUSINESS_INPUTS,
  PLAYBOOK,
  RISK_BANDS,
  annualValue,
  recommendPlay,
  riskAction,
  riskColor,
  riskLevel,
} from "@/lib/ml/pipeline";
import { getBackground, getProduction, type DbCustomer, type DbRun } from "@/lib/platform";

/* ------------------------------------------------------------------ */
/* Executive summary                                                   */
/* ------------------------------------------------------------------ */

export type Breakdown = { key: string; customers: number; churned: number; churnRate: number; avgRisk: number; revenueAtRisk: number; premiumMonthly: number };

function groupByField(rows: CompactRow[], field: keyof CompactRow): Breakdown[] {
  const map = new Map<string, Breakdown>();
  for (const r of rows) {
    const key = String(r[field]);
    const b = map.get(key) ?? { key, customers: 0, churned: 0, churnRate: 0, avgRisk: 0, revenueAtRisk: 0, premiumMonthly: 0 };
    b.customers += 1;
    b.churned += r.churn;
    b.avgRisk += r.prob ?? 0;
    b.revenueAtRisk += r.revenueAtRisk ?? 0;
    b.premiumMonthly += r.premium;
    map.set(key, b);
  }
  return Array.from(map.values())
    .map((b) => ({ ...b, churnRate: b.churned / b.customers, avgRisk: b.avgRisk / b.customers }))
    .sort((a, b) => b.customers - a.customers);
}

type CompactRow = {
  premium: number;
  policies: number;
  tenure: number;
  churn: number;
  prob: number;
  segment: string;
  county: string;
  product: string;
  channel: string;
  plan: string;
  contract: string;
  status: string;
  revenueAtRisk: number;
};

const VALUE_BANDS: Array<{ label: string; min: number; max: number }> = [
  { label: "< KES 25K", min: 0, max: 25_000 },
  { label: "25K – 100K", min: 25_000, max: 100_000 },
  { label: "100K – 500K", min: 100_000, max: 500_000 },
  { label: "500K – 2M", min: 500_000, max: 2_000_000 },
  { label: "> KES 2M", min: 2_000_000, max: Number.POSITIVE_INFINITY },
];

export async function executiveSummary() {
  const { run } = await getProduction();
  const runId = run.id;

  const compact = (await db
    .select({
      premium: customers.premiumMonthly,
      policies: customers.policiesHeld,
      tenure: customers.tenureMonths,
      churn: customers.churn,
      status: customers.status,
      prob: predictions.probability,
      segment: customers.segment,
      county: customers.county,
      product: customers.productLine,
      channel: customers.channel,
      plan: customers.planTier,
      contract: customers.contractType,
      revenueAtRisk: predictions.revenueAtRisk,
    })
    .from(customers)
    .innerJoin(predictions, and(eq(predictions.customerId, customers.id), eq(predictions.runId, runId)))) as CompactRow[];

  const total = compact.length;
  const churned = compact.reduce((s, r) => s + r.churn, 0);
  const active = compact.filter((r) => r.status === "Active" || r.status === "Renewal Due").length;
  const premiumMonthly = compact.reduce((s, r) => s + r.premium, 0);
  const revenueAtRisk = compact.reduce((s, r) => s + (r.revenueAtRisk ?? 0), 0);
  const avgRisk = compact.reduce((s, r) => s + (r.prob ?? 0), 0) / Math.max(1, total);
  const riskCounts = RISK_BANDS.map((band) => ({
    level: band.level,
    color: band.color,
    action: band.action,
    count: compact.filter((r) => riskLevel(r.prob ?? 0) === band.level).length,
    revenueAtRisk: compact.filter((r) => riskLevel(r.prob ?? 0) === band.level).reduce((s, r) => s + (r.revenueAtRisk ?? 0), 0),
  }));

  const histogram = Array.from({ length: 20 }, (_, i) => ({
    bucket: i / 20,
    count: compact.filter((r) => (r.prob ?? 0) >= i / 20 && (r.prob ?? 0) < (i + 1) / 20).length,
  }));

  const valueBands = VALUE_BANDS.map((band) => {
    const rows = compact.filter((r) => {
      const v = r.premium * 12 * Math.max(1, r.policies);
      return v >= band.min && v < band.max;
    });
    return {
      label: band.label,
      customers: rows.length,
      churnRate: rows.length ? rows.reduce((s, r) => s + r.churn, 0) / rows.length : 0,
      avgRisk: rows.length ? rows.reduce((s, r) => s + r.prob, 0) / rows.length : 0,
      revenueAtRisk: rows.reduce((s, r) => s + r.revenueAtRisk, 0),
    };
  });

  const tenureBands = [
    { label: "0–6m", min: 0, max: 6 },
    { label: "7–12m", min: 7, max: 12 },
    { label: "13–24m", min: 13, max: 24 },
    { label: "25–48m", min: 25, max: 48 },
    { label: "48m+", min: 49, max: 999 },
  ].map((band) => {
    const rows = compact.filter((r) => r.tenure >= band.min && r.tenure <= band.max);
    return {
      label: band.label,
      customers: rows.length,
      churnRate: rows.length ? rows.reduce((s, r) => s + r.churn, 0) / rows.length : 0,
      avgRisk: rows.length ? rows.reduce((s, r) => s + r.prob, 0) / rows.length : 0,
    };
  });

  const trend = await db
    .select({
      month: sql<string>`to_char(date_trunc('month', ${customerEvents.occurredAt}), 'YYYY-MM')`,
      lapses: sql<number>`count(*) filter (where ${customerEvents.eventType} in ('policy_lapsed','policy_cancelled'))::int`,
      failures: sql<number>`count(*) filter (where ${customerEvents.eventType} = 'mpesa_debit_failed')::int`,
      complaints: sql<number>`count(*) filter (where ${customerEvents.eventType} = 'complaint_filed')::int`,
      tickets: sql<number>`count(*) filter (where ${customerEvents.eventType} = 'ticket_opened')::int`,
      events: sql<number>`count(*)::int`,
    })
    .from(customerEvents)
    .groupBy(sql`1`)
    .orderBy(sql`1`);

  const riskSeries = await db
    .select({ at: pipelineMetrics.recordedAt, value: pipelineMetrics.value })
    .from(pipelineMetrics)
    .where(and(eq(pipelineMetrics.stage, "scoring"), eq(pipelineMetrics.metric, "avg_risk")))
    .orderBy(asc(pipelineMetrics.recordedAt))
    .limit(400);

  const actionsAgg = await db
    .select({
      queued: sql<number>`count(*) filter (where ${retentionActions.status} = 'queued')::int`,
      contacted: sql<number>`count(*) filter (where ${retentionActions.status} = 'contacted')::int`,
      saved: sql<number>`count(*) filter (where ${retentionActions.status} in ('saved','won'))::int`,
      expected: sql<number>`coalesce(sum(${retentionActions.expectedSaveKes}),0)::float`,
      cost: sql<number>`coalesce(sum(${retentionActions.playCostKes}),0)::float`,
    })
    .from(retentionActions)
    .where(eq(retentionActions.runId, runId));

  const topAtRisk = await db
    .select({
      id: customers.id,
      name: customers.fullName,
      segment: customers.segment,
      productLine: customers.productLine,
      county: customers.county,
      premiumMonthly: customers.premiumMonthly,
      probability: predictions.probability,
      riskLevel: predictions.riskLevel,
      revenueAtRisk: predictions.revenueAtRisk,
      drivers: predictions.drivers,
    })
    .from(customers)
    .innerJoin(predictions, and(eq(predictions.customerId, customers.id), eq(predictions.runId, runId)))
    .orderBy(desc(predictions.probability))
    .limit(8);

  return {
    runId,
    algorithm: run.algorithm,
    version: run.version,
    scoredAt: run.promotedAt ?? run.createdAt,
    kpi: {
      total,
      active,
      churned,
      churnRate: churned / Math.max(1, total),
      retentionRate: 1 - churned / Math.max(1, total),
      highRisk: compact.filter((r) => (r.prob ?? 0) >= 0.55).length,
      critical: compact.filter((r) => (r.prob ?? 0) >= 0.75).length,
      revenueAtRisk,
      annualPremium: premiumMonthly * 12,
      avgRisk,
      bookValue: compact.reduce((s, r) => s + r.premium * 12 * Math.max(1, r.policies), 0),
    },
    riskCounts,
    histogram,
    valueBands,
    tenureBands,
    segments: groupByField(compact, "segment"),
    products: groupByField(compact, "product"),
    counties: groupByField(compact, "county").slice(0, 10),
    channels: groupByField(compact, "channel"),
    plans: groupByField(compact, "plan"),
    contracts: groupByField(compact, "contract"),
    trend: trend.map((t) => ({ ...t, churnRate: t.lapses / Math.max(1, total) })),
    riskSeries: riskSeries.map((r) => ({ at: r.at.toISOString(), value: r.value })),
    retention: actionsAgg[0] ?? { queued: 0, contacted: 0, saved: 0, expected: 0, cost: 0 },
    topAtRisk: topAtRisk.map((t) => ({ ...t, color: riskColor(t.riskLevel), action: riskAction(t.riskLevel) })),
    businessInputs: BUSINESS_INPUTS,
  };
}

/* ------------------------------------------------------------------ */
/* Customer explorer                                                   */
/* ------------------------------------------------------------------ */

export type CustomerFilters = {
  q?: string;
  segment?: string;
  productLine?: string;
  county?: string;
  riskLevel?: string;
  contractType?: string;
  status?: string;
  churned?: "yes" | "no";
  sort?: "probability" | "premium" | "tenure" | "priority" | "name" | "revenueAtRisk";
  dir?: "asc" | "desc";
  page?: number;
  pageSize?: number;
};

export async function listCustomers(f: CustomerFilters) {
  const { run } = await getProduction();
  const conditions = [eq(predictions.runId, run.id)];
  if (f.q) {
    const like = `%${f.q}%`;
    conditions.push(or(ilike(customers.id, like), ilike(customers.fullName, like), ilike(customers.email, like), ilike(customers.phone, like))!);
  }
  if (f.segment) conditions.push(eq(customers.segment, f.segment));
  if (f.productLine) conditions.push(eq(customers.productLine, f.productLine));
  if (f.county) conditions.push(eq(customers.county, f.county));
  if (f.contractType) conditions.push(eq(customers.contractType, f.contractType));
  if (f.status) conditions.push(eq(customers.status, f.status));
  if (f.riskLevel) conditions.push(eq(predictions.riskLevel, f.riskLevel));
  if (f.churned === "yes") conditions.push(eq(customers.churn, 1));
  if (f.churned === "no") conditions.push(eq(customers.churn, 0));

  const where = and(...conditions)!;
  const page = Math.max(1, f.page ?? 1);
  const pageSize = Math.min(100, Math.max(5, f.pageSize ?? 25));
  const sortCol =
    f.sort === "premium"
      ? customers.premiumMonthly
      : f.sort === "tenure"
        ? customers.tenureMonths
        : f.sort === "priority"
          ? predictions.priorityScore
          : f.sort === "name"
            ? customers.fullName
            : f.sort === "revenueAtRisk"
              ? predictions.revenueAtRisk
              : predictions.probability;
  const order = f.dir === "asc" ? asc(sortCol) : desc(sortCol);

  const [rows, countRow] = await Promise.all([
    db
      .select({
        id: customers.id,
        fullName: customers.fullName,
        email: customers.email,
        phone: customers.phone,
        county: customers.county,
        segment: customers.segment,
        productLine: customers.productLine,
        channel: customers.channel,
        contractType: customers.contractType,
        planTier: customers.planTier,
        status: customers.status,
        tenureMonths: customers.tenureMonths,
        premiumMonthly: customers.premiumMonthly,
        lifetimePremium: customers.lifetimePremium,
        policiesHeld: customers.policiesHeld,
        churn: customers.churn,
        satisfactionScore: customers.satisfactionScore,
        paymentFailures: customers.paymentFailures,
        probability: predictions.probability,
        riskLevel: predictions.riskLevel,
        revenueAtRisk: predictions.revenueAtRisk,
        priorityScore: predictions.priorityScore,
        scoredAt: predictions.scoredAt,
      })
      .from(customers)
      .innerJoin(predictions, and(eq(predictions.customerId, customers.id), eq(predictions.runId, run.id)))
      .where(where)
      .orderBy(order, asc(customers.id))
      .limit(pageSize)
      .offset((page - 1) * pageSize),
    db.select({ count: sql<number>`count(*)::int` }).from(customers).innerJoin(predictions, and(eq(predictions.customerId, customers.id), eq(predictions.runId, run.id))).where(where),
  ]);

  return {
    rows: rows.map((r) => ({ ...r, annualValue: annualValue(r), color: riskColor(r.riskLevel) })),
    total: countRow[0]?.count ?? 0,
    page,
    pageSize,
    pages: Math.max(1, Math.ceil((countRow[0]?.count ?? 0) / pageSize)),
  };
}

export async function filterOptions() {
  const [counties, segments, products] = await Promise.all([
    db.selectDistinct({ county: customers.county }).from(customers),
    db.selectDistinct({ segment: customers.segment }).from(customers),
    db.selectDistinct({ productLine: customers.productLine }).from(customers),
  ]);
  return {
    counties: counties.map((c) => c.county).sort(),
    segments: segments.map((c) => c.segment).sort(),
    products: products.map((c) => c.productLine).sort(),
    riskLevels: RISK_BANDS.map((b) => b.level),
  };
}

/* ------------------------------------------------------------------ */
/* Customer 360                                                        */
/* ------------------------------------------------------------------ */

export async function customer360(id: string) {
  const { run, model } = await getProduction();
  const [row] = await db.select().from(customers).where(eq(customers.id, id)).limit(1);
  if (!row) return null;

  const [pred] = await db
    .select()
    .from(predictions)
    .where(and(eq(predictions.customerId, id), eq(predictions.runId, run.id)))
    .limit(1);

  const events = await db
    .select()
    .from(customerEvents)
    .where(eq(customerEvents.customerId, id))
    .orderBy(desc(customerEvents.occurredAt))
    .limit(220);

  const { bg } = await getBackground();
  const vector = vectorize(row as CustomerRow);
  const started = Date.now();
  const attributions: Attribution[] = kernelShap(model, vector, bg.slice(0, 8), 260, mulberryLike(1337));
  const shapMs = Date.now() - started;
  const drivers = attributionsToDrivers(attributions);
  const sortedAttrs = [...attributions].sort((a, b) => Math.abs(b.impact) - Math.abs(a.impact));
  const baselineProb = bg.reduce((sum, r) => sum + model.predictProba(r), 0) / Math.max(1, bg.length);

  const [action] = await db
    .select()
    .from(retentionActions)
    .where(and(eq(retentionActions.customerId, id), eq(retentionActions.runId, run.id)))
    .limit(1);

  const play =
    action ??
    (() => {
      const p = recommendPlay(row as CustomerRow, pred?.probability ?? 0, drivers, riskLevel(pred?.probability ?? 0));
      return {
        customerId: id,
        runId: run.id,
        play: p.play,
        rationale: p.rationale,
        owner: p.owner,
        priority: p.priority,
        status: "proposed",
        probability: p.probability,
        annualValue: p.annualValueKes,
        playCostKes: p.playCostKes,
        expectedSaveKes: p.expectedSaveKes,
        roi: p.roi,
        createdAt: new Date(),
        updatedAt: new Date(),
        id: 0,
      };
    })();

  const peers = await db
    .select({
      id: customers.id,
      fullName: customers.fullName,
      probability: predictions.probability,
      riskLevel: predictions.riskLevel,
      premiumMonthly: customers.premiumMonthly,
      churn: customers.churn,
    })
    .from(customers)
    .innerJoin(predictions, and(eq(predictions.customerId, customers.id), eq(predictions.runId, run.id)))
    .where(and(eq(customers.segment, row.segment), eq(customers.productLine, row.productLine), ne(customers.id, id)))
    .orderBy(desc(predictions.probability))
    .limit(6);

  const riskHistory = events
    .filter((e) => e.scoreAfter !== null)
    .slice(0, 40)
    .reverse()
    .map((e) => ({ at: e.occurredAt.toISOString(), value: e.scoreAfter ?? 0, eventType: e.eventType }));

  const payments = events.filter((e) => e.topic === "transactions" || e.topic === "payments");
  const support = events.filter((e) => e.topic === "support_events");
  const usage = events.filter((e) => e.topic === "usage_events");

  // cross-model comparison for the same customer
  const runs = await db.select().from(modelRuns);
  const ensemble = runs.map((r) => {
    const m = restoreModel(r.artifact as unknown as Parameters<typeof restoreModel>[0]);
    return {
      runId: r.id,
      algorithm: r.algorithm,
      stage: r.stage,
      probability: m.predictProba(vector),
    };
  });

  return {
    customer: row,
    prediction: pred,
    events,
    attributions: sortedAttrs,
    drivers,
    baselineProb,
    shapMs,
    play,
    peers,
    riskHistory,
    ensemble,
    timeline: {
      payments: payments.slice(0, 40),
      support: support.slice(0, 40),
      usage: usage.slice(0, 40),
    },
    aggregates: {
      annualValue: annualValue(row),
      lifetimePremium: row.lifetimePremium,
      revenueAtRisk: pred?.revenueAtRisk ?? 0,
      paidEvents: payments.filter((p) => p.eventType === "premium_paid").length,
      failedPayments: payments.filter((p) => p.eventType === "mpesa_debit_failed").length,
      claims: payments.filter((p) => p.eventType === "claim_submitted").length,
      tickets: support.filter((p) => p.eventType === "ticket_opened").length,
      complaints: support.filter((p) => p.eventType === "complaint_filed").length,
      sessions: usage.length,
    },
    playbook: GROUP_ORDER.map((grp) => ({ group: grp, ...GROUP_META[grp], ...PLAYBOOK[grp] })),
    features: FEATURE_META.map((f, i) => ({ key: f.key, label: f.label, group: f.group, kind: f.kind, value: vector[i] })),
  };
}

function mulberryLike(seed: number) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* ------------------------------------------------------------------ */
/* Retention centre                                                    */
/* ------------------------------------------------------------------ */

export async function retentionQueue(opts: { priority?: string; status?: string; q?: string; group?: string; page?: number; pageSize?: number; sort?: string }) {
  const { run } = await getProduction();
  const conditions = [eq(retentionActions.runId, run.id)];
  if (opts.priority) conditions.push(eq(retentionActions.priority, opts.priority));
  if (opts.status) conditions.push(eq(retentionActions.status, opts.status));
  if (opts.q) conditions.push(or(ilike(customers.id, `%${opts.q}%`), ilike(customers.fullName, `%${opts.q}%`))!);
  const where = and(...conditions)!;
  const page = Math.max(1, opts.page ?? 1);
  const pageSize = Math.min(100, Math.max(10, opts.pageSize ?? 30));

  const orderCol =
    opts.sort === "roi"
      ? retentionActions.roi
      : opts.sort === "expected"
        ? retentionActions.expectedSaveKes
        : opts.sort === "value"
          ? retentionActions.annualValue
          : retentionActions.probability;

  const [rows, countRow, summary] = await Promise.all([
    db
      .select({
        actionId: retentionActions.id,
        play: retentionActions.play,
        rationale: retentionActions.rationale,
        owner: retentionActions.owner,
        priority: retentionActions.priority,
        status: retentionActions.status,
        probability: retentionActions.probability,
        annualValue: retentionActions.annualValue,
        playCostKes: retentionActions.playCostKes,
        expectedSaveKes: retentionActions.expectedSaveKes,
        roi: retentionActions.roi,
        updatedAt: retentionActions.updatedAt,
        id: customers.id,
        fullName: customers.fullName,
        segment: customers.segment,
        productLine: customers.productLine,
        county: customers.county,
        premiumMonthly: customers.premiumMonthly,
        contractType: customers.contractType,
        tenureMonths: customers.tenureMonths,
        churn: customers.churn,
        drivers: predictions.drivers,
        revenueAtRisk: predictions.revenueAtRisk,
      })
      .from(retentionActions)
      .innerJoin(customers, eq(customers.id, retentionActions.customerId))
      .leftJoin(predictions, and(eq(predictions.customerId, customers.id), eq(predictions.runId, run.id)))
      .where(where)
      .orderBy(desc(orderCol))
      .limit(pageSize)
      .offset((page - 1) * pageSize),
    db.select({ count: sql<number>`count(*)::int` }).from(retentionActions).where(and(...conditions)),
    db
      .select({
        priority: retentionActions.priority,
        status: retentionActions.status,
        count: sql<number>`count(*)::int`,
        expected: sql<number>`coalesce(sum(${retentionActions.expectedSaveKes}),0)::float`,
        cost: sql<number>`coalesce(sum(${retentionActions.playCostKes}),0)::float`,
        value: sql<number>`coalesce(sum(${retentionActions.annualValue} * ${retentionActions.probability}),0)::float`,
      })
      .from(retentionActions)
      .where(eq(retentionActions.runId, run.id))
      .groupBy(retentionActions.priority, retentionActions.status),
  ]);

  return {
    rows: rows.map((r) => ({ ...r, color: riskColor(riskLevel(r.probability)) })),
    total: countRow[0]?.count ?? 0,
    page,
    pageSize,
    pages: Math.max(1, Math.ceil((countRow[0]?.count ?? 0) / pageSize)),
    summary,
    playbook: GROUP_ORDER.map((grp) => ({ group: grp, ...GROUP_META[grp], ...PLAYBOOK[grp] })),
  };
}

export async function setActionStatus(actionId: number, status: string, note?: string) {
  const [updated] = await db
    .update(retentionActions)
    .set({ status, updatedAt: new Date(), ...(note ? { rationale: note } : {}) })
    .where(eq(retentionActions.id, actionId))
    .returning();
  if (updated) {
    await db.insert(alerts).values({
      severity: "info",
      source: "retention",
      title: `Play ${status} · ${updated.customerId}`,
      body: `${updated.play} — owner ${updated.owner}, expected save KES ${Math.round(updated.expectedSaveKes).toLocaleString()}.`,
      customerId: updated.customerId,
      acknowledged: false,
      createdAt: new Date(),
    });
  }
  return updated ?? null;
}

/* ------------------------------------------------------------------ */
/* Ad-hoc scoring (form + CSV)                                         */
/* ------------------------------------------------------------------ */

const DEFAULT_PROFILE: CustomerRow = {
  id: "ADHOC",
  fullName: "Ad-hoc profile",
  email: "adhoc@churniq.ke",
  phone: "+254700000000",
  county: "Nairobi",
  city: "Nairobi",
  segment: "Consumer",
  productLine: "Health Cover",
  channel: "Digital App / USSD",
  contractType: "Monthly",
  planTier: "Plus",
  status: "Active",
  gender: "Female",
  age: 34,
  tenureMonths: 22,
  policiesHeld: 1,
  premiumMonthly: 4200,
  lifetimePremium: 92_400,
  paymentFailures: 0,
  latePaymentDays: 0,
  supportTickets: 1,
  complaints: 0,
  claimsCount: 0,
  claimSettlementDays: 0,
  lastLoginDays: 9,
  loginFrequency: 24,
  usageFrequency: 9,
  mpesaActivity: 16,
  satisfactionScore: 3.8,
  npsScore: 26,
  discountPct: 8,
  premiumIncreasePct: 7,
  agentEngagement: 2.6,
  renewalDueInDays: 120,
  churn: 0,
  onboardedAt: new Date(),
  updatedAt: new Date(),
};

export async function scoreAdhoc(input: Partial<CustomerRow>) {
  const { run, model } = await getProduction();
  const row: CustomerRow = {
    ...DEFAULT_PROFILE,
    ...input,
    lifetimePremium:
      input.lifetimePremium ?? Math.round((input.premiumMonthly ?? DEFAULT_PROFILE.premiumMonthly) * (input.tenureMonths ?? DEFAULT_PROFILE.tenureMonths)),
  };
  const vector = vectorize(row);
  const { bg } = await getBackground();
  const probability = model.predictProba(vector);
  const attributions = kernelShap(model, vector, bg.slice(0, 8), 260, mulberryLike(99)).sort(
    (a, b) => Math.abs(b.impact) - Math.abs(a.impact),
  );
  const drivers = attributionsToDrivers(attributions);
  const level = riskLevel(probability);
  const play = recommendPlay(row, probability, drivers, level === "Critical" ? "Critical" : level === "High" ? "High" : level === "Elevated" ? "Medium" : "Low");

  const runs = await db.select().from(modelRuns);
  const ensemble = runs.map((r) => ({
    algorithm: r.algorithm,
    stage: r.stage,
    probability: restoreModel(r.artifact as unknown as Parameters<typeof restoreModel>[0]).predictProba(vector),
  }));

  const baseline = bg.reduce((sum, r) => sum + model.predictProba(r), 0) / Math.max(1, bg.length);

  return {
    runId: run.id,
    algorithm: run.algorithm,
    probability,
    baseline,
    riskLevel: level,
    color: riskColor(level),
    action: riskAction(level),
    revenueAtRisk: Math.round(probability * annualValue(row) * BUSINESS_INPUTS.recoverableShare),
    annualValue: annualValue(row),
    attributions,
    drivers,
    play,
    ensemble,
    profile: row,
    features: FEATURE_META.map((f, i) => ({ key: f.key, label: f.label, group: f.group, value: vector[i] })),
  };
}

const CSV_ALIASES: Record<string, keyof CustomerRow> = {
  customer_id: "id",
  id: "id",
  name: "fullName",
  full_name: "fullName",
  email: "email",
  phone: "phone",
  county: "county",
  segment: "segment",
  product: "productLine",
  product_line: "productLine",
  channel: "channel",
  contract: "contractType",
  contract_type: "contractType",
  plan: "planTier",
  plan_tier: "planTier",
  age: "age",
  tenure: "tenureMonths",
  tenure_months: "tenureMonths",
  policies_held: "policiesHeld",
  premium: "premiumMonthly",
  monthly_premium: "premiumMonthly",
  premium_monthly: "premiumMonthly",
  monthly_revenue: "premiumMonthly",
  lifetime_premium: "lifetimePremium",
  payment_failures: "paymentFailures",
  late_payment_days: "latePaymentDays",
  support_tickets: "supportTickets",
  complaints: "complaints",
  claims_count: "claimsCount",
  claim_settlement_days: "claimSettlementDays",
  last_login_days: "lastLoginDays",
  login_frequency: "loginFrequency",
  usage_frequency: "usageFrequency",
  mpesa_activity: "mpesaActivity",
  satisfaction: "satisfactionScore",
  customer_satisfaction: "satisfactionScore",
  satisfaction_score: "satisfactionScore",
  nps: "npsScore",
  nps_score: "npsScore",
  discount: "discountPct",
  discount_pct: "discountPct",
  premium_increase_pct: "premiumIncreasePct",
  agent_engagement: "agentEngagement",
  renewal_due_in_days: "renewalDueInDays",
};

export async function scoreCsv(text: string) {
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length < 2) throw new Error("CSV must contain a header row and at least one data row");
  const header = lines[0].split(",").map((h) => h.trim().toLowerCase().replace(/^"|"$/g, ""));
  const { run, model } = await getProduction();
  const { bg } = await getBackground();
  const baselineMean = bg.reduce<number[]>((acc, r) => acc.map((v, i) => v + r[i] / bg.length), new Array(FEATURE_META.length).fill(0));
  const numericFields = new Set<string>([
    "age","tenureMonths","policiesHeld","premiumMonthly","lifetimePremium","paymentFailures","latePaymentDays",
    "supportTickets","complaints","claimsCount","claimSettlementDays","lastLoginDays","loginFrequency",
    "usageFrequency","mpesaActivity","satisfactionScore","npsScore","discountPct","premiumIncreasePct",
    "agentEngagement","renewalDueInDays",
  ]);

  const results: Array<{
    line: number;
    id: string;
    profile: CustomerRow;
    probability: number;
    riskLevel: string;
    revenueAtRisk: number;
    drivers: Array<{ label: string; group: string; impact: number }>;
    play: string;
    owner: string;
  }> = [];

  for (let li = 1; li < lines.length; li += 1) {
    const cells = splitCsvLine(lines[li]);
    const partial: Partial<CustomerRow> = {};
    header.forEach((h, i) => {
      const field = CSV_ALIASES[h];
      if (!field) return;
      const raw = (cells[i] ?? "").trim().replace(/^"|"$/g, "");
      if (raw === "") return;
      if (numericFields.has(field)) {
        const num = Number(raw.replace(/[^0-9.\-]/g, ""));
        if (!Number.isNaN(num)) (partial as Record<string, unknown>)[field] = num;
      } else {
        (partial as Record<string, unknown>)[field] = raw;
      }
    });
    const row: CustomerRow = {
      ...DEFAULT_PROFILE,
      ...partial,
      id: partial.id ?? `CSV-${li.toString().padStart(4, "0")}`,
    };
    row.lifetimePremium = partial.lifetimePremium ?? Math.round(row.premiumMonthly * row.tenureMonths);
    const vector = vectorize(row);
    const probability = model.predictProba(vector);
    const level = riskLevel(probability);
    const drivers = groupDriversLocal(model, vector, bg.slice(0, 3), baselineMean);
    const play = recommendPlay(row, probability, drivers, level);
    results.push({
      line: li,
      id: row.id,
      profile: row,
      probability,
      riskLevel: level,
      revenueAtRisk: Math.round(probability * annualValue(row) * BUSINESS_INPUTS.recoverableShare),
      drivers: drivers.slice(0, 3),
      play: play.play,
      owner: play.owner,
    });
  }

  return { runId: run.id, algorithm: run.algorithm, count: results.length, results };
}

function groupDriversLocal(
  model: ReturnType<typeof restoreModel>,
  x: number[],
  bg: number[][],
  baselineMean: number[],
): Array<{ label: string; group: FeatureGroup; impact: number }> {
  const map = new Map<FeatureGroup, number[]>();
  FEATURE_META.forEach((f, i) => {
    const arr = map.get(f.group) ?? [];
    arr.push(i);
    map.set(f.group, arr);
  });
  const full = model.predictProba(x);
  const base = model.predictProba(baselineMean);
  const impacts = GROUP_ORDER.map((grpKey) => {
    const idxs = map.get(grpKey) ?? [];
    let s = 0;
    for (const b of bg) {
      const cand = x.slice();
      for (const idx of idxs) cand[idx] = b[idx];
      s += model.predictProba(cand);
    }
    return { group: grpKey, label: GROUP_META[grpKey].label, impact: full - s / Math.max(1, bg.length) };
  });
  const total = impacts.reduce((a, b) => a + b.impact, 0);
  const scale = Math.abs(total) > 1e-9 ? (full - base) / total : 0;
  return impacts
    .map((i) => ({ ...i, impact: i.impact * scale }))
    .sort((a, b) => Math.abs(b.impact) - Math.abs(a.impact));
}

function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (ch === '"') quoted = !quoted;
    else if (ch === "," && !quoted) {
      out.push(cur);
      cur = "";
    } else cur += ch;
  }
  out.push(cur);
  return out;
}

/* ------------------------------------------------------------------ */
/* Monitoring / MLOps                                                  */
/* ------------------------------------------------------------------ */

export async function monitoring() {
  const { run } = await getProduction();
  const runs = await db.select().from(modelRuns).orderBy(desc(modelRuns.createdAt));
  const [latency, throughput, lag, risk] = await Promise.all([
    seriesOf("scoring", "latency_ms", 240),
    seriesOf("ingest", "throughput_eps", 240),
    seriesOf("ingest", "consumer_lag", 240),
    seriesOf("scoring", "avg_risk", 240),
  ]);

  const [quality] = await db
    .select({
      customers: sql<number>`(select count(*)::int from ${customers})`,
      staleFeatures: sql<number>`(select count(*)::int from ${featureStore} where ${featureStore.computedAt} < now() - interval '7 days')`,
      missingVectors: sql<number>`(select count(*)::int from ${customers} c where not exists (select 1 from ${featureStore} f where f.customer_id = c.id))`,
      unprocessedEvents: sql<number>`(select count(*)::int from ${customerEvents} where ${customerEvents.processed} = false)`,
      events24h: sql<number>`(select count(*)::int from ${customerEvents} where ${customerEvents.ingestedAt} > now() - interval '24 hours')`,
      negativePremium: sql<number>`(select count(*)::int from ${customers} where ${customers.premiumMonthly} <= 0)`,
      duplicateIds: sql<number>`(select count(*)::int from (select ${customers.id} from ${customers} group by ${customers.id} having count(*) > 1) d)`,
      unscored: sql<number>`(select count(*)::int from ${customers} c where not exists (select 1 from ${predictions} p where p.customer_id = c.id and p.run_id = ${run.id}))`,
    })
    .from(customers)
    .limit(1);

  const topics = await db
    .select({ topic: customerEvents.topic, count: sql<number>`count(*)::int`, last: sql<string>`max(${customerEvents.ingestedAt})` })
    .from(customerEvents)
    .groupBy(customerEvents.topic);

  const alertCounts = await db
    .select({ severity: alerts.severity, count: sql<number>`count(*)::int`, open: sql<number>`count(*) filter (where ${alerts.acknowledged} = false)::int` })
    .from(alerts)
    .groupBy(alerts.severity);

  const registry = runs.map((r) => {
    const m = r.metrics as unknown as Record<string, number | Record<string, number>>;
    const business = (m.business ?? {}) as Record<string, number>;
    return {
      id: r.id,
      algorithm: r.algorithm,
      version: r.version,
      stage: r.stage,
      status: r.status,
      trainingMs: r.trainingMs,
      trainRows: r.trainRows,
      testRows: r.testRows,
      createdAt: r.createdAt.toISOString(),
      promotedAt: r.promotedAt?.toISOString() ?? null,
      datasetHash: r.datasetHash,
      rocAuc: Number(m.rocAuc ?? 0),
      prAuc: Number(m.prAuc ?? 0),
      precision: Number(m.precision ?? 0),
      recall: Number(m.recall ?? 0),
      f1: Number(m.f1 ?? 0),
      brier: Number(m.brier ?? 0),
      ks: Number(m.ks ?? 0),
      liftTopDecile: Number(m.liftTopDecile ?? 0),
      netValueKes: Number(business.netValueKes ?? 0),
      threshold: Number(m.threshold ?? 0.5),
      featureImportance: r.featureImportance.slice(0, 10),
    };
  });

  return {
    production: registry.find((r) => r.stage === "production") ?? registry[0],
    registry,
    latency,
    throughput,
    lag,
    risk,
    quality,
    topics: topics.map((t) => ({ ...t, last: new Date(t.last).toISOString() })),
    alertCounts,
    businessInputs: BUSINESS_INPUTS,
    fullMetrics: run.metrics,
  };
}

async function seriesOf(stage: string, metric: string, limit: number) {
  const rows = await db
    .select({ at: pipelineMetrics.recordedAt, value: pipelineMetrics.value })
    .from(pipelineMetrics)
    .where(and(eq(pipelineMetrics.stage, stage), eq(pipelineMetrics.metric, metric)))
    .orderBy(desc(pipelineMetrics.recordedAt))
    .limit(limit);
  return rows.reverse().map((r) => ({ at: r.at.toISOString(), value: r.value }));
}

export async function recentAlerts(limit = 40, onlyOpen = false) {
  const conditions = onlyOpen ? [eq(alerts.acknowledged, false)] : [];
  return db.select().from(alerts).where(and(...conditions)).orderBy(desc(alerts.createdAt)).limit(limit);
}

export async function acknowledgeAlert(id: number) {
  const [row] = await db.update(alerts).set({ acknowledged: true }).where(eq(alerts.id, id)).returning();
  return row ?? null;
}

export async function registryRuns(): Promise<DbRun[]> {
  return db.select().from(modelRuns).orderBy(desc(modelRuns.createdAt));
}

export async function streamSnapshot(limit = 60) {
  const { run } = await getProduction();
  const events = await db
    .select({
      id: customerEvents.id,
      customerId: customerEvents.customerId,
      name: customers.fullName,
      segment: customers.segment,
      topic: customerEvents.topic,
      eventType: customerEvents.eventType,
      severity: customerEvents.severity,
      payload: customerEvents.payload,
      partition: customerEvents.partition,
      streamOffset: customerEvents.streamOffset,
      lagMs: customerEvents.lagMs,
      scoreBefore: customerEvents.scoreBefore,
      scoreAfter: customerEvents.scoreAfter,
      riskDelta: customerEvents.riskDelta,
      occurredAt: customerEvents.occurredAt,
    })
    .from(customerEvents)
    .innerJoin(customers, eq(customers.id, customerEvents.customerId))
    .where(isNotNull(customerEvents.scoreAfter))
    .orderBy(desc(customerEvents.id))
    .limit(limit);

  const topics = await db
    .select({ topic: customerEvents.topic, count: sql<number>`count(*)::int` })
    .from(customerEvents)
    .where(gt(customerEvents.ingestedAt, sql`now() - interval '6 hours'`))
    .groupBy(customerEvents.topic);

  const [book] = await db
    .select({
      avgRisk: sql<number>`avg(${predictions.probability})::float`,
      critical: sql<number>`count(*) filter (where ${predictions.riskLevel} = 'Critical')::int`,
      high: sql<number>`count(*) filter (where ${predictions.riskLevel} = 'High')::int`,
      revenueAtRisk: sql<number>`coalesce(sum(${predictions.revenueAtRisk}),0)::float`,
    })
    .from(predictions)
    .where(eq(predictions.runId, run.id));

  const latestMetrics = await db
    .select({ metric: pipelineMetrics.metric, value: pipelineMetrics.value, at: pipelineMetrics.recordedAt })
    .from(pipelineMetrics)
    .where(inArray(pipelineMetrics.metric, ["throughput_eps", "consumer_lag", "latency_ms", "avg_risk"]))
    .orderBy(desc(pipelineMetrics.recordedAt))
    .limit(24);

  const openAlerts = await db.select().from(alerts).where(eq(alerts.acknowledged, false)).orderBy(desc(alerts.createdAt)).limit(12);

  return { events, topics, book, latestMetrics, openAlerts, runId: run.id };
}

export type ExecutiveSummary = Awaited<ReturnType<typeof executiveSummary>>;
export type Customer360 = NonNullable<Awaited<ReturnType<typeof customer360>>>;
export type AdhocScore = Awaited<ReturnType<typeof scoreAdhoc>>;
