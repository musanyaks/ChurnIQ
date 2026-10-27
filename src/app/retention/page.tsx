import { BootGate } from "@/components/boot";
import { RetentionApp } from "@/components/retention";
import { RefreshButton } from "@/components/controls";
import { Meter, Panel, SectionHead, StatTile, Tag } from "@/components/ui";
import { platformState } from "@/lib/platform";
import { retentionQueue } from "@/lib/serving";
import { formatKes, formatPct } from "@/lib/format";
import type { RetentionRow } from "@/lib/dto";

export const dynamic = "force-dynamic";

export const metadata = { title: "Retention Center · ChurnIQ" };

export default async function RetentionPage() {
  const state = await platformState();
  if (!state.bootstrapped) return <BootGate />;

  const queue = await retentionQueue({ page: 1, pageSize: 30, sort: "probability" });
  const rows: RetentionRow[] = queue.rows.map((r) => ({ ...r, updatedAt: new Date(r.updatedAt).toISOString() }));

  const byPriority = (p: string) => queue.summary.filter((s) => s.priority === p).reduce((sum, s) => sum + s.count, 0);
  const byStatus = (s: string) => queue.summary.filter((x) => x.status === s).reduce((sum, x) => sum + x.count, 0);
  const totalExpected = queue.summary.reduce((s, x) => s + x.expected, 0);
  const totalCost = queue.summary.reduce((s, x) => s + x.cost, 0);
  const exposure = queue.summary.reduce((s, x) => s + x.value, 0);

  const priorities = [
    { key: "Critical", color: "#FF4D3D", note: "intervene within 24 hours" },
    { key: "High", color: "#FF8A3D", note: "intervene within 72 hours" },
    { key: "Medium", color: "#F2C14E", note: "monitor + soft touch" },
    { key: "Low", color: "#2BB673", note: "lifecycle nurture only" },
  ];

  return (
    <div className="space-y-5">
      <SectionHead
        index="05"
        title="Retention Center"
        note="Priority = churn probability × customer value. Every queued row carries the play the model's leading driver implies, the team that owns it, and the shilling value of running it."
        right={<RefreshButton />}
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {priorities.map((p, i) => (
          <StatTile
            key={p.key}
            label={`${p.key} priority`}
            value={byPriority(p.key).toLocaleString()}
            tone={p.color}
            delay={i * 60}
            hint={p.note}
          >
            <Meter value={byPriority(p.key) / Math.max(1, queue.total)} color={p.color} />
          </StatTile>
        ))}
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatTile label="Plays generated" value={queue.total.toLocaleString()} tone="#F4F1E8" hint={`${byStatus("queued")} queued · ${byStatus("backlog")} in backlog`} />
          <StatTile label="Expected save" value={formatKes(totalExpected)} tone="#37D39B" hint="probability × annual premium × play save-rate − cost" />
          <StatTile label="Delivery cost" value={formatKes(totalCost)} tone="#FF8A3D" hint={`${byStatus("contacted")} contacted · ${byStatus("saved")} saved · ${byStatus("lost")} lost`} />
          <StatTile label="Portfolio ROI" value={`${(totalExpected / Math.max(1, totalCost)).toFixed(1)}x`} tone="#F2C14E" accent hint={`${formatKes(exposure)} of probability-weighted premium defended`} />
        </div>

        <Panel eyebrow="coverage" title="Book exposure defended" note="Share of the probability-weighted premium the queued plays address.">
          <div className="space-y-2.5">
            {priorities.map((p, i) => {
              const value = queue.summary.filter((s) => s.priority === p.key).reduce((sum, s) => sum + s.value, 0);
              return (
                <div key={p.key}>
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="text-[12px] text-ivory-dim">{p.key}</span>
                    <span className="numeral text-[12.5px] font-semibold" style={{ color: p.color }}>
                      {formatKes(value)}
                    </span>
                  </div>
                  <Meter value={value / Math.max(1, exposure)} color={p.color} height={5} delay={i * 70} />
                </div>
              );
            })}
            <div className="border-t border-line-soft pt-2 text-[11px] leading-relaxed text-muted">
              Recoverable share {formatPct(0.82, 0)} of annual premium · average intervention {formatKes(1450, { compact: false })}
            </div>
          </div>
        </Panel>
      </div>

      <Panel eyebrow="play library" title="Driver → action mapping" note="Each retention play is triggered by the dominant SHAP driver group for that customer, so the outreach message matches the reason they are leaving.">
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {queue.playbook.map((p, i) => (
            <article key={p.group} className="panel-flat panel-hover rise px-3.5 py-3" style={{ animationDelay: `${i * 55}ms`, borderTop: `2px solid ${p.color}` }}>
              <div className="flex items-start justify-between gap-2">
                <h3 className="font-display text-[13.5px] font-semibold leading-snug text-ivory">{p.play}</h3>
                <Tag tone="signal">{formatKes(p.costKes, { compact: false })}</Tag>
              </div>
              <p className="mt-1.5 text-[11.5px] leading-relaxed text-muted">{p.rationale}</p>
              <div className="mt-2.5 flex flex-wrap items-center justify-between gap-2 border-t border-line-soft pt-2 font-mono text-[10px] uppercase tracking-wider">
                <span className="text-faint">{p.owner}</span>
                <span style={{ color: p.color }}>save-rate {formatPct(p.saveRate, 0)}</span>
              </div>
              <div className="mt-1.5 flex items-center gap-2">
                <span className="h-1.5 w-1.5 rounded-full" style={{ background: p.color }} />
                <span className="truncate text-[10.5px] text-faint">triggered by: {p.label.toLowerCase()}</span>
              </div>
            </article>
          ))}
        </div>
      </Panel>

      <RetentionApp initial={{ rows, total: queue.total, pages: queue.pages }} />
    </div>
  );
}
