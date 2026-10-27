import { ingestStream } from "@/lib/platform";
import { streamSnapshot } from "@/lib/serving";
import { fail, json, numParam, requirePlatform } from "@/lib/api";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function GET(req: Request) {
  const guard = await requirePlatform();
  if (guard.response) return guard.response;
  const url = new URL(req.url);
  try {
    return json(await streamSnapshot(numParam(url, "limit", 60)));
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : "stream read failed" }, { status: 500 });
  }
}

export async function POST(req: Request) {
  const guard = await requirePlatform();
  if (guard.response) return guard.response;
  const body = (await req.json().catch(() => ({}))) as { count?: number };
  const count = Math.max(1, Math.min(60, body.count ?? 12));
  try {
    const tick = await ingestStream(count);
    return json(tick);
  } catch (e) {
    return fail(e instanceof Error ? e.message : "ingest failed", 500);
  }
}
