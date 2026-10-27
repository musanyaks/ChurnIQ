import { BootGate } from "@/components/boot";
import { ModelActions, RefreshButton } from "@/components/controls";
import { ThresholdLab } from "@/components/thresholdLab";
import { ConfusionMatrix, CurveChart, DecileChart } from "@/components/charts";
import { BarRow, KeyValue, Meter, Panel, SectionHead, StatTile, Tag, Td, Th } from "@/components/ui";
import { platformState } from "@/lib/platform";
import { monitoring } from "@/lib/serving";
import { GROUP_META, type FeatureGroup } from "@/lib/ml/features";
import { formatKes, formatPct } from "@/lib/format";

export const dynamic = "force-dynamic";

export const metadata = { title: "Model Lab · ChurnIQ" };

type Metrics = {
  rocAuc: number;
  prAuc: number;
  precision: number;
  recall: number;
  f1: number;
  accuracy: number;
  specificity: number;
  brier: number;
  logLoss: number;
  ks: number;
  threshold: number;
  liftTopDecile: number;
  captureTopTwoDeciles: number;
  positives: number;
  negatives: number;
  confusion: { tp: number; fp: number; tn: number; fn: number };
  calibration: Array<{ bin: number; predicted: number; observed: number; count: number }>;
  deciles: Array<{ decile: number; churnRate: number; lift: number; capture: number; avgProb: number }>;
  roc: Array<{ fpr: number; tpr: number }>;
  pr: Array<{ recall: number; precision: number }>;
  sweep: Array<{
    t: number;
    accuracy: number;
    precision: number;
    recall: number;
    f1: number;
    flagged: number;
    tp: number;
    fp: number;
    fn: number;
    netValueKes: number;
    recoveredKes: number;
    interventionCostKes: number;
  }>;
  business: {
    savedCustomers: number;
    recoveredKes: number;
    interventionCostKes: number;
    lostPremiumKes: number;
    netValueKes: number;
    baselineLossKes: number;
    valueVsBaselineKes: number;
    roi: number;
  };
};

export default async function ModelsPage() {
  const state = await platformState();
  if (!state.bootstrapped) return <BootGate />;

  const data = await monitoring();
  const m = data.fullMetrics as unknown as Metrics;
  const champion = data.production;
  const hasSweep = Array.isArray(m?.sweep) && m.sweep.length > 0;

  return (
    <div className="space-y-5">
      <SectionHead
        index="06"
        title="Model Lab"
        note="Three model families trained on the same feature matrix, evaluated on a held-out stratified split and ranked on PR-AUC, ROC-AUC and net shilling value — never on accuracy."
        right={
          <>
            <Tag tone="ok">{champion?.algorithm ?? "—"}</Tag>
            <RefreshButton />
          </>
        }
      />

      {/* champion metrics */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        {[
          { label: "ROC-AUC", value: (m?.rocAuc ?? 0).toFixed(4), tone: "#F2A93B", hint: "ranking quality across all thresholds" },
          { label: "PR-AUC", value: (m?.prAuc ?? 0).toFixed(4), tone: "#FF8A3D", hint: "the metric that matters at 20% base rate" },
          { label: "Recall", value: formatPct(m?.recall ?? 0), tone: "#FF4D3D", hint: `${m?.confusion.tp ?? 0} of ${(m?.confusion.tp ?? 0) + (m?.confusion.fn ?? 0)} churners caught` },
          { label: "Precision", value: formatPct(m?.precision ?? 0), tone: "#46B3A5", hint: `${m?.confusion.fp ?? 0} false alarms per cut` },
          { label: "Lift @ top decile", value: `${(m?.liftTopDecile ?? 0).toFixed(2)}x`, tone: "#37D39B", hint: "vs a random targeting policy" },
          { label: "Net business value", value: formatKes(m?.business?.netValueKes ?? 0), tone: "#F2C14E", hint: `ROI ${(m?.business?.roi ?? 0).toFixed(1)}x on intervention spend` },
        ].map((s, i) => (
          <StatTile key={s.label} label={s.label} value={s.value} tone={s.tone} hint={s.hint} delay={i * 55} />
        ))}
      </div>

      {/* registry */}
      <Panel
        eyebrow="model registry"
        title="Registered runs"
        note="MLflow-style registry: every training run stores its artefact, hyper-parameters, metrics and permutation importance. Promote any challenger to production — the whole book is re-scored on the new artefact."
        actions={<ModelActions runs={data.registry} productionId={champion?.id ?? ""} />}
        bodyClass="!p-0"
      >
        <div className="overflow-x-auto">
          <table className="w-full min-w-[980px] border-collapse">
            <thead>
              <tr>
                <Th>Run</Th>
                <Th>Stage</Th>
                <Th align="right">ROC-AUC</Th>
                <Th align="right">PR-AUC</Th>
                <Th align="right">F1</Th>
                <Th align="right">Recall</Th>
                <Th align="right">Precision</Th>
                <Th align="right">Brier</Th>
                <Th align="right">Lift D1</Th>
                <Th align="right">Net value</Th>
                <Th align="right">Train</Th>
              </tr>
            </thead>
            <tbody>
              {data.registry.map((r, i) => (
                <tr key={r.id} className={`table-row rise ${r.stage === "production" ? "bg-[rgba(242,169,59,0.06)]" : ""}`} style={{ animationDelay: `${i * 50}ms` }}>
                  <Td>
                    <span className="block text-[12.5px] font-medium text-ivory">{r.algorithm}</span>
                    <span className="block font-mono text-[10px] text-faint">{r.id}</span>
                  </Td>
                  <Td>
                    {r.stage === "production" ? <Tag tone="signal">production</Tag> : <Tag tone="muted">staging</Tag>}
                    <span className="mt-1 block font-mono text-[9.5px] text-faint">{r.version}</span>
                  </Td>
                  {[
                    { v: r.rocAuc, f: (x: number) => x.toFixed(4), best: Math.max(...data.registry.map((z) => z.rocAuc)) },
                    { v: r.prAuc, f: (x: number) => x.toFixed(4), best: Math.max(...data.registry.map((z) => z.prAuc)) },
                    { v: r.f1, f: (x: number) => x.toFixed(3), best: Math.max(...data.registry.map((z) => z.f1)) },
                    { v: r.recall, f: (x: number) => formatPct(x), best: Math.max(...data.registry.map((z) => z.recall)) },
                    { v: r.precision, f: (x: number) => formatPct(x), best: Math.max(...data.registry.map((z) => z.precision)) },
                    { v: r.brier, f: (x: number) => x.toFixed(4), best: Math.min(...data.registry.map((z) => z.brier)) },
                    { v: r.liftTopDecile, f: (x: number) => `${x.toFixed(2)}x`, best: Math.max(...data.registry.map((z) => z.liftTopDecile)) },
                  ].map((cell, ci) => (
                    <Td key={ci} align="right" className={`numeral ${Math.abs(cell.v - cell.best) < 1e-9 ? "font-bold text-signal" : ""}`}>
                      {cell.f(cell.v)}
                    </Td>
                  ))}
                  <Td align="right" className="numeral font-semibold text-mint">{formatKes(r.netValueKes)}</Td>
                  <Td align="right" className="numeral text-muted">{r.trainingMs}ms</Td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>

      {/* curves */}
      <div className="grid gap-4 xl:grid-cols-3">
        <Panel eyebrow="ranking" title="ROC curve" note={`AUC ${(m?.rocAuc ?? 0).toFixed(4)} · KS ${(m?.ks ?? 0).toFixed(3)}`}>
          <CurveChart points={(m?.roc ?? []).map((r) => ({ x: r.fpr, y: r.tpr }))} color="#F2A93B" xLabel="false positive rate" yLabel="true positive rate" height={220} />
        </Panel>
        <Panel eyebrow="imbalanced view" title="Precision-recall curve" note={`Average precision ${(m?.prAuc ?? 0).toFixed(4)} against a ${formatPct((m?.positives ?? 0) / Math.max(1, (m?.positives ?? 0) + (m?.negatives ?? 0)))} base rate`}>
          <CurveChart points={(m?.pr ?? []).map((p) => ({ x: p.recall, y: p.precision }))} color="#FF8A3D" reference={false} xLabel="recall" yLabel="precision" height={220} />
        </Panel>
        <Panel eyebrow="trust" title="Calibration" note="Predicted probability against realised churn rate per decile of risk.">
          <CurveChart
            points={(m?.calibration ?? []).filter((c) => c.count > 0).map((c) => ({ x: c.predicted, y: c.observed }))}
            color="#46B3A5"
            xLabel="predicted"
            yLabel="observed"
            height={220}
            markers={(m?.calibration ?? []).filter((c) => c.count > 0).slice(-1).map((c) => ({ x: c.predicted, y: c.observed, label: `n=${c.count}`, color: "#46B3A5" }))}
          />
          <div className="mt-2 grid grid-cols-3 gap-2 border-t border-line-soft pt-2">
            <KeyValue k="Brier" v={(m?.brier ?? 0).toFixed(4)} mono />
            <KeyValue k="Log loss" v={(m?.logLoss ?? 0).toFixed(4)} mono />
            <KeyValue k="Specificity" v={formatPct(m?.specificity ?? 0)} mono />
          </div>
        </Panel>
      </div>

      {/* lift + confusion + threshold lab */}
      <div className="grid gap-4 xl:grid-cols-3">
        <Panel eyebrow="targeting power" title="Lift by risk decile" note={`Top two deciles capture ${formatPct(m?.captureTopTwoDeciles ?? 0)} of all churners.`}>
          <DecileChart deciles={m?.deciles ?? []} height={210} />
        </Panel>
        <Panel eyebrow="error economics" title="Confusion matrix" note="Held-out split at the F1-optimal threshold.">
          <ConfusionMatrix c={m?.confusion ?? { tp: 0, fp: 0, tn: 0, fn: 0 }} threshold={m?.threshold ?? 0.5} />
        </Panel>
        <Panel eyebrow="decisioning" title="Threshold & cost lab" note="Drag the operating point and watch precision, recall and shilling value move.">
          {hasSweep ? (
            <ThresholdLab sweep={m.sweep} optimum={m.threshold} />
          ) : (
            <div className="px-2 py-10 text-center text-[12.5px] text-muted">
              This run was trained before the threshold sweep was added to the evaluator.{" "}
              <span className="text-signal">Retrain the suite</span> to populate it.
            </div>
          )}
        </Panel>
      </div>

      {/* importance + business */}
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]">
        <Panel eyebrow="permutation importance" title="What the champion model actually uses" note="PR-AUC drop when each feature is shuffled on the held-out split, normalised to the most important feature.">
          <div className="grid gap-x-6 md:grid-cols-2">
            {(champion?.featureImportance ?? []).map((f, i) => (
              <BarRow
                key={f.feature}
                label={f.feature}
                value={f.importance}
                max={Math.max(...(champion?.featureImportance ?? [{ importance: 1 }]).map((x) => x.importance), 0.001)}
                display={formatPct(f.importance)}
                color={GROUP_META[f.group as FeatureGroup]?.color ?? "#F2A93B"}
                sub={GROUP_META[f.group as FeatureGroup]?.label ?? f.group}
                delay={i * 40}
              />
            ))}
          </div>
          <div className="mt-3 flex flex-wrap gap-2 border-t border-line-soft pt-3">
            {Object.entries(GROUP_META).map(([key, g]) => (
              <span key={key} className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-wider text-muted">
                <span className="h-2 w-2 rounded-[1px]" style={{ background: g.color }} />
                {g.label}
              </span>
            ))}
          </div>
        </Panel>

        <div className="space-y-4">
          <Panel eyebrow="business case" title="Value of the champion at its operating point">
            {[
              { label: "Churners caught", value: `${m?.confusion.tp ?? 0}`, tone: "#37D39B", meter: (m?.confusion.tp ?? 0) / Math.max(1, (m?.confusion.tp ?? 0) + (m?.confusion.fn ?? 0)) },
              { label: "Customers saved by plays", value: (m?.business?.savedCustomers ?? 0).toFixed(0), tone: "#2BB673", meter: (m?.business?.savedCustomers ?? 0) / Math.max(1, m?.confusion.tp ?? 1) },
              { label: "Premium recovered", value: formatKes(m?.business?.recoveredKes ?? 0), tone: "#F2C14E", meter: 0.8 },
              { label: "Intervention spend", value: formatKes(m?.business?.interventionCostKes ?? 0), tone: "#FF8A3D", meter: 0.35 },
              { label: "Premium lost (missed)", value: formatKes(m?.business?.lostPremiumKes ?? 0), tone: "#FF4D3D", meter: (m?.confusion.fn ?? 0) / Math.max(1, (m?.confusion.tp ?? 0) + (m?.confusion.fn ?? 0)) },
            ].map((row, i) => (
              <div key={row.label} className="py-1.5">
                <div className="flex items-baseline justify-between gap-3">
                  <span className="text-[12px] text-muted">{row.label}</span>
                  <span className="numeral text-[14px] font-semibold" style={{ color: row.tone }}>
                    {row.value}
                  </span>
                </div>
                <Meter value={row.meter} color={row.tone} height={4} delay={i * 60} />
              </div>
            ))}
            <div className="mt-3 flex items-baseline justify-between gap-3 border-t border-line-soft pt-3">
              <span className="eyebrow">net value vs do-nothing baseline</span>
              <span className="numeral text-[22px] font-bold text-mint">{formatKes(m?.business?.valueVsBaselineKes ?? 0)}</span>
            </div>
          </Panel>

          <Panel eyebrow="run metadata" title={`${champion?.algorithm ?? "—"}`}>
            <KeyValue k="Run id" v={<span className="font-mono text-[11px]">{champion?.id}</span>} />
            <KeyValue k="Version" v={champion?.version ?? "—"} mono />
            <KeyValue k="Dataset hash" v={<span className="font-mono text-[11px]">{champion?.datasetHash ?? "—"}</span>} />
            <KeyValue k="Train / test rows" v={`${champion?.trainRows ?? 0} / ${champion?.testRows ?? 0}`} mono />
            <KeyValue k="Training time" v={`${champion?.trainingMs ?? 0} ms`} mono />
            <KeyValue k="Registered" v={champion?.createdAt ? new Date(champion.createdAt).toLocaleString("en-GB") : "—"} mono />
            <KeyValue k="Promoted" v={champion?.promotedAt ? new Date(champion.promotedAt).toLocaleString("en-GB") : "—"} mono />
            <div className="mt-3 border-t border-line-soft pt-2 text-[11.5px] leading-relaxed text-muted">
              Artefacts are serialised into the registry (histogram bins, tree ensemble, scaler) so any run can be rehydrated and
              served without retraining — the same contract a production MLflow store provides.
            </div>
          </Panel>
        </div>
      </div>
    </div>
  );
}
