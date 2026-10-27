# ChurnIQ — Real-Time Customer Churn & Retention Intelligence Platform

**Live demo:** https://churniq-two.vercel.app

> **Which customers are likely to leave, why are they likely to leave, and what should the business do about it?**

ChurnIQ is a production-shaped churn intelligence platform built as a single deployable Next.js + PostgreSQL
application. It covers the whole lifecycle — **data engineering → feature store → model training → model registry →
batch + real-time scoring → explainability → retention decisioning → monitoring** — with a Kenya-focused synthetic
insurance book (policyholder non-renewal) as the domain.

Everything runs for real: the models are trained from scratch in TypeScript on data stored in PostgreSQL, artefacts
are serialised into a registry, scoring is reproducible across restarts, and explanations are computed with a
sampled-coalition KernelSHAP estimator.

---

## 1. What the platform answers

| Question | Where it is answered |
|---|---|
| How much of the book is at risk, in shillings? | Executive Dashboard |
| Which specific customers should we call today? | Retention Center (priority = P(churn) × customer value) |
| Why is *this* customer at risk? | Customer 360 — SHAP waterfall per feature |
| What should we do, who owns it, and what is it worth? | Driver → play mapping with cost, save-rate, expected save, ROI |
| Is the model any good, and against what? | Model Lab — 3 families, ROC/PR/calibration/lift, threshold & cost lab |
| What happened in the last five minutes? | Real-Time Stream — event → feature mutation → re-score → alert |
| Can we trust it in production? | Platform Health — SLOs, PSI drift, data-quality gates, registry |

---

## 2. Architecture

```
                CUSTOMER SOURCES (CRM · core insurance · M-PESA · app telemetry)
                                     │
                        ┌────────────▼────────────┐
                        │  KAFKA-STYLE EVENT BUS  │  customer_events · transactions
                        │  5 topics · 6 partitions│  payments · support_events · usage_events
                        └────────────┬────────────┘
                                     │  micro-batch consumer
                        ┌────────────▼────────────┐
                        │   POSTGRESQL WAREHOUSE  │  customers (raw telemetry, 2,400 rows)
                        │                         │  customer_events (26k+ append-only rows)
                        └────────────┬────────────┘
                                     │  feature engineering (44 features, 7 driver groups)
                        ┌────────────▼────────────┐
                        │   ONLINE FEATURE STORE  │  feature_store (versioned vectors)
                        └────────────┬────────────┘
                                     │
              ┌──────────────────────┼──────────────────────┐
              │                      │                      │
     Logistic Regression      Random Forest        Gradient Boosting
       (L2, standardised)   (bagged hist. CART)   (LightGBM-style, log-loss)
              └──────────────────────┼──────────────────────┘
                                     │  PR-AUC / ROC-AUC / lift / net shilling value
                        ┌────────────▼────────────┐
                        │     MODEL REGISTRY      │  model_runs (serialised artefacts,
                        │     (MLflow-style)      │  metrics, importance, PSI baseline)
                        └────────────┬────────────┘
                                     │  promote / rollback → full book re-score
                        ┌────────────▼────────────┐
                        │  SCORING + EXPLAINABILITY│ predictions · retention_actions
                        │  KernelSHAP attributions │ alerts
                        └────────────┬────────────┘
                                     │
                 ┌───────────────────┼────────────────────┐
                 │                   │                    │
          NEXT.JS DASHBOARD     ALERT BUS         PROMETHEUS /api/metrics
          (8 surfaces, RSC)     (risk crossings)  (text exposition format)
```

---

## 3. The eight surfaces

1. **Executive Dashboard** (`/`) — KPI strip (book size, observed non-renewal rate, high-risk count, revenue at
   risk, retention rate, mean predicted risk), live book-risk trend, retention-opportunity donut, monthly lapse
   columns, churn by segment / product / channel / cadence / plan / county / value band / tenure band, risk
   distribution histogram, top-risk table with leading driver, retention pipeline economics.
2. **Customer Explorer** (`/explorer`) — debounced search across id / name / email / phone, eight filters, six sort
   keys, pagination, CSV export of the current view.
3. **Churn Prediction** (`/predict`) — single-profile scoring with 19 sliders and 6 categoricals, four preset
   scenarios (healthy renewer, payment distress, disengaged digital, price-shocked corporate), cross-model
   agreement, SHAP waterfall, costed play. Plus **CSV batch scoring** with header aliasing, partial-row tolerance,
   summary statistics and scored-CSV export.
4. **Customer 360** (`/customers/[id]`) — identity header, risk gauge, SHAP waterfall, driver groups, next best
   action with workflow buttons, contract/demographic/behavioural panels, payments, support & claims, digital usage,
   full interaction timeline with per-event score deltas, cross-model agreement, all 44 attributions, peer cohort.
5. **Retention Center** (`/retention`) — priority bands, exposure defended, play library (7 driver→action plays),
   filterable queue with expected save / cost / ROI and a real workflow (queued → contacted → saved / lost / snoozed).
6. **Model Lab** (`/models`) — champion metrics, registry table with best-value highlighting, ROC, precision-recall,
   calibration, decile lift & cumulative capture, confusion matrix, **interactive threshold & cost lab** (drag the
   operating point, watch accuracy stay flat while recall and shilling value collapse), permutation importance,
   business case, run metadata, promote / retrain actions.
7. **Real-Time Stream** (`/stream`) — live consumer deck (go live / emit burst / burst size), animated six-stage
   topology, book stats, event ticker with partition, offset, lag and before→after scores, biggest risk movers,
   streaming alert bus, micro-batch latency and topic volumes.
8. **Platform Health** (`/monitoring`) — stage health, four SLO charts (p95 latency, throughput, consumer lag, book
   risk), PSI drift by driver group and by feature against the training baseline, model registry with promotion,
   eight data-quality gates, topic/alert volumes, `/api/metrics` scrape endpoint, full re-ingest.

---

## 4. Machine learning

**Target** — `churn = 1` when a policyholder fails to renew (lapses or cancels).

**Features (44)** — engineered from raw CRM, transactional and usage columns, grouped into seven business-readable
driver groups:

| Group | Examples |
|---|---|
| Payments & collections | failed M-PESA debits, days in arrears, payment stress index, wallet activity |
| Product engagement | weekly usage, days since last login (log), 90-day logins, engagement velocity, dormancy ratio |
| Support & claims friction | tickets, complaints, claims, settlement time (log), friction load per policy year |
| Tenure & loyalty | tenure (log), policies held, agent engagement, CSAT, NPS |
| Pricing & value | premium (log), lifetime premium (log), renewal uplift %, discount %, value per interaction |
| Contract & distribution | billing cadence, plan tier, segment, channel, product line (one-hot, drop-first) |
| Customer profile | age, renewal window |

`policy status` is **deliberately excluded** — lapsed/cancelled is a consequence of the label and would leak the target.

**Models** — all implemented from scratch (no sklearn/XGBoost runtime available in the deploy target):

| Model | Implementation |
|---|---|
| Logistic Regression | standardised, L2-penalised, Adam full-batch GD, 420 iterations |
| Random Forest | 45 bagged histogram CART trees, depth 9, gini, per-split feature subsampling |
| Gradient Boosting | LightGBM-style: 32-bin histograms, 90 leaf-wise trees, depth 4, log-loss gradients/hessians, λ regularisation, row + feature subsampling |

**Evaluation** — stratified 78/22 split; ROC-AUC, PR-AUC (average precision), precision, recall, F1, specificity,
Brier, log-loss, KS, lift@D1, capture@D1–D2, 10-bin calibration, decile lift curve, threshold sweep, and a business
cost function in Kenyan shillings:

```
recovered   = TP × save_rate(31%) × avg_annual_premium × recoverable_share(82%)
spend       = (TP + FP) × intervention_cost (KES 1,450)
net_value   = recovered − spend
```

Champion selection is a composite of **0.42·PR-AUC + 0.28·ROC-AUC + 0.30·normalised net value** — never accuracy.
Typical result on the seeded book: ROC-AUC ≈ 0.87, PR-AUC ≈ 0.64 at a 20.5% base rate, ≈3.4x lift in the top decile.

**Explainability** — `kernelShap()` samples feature coalitions, scores each masked vector against an 8-row background
sample, fits a kernel-weighted local linear regression (Shapley kernel weights), then renormalises so attributions sum
exactly to `f(x) − E[f(background)]`. Batch scoring uses group-level occlusion so every queued retention play carries
a rationale at ~1 ms per customer.

**Retrieval & serving** — artefacts (weights, scaler, histogram bins, tree ensembles) are serialised as JSON into
`model_runs.artifact` and rehydrated on demand, cached in process memory. Promotion re-scores all 2,400 customers and
rewrites the retention queue.

---

## 5. Real-time path

`POST /api/stream {count}` simulates one Spark micro-batch:

1. sample customers (risk-biased) and draw events from a weighted recipe table across 5 topics;
2. mutate the raw telemetry columns exactly as the upstream system would (a failed debit increments
   `payment_failures`, adds arrears days, drops CSAT and wallet activity);
3. re-vectorise, re-score with the production artefact, compute per-group drivers;
4. version-bump the online feature store, upsert predictions and retention plays;
5. append events with `score_before` / `score_after` / `risk_delta`;
6. raise alerts on High/Critical band crossings;
7. emit Prometheus-style telemetry (throughput, window latency, consumer lag, book mean risk).

The dashboard polls this endpoint while **go live** is engaged and renders the ticker, movers and alert bus.

---

## 6. Data model

| Table | Role |
|---|---|
| `customers` | policyholder master + raw behavioural telemetry + label |
| `customer_events` | append-only stream log (topic, partition, offset, lag, payload, score delta) |
| `feature_store` | online materialised vectors, versioned per entity |
| `model_runs` | registry: metrics, params, importance, PSI baseline, serialised artefact, stage |
| `predictions` | per-customer score, band, revenue at risk, priority, drivers |
| `retention_actions` | dispatched play, owner, priority, status, cost, expected save, ROI |
| `alerts` | risk crossings, registry and retention notifications |
| `pipeline_metrics` | telemetry samples for SLO and drift panels |

---

## 7. API

| Method | Route | Purpose |
|---|---|---|
| POST | `/api/bootstrap` | run (or re-run with `{force:true}`) the end-to-end pipeline |
| GET | `/api/status` | shell status: production model, book risk, open alerts, event rate |
| GET | `/api/summary` | executive dashboard payload |
| GET | `/api/customers` | filtered, sorted, paginated explorer query + filter options |
| GET | `/api/customers/:id` | Customer 360 with live KernelSHAP explanation |
| POST | `/api/predict` | `{mode:"form"}` single profile or `{mode:"csv"}` batch scoring |
| GET/POST | `/api/models` | registry read · `{action:"promote",runId}` · `{action:"retrain"}` |
| GET/PATCH | `/api/retention` | queue read · play workflow updates |
| GET/POST | `/api/stream` | snapshot · emit one streaming micro-batch |
| GET/PATCH | `/api/alerts` | alert feed · acknowledge |
| GET/POST | `/api/monitoring` | SLOs, registry, quality, drift · `{action:"reset"}` re-ingest |
| GET | `/api/metrics` | Prometheus text exposition format |
| GET | `/api/health` | liveness |

---

## 8. Running it

```bash
npm install
npx drizzle-kit push     # create the schema
npm run dev              # or: npm run build && npm start
```

Open the app — the first visit shows the **cold-start gate**; triggering it runs ingestion, load, feature-store
materialisation, training of all three families, registry promotion, batch scoring, play generation and telemetry
backfill (≈5–10 s for 2,400 customers and ~27,000 events).

Environment: `DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/app_db`.

---

## 9. Stack

**Next.js (App Router, React Server Components) · TypeScript · PostgreSQL · Drizzle ORM · Tailwind CSS v4 ·
hand-rolled ML (logistic regression, random forest, histogram gradient boosting) · hand-rolled SHAP-style
explainer · hand-rolled SVG chart library · Prometheus-compatible metrics endpoint.**

The reference production topology (Kafka, Spark, MinIO, MLflow, FastAPI, Prometheus/Grafana) is mirrored 1:1 by the
modules in `src/lib` so each stage has a real, inspectable implementation inside one deployable unit.

> Data is synthetic and generated deterministically (`seed 20260214`) from an explicit latent non-renewal process, so
> trained models recover genuine, reproducible signal.
