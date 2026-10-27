import { customer360 } from "@/lib/serving";
import { json, requirePlatform } from "@/lib/api";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const guard = await requirePlatform();
  if (guard.response) return guard.response;
  const { id } = await ctx.params;
  try {
    const data = await customer360(id);
    if (!data) return json({ error: `customer ${id} not found` }, { status: 404 });
    return json(data);
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : "lookup failed" }, { status: 500 });
  }
}
