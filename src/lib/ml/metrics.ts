/**
 * Evaluation toolkit. For an imbalanced churn problem accuracy is meaningless,
 * so the platform ranks models on PR-AUC / ROC-AUC / recall / lift and on a
 * business cost function expressed in Kenyan shillings.
 */

export type Confusion = { tp: number; fp: number; tn: number; fn: number };

export function confusion(y: number[], p: number[], threshold: number): Confusion {
  let tp = 0;
  let fp = 0;
  let tn = 0;
  let fn = 0;
  for (let i = 0; i < y.length; i += 1) {
    const pred = p[i] >= threshold ? 1 : 0;
    if (pred === 1 && y[i] === 1) tp += 1;
    else if (pred === 1 && y[i] === 0) fp += 1;
    else if (pred === 0 && y[i] === 0) tn += 1;
    else fn += 1;
  }
  return { tp, fp, tn, fn };
}

export function prf(c: Confusion) {
  const precision = c.tp / Math.max(1, c.tp + c.fp);
  const recall = c.tp / Math.max(1, c.tp + c.fn);
  const f1 = (2 * precision * recall) / Math.max(1e-9, precision + recall);
  const accuracy = (c.tp + c.tn) / Math.max(1, c.tp + c.fp + c.tn + c.fn);
  const specificity = c.tn / Math.max(1, c.tn + c.fp);
  return { precision, recall, f1, accuracy, specificity };
}

/** Rank-based ROC-AUC (handles ties with average ranks). */
export function rocAuc(y: number[], p: number[]): number {
  const n = y.length;
  const order = Array.from({ length: n }, (_, i) => i).sort((a, b) => p[a] - p[b]);
  let rankSum = 0;
  let positives = 0;
  let i = 0;
  while (i < n) {
    let j = i;
    while (j + 1 < n && p[order[j + 1]] === p[order[i]]) j += 1;
    const avgRank = (i + j) / 2 + 1;
    for (let k = i; k <= j; k += 1) {
      if (y[order[k]] === 1) {
        rankSum += avgRank;
        positives += 1;
      }
    }
    i = j + 1;
  }
  if (positives === 0 || positives === n) return 0.5;
  return (rankSum - (positives * (positives + 1)) / 2) / (positives * (n - positives));
}

/** Average precision (area under precision-recall curve). */
export function prAuc(y: number[], p: number[]): number {
  const order = Array.from({ length: y.length }, (_, i) => i).sort((a, b) => p[b] - p[a]);
  let tp = 0;
  let fp = 0;
  let ap = 0;
  let prevRecall = 0;
  const totalPos = y.reduce((s, v) => s + v, 0) || 1;
  for (let k = 0; k < order.length; k += 1) {
    const idx = order[k];
    if (y[idx] === 1) tp += 1;
    else fp += 1;
    const precision = tp / (tp + fp);
    const recall = tp / totalPos;
    ap += precision * (recall - prevRecall);
    prevRecall = recall;
  }
  return ap;
}

export function rocCurve(y: number[], p: number[], maxPoints = 90): Array<{ fpr: number; tpr: number }> {
  const order = Array.from({ length: y.length }, (_, i) => i).sort((a, b) => p[b] - p[a]);
  const P = y.reduce((s, v) => s + v, 0) || 1;
  const N = y.length - P || 1;
  let tp = 0;
  let fp = 0;
  const pts: Array<{ fpr: number; tpr: number }> = [{ fpr: 0, tpr: 0 }];
  const step = Math.max(1, Math.floor(order.length / maxPoints));
  for (let k = 0; k < order.length; k += 1) {
    if (y[order[k]] === 1) tp += 1;
    else fp += 1;
    if (k % step === 0 || k === order.length - 1) pts.push({ fpr: fp / N, tpr: tp / P });
  }
  pts.push({ fpr: 1, tpr: 1 });
  return pts;
}

export function prCurve(y: number[], p: number[], maxPoints = 90): Array<{ recall: number; precision: number }> {
  const order = Array.from({ length: y.length }, (_, i) => i).sort((a, b) => p[b] - p[a]);
  const P = y.reduce((s, v) => s + v, 0) || 1;
  let tp = 0;
  let fp = 0;
  const pts: Array<{ recall: number; precision: number }> = [];
  const step = Math.max(1, Math.floor(order.length / maxPoints));
  for (let k = 0; k < order.length; k += 1) {
    if (y[order[k]] === 1) tp += 1;
    else fp += 1;
    if (k % step === 0 || k === order.length - 1) pts.push({ recall: tp / P, precision: tp / (tp + fp) });
  }
  return pts;
}

export function calibrationCurve(y: number[], p: number[], bins = 10): Array<{ bin: number; predicted: number; observed: number; count: number }> {
  const out: Array<{ bin: number; predicted: number; observed: number; count: number }> = [];
  for (let b = 0; b < bins; b += 1) {
    const lo = b / bins;
    const hi = (b + 1) / bins;
    let sum = 0;
    let pos = 0;
    let count = 0;
    for (let i = 0; i < p.length; i += 1) {
      const inBin = b === bins - 1 ? p[i] >= lo && p[i] <= hi : p[i] >= lo && p[i] < hi;
      if (!inBin) continue;
      sum += p[i];
      pos += y[i];
      count += 1;
    }
    out.push({
      bin: b,
      predicted: count ? sum / count : (lo + hi) / 2,
      observed: count ? pos / count : 0,
      count,
    });
  }
  return out;
}

export function brierScore(y: number[], p: number[]): number {
  let s = 0;
  for (let i = 0; i < y.length; i += 1) s += (p[i] - y[i]) ** 2;
  return s / Math.max(1, y.length);
}

export function logLoss(y: number[], p: number[]): number {
  let s = 0;
  for (let i = 0; i < y.length; i += 1) {
    const pc = Math.min(Math.max(p[i], 1e-7), 1 - 1e-7);
    s += -(y[i] * Math.log(pc) + (1 - y[i]) * Math.log(1 - pc));
  }
  return s / Math.max(1, y.length);
}

export function ksStatistic(y: number[], p: number[]): number {
  const order = Array.from({ length: y.length }, (_, i) => i).sort((a, b) => p[b] - p[a]);
  const P = y.reduce((s, v) => s + v, 0) || 1;
  const N = y.length - P || 1;
  let tp = 0;
  let fp = 0;
  let ks = 0;
  for (const idx of order) {
    if (y[idx] === 1) tp += 1;
    else fp += 1;
    ks = Math.max(ks, Math.abs(tp / P - fp / N));
  }
  return ks;
}

export function liftByDecile(y: number[], p: number[]): Array<{ decile: number; churnRate: number; lift: number; capture: number; avgProb: number }> {
  const order = Array.from({ length: y.length }, (_, i) => i).sort((a, b) => p[b] - p[a]);
  const baseRate = (y.reduce((s, v) => s + v, 0) / Math.max(1, y.length)) || 1e-6;
  const size = Math.max(1, Math.ceil(order.length / 10));
  const out: Array<{ decile: number; churnRate: number; lift: number; capture: number; avgProb: number }> = [];
  let cumulative = 0;
  const totalPos = y.reduce((s, v) => s + v, 0) || 1;
  for (let d = 0; d < 10; d += 1) {
    const slice = order.slice(d * size, (d + 1) * size);
    if (!slice.length) break;
    const pos = slice.reduce((s, i) => s + y[i], 0);
    cumulative += pos;
    const churnRate = pos / slice.length;
    out.push({
      decile: d + 1,
      churnRate,
      lift: churnRate / baseRate,
      capture: cumulative / totalPos,
      avgProb: slice.reduce((s, i) => s + p[i], 0) / slice.length,
    });
  }
  return out;
}

export function bestF1Threshold(y: number[], p: number[]): number {
  let best = { t: 0.5, f1: -1 };
  for (let t = 0.05; t <= 0.95; t += 0.01) {
    const { f1 } = prf(confusion(y, p, t));
    if (f1 > best.f1) best = { t, f1 };
  }
  return Number(best.t.toFixed(2));
}

/* ------------------------------------------------------------------ */
/* Business cost model                                                 */
/* ------------------------------------------------------------------ */

export type BusinessInputs = {
  /** Average annual premium of a churner that could have been saved. */
  avgAnnualPremium: number;
  /** Cost of one retention intervention (call, incentive, CSM time). */
  interventionCost: number;
  /** Uplift: fraction of flagged true churners actually saved by a play. */
  saveRate: number;
  /** Share of lifetime value still recoverable at scoring time. */
  recoverableShare: number;
};

export function businessValue(y: number[], p: number[], threshold: number, inputs: BusinessInputs) {
  const c = confusion(y, p, threshold);
  const saved = c.tp * inputs.saveRate;
  const recovered = saved * inputs.avgAnnualPremium * inputs.recoverableShare;
  const interventions = (c.tp + c.fp) * inputs.interventionCost;
  const lostPremium = c.fn * inputs.avgAnnualPremium * inputs.recoverableShare;
  const netValue = recovered - interventions;
  const baselineLoss = (c.tp + c.fn) * inputs.avgAnnualPremium * inputs.recoverableShare;
  return {
    ...c,
    savedCustomers: saved,
    recoveredKes: recovered,
    interventionCostKes: interventions,
    lostPremiumKes: lostPremium,
    netValueKes: netValue,
    baselineLossKes: baselineLoss,
    valueVsBaselineKes: netValue + baselineLoss,
    roi: interventions > 0 ? recovered / interventions : 0,
    recall: c.tp / Math.max(1, c.tp + c.fn),
    precision: c.tp / Math.max(1, c.tp + c.fp),
  };
}

/** Population Stability Index — classic drift statistic used by model risk teams. */
export function psi(expected: number[], actual: number[], bins = 10): number {
  const edges: number[] = [];
  const sorted = [...expected].sort((a, b) => a - b);
  for (let b = 1; b < bins; b += 1) edges.push(sorted[Math.floor((b / bins) * sorted.length)] ?? 0);
  const bucket = (v: number) => {
    let i = 0;
    while (i < edges.length && v > edges[i]) i += 1;
    return i;
  };
  const e = new Array(bins).fill(0);
  const a = new Array(bins).fill(0);
  expected.forEach((v) => (e[bucket(v)] += 1));
  actual.forEach((v) => (a[bucket(v)] += 1));
  let total = 0;
  for (let b = 0; b < bins; b += 1) {
    const pe = Math.max(e[b] / expected.length, 1e-4);
    const pa = Math.max(a[b] / actual.length, 1e-4);
    total += (pa - pe) * Math.log(pa / pe);
  }
  return total;
}

export function psiVerdict(v: number): { label: string; tone: "ok" | "warn" | "critical" } {
  if (v < 0.1) return { label: "Stable", tone: "ok" };
  if (v < 0.25) return { label: "Moderate shift", tone: "warn" };
  return { label: "Significant drift", tone: "critical" };
}

/**
 * Decision-threshold sweep: proves why accuracy is the wrong headline metric
 * for a 20% base-rate problem, and lets the business pick its own operating
 * point on the precision / recall / net-value frontier.
 */
export function thresholdSweep(y: number[], p: number[], inputs: BusinessInputs) {
  const out: Array<{
    t: number;
    accuracy: number;
    precision: number;
    recall: number;
    f1: number;
    flagged: number;
    tp: number;
    fp: number;
    fn: number;
    tn: number;
    netValueKes: number;
    recoveredKes: number;
    interventionCostKes: number;
  }> = [];
  for (let t = 0.02; t <= 0.96; t += 0.02) {
    const c = confusion(y, p, t);
    const s = prf(c);
    const b = businessValue(y, p, t, inputs);
    out.push({
      t: Number(t.toFixed(2)),
      accuracy: s.accuracy,
      precision: s.precision,
      recall: s.recall,
      f1: s.f1,
      flagged: c.tp + c.fp,
      tp: c.tp,
      fp: c.fp,
      fn: c.fn,
      tn: c.tn,
      netValueKes: b.netValueKes,
      recoveredKes: b.recoveredKes,
      interventionCostKes: b.interventionCostKes,
    });
  }
  return out;
}

export type FullMetrics = ReturnType<typeof evaluateModel>;

export function evaluateModel(y: number[], p: number[], business: BusinessInputs) {
  const threshold = bestF1Threshold(y, p);
  const c = confusion(y, p, threshold);
  const scores = prf(c);
  const deciles = liftByDecile(y, p);
  return {
    rocAuc: rocAuc(y, p),
    threshold,
    confusion: c,
    ...scores,
    prAuc: prAuc(y, p),
    brier: brierScore(y, p),
    logLoss: logLoss(y, p),
    ks: ksStatistic(y, p),
    liftTopDecile: deciles[0]?.lift ?? 0,
    captureTopTwoDeciles: deciles[1]?.capture ?? 0,
    calibration: calibrationCurve(y, p),
    deciles,
    sweep: thresholdSweep(y, p, business),
    roc: rocCurve(y, p),
    pr: prCurve(y, p),
    business: businessValue(y, p, threshold, business),
    positives: y.reduce((s, v) => s + v, 0),
    negatives: y.length - y.reduce((s, v) => s + v, 0),
  };
}


