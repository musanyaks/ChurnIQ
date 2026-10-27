import { db } from "@/db";
import { sql } from "drizzle-orm";
import { monitoring } from "@/lib/serving";
import { json, requirePlatform } from "@/lib/api";
import { bootstrap, driftReport } from "@/lib/platform";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET() {
  const guard = await requirePlatform();
  if (guard.response) return guard.response;
  try {
    const [base, drift, dbSize] = await Promise.all([
      monitoring(),
      driftReport(900),
      db.execute(sql`select pg_size_pretty(pg_database_size(current_database())) as size`).then((r) => {
        const rows = r as unknown as Array<{ size: string }>;
        return rows[0]?.size ?? "—";
      }),
    ]);
    return json({ ...base, drift, databaseSize: dbSize });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : "monitoring failed" }, { status: 500 });
  }
}

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { action?: string };
  if (body.action !== "reset") return json({ error: `unknown action ${body.action ?? "(none)"}` }, { status: 400 });
  try {
    const report = await bootstrap(true);
    return json({ report });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : "reset failed" }, { status: 500 });
  }
}
