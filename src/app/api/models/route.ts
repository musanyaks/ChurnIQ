import { db } from "@/db";
import { customers, modelRuns } from "@/db/schema";
import { hashDataset, trainSuite } from "@/lib/ml/pipeline";
import { buildMatrix } from "@/lib/ml/features";
import { featureBaseline, promoteRun } from "@/lib/platform";
import { monitoring } from "@/lib/serving";
import { fail, json, requirePlatform } from "@/lib/api";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET() {
  const guard = await requirePlatform();
  if (guard.response) return guard.response;
  try {
    const data = await monitoring();
    return json({ registry: data.registry, production: data.production });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : "registry read failed" }, { status: 500 });
  }
}

export async function POST(req: Request) {
  const guard = await requirePlatform();
  if (guard.response) return guard.response;
  const body = (await req.json().catch(() => ({}))) as { action?: string; runId?: string };

  try {
    if (body.action === "promote") {
      if (!body.runId) return fail("runId is required");
      const result = await promoteRun(body.runId);
      return json({ promoted: result });
    }

    if (body.action === "retrain") {
      const rows = await db.select().from(customers);
      if (!rows.length) return fail("no training data available");
      const seed = Math.floor(Math.random() * 99991) + 1;
      const suite = trainSuite(rows, seed);
      const baseline = featureBaseline(buildMatrix(rows));
      const suffix = Date.now().toString(36).slice(-4);
      const stamp = new Date();
      await db.insert(modelRuns).values(
        suite.runs.map((r) => ({
          id: `${r.id}-${suffix}`,
          algorithm: r.algorithm,
          version: `${r.version}.r${suffix}`,
          status: "candidate",
          stage: "staging",
          metrics: { ...(r.metrics as unknown as Record<string, unknown>), baseline },
          params: r.params,
          featureImportance: r.featureImportance,
          artifact: r.artifact as unknown as Record<string, unknown>,
          trainRows: r.trainRows,
          testRows: r.testRows,
          trainingMs: r.trainingMs,
          datasetHash: hashDataset(rows),
          createdAt: stamp,
          promotedAt: null,
        })),
      );
      const championId = `${suite.productionRunId}-${suffix}`;
      const promoted = await promoteRun(championId);
      return json({
        retrained: true,
        seed,
        runs: suite.runs.map((r) => ({
          id: `${r.id}-${suffix}`,
          algorithm: r.algorithm,
          prAuc: r.metrics.prAuc,
          rocAuc: r.metrics.rocAuc,
          f1: r.metrics.f1,
          recall: r.metrics.recall,
          trainingMs: r.trainingMs,
        })),
        selection: suite.selection,
        promoted,
      });
    }

    return fail(`unknown action: ${body.action ?? "(none)"}`);
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : "registry action failed" }, { status: 500 });
  }
}
