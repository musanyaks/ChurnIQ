import { FEATURE_META, GROUP_META, GROUP_ORDER, type FeatureGroup } from "./features";
import type { ChurnModel } from "./models";

/**
 * Explainability layer (SHAP-style).
 *
 * `kernelShap`   — sampled-coalition kernel regression for a single customer,
 *                  renormalised so attributions sum exactly to
 *                  f(x) − E[f(background)]. Used on Customer 360 / deep dives.
 * `groupDrivers` — fast group-level occlusion used when scoring the whole book
 *                  so every row in the retention queue carries a rationale.
 *
 * All values are expressed in probability points (0–1), which is what makes the
 * waterfall readable for a non-technical retention manager.
 */

export type Attribution = {
  key: string;
  label: string;
  group: FeatureGroup;
  impact: number;
  raw: number;
};

export type Driver = { group: FeatureGroup; label: string; impact: number };

export function meanVector(bg: number[][]): number[] {
  const p = bg[0].length;
  const m = new Array<number>(p).fill(0);
  for (const row of bg) for (let f = 0; f < p; f += 1) m[f] += row[f];
  for (let f = 0; f < p; f += 1) m[f] /= bg.length;
  return m;
}

export const groupIndexMap = (): Record<FeatureGroup, number[]> => {
  const map = {} as Record<FeatureGroup, number[]>;
  for (const g of GROUP_ORDER) map[g] = [];
  FEATURE_META.forEach((f, i) => map[f.group].push(i));
  return map;
};

/* ------------------------------------------------------------------ */
/* Group-level occlusion (batch-friendly)                              */
/* ------------------------------------------------------------------ */

export function groupDrivers(model: ChurnModel, x: number[], bg: number[][], baselineMean: number[]): Driver[] {
  const map = groupIndexMap();
  const full = model.predictProba(x);
  const base = model.predictProba(baselineMean);
  const mixed = new Array<number>(GROUP_ORDER.length);

  GROUP_ORDER.forEach((g, gi) => {
    let s = 0;
    for (const b of bg) {
      const cand = x.slice();
      for (const idx of map[g]) cand[idx] = b[idx];
      s += model.predictProba(cand);
    }
    const occluded = s / bg.length;
    mixed[gi] = full - occluded;
  });

  const total = mixed.reduce((a, b) => a + b, 0);
  const target = full - base;
  const scale = Math.abs(total) > 1e-9 ? target / total : 0;

  return GROUP_ORDER.map((g, gi) => ({
    group: g,
    label: GROUP_META[g].label,
    impact: mixed[gi] * scale,
  })).sort((a, b) => Math.abs(b.impact) - Math.abs(a.impact));
}

/* ------------------------------------------------------------------ */
/* KernelSHAP (sampled coalitions)                                     */
/* ------------------------------------------------------------------ */

function logChoose(n: number, k: number): number {
  if (k <= 0 || k >= n) return 0;
  let s = 0;
  for (let i = 0; i < k; i += 1) s += Math.log(n - i) - Math.log(i + 1);
  return s;
}

function solveWeightedLS(Z: number[][], y: number[], w: number[], m: number, lambda: number): number[] {
  const A: number[][] = Array.from({ length: m }, () => new Array<number>(m).fill(0));
  const b = new Array<number>(m).fill(0);
  for (let s = 0; s < Z.length; s += 1) {
    const z = Z[s];
    const ws = w[s];
    for (let i = 0; i < m; i += 1) {
      if (z[i] === 0) continue;
      b[i] += ws * z[i] * y[s];
      for (let j = 0; j < m; j += 1) {
        if (z[j] === 0) continue;
        A[i][j] += ws * z[i] * z[j];
      }
    }
  }
  for (let i = 0; i < m; i += 1) A[i][i] += lambda;

  // Gaussian elimination with partial pivoting.
  for (let col = 0; col < m; col += 1) {
    let piv = col;
    for (let r = col + 1; r < m; r += 1) if (Math.abs(A[r][col]) > Math.abs(A[piv][col])) piv = r;
    if (Math.abs(A[piv][col]) < 1e-12) continue;
    [A[col], A[piv]] = [A[piv], A[col]];
    [b[col], b[piv]] = [b[piv], b[col]];
    for (let r = 0; r < m; r += 1) {
      if (r === col) continue;
      const factor = A[r][col] / A[col][col];
      if (factor === 0) continue;
      for (let c = col; c < m; c += 1) A[r][c] -= factor * A[col][c];
      b[r] -= factor * b[col];
    }
  }
  const phi = new Array<number>(m).fill(0);
  for (let i = 0; i < m; i += 1) phi[i] = Math.abs(A[i][i]) < 1e-12 ? 0 : b[i] / A[i][i];
  return phi;
}

export function kernelShap(
  model: ChurnModel,
  x: number[],
  bg: number[][],
  coalitions = 120,
  rng: () => number = Math.random,
): Attribution[] {
  const m = x.length;
  const bgMean = meanVector(bg);
  const mix = (mask: number[], bgRow: number[]) => mask.map((v, i) => (v === 1 ? x[i] : bgRow[i]));

  const evalCoalition = (mask: number[]): number => {
    let s = 0;
    for (const b of bg) s += model.predictProba(mix(mask, b));
    return s / bg.length;
  };

  const empty = new Array<number>(m).fill(0);
  const full = new Array<number>(m).fill(1);
  const f0 = evalCoalition(empty);
  const f1 = evalCoalition(full);

  const Z: number[][] = [empty, full];
  const Y: number[] = [f0, f1];
  const W: number[] = [1e5, 1e5];

  for (let s = 0; s < coalitions; s += 1) {
    const k = 1 + Math.floor(rng() * (m - 1));
    const perm = Array.from({ length: m }, (_, i) => i);
    for (let i = m - 1; i > 0; i -= 1) {
      const j = Math.floor(rng() * (i + 1)) % (i + 1);
      [perm[i], perm[j]] = [perm[j], perm[i]];
    }
    const mask = new Array<number>(m).fill(0);
    for (let i = 0; i < k; i += 1) mask[perm[i]] = 1;
    const weight = (m - 1) / Math.exp(logChoose(m, k) + Math.log(k) + Math.log(m - k));
    Z.push(mask);
    Y.push(evalCoalition(mask));
    W.push(Math.min(weight, 1e4));
  }

  const phi = solveWeightedLS(Z, Y, W, m, 1e-3);
  const total = f1 - f0;
  const sum = phi.reduce((a, b) => a + b, 0);
  const scale = Math.abs(sum) > 1e-9 ? total / sum : 0;

  return phi.map((v, i) => ({
    key: FEATURE_META[i]?.key ?? `f${i}`,
    label: FEATURE_META[i]?.label ?? `feature ${i}`,
    group: FEATURE_META[i]?.group ?? "profile",
    impact: v * scale,
    raw: x[i],
  }));
}

export function attributionsToDrivers(attrs: Attribution[]): Driver[] {
  const byGroup = new Map<FeatureGroup, number>();
  for (const a of attrs) byGroup.set(a.group, (byGroup.get(a.group) ?? 0) + a.impact);
  return GROUP_ORDER.map((g) => ({ group: g, label: GROUP_META[g].label, impact: byGroup.get(g) ?? 0 })).sort(
    (a, b) => Math.abs(b.impact) - Math.abs(a.impact),
  );
}

export function formatImpact(v: number): string {
  const pts = v * 100;
  return `${pts >= 0 ? "+" : "−"}${Math.abs(pts).toFixed(1)} pts`;
}
