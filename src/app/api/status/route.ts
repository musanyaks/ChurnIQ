import { desc, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { alerts, customerEvents, modelRuns, predictions } from "@/db/schema";
import { json } from "@/lib/api";
import { platformState } from "@/lib/platform";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const state = await platformState();
    if (!state.bootstrapped) return json({ ok: true, bootstrapped: false });

    const run = await db.select({ id: modelRuns.id, algorithm: modelRuns.algorithm }).from(modelRuns).where(eq(modelRuns.stage, "production")).limit(1);
    const [book] = await db
      .select({ avgRisk: sql<number>`avg(${predictions.probability})::float` })
      .from(predictions)
      .where(eq(predictions.runId, run[0]?.id ?? ""));
    const [alertAgg] = await db
      .select({
        open: sql<number>`count(*) filter (where ${alerts.acknowledged} = false)::int`,
        critical: sql<number>`count(*) filter (where ${alerts.acknowledged} = false and ${alerts.severity} = 'critical')::int`,
      })
      .from(alerts);
    const [latestAlert] = await db.select().from(alerts).orderBy(desc(alerts.createdAt)).limit(1);
    const [events] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(customerEvents)
      .where(sql`${customerEvents.ingestedAt} > now() - interval '10 minutes'`);

    return json({
      ok: true,
      bootstrapped: true,
      customers: state.customers,
      events: state.events,
      production: run[0]?.id ?? null,
      algorithm: run[0]?.algorithm ?? null,
      bookAvgRisk: book?.avgRisk ?? 0,
      openAlerts: alertAgg?.open ?? 0,
      criticalAlerts: alertAgg?.critical ?? 0,
      eventsLast10m: events?.count ?? 0,
      latestAlert: latestAlert
        ? { id: latestAlert.id, severity: latestAlert.severity, title: latestAlert.title, body: latestAlert.body, customerId: latestAlert.customerId }
        : null,
    });
  } catch (e) {
    return json({ ok: false, error: e instanceof Error ? e.message : "unavailable" }, { status: 500 });
  }
}
