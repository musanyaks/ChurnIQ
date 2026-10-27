import { FEATURE_COUNT, MAX_BINS, binMatrix, binVector, buildBins } from "./features";

/**
 * ChurnIQ model zoo — implemented from scratch in TypeScript so the whole
 * pipeline (training, evaluation, registry, serving, explanation) runs inside
 * the platform without an external runtime.
 *
 *  - LogisticRegression  : L2-penalised, standardised, full-batch GD baseline
 *  - RandomForest        : bagged histogram CART (gini) with feature subsampling
 *  - GradientBoosting    : LightGBM-style histogram boosting on log-loss
 */

export type ModelKind = "logistic_regression" | "random_forest" | "gradient_boosting";

export type TreeArtifact = {
  feature: number[];
  threshold: number[];
  left: number[];
  right: number[];
  value: number[];
};

export type SerializedModel =
  | {
      kind: "logistic_regression";
      weights: number[];
      bias: number;
      mean: number[];
      std: number[];
      iterations: number;
      l2: number;
    }
  | {
      kind: "random_forest";
      bins: number[][];
      trees: TreeArtifact[];
      params: Record<string, number>;
    }
  | {
      kind: "gradient_boosting";
      bins: number[][];
      trees: TreeArtifact[];
      baseScore: number;
      learningRate: number;
      params: Record<string, number>;
    };

export interface ChurnModel {
  kind: ModelKind;
  predictProba(x: number[]): number;
  predictBatch(X: number[][]): number[];
  serialize(): SerializedModel;
}

const sigmoid = (z: number) => (z >= 0 ? 1 / (1 + Math.exp(-z)) : Math.exp(z) / (1 + Math.exp(z)));

/* ================================================================== */
/* Logistic regression                                                 */
/* ================================================================== */

export type LrParams = { l2?: number; lr?: number; iterations?: number };

export class LogisticRegression implements ChurnModel {
  kind = "logistic_regression" as const;
  weights: Float64Array;
  bias = 0;
  mean: Float64Array;
  std: Float64Array;
  iterations = 0;
  l2: number;

  private constructor(p: number) {
    this.weights = new Float64Array(p);
    this.mean = new Float64Array(p);
    this.std = new Float64Array(p);
    this.l2 = 0;
  }

  static fit(X: number[][], y: number[], params: LrParams = {}): LogisticRegression {
    const n = X.length;
    const p = X[0].length;
    const l2 = params.l2 ?? 0.012;
    const lr = params.lr ?? 0.35;
    const iterations = params.iterations ?? 420;

    const model = new LogisticRegression(p);
    model.l2 = l2;
    for (let f = 0; f < p; f += 1) {
      let s = 0;
      for (let i = 0; i < n; i += 1) s += X[i][f];
      const mean = s / n;
      let v = 0;
      for (let i = 0; i < n; i += 1) v += (X[i][f] - mean) ** 2;
      const std = Math.sqrt(v / n);
      model.mean[f] = mean;
      model.std[f] = std > 1e-9 ? std : 1;
    }

    const w = new Float64Array(p);
    let b = 0;
    const vw = new Float64Array(p);
    let vb = 0;
    const mw = new Float64Array(p);
    let mb = 0;
    let posSum = 0;
    for (let i = 0; i < n; i += 1) posSum += y[i];
    b = Math.log(Math.max(posSum, 1) / Math.max(n - posSum, 1));

    for (let it = 1; it <= iterations; it += 1) {
      const gw = new Float64Array(p);
      let gb = 0;
      for (let i = 0; i < n; i += 1) {
        const row = X[i];
        let z = b;
        for (let f = 0; f < p; f += 1) z += w[f] * ((row[f] - model.mean[f]) / model.std[f]);
        const pred = sigmoid(z);
        const err = pred - y[i];
        gb += err;
        for (let f = 0; f < p; f += 1) gw[f] += (err * (row[f] - model.mean[f])) / model.std[f];
      }
      const beta1 = 0.9;
      const beta2 = 0.999;
      const eps = 1e-8;
      const c1 = 1 - beta1 ** it;
      const c2 = 1 - beta2 ** it;
      for (let f = 0; f < p; f += 1) {
        const g = gw[f] / n + l2 * w[f];
        mw[f] = beta1 * mw[f] + (1 - beta1) * g;
        vw[f] = beta2 * vw[f] + (1 - beta2) * g * g;
        w[f] -= lr * (mw[f] / c1) / (Math.sqrt(vw[f] / c2) + eps);
      }
      const gB = gb / n;
      mb = beta1 * mb + (1 - beta1) * gB;
      vb = beta2 * vb + (1 - beta2) * gB * gB;
      b -= lr * (mb / c1) / (Math.sqrt(vb / c2) + eps);
    }

    model.weights = w;
    model.bias = b;
    model.iterations = iterations;
    return model;
  }

  predictProba(x: number[]): number {
    let z = this.bias;
    for (let f = 0; f < x.length; f += 1) z += this.weights[f] * ((x[f] - this.mean[f]) / this.std[f]);
    return sigmoid(z);
  }

  predictBatch(X: number[][]): number[] {
    return X.map((x) => this.predictProba(x));
  }

  serialize(): SerializedModel {
    return {
      kind: "logistic_regression",
      weights: Array.from(this.weights),
      bias: this.bias,
      mean: Array.from(this.mean),
      std: Array.from(this.std),
      iterations: this.iterations,
      l2: this.l2,
    };
  }

  static restore(a: Extract<SerializedModel, { kind: "logistic_regression" }>): LogisticRegression {
    const m = new LogisticRegression(a.weights.length);
    m.weights = Float64Array.from(a.weights);
    m.bias = a.bias;
    m.mean = Float64Array.from(a.mean);
    m.std = Float64Array.from(a.std);
    m.iterations = a.iterations;
    m.l2 = a.l2;
    return m;
  }
}

/* ================================================================== */
/* Histogram tree building                                             */
/* ================================================================== */

type TreeBuilder = {
  bins: number[][];
  binCount: number[];
};

function walk(tree: TreeArtifact, binned: Uint8Array): number {
  let node = 0;
  while (tree.feature[node] >= 0) {
    node = binned[tree.feature[node]] <= tree.threshold[node] ? tree.left[node] : tree.right[node];
  }
  return tree.value[node];
}

/** threshold stored as bin index; comparison uses binned values. */
function predictTreeRaw(tree: TreeArtifact, x: number[], bins: number[][]): number {
  const b = binVector(x, bins);
  let node = 0;
  while (tree.feature[node] >= 0) {
    node = b[tree.feature[node]] <= tree.threshold[node] ? tree.left[node] : tree.right[node];
  }
  return tree.value[node];
}

export type GbmParams = {
  trees?: number;
  depth?: number;
  learningRate?: number;
  minDataInLeaf?: number;
  lambda?: number;
  minGain?: number;
  featureFraction?: number;
  subsample?: number;
};

function fitBoostTree(
  binned: Uint8Array[],
  idx: number[],
  grad: Float64Array,
  hess: Float64Array,
  tb: TreeBuilder,
  depth: number,
  minDataInLeaf: number,
  lambda: number,
  minGain: number,
  rng: () => number,
  featureFraction: number,
): TreeArtifact {
  const feature: number[] = [];
  const threshold: number[] = [];
  const left: number[] = [];
  const right: number[] = [];
  const value: number[] = [];
  const p = FEATURE_COUNT;

  const grow = (rows: number[], d: number): number => {
    const node = feature.length;
    feature.push(-1);
    threshold.push(0);
    left.push(-1);
    right.push(-1);
    value.push(0);

    let G = 0;
    let H = 0;
    for (const i of rows) {
      G += grad[i];
      H += hess[i];
    }
    const leafValue = -G / (H + lambda);

    if (d >= depth || rows.length < 2 * minDataInLeaf) {
      value[node] = leafValue;
      return node;
    }

    const parentGain = (G * G) / (H + lambda);
    let best = { gain: 0, f: -1, t: 0 };

    const candidate: number[] = [];
    for (let f = 0; f < p; f += 1) if (rng() < featureFraction) candidate.push(f);
    if (candidate.length === 0) candidate.push(Math.floor(rng() * p) % p);

    for (const f of candidate) {
      const nb = tb.binCount[f] + 1;
      if (nb < 2) continue;
      const gc = new Float64Array(nb);
      const hc = new Float64Array(nb);
      const cc = new Float64Array(nb);
      for (const i of rows) {
        const b = binned[i][f];
        gc[b] += grad[i];
        hc[b] += hess[i];
        cc[b] += 1;
      }
      let gl = 0;
      let hl = 0;
      let cl = 0;
      for (let b = 0; b < nb - 1; b += 1) {
        gl += gc[b];
        hl += hc[b];
        cl += cc[b];
        const cr = rows.length - cl;
        if (cl < minDataInLeaf || cr < minDataInLeaf) continue;
        const gain = (gl * gl) / (hl + lambda) + ((G - gl) * (G - gl)) / (H - hl + lambda) - parentGain;
        if (gain > best.gain) best = { gain, f, t: b };
      }
    }

    if (best.f < 0 || best.gain < minGain) {
      value[node] = leafValue;
      return node;
    }

    const lRows: number[] = [];
    const rRows: number[] = [];
    for (const i of rows) (binned[i][best.f] <= best.t ? lRows : rRows).push(i);
    if (lRows.length === 0 || rRows.length === 0) {
      value[node] = leafValue;
      return node;
    }
    feature[node] = best.f;
    threshold[node] = best.t;
    const l = grow(lRows, d + 1);
    const rr = grow(rRows, d + 1);
    left[node] = l;
    right[node] = rr;
    return node;
  };

  grow(idx, 0);
  return { feature, threshold, left, right, value };
}

export class GradientBoosting implements ChurnModel {
  kind = "gradient_boosting" as const;
  bins: number[][];
  trees: TreeArtifact[];
  baseScore: number;
  learningRate: number;
  params: Record<string, number>;

  constructor(bins: number[][], trees: TreeArtifact[], baseScore: number, lr: number, params: Record<string, number>) {
    this.bins = bins;
    this.trees = trees;
    this.baseScore = baseScore;
    this.learningRate = lr;
    this.params = params;
  }

  static fit(X: number[][], y: number[], params: GbmParams = {}, rng: () => number = Math.random): GradientBoosting {
    const nTrees = params.trees ?? 90;
    const depth = params.depth ?? 4;
    const lr = params.learningRate ?? 0.09;
    const minDataInLeaf = params.minDataInLeaf ?? 24;
    const lambda = params.lambda ?? 1.2;
    const minGain = params.minGain ?? 1e-4;
    const featureFraction = params.featureFraction ?? 0.85;
    const subsample = params.subsample ?? 0.9;

    const n = X.length;
    const bins = buildBins(X);
    const binCount = bins.map((e) => Math.min(e.length, MAX_BINS));
    const binned = binMatrix(X, bins);

    let pos = 0;
    for (let i = 0; i < n; i += 1) pos += y[i];
    const pBar = Math.min(Math.max(pos / n, 1e-4), 1 - 1e-4);
    const baseScore = Math.log(pBar / (1 - pBar));

    const raw = new Float64Array(n).fill(baseScore);
    const grad = new Float64Array(n);
    const hess = new Float64Array(n);
    const allIdx: number[] = Array.from({ length: n }, (_, i) => i);
    const trees: TreeArtifact[] = [];

    for (let t = 0; t < nTrees; t += 1) {
      for (let i = 0; i < n; i += 1) {
        const p = sigmoid(raw[i]);
        grad[i] = p - y[i];
        hess[i] = Math.max(p * (1 - p), 1e-6);
      }
      const idx = subsample < 1 ? allIdx.filter(() => rng() < subsample) : allIdx;
      const rows = idx.length > 64 ? idx : allIdx;
      const tree = fitBoostTree(binned, rows, grad, hess, { bins, binCount }, depth, minDataInLeaf, lambda, minGain, rng, featureFraction);
      trees.push(tree);
      for (let i = 0; i < n; i += 1) {
        raw[i] += lr * predictTreeRaw(tree, X[i], bins);
      }
    }

    return new GradientBoosting(bins, trees, baseScore, lr, {
      trees: nTrees,
      depth,
      learningRate: lr,
      minDataInLeaf,
      lambda,
      featureFraction,
      subsample,
    });
  }

  private rawScore(x: number[]): number {
    let s = this.baseScore;
    for (const tree of this.trees) s += this.learningRate * predictTreeRaw(tree, x, this.bins);
    return s;
  }

  predictProba(x: number[]): number {
    return sigmoid(this.rawScore(x));
  }

  predictBatch(X: number[][]): number[] {
    return X.map((x) => this.predictProba(x));
  }

  serialize(): SerializedModel {
    return {
      kind: "gradient_boosting",
      bins: this.bins,
      trees: this.trees,
      baseScore: this.baseScore,
      learningRate: this.learningRate,
      params: this.params,
    };
  }

  static restore(a: Extract<SerializedModel, { kind: "gradient_boosting" }>): GradientBoosting {
    return new GradientBoosting(a.bins, a.trees, a.baseScore, a.learningRate, a.params);
  }
}

/* ================================================================== */
/* Random forest (bagged histogram CART, gini)                         */
/* ================================================================== */

export type RfParams = { trees?: number; depth?: number; minDataInLeaf?: number; featureFraction?: number };

function fitClassTree(
  binned: Uint8Array[],
  X: number[][],
  idx: number[],
  y: number[],
  binCount: number[],
  depth: number,
  minDataInLeaf: number,
  rng: () => number,
  featureFraction: number,
): TreeArtifact {
  const feature: number[] = [];
  const threshold: number[] = [];
  const left: number[] = [];
  const right: number[] = [];
  const value: number[] = [];
  const p = FEATURE_COUNT;

  const prob = (rows: number[]) => {
    let pos = 0;
    for (const i of rows) pos += y[i];
    return (pos + 0.5) / (rows.length + 1);
  };

  const grow = (rows: number[], d: number): number => {
    const node = feature.length;
    feature.push(-1);
    threshold.push(0);
    left.push(-1);
    right.push(-1);
    value.push(0);

    const baseProb = prob(rows);
    if (d >= depth || rows.length < 2 * minDataInLeaf) {
      value[node] = baseProb;
      return node;
    }
    const gini = (pr: number) => 2 * pr * (1 - pr);
    const parentImp = rows.length * gini(baseProb);
    let totalPos = 0;
    for (const i of rows) totalPos += y[i];

    const candidate: number[] = [];
    for (let f = 0; f < p; f += 1) if (rng() < featureFraction) candidate.push(f);
    if (candidate.length === 0) candidate.push(Math.floor(rng() * p) % p);

    let best = { gain: 0, f: -1, t: 0 };
    for (const f of candidate) {
      const nb = binCount[f] + 1;
      if (nb < 2) continue;
      const c0 = new Float64Array(nb);
      const c1 = new Float64Array(nb);
      for (const i of rows) {
        const b = binned[i][f];
        if (y[i] === 1) c1[b] += 1;
        else c0[b] += 1;
      }
      let l0 = 0;
      let l1 = 0;
      for (let b = 0; b < nb - 1; b += 1) {
        l0 += c0[b];
        l1 += c1[b];
        const nl = l0 + l1;
        const nr = rows.length - nl;
        if (nl < minDataInLeaf || nr < minDataInLeaf) continue;
        const pl = (l1 + 0.5) / (nl + 1);
        const pr = (totalPos - l1 + 0.5) / (nr + 1);
        const imp = nl * gini(pl) + nr * gini(pr);
        const gain = parentImp - imp;
        if (gain > best.gain) best = { gain, f, t: b };
      }
    }

    if (best.f < 0) {
      value[node] = baseProb;
      return node;
    }
    const lRows: number[] = [];
    const rRows: number[] = [];
    for (const i of rows) (binned[i][best.f] <= best.t ? lRows : rRows).push(i);
    if (!lRows.length || !rRows.length) {
      value[node] = baseProb;
      return node;
    }
    feature[node] = best.f;
    threshold[node] = best.t;
    left[node] = grow(lRows, d + 1);
    right[node] = grow(rRows, d + 1);
    return node;
  };

  grow(idx, 0);
  void X;
  return { feature, threshold, left, right, value };
}

export class RandomForest implements ChurnModel {
  kind = "random_forest" as const;
  bins: number[][];
  trees: TreeArtifact[];
  params: Record<string, number>;

  constructor(bins: number[][], trees: TreeArtifact[], params: Record<string, number>) {
    this.bins = bins;
    this.trees = trees;
    this.params = params;
  }

  static fit(X: number[][], y: number[], params: RfParams = {}, rng: () => number = Math.random): RandomForest {
    const nTrees = params.trees ?? 45;
    const depth = params.depth ?? 9;
    const minDataInLeaf = params.minDataInLeaf ?? 12;
    const featureFraction = params.featureFraction ?? 0.38;
    const n = X.length;
    const bins = buildBins(X);
    const binCount = bins.map((e) => Math.min(e.length, MAX_BINS));
    const binned = binMatrix(X, bins);
    const trees: TreeArtifact[] = [];

    for (let t = 0; t < nTrees; t += 1) {
      const bag: number[] = new Array(n);
      for (let i = 0; i < n; i += 1) bag[i] = Math.floor(rng() * n) % n;
      trees.push(fitClassTree(binned, X, bag, y, binCount, depth, minDataInLeaf, rng, featureFraction));
    }
    return new RandomForest(bins, trees, { trees: nTrees, depth, minDataInLeaf, featureFraction });
  }

  predictProba(x: number[]): number {
    const b = binVector(x, this.bins);
    let s = 0;
    for (const tree of this.trees) s += walk(tree, b);
    return s / this.trees.length;
  }

  predictBatch(X: number[][]): number[] {
    const out = new Array<number>(X.length);
    for (let i = 0; i < X.length; i += 1) out[i] = this.predictProba(X[i]);
    return out;
  }

  serialize(): SerializedModel {
    return { kind: "random_forest", bins: this.bins, trees: this.trees, params: this.params };
  }

  static restore(a: Extract<SerializedModel, { kind: "random_forest" }>): RandomForest {
    return new RandomForest(a.bins, a.trees, a.params);
  }
}

/* ================================================================== */
/* Registry hydration                                                  */
/* ================================================================== */

export function restoreModel(a: SerializedModel): ChurnModel {
  switch (a.kind) {
    case "logistic_regression":
      return LogisticRegression.restore(a);
    case "random_forest":
      return RandomForest.restore(a);
    case "gradient_boosting":
      return GradientBoosting.restore(a);
    default:
      throw new Error(`Unknown model kind: ${(a as { kind: string }).kind}`);
  }
}

export const MODEL_CATALOG: Array<{
  kind: ModelKind;
  name: string;
  family: string;
  note: string;
  defaultParams: Record<string, number>;
}> = [
  {
    kind: "logistic_regression",
    name: "Logistic Regression",
    family: "Linear / GLM",
    note: "Interpretable baseline with exact coefficient attribution.",
    defaultParams: { l2: 0.012, lr: 0.35, iterations: 420 },
  },
  {
    kind: "random_forest",
    name: "Random Forest",
    family: "Bagged histogram CART",
    note: "Variance-reduced ensemble; robust to noisy behavioural features.",
    defaultParams: { trees: 45, depth: 9, minDataInLeaf: 12, featureFraction: 0.38 },
  },
  {
    kind: "gradient_boosting",
    name: "Gradient Boosting (LightGBM-style)",
    family: "Boosted histogram trees",
    note: "Leaf-wise boosting on log-loss; strongest ranking for skewed churn.",
    defaultParams: { trees: 90, depth: 4, learningRate: 0.09, lambda: 1.2, featureFraction: 0.85, subsample: 0.9 },
  },
];
