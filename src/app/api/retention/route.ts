import { retentionQueue, setActionStatus } from "@/lib/serving";
import { fail, json, numParam, requirePlatform, strParam } from "@/lib/api";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const guard = await requirePlatform();
  if (guard.response) return guard.response;
  const url = new URL(req.url);
  try {
    return json(
      await retentionQueue({
        priority: strParam(url, "priority"),
        status: strParam(url, "status"),
        q: strParam(url, "q"),
        sort: strParam(url, "sort") ?? "probability",
        page: numParam(url, "page", 1),
        pageSize: numParam(url, "pageSize", 30),
      }),
    );
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : "queue read failed" }, { status: 500 });
  }
}

export async function PATCH(req: Request) {
  const guard = await requirePlatform();
  if (guard.response) return guard.response;
  const body = (await req.json().catch(() => ({}))) as { actionId?: number; status?: string; note?: string };
  if (!body.actionId || !body.status) return fail("actionId and status are required");
  try {
    const updated = await setActionStatus(body.actionId, body.status, body.note);
    if (!updated) return json({ error: "action not found" }, { status: 404 });
    return json({ updated });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : "update failed" }, { status: 500 });
  }
}
