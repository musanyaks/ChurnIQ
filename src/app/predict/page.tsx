import { BootGate } from "@/components/boot";
import { PredictApp } from "@/components/predict";
import { SectionHead, Tag } from "@/components/ui";
import { platformState, getProduction } from "@/lib/platform";

export const dynamic = "force-dynamic";

export const metadata = { title: "Churn Prediction · ChurnIQ" };

export default async function PredictPage() {
  const state = await platformState();
  if (!state.bootstrapped) return <BootGate />;
  const { run } = await getProduction();

  return (
    <div className="space-y-4">
      <SectionHead
        index="03"
        title="Churn Prediction"
        note="Score a single profile or a whole CRM extract against the registered champion model. Every prediction returns a probability, a SHAP-style explanation and a costed retention play."
        right={
          <>
            <Tag tone="signal">{run.algorithm}</Tag>
            <span className="hidden font-mono text-[10px] uppercase tracking-wider text-faint md:inline">{run.id}</span>
          </>
        }
      />
      <PredictApp />
    </div>
  );
}
