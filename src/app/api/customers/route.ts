import { filterOptions, listCustomers, type CustomerFilters } from "@/lib/serving";
import { json, numParam, requirePlatform, strParam } from "@/lib/api";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const guard = await requirePlatform();
  if (guard.response) return guard.response;
  const url = new URL(req.url);
  const sort = (strParam(url, "sort") ?? "probability") as CustomerFilters["sort"];
  const dir = (strParam(url, "dir") ?? "desc") as "asc" | "desc";
  const churnedRaw = strParam(url, "churned");
  try {
    const [result, options] = await Promise.all([
      listCustomers({
        q: strParam(url, "q"),
        segment: strParam(url, "segment"),
        productLine: strParam(url, "productLine"),
        county: strParam(url, "county"),
        riskLevel: strParam(url, "riskLevel"),
        contractType: strParam(url, "contractType"),
        status: strParam(url, "status"),
        churned: churnedRaw === "yes" || churnedRaw === "no" ? churnedRaw : undefined,
        sort,
        dir,
        page: numParam(url, "page", 1),
        pageSize: numParam(url, "pageSize", 25),
      }),
      filterOptions(),
    ]);
    return json({ ...result, options });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : "query failed" }, { status: 500 });
  }
}
