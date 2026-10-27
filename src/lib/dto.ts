/**
 * Plain, serialisable data-transfer types shared by server components and
 * client islands. Kept free of any Drizzle / Node import so the browser bundle
 * never pulls in database or ML code.
 */

export type RiskDriver = { label: string; group: string; impact: number; raw?: number };

export type CustomerListItem = {
  id: string;
  fullName: string;
  email: string;
  phone: string;
  county: string;
  segment: string;
  productLine: string;
  channel: string;
  contractType: string;
  planTier: string;
  status: string;
  tenureMonths: number;
  premiumMonthly: number;
  lifetimePremium: number;
  policiesHeld: number;
  churn: number;
  satisfactionScore: number;
  paymentFailures: number;
  probability: number;
  riskLevel: string;
  revenueAtRisk: number;
  priorityScore: number;
  scoredAt: string;
  annualValue: number;
  color: string;
};

export type CustomerListResult = {
  rows: CustomerListItem[];
  total: number;
  page: number;
  pageSize: number;
  pages: number;
};

export type FilterOptions = {
  counties: string[];
  segments: string[];
  products: string[];
  riskLevels: string[];
};

export type RetentionRow = {
  actionId: number;
  play: string;
  rationale: string;
  owner: string;
  priority: string;
  status: string;
  probability: number;
  annualValue: number;
  playCostKes: number;
  expectedSaveKes: number;
  roi: number;
  updatedAt: string;
  id: string;
  fullName: string;
  segment: string;
  productLine: string;
  county: string;
  premiumMonthly: number;
  contractType: string;
  tenureMonths: number;
  churn: number;
  drivers: RiskDriver[] | null;
  revenueAtRisk: number | null;
  color: string;
};

export type RetentionSummaryRow = { priority: string; status: string; count: number; expected: number; cost: number; value: number };

export type PlaybookEntry = {
  group: string;
  label: string;
  color: string;
  blurb: string;
  play: string;
  rationale: string;
  owner: string;
  costKes: number;
  saveRate: number;
};

export type RegistryEntry = {
  id: string;
  algorithm: string;
  version: string;
  stage: string;
  status: string;
  trainingMs: number;
  trainRows: number;
  testRows: number;
  createdAt: string;
  promotedAt: string | null;
  datasetHash: string;
  rocAuc: number;
  prAuc: number;
  precision: number;
  recall: number;
  f1: number;
  brier: number;
  ks: number;
  liftTopDecile: number;
  netValueKes: number;
  threshold: number;
  featureImportance: Array<{ feature: string; group: string; importance: number }>;
};

export type StreamEventDto = {
  id: number;
  customerId: string;
  name?: string;
  segment?: string;
  topic: string;
  eventType: string;
  severity: string;
  payload: Record<string, unknown>;
  partition: number;
  streamOffset: number;
  lagMs: number;
  scoreBefore: number | null;
  scoreAfter: number | null;
  riskDelta: number | null;
  occurredAt: string;
};

export type AlertDto = {
  id: number;
  severity: string;
  source: string;
  title: string;
  body: string;
  customerId: string | null;
  acknowledged: boolean;
  createdAt: string;
};
