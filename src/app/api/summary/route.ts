import { executiveSummary } from "@/lib/serving";
import { json, requirePlatform } from "@/lib/api";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function GET() {
  const guard = await requirePlatform();
  if (guard.response) return guard.response;
  try {
    return json(await executiveSummary());
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : "summary failed" }, { status: 500 });
  }
}
