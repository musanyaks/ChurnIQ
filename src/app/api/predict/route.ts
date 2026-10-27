import { scoreAdhoc, scoreCsv } from "@/lib/serving";
import { fail, json, requirePlatform } from "@/lib/api";
import type { CustomerRow } from "@/lib/synthesize";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

type Body =
  | { mode: "form"; input: Partial<CustomerRow> }
  | { mode: "csv"; text: string };

export async function POST(req: Request) {
  const guard = await requirePlatform();
  if (guard.response) return guard.response;
  try {
    const body = (await req.json()) as Body;
    if (body.mode === "csv") {
      if (!body.text || body.text.trim().length === 0) return fail("CSV payload is empty");
      const result = await scoreCsv(body.text);
      return json(result);
    }
    const result = await scoreAdhoc(body.input ?? {});
    return json(result);
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : "scoring failed" }, { status: 500 });
  }
}
