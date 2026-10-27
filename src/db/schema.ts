import {
  boolean,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgTable,
  real,
  serial,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

/**
 * ChurnIQ — schema for the churn intelligence platform.
 *
 * Layers mirrored from the reference architecture:
 *   ingestion (Kafka topics)      -> customerEvents
 *   data engineering (Postgres)   -> customers
 *   feature store (online/offline)-> featureStore
 *   model registry (MLflow-like)  -> modelRuns
 *   batch + real-time scoring     -> predictions
 *   decisioning                   -> retentionActions
 *   observability                 -> alerts, pipelineMetrics
 */

export const customers = pgTable(
  "customers",
  {
    id: text("id").primaryKey(),
    fullName: text("full_name").notNull(),
    email: text("email").notNull(),
    phone: text("phone").notNull(),
    county: text("county").notNull(),
    city: text("city").notNull(),
    segment: text("segment").notNull(),
    productLine: text("product_line").notNull(),
    channel: text("channel").notNull(),
    contractType: text("contract_type").notNull(),
    planTier: text("plan_tier").notNull(),
    status: text("status").notNull(),
    gender: text("gender").notNull(),
    age: integer("age").notNull(),
    tenureMonths: integer("tenure_months").notNull(),
    policiesHeld: integer("policies_held").notNull(),
    premiumMonthly: real("premium_monthly").notNull(),
    lifetimePremium: real("lifetime_premium").notNull(),
    paymentFailures: integer("payment_failures").notNull(),
    latePaymentDays: integer("late_payment_days").notNull(),
    supportTickets: integer("support_tickets").notNull(),
    complaints: integer("complaints").notNull(),
    claimsCount: integer("claims_count").notNull(),
    claimSettlementDays: real("claim_settlement_days").notNull(),
    lastLoginDays: integer("last_login_days").notNull(),
    loginFrequency: integer("login_frequency").notNull(),
    usageFrequency: real("usage_frequency").notNull(),
    mpesaActivity: real("mpesa_activity").notNull(),
    satisfactionScore: real("satisfaction_score").notNull(),
    npsScore: integer("nps_score").notNull(),
    discountPct: real("discount_pct").notNull(),
    premiumIncreasePct: real("premium_increase_pct").notNull(),
    agentEngagement: real("agent_engagement").notNull(),
    renewalDueInDays: integer("renewal_due_in_days").notNull(),
    churn: integer("churn").notNull(),
    onboardedAt: timestamp("onboarded_at").notNull(),
    updatedAt: timestamp("updated_at").notNull(),
  },
  (t) => [
    index("customers_segment_idx").on(t.segment),
    index("customers_county_idx").on(t.county),
    index("customers_churn_idx").on(t.churn),
    index("customers_product_idx").on(t.productLine),
  ],
);

/** Kafka-style append-only event log across five topics. */
export const customerEvents = pgTable(
  "customer_events",
  {
    id: serial("id").primaryKey(),
    customerId: text("customer_id").notNull(),
    topic: text("topic").notNull(),
    eventType: text("event_type").notNull(),
    severity: text("severity").notNull(),
    payload: jsonb("payload").notNull().$type<Record<string, unknown>>(),
    partition: integer("partition").notNull(),
    streamOffset: integer("stream_offset").notNull(),
    lagMs: integer("lag_ms").notNull(),
    scoreBefore: real("score_before"),
    scoreAfter: real("score_after"),
    riskDelta: real("risk_delta"),
    processed: boolean("processed").notNull().default(false),
    occurredAt: timestamp("occurred_at").notNull(),
    ingestedAt: timestamp("ingested_at").notNull(),
  },
  (t) => [
    index("events_customer_idx").on(t.customerId),
    index("events_topic_idx").on(t.topic),
    index("events_ingested_idx").on(t.ingestedAt),
  ],
);

/** Online feature store: materialised, versioned feature vectors. */
export const featureStore = pgTable("feature_store", {
  customerId: text("customer_id").primaryKey(),
  version: integer("version").notNull(),
  vector: jsonb("vector").notNull().$type<number[]>(),
  groupTotals: jsonb("group_totals").notNull().$type<Record<string, number>>(),
  computedAt: timestamp("computed_at").notNull(),
});

/** MLflow-style model registry. `artifact` holds the serialised model. */
export const modelRuns = pgTable(
  "model_runs",
  {
    id: text("id").primaryKey(),
    algorithm: text("algorithm").notNull(),
    version: text("version").notNull(),
    status: text("status").notNull(),
    stage: text("stage").notNull(),
    metrics: jsonb("metrics").notNull().$type<Record<string, unknown>>(),
    params: jsonb("params").notNull().$type<Record<string, unknown>>(),
    featureImportance: jsonb("feature_importance").notNull().$type<
      Array<{ feature: string; group: string; importance: number }>
    >(),
    artifact: jsonb("artifact").notNull().$type<Record<string, unknown>>(),
    trainRows: integer("train_rows").notNull(),
    testRows: integer("test_rows").notNull(),
    trainingMs: integer("training_ms").notNull(),
    datasetHash: text("dataset_hash").notNull(),
    createdAt: timestamp("created_at").notNull(),
    promotedAt: timestamp("promoted_at"),
  },
  (t) => [index("model_runs_algo_idx").on(t.algorithm)],
);

export const predictions = pgTable(
  "predictions",
  {
    id: serial("id").primaryKey(),
    customerId: text("customer_id").notNull(),
    runId: text("run_id").notNull(),
    probability: real("probability").notNull(),
    riskLevel: text("risk_level").notNull(),
    revenueAtRisk: real("revenue_at_risk").notNull(),
    priorityScore: real("priority_score").notNull(),
    drivers: jsonb("drivers").notNull().$type<
      Array<{ label: string; group: string; impact: number; raw: number }>
    >(),
    latencyMs: integer("latency_ms").notNull(),
    scoredAt: timestamp("scored_at").notNull(),
  },
  (t) => [
    uniqueIndex("predictions_customer_run_uidx").on(t.customerId, t.runId),
    index("predictions_risk_idx").on(t.riskLevel),
    index("predictions_prob_idx").on(t.probability),
  ],
);

export const retentionActions = pgTable(
  "retention_actions",
  {
    id: serial("id").primaryKey(),
    customerId: text("customer_id").notNull(),
    runId: text("run_id").notNull(),
    play: text("play").notNull(),
    rationale: text("rationale").notNull(),
    owner: text("owner").notNull(),
    priority: text("priority").notNull(),
    status: text("status").notNull(),
    probability: real("probability").notNull(),
    annualValue: real("annual_value").notNull(),
    playCostKes: real("play_cost_kes").notNull(),
    expectedSaveKes: real("expected_save_kes").notNull(),
    roi: real("roi").notNull(),
    createdAt: timestamp("created_at").notNull(),
    updatedAt: timestamp("updated_at").notNull(),
  },
  (t) => [
    uniqueIndex("retention_customer_run_uidx").on(t.customerId, t.runId),
    index("retention_status_idx").on(t.status),
  ],
);

export const alerts = pgTable(
  "alerts",
  {
    id: serial("id").primaryKey(),
    severity: text("severity").notNull(),
    source: text("source").notNull(),
    title: text("title").notNull(),
    body: text("body").notNull(),
    customerId: text("customer_id"),
    acknowledged: boolean("acknowledged").notNull().default(false),
    createdAt: timestamp("created_at").notNull(),
  },
  (t) => [index("alerts_created_idx").on(t.createdAt)],
);

/** Prometheus-style telemetry samples emitted by every pipeline stage. */
export const pipelineMetrics = pgTable(
  "pipeline_metrics",
  {
    id: serial("id").primaryKey(),
    stage: text("stage").notNull(),
    metric: text("metric").notNull(),
    label: text("label").notNull(),
    value: doublePrecision("value").notNull(),
    recordedAt: timestamp("recorded_at").notNull(),
  },
  (t) => [index("metrics_stage_idx").on(t.stage, t.metric)],
);
