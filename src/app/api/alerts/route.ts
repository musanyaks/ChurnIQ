import { acknowledgeAlert, recentAlerts } from "@/lib/serving";
import { fail, json, numParam, requirePlatform } from "@/lib/api";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const guard = await requirePlatform();
  if (guard.response) return guard.response;
  const url = new URL(req.url);
  try {
    const rows = await recentAlerts(numParam(url, "limit", 40), url.searchParams.get("open") === "true");
    return json({ alerts: rows });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : "alerts read failed" }, { status: 500 });
  }
}

export async function PATCH(req: Request) {
  const guard = await requirePlatform();
  if (guard.response) return guard.response;
  const body = (await req.json().catch(() => ({}))) as { id?: number };
  if (!body.id) return fail("alert id is required");
  try {
    return json({ alert: await acknowledgeAlert(body.id) });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : "ack failed" }, { status: 500 });
  }
}
