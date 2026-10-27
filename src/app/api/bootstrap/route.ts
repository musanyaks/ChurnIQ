import { bootstrap } from "@/lib/platform";
import { fail, json } from "@/lib/api";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => ({}))) as { force?: boolean };
    const report = await bootstrap(Boolean(body.force));
    return json({ report });
  } catch (e) {
    return fail(e instanceof Error ? e.message : "bootstrap failed", 500);
  }
}
