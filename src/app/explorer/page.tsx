import { BootGate } from "@/components/boot";
import { ExplorerApp } from "@/components/explorer";
import { SectionHead } from "@/components/ui";
import { filterOptions, listCustomers } from "@/lib/serving";
import { platformState } from "@/lib/platform";

export const dynamic = "force-dynamic";

export const metadata = { title: "Customer Explorer · ChurnIQ" };

export default async function ExplorerPage() {
  const state = await platformState();
  if (!state.bootstrapped) return <BootGate />;

  const [list, options] = await Promise.all([
    listCustomers({ pageSize: 25, sort: "probability", dir: "desc", page: 1 }),
    filterOptions(),
  ]);

  const initial = {
    ...list,
    rows: list.rows.map((r) => ({ ...r, scoredAt: new Date(r.scoredAt).toISOString() })),
  };

  return (
    <div className="space-y-4">
      <SectionHead
        index="02"
        title="Customer Explorer"
        note="Every scored policyholder in the book. Filter by segment, product, county, billing cadence or risk band, sort by any business dimension, and drill into a Customer 360."
      />
      <ExplorerApp initial={initial} options={options} />
    </div>
  );
}
