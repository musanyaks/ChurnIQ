import { desc, eq, sql } from "drizzle-orm";
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

export const dynamic = "force-dynamic";

/** Prometheus text exposition format — scrape target for the monitoring stack. */
export async function GET() {
  const [kpi] = await db
    .select({
      customers: sql<number>`(select count(*)::int from ${customers})`,
      churned: sql<number>`(select count(*)::int from ${customers} where ${customers.churn} = 1)`,
      events: sql<number>`(select count(*)::int from ${customerEvents})`,
      features: sql<number>`(select count(*)::int from ${featureStore})`,
      runs: sql<number>`(select count(*)::int from ${modelRuns})`,
      scored: sql<number>`(select count(*)::int from ${predictions})`,
      plays: sql<number>`(select count(*)::int from ${retentionActions})`,
      openAlerts: sql<number>`(select count(*)::int from ${alerts} where ${alerts.acknowledged} = false)`,
    })
    .from(customers)
    .limit(1);

  const prod = await db
    .select({ id: modelRuns.id, algorithm: modelRuns.algorithm })
    .from(modelRuns)
    .where(eq(modelRuns.stage, "production"))
    .limit(1);

  const risk = await db
    .select({
      level: predictions.riskLevel,
      count: sql<number>`count(*)::int`,
      exposure: sql<number>`coalesce(sum(${predictions.revenueAtRisk}),0)::float`,
    })
    .from(predictions)
    .where(eq(predictions.runId, prod[0]?.id ?? ""))
    .groupBy(predictions.riskLevel);

  const latest = await db
    .selectDistinctOn([pipelineMetrics.metric], { name: pipelineMetrics.metric, value: pipelineMetrics.value })
    .from(pipelineMetrics)
    .orderBy(pipelineMetrics.metric, desc(pipelineMetrics.recordedAt))
    .limit(24);

  const lines: string[] = [
    "# HELP churniq_up Platform availability",
    "# TYPE churniq_up gauge",
    "churniq_up 1",
    "# HELP churniq_customers_total Policyholders in the scored book",
    "# TYPE churniq_customers_total gauge",
    `churniq_customers_total ${kpi?.customers ?? 0}`,
    "# HELP churniq_customers_churned_total Observed non-renewals in the label window",
    "# TYPE churniq_customers_churned_total gauge",
    `churniq_customers_churned_total ${kpi?.churned ?? 0}`,
    "# HELP churniq_stream_events_total Events consumed from all Kafka topics",
    "# TYPE churniq_stream_events_total counter",
    `churniq_stream_events_total ${kpi?.events ?? 0}`,
    "# HELP churniq_feature_store_entities Entities with a materialised online vector",
    "# TYPE churniq_feature_store_entities gauge",
    `churniq_feature_store_entities ${kpi?.features ?? 0}`,
    "# HELP churniq_model_runs_total Registered model runs",
    "# TYPE churniq_model_runs_total gauge",
    `churniq_model_runs_total ${kpi?.runs ?? 0}`,
    "# HELP churniq_predictions_total Stored customer scores",
    "# TYPE churniq_predictions_total counter",
    `churniq_predictions_total ${kpi?.scored ?? 0}`,
    "# HELP churniq_retention_plays_total Generated retention plays",
    "# TYPE churniq_retention_plays_total gauge",
    `churniq_retention_plays_total ${kpi?.plays ?? 0}`,
    "# HELP churniq_alerts_open Open alerts on the bus",
    "# TYPE churniq_alerts_open gauge",
    `churniq_alerts_open ${kpi?.openAlerts ?? 0}`,
    "# HELP churniq_production_model Current champion model (1 = production)",
    "# TYPE churniq_production_model gauge",
    `churniq_production_model{run="${prod[0]?.id ?? "none"}",algorithm="${prod[0]?.algorithm ?? "none"}"} 1`,
    "# HELP churniq_risk_band_customers Customers per predicted risk band",
    "# TYPE churniq_risk_band_customers gauge",
    ...risk.map((r) => `churniq_risk_band_customers{level="${r.level}"} ${r.count}`),
    "# HELP churniq_revenue_at_risk_kenyan_shillings Expected exposure per risk band",
    "# TYPE churniq_revenue_at_risk_kenyan_shillings gauge",
    ...risk.map((r) => `churniq_revenue_at_risk_kenyan_shillings{level="${r.level}"} ${Math.round(r.exposure)}`),
    "# HELP churniq_pipeline_metric Latest pipeline telemetry sample",
    "# TYPE churniq_pipeline_metric gauge",
    ...latest.map((l) => `churniq_pipeline_metric{name="${l.name}"} ${Number(l.value).toFixed(4)}`),
  ];

  return new Response(lines.join("\n") + "\n", {
    headers: { "content-type": "text/plain; version=0.0.4", "cache-control": "no-store" },
  });
}
