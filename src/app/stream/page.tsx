import { BootGate } from "@/components/boot";
import { StreamApp } from "@/components/stream";
import { SectionHead, Tag } from "@/components/ui";
import { platformState } from "@/lib/platform";
import { streamSnapshot } from "@/lib/serving";

export const dynamic = "force-dynamic";

export const metadata = { title: "Real-Time Stream · ChurnIQ" };

export default async function StreamPage() {
  const state = await platformState();
  if (!state.bootstrapped) return <BootGate />;

  const snap = await streamSnapshot(40);

  return (
    <div className="space-y-4">
      <SectionHead
        index="07"
        title="Real-Time Stream"
        note="A failed M-PESA debit, a complaint, a usage drop-off — each event mutates the customer's telemetry, refreshes the online feature vector and re-scores the policyholder in the same micro-batch."
        right={
          <>
            <Tag tone="info">{snap.topics.length} topics</Tag>
            <Tag tone="ok">
              <span className="h-1.5 w-1.5 rounded-full bg-mint blink" />
              consumer group healthy
            </Tag>
          </>
        }
      />
      <StreamApp
        initialEvents={snap.events.map((e) => ({ ...e, occurredAt: new Date(e.occurredAt).toISOString() }))}
        initialAlerts={snap.openAlerts.map((a) => ({ ...a, createdAt: new Date(a.createdAt).toISOString() }))}
        initialBook={{
          avgRisk: snap.book?.avgRisk ?? 0,
          critical: snap.book?.critical ?? 0,
          high: snap.book?.high ?? 0,
          revenueAtRisk: snap.book?.revenueAtRisk ?? 0,
        }}
        initialTopics={snap.topics}
        runId={snap.runId}
      />
    </div>
  );
}
