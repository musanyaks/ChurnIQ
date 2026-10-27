/**
 * Deterministic synthetic data generator for the ChurnIQ platform.
 *
 * Simulates a Kenyan insurer / mobile-money-linked cover book:
 * policyholders across counties, product lines and acquisition channels, with
 * an explicit latent churn (non-renewal) process so that trained models learn
 * genuine, recoverable signal rather than noise.
 */

export type CustomerRow = {
  id: string;
  fullName: string;
  email: string;
  phone: string;
  county: string;
  city: string;
  segment: string;
  productLine: string;
  channel: string;
  contractType: string;
  planTier: string;
  status: string;
  gender: string;
  age: number;
  tenureMonths: number;
  policiesHeld: number;
  premiumMonthly: number;
  lifetimePremium: number;
  paymentFailures: number;
  latePaymentDays: number;
  supportTickets: number;
  complaints: number;
  claimsCount: number;
  claimSettlementDays: number;
  lastLoginDays: number;
  loginFrequency: number;
  usageFrequency: number;
  mpesaActivity: number;
  satisfactionScore: number;
  npsScore: number;
  discountPct: number;
  premiumIncreasePct: number;
  agentEngagement: number;
  renewalDueInDays: number;
  churn: number;
  onboardedAt: Date;
  updatedAt: Date;
};

export type EventRow = {
  customerId: string;
  topic: string;
  eventType: string;
  severity: string;
  payload: Record<string, unknown>;
  partition: number;
  streamOffset: number;
  lagMs: number;
  processed: boolean;
  occurredAt: Date;
  ingestedAt: Date;
};

/* ------------------------------------------------------------------ */
/* PRNG                                                                */
/* ------------------------------------------------------------------ */

export function mulberry32(seed: number) {
  let a = seed >>> 0;
  return function rand() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Rng = () => number;

const pick = <T,>(r: Rng, arr: readonly T[]): T => arr[Math.floor(r() * arr.length) % arr.length];
const between = (r: Rng, lo: number, hi: number) => lo + r() * (hi - lo);
const intBetween = (r: Rng, lo: number, hi: number) => Math.floor(between(r, lo, hi + 1));

function gaussian(r: Rng, mean = 0, sd = 1) {
  let u = 0;
  let v = 0;
  while (u === 0) u = r();
  while (v === 0) v = r();
  return mean + sd * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

function poisson(r: Rng, lambda: number) {
  const L = Math.exp(-lambda);
  let k = 0;
  let p = 1;
  do {
    k += 1;
    p *= r();
  } while (p > L && k < 40);
  return k - 1;
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/* ------------------------------------------------------------------ */
/* Kenyan reference data                                               */
/* ------------------------------------------------------------------ */

export const COUNTIES: ReadonlyArray<{ county: string; city: string; weight: number }> = [
  { county: "Nairobi", city: "Nairobi", weight: 0.26 },
  { county: "Mombasa", city: "Mombasa", weight: 0.1 },
  { county: "Kisumu", city: "Kisumu", weight: 0.09 },
  { county: "Nakuru", city: "Nakuru", weight: 0.09 },
  { county: "Uasin Gishu", city: "Eldoret", weight: 0.07 },
  { county: "Kiambu", city: "Thika", weight: 0.07 },
  { county: "Machakos", city: "Machakos", weight: 0.05 },
  { county: "Kajiado", city: "Ngong", weight: 0.05 },
  { county: "Nyeri", city: "Nyeri", weight: 0.04 },
  { county: "Meru", city: "Meru", weight: 0.04 },
  { county: "Kakamega", city: "Kakamega", weight: 0.04 },
  { county: "Kilifi", city: "Malindi", weight: 0.03 },
  { county: "Bungoma", city: "Bungoma", weight: 0.03 },
  { county: "Kericho", city: "Kericho", weight: 0.02 },
  { county: "Garissa", city: "Garissa", weight: 0.02 },
];

const FIRST_M = [
  "Brian","Kevin","James","Peter","John","Samuel","David","Moses","Joseph","Daniel","Elijah","Collins",
  "Victor","Vincent","Kenneth","Baraka","Otieno","Kipchoge","Mutua","Hassan","Abdi","Nelson","Dennis","Felix",
] as const;
const FIRST_F = [
  "Wanjiru","Achieng","Njeri","Akinyi","Mumbi","Faith","Grace","Mercy","Nancy","Lilian","Zainab","Halima",
  "Chebet","Nyambura","Wambui","Joyce","Cynthia","Amina","Esther","Beatrice","Sharon","Josephine","Damaris","Asha",
] as const;
const SURNAMES = [
  "Kamau","Ochieng","Mwangi","Otieno","Kiprop","Wanjala","Njoroge","Mutiso","Kimani","Odhiambo","Karanja","Chebet",
  "Macharia","Hassan","Abdi","Wafula","Njenga","Koech","Lutta","Mumo","Githinji","Ouma","Kibet","Nderitu","Juma",
  "Maina","Rotich","Omondi","Kariuki","Mukami",
] as const;

export const PRODUCT_LINES = [
  "Motor Cover",
  "Health Cover",
  "Life & Education",
  "Agri-Index Cover",
  "SME Biashara Pack",
  "Mobile Wallet Cover",
  "Domestic Travel",
] as const;

export const CHANNELS = ["Field Agent", "Bancassurance", "Digital App / USSD", "Broker", "Telco Bundle"] as const;
export const SEGMENTS = ["Consumer", "SME", "Enterprise", "Corporate"] as const;
export const CONTRACT_TYPES = ["Monthly", "Quarterly", "Annual"] as const;
export const PLAN_TIERS = ["Jamii", "Plus", "Premium", "Biashara"] as const;

const PREMIUM_BASE: Record<string, [number, number]> = {
  "Motor Cover": [3200, 18000],
  "Health Cover": [4500, 26000],
  "Life & Education": [1800, 12000],
  "Agri-Index Cover": [900, 6500],
  "SME Biashara Pack": [12000, 78000],
  "Mobile Wallet Cover": [250, 1800],
  "Domestic Travel": [600, 3400],
};

const SEGMENT_MIX: Record<string, string[]> = {
  Consumer: ["Mobile Wallet Cover", "Health Cover", "Life & Education", "Agri-Index Cover", "Domestic Travel"],
  SME: ["SME Biashara Pack", "Motor Cover", "Health Cover", "Domestic Travel"],
  Enterprise: ["Motor Cover", "Health Cover", "SME Biashara Pack"],
  Corporate: ["Health Cover", "Motor Cover", "SME Biashara Pack"],
};

/* ------------------------------------------------------------------ */
/* Latent churn process                                                */
/* ------------------------------------------------------------------ */

const sigmoid = (z: number) => 1 / (1 + Math.exp(-z));

type Latent = {
  zPayment: number;
  zUsage: number;
  zSatisfaction: number;
  zTenure: number;
  zPrice: number;
  zClaims: number;
  zDigital: number;
  zSupport: number;
};

function latentWeights(lat: Latent, contractMonthly: boolean) {
  return (
    0.78 * lat.zPayment +
    -0.62 * lat.zUsage +
    -0.7 * lat.zSatisfaction +
    -0.44 * lat.zTenure +
    0.48 * lat.zPrice +
    0.36 * lat.zClaims +
    -0.24 * lat.zDigital +
    0.42 * lat.zSupport +
    (contractMonthly ? 0.5 : -0.18) +
    -1.55
  );
}

/* ------------------------------------------------------------------ */
/* Dataset generation                                                  */
/* ------------------------------------------------------------------ */

export function generateDataset(count: number, seed = 20260214) {
  const r = mulberry32(seed);
  const rows: CustomerRow[] = [];
  const events: EventRow[] = [];
  // Anchor the book to the current wall clock so the trailing-12-month churn
  // trend, event recency and 24h ingest counters always line up with "today".
  const now = new Date();
  let offset = 1;

  const countyBag: typeof COUNTIES[number][] = [];
  COUNTIES.forEach((c) => {
    const n = Math.max(1, Math.round(c.weight * count));
    for (let i = 0; i < n; i += 1) countyBag.push(c);
  });

  for (let i = 0; i < count; i += 1) {
    const gender = r() < 0.51 ? "Female" : "Male";
    const first = gender === "Female" ? pick(r, FIRST_F) : pick(r, FIRST_M);
    const last = pick(r, SURNAMES);
    const fullName = `${first} ${last}`;
    const loc = countyBag.length ? countyBag[Math.floor(r() * countyBag.length) % countyBag.length] : COUNTIES[0];

    const segmentRoll = r();
    const segment =
      segmentRoll < 0.52 ? "Consumer" : segmentRoll < 0.8 ? "SME" : segmentRoll < 0.95 ? "Enterprise" : "Corporate";
    const productLine = pick(r, SEGMENT_MIX[segment] ?? PRODUCT_LINES);
    const channel = pick(r, CHANNELS);
    const contractType =
      segment === "Consumer"
        ? pick(r, ["Monthly", "Monthly", "Monthly", "Quarterly", "Annual"] as const)
        : pick(r, CONTRACT_TYPES);
    const planTier =
      segment === "Consumer"
        ? pick(r, ["Jamii", "Jamii", "Plus", "Premium"] as const)
        : segment === "SME"
          ? pick(r, ["Plus", "Premium", "Biashara"] as const)
          : "Biashara";

    const tenureMonths = Math.round(clamp(Math.exp(gaussian(r, 2.7, 0.95)), 1, 108));
    const age = Math.round(clamp(gaussian(r, segment === "Consumer" ? 34 : 44, 10), 19, 74));

    const [lo, hi] = PREMIUM_BASE[productLine] ?? [1500, 9000];
    const segmentMult = segment === "Consumer" ? 1 : segment === "SME" ? 2.4 : segment === "Enterprise" ? 7.5 : 18;
    const tierMult = planTier === "Jamii" ? 0.72 : planTier === "Plus" ? 1 : planTier === "Premium" ? 1.55 : 2.1;
    const premiumMonthly = Math.round(between(r, lo, hi) * segmentMult * tierMult * clamp(gaussian(r, 1, 0.22), 0.55, 1.9));

    // Behavioural features — mutually correlated, as in real telemetry.
    const disengagement = clamp(gaussian(r, 0, 1), -2.4, 3.2);
    const financialStress = clamp(gaussian(r, 0, 1) * 0.6 + disengagement * 0.55, -2.2, 3.6);

    const paymentFailures = poisson(r, clamp(0.35 + financialStress * 0.9, 0.02, 6));
    const latePaymentDays = Math.round(clamp(financialStress * 9 + Math.max(0, gaussian(r, 3, 4)), 0, 74));
    const supportTickets = poisson(r, clamp(1.1 + disengagement * 0.55, 0.05, 7));
    const complaints = poisson(r, clamp(0.28 + disengagement * 0.42 + financialStress * 0.2, 0.01, 4));
    const claimsCount = poisson(r, clamp(0.9 + tenureMonths / 26, 0.05, 8));
    const claimSettlementDays =
      claimsCount === 0 ? 0 : Math.round(clamp(gaussian(r, 24, 14) + complaints * 4, 2, 118));

    const usageFrequency = clamp(gaussian(r, 11 - disengagement * 3.6, 3), 0, 30);
    const lastLoginDays = Math.round(clamp(Math.exp(gaussian(r, 1.5 + disengagement * 0.75, 0.8)), 0, 178));
    const loginFrequency = Math.round(clamp(usageFrequency * 3.4 + gaussian(r, 0, 4), 0, 130));
    const mpesaActivity = clamp(gaussian(r, 18 - disengagement * 5, 6), 0, 60);
    const satisfactionScore = clamp(Math.round((3.9 - disengagement * 0.72 + gaussian(r, 0, 0.45)) * 2) / 2, 1, 5);
    const npsScore = Math.round(clamp(satisfactionScore * 18 - 42 + gaussian(r, 0, 14), -100, 100));
    const discountPct = clamp(Math.round(gaussian(r, 8, 6)), 0, 35);
    const premiumIncreasePct = clamp(Math.round((7 + financialStress * 4.5 + gaussian(r, 0, 5)) * 10) / 10, -4, 34);
    const agentEngagement = clamp(Math.round((2.6 - disengagement * 0.9 + gaussian(r, 0, 1)) * 10) / 10, 0, 10);
    const renewalDueInDays = intBetween(r, 2, 330);
    const policiesHeld = 1 + poisson(r, segment === "Consumer" ? 0.25 : segment === "SME" ? 0.8 : 1.8);

    const lat: Latent = {
      zPayment: (paymentFailures * 0.55 + latePaymentDays / 24) / 1.15 - 0.55,
      zUsage: (usageFrequency - 10) / 5.2,
      zSatisfaction: (satisfactionScore - 3.4) / 0.85,
      zTenure: (Math.log(tenureMonths + 1) - 2.8) / 1.0,
      zPrice: (premiumIncreasePct - 8) / 7.5,
      zClaims: claimsCount === 0 ? -0.45 : (claimSettlementDays - 26) / 26,
      zDigital: (mpesaActivity - 15) / 8,
      zSupport: (supportTickets * 0.6 + complaints * 1.1) / 1.6 - 0.7,
    };

    const z = latentWeights(lat, contractType === "Monthly") + gaussian(r, 0, 0.5);
    const p = sigmoid(z);
    const churn = r() < p ? 1 : 0;

    const status = churn
      ? r() < 0.62
        ? "Lapsed"
        : "Cancelled"
      : renewalDueInDays <= 30
        ? "Renewal Due"
        : "Active";

    const onboardedAt = new Date(now.getTime() - tenureMonths * 30.44 * 86400000);

    const id = `CIQ-${(10000 + i).toString()}`;
    rows.push({
      id,
      fullName,
      email: `${first.toLowerCase()}.${last.toLowerCase()}${intBetween(r, 1, 99)}@${pick(r, [
        "mail.co.ke",
        "safari.mail.ke",
        "biashara.co.ke",
        "inbox.africa",
      ] as const)}`,
      phone: `+2547${intBetween(r, 10000000, 99999999)}`,
      county: loc.county,
      city: loc.city,
      segment,
      productLine,
      channel,
      contractType,
      planTier,
      status,
      gender,
      age,
      tenureMonths,
      policiesHeld,
      premiumMonthly,
      lifetimePremium: Math.round(premiumMonthly * tenureMonths * between(r, 0.86, 1.02)),
      paymentFailures,
      latePaymentDays,
      supportTickets,
      complaints,
      claimsCount,
      claimSettlementDays,
      lastLoginDays,
      loginFrequency,
      usageFrequency: Math.round(usageFrequency * 10) / 10,
      mpesaActivity: Math.round(mpesaActivity * 10) / 10,
      satisfactionScore,
      npsScore,
      discountPct,
      premiumIncreasePct,
      agentEngagement,
      renewalDueInDays,
      churn,
      onboardedAt,
      updatedAt: now,
    });

    /* ---------------- event history (Kafka topics) ---------------- */
    const pushEvent = (
      topic: string,
      eventType: string,
      severity: string,
      daysAgo: number,
      payload: Record<string, unknown>,
    ) => {
      const occurredAt = new Date(now.getTime() - daysAgo * 86400000 - intBetween(r, 0, 82800) * 1000);
      offset += 1;
      events.push({
        customerId: id,
        topic,
        eventType,
        severity,
        payload,
        partition: intBetween(r, 0, 5),
        streamOffset: offset,
        lagMs: intBetween(r, 40, 940),
        processed: true,
        occurredAt,
        ingestedAt: new Date(occurredAt.getTime() + intBetween(r, 120, 4200)),
      });
    };

    for (let f = 0; f < Math.min(paymentFailures, 5); f += 1) {
      pushEvent("payments", "mpesa_debit_failed", "critical", intBetween(r, 1, 96), {
        attempt: f + 1,
        amount: premiumMonthly,
        reason: pick(r, ["insufficient_funds", "wrong_pin", "network_timeout", "limit_exceeded"] as const),
        channel: "M-PESA STK Push",
      });
    }
    for (let t = 0; t < Math.min(supportTickets, 4); t += 1) {
      pushEvent("support_events", "ticket_opened", complaints > t ? "warn" : "info", intBetween(r, 1, 150), {
        category: pick(r, ["claims_status", "billing", "policy_change", "app_access", "cover_clarification"] as const),
        channel: pick(r, ["call_centre", "whatsapp", "email", "branch"] as const),
        firstResponseMins: intBetween(r, 4, 900),
      });
    }
    for (let c = 0; c < Math.min(complaints, 3); c += 1) {
      pushEvent("support_events", "complaint_filed", "critical", intBetween(r, 2, 120), {
        escalated: r() < 0.4,
        channel: pick(r, ["IRA_portal", "social_media", "call_centre", "branch"] as const),
      });
    }
    for (let c = 0; c < Math.min(claimsCount, 3); c += 1) {
      pushEvent("transactions", "claim_submitted", "warn", intBetween(r, 5, 300), {
        claimAmount: Math.round(premiumMonthly * between(r, 2, 22)),
        settlementDays: claimSettlementDays || undefined,
        status: claimSettlementDays > 45 ? "delayed" : "settled",
      });
    }
    const paidCount = clamp(Math.round(tenureMonths / 6) - paymentFailures, 1, 8);
    for (let pIdx = 0; pIdx < paidCount; pIdx += 1) {
      pushEvent("transactions", "premium_paid", "info", intBetween(r, 1, Math.max(2, tenureMonths * 30)), {
        amount: premiumMonthly,
        method: pick(r, ["M-PESA", "bank_transfer", "card", "agent_cash"] as const),
        receipt: `QGH${intBetween(r, 100000, 999999)}`,
      });
    }
    const usageEvents = clamp(Math.round(usageFrequency / 3), 1, 5);
    for (let u = 0; u < usageEvents; u += 1) {
      pushEvent("usage_events", lastLoginDays > 21 ? "session_dropped" : "app_session", lastLoginDays > 21 ? "warn" : "info", intBetween(r, 0, Math.max(1, lastLoginDays + 12)), {
        surface: pick(r, ["mobile_app", "ussd_*126#", "web_portal", "whatsapp_bot"] as const),
        minutes: intBetween(r, 1, 34),
      });
    }
    if (churn) {
      // Lapse/cancellation dates spread across the trailing 12 months,
      // weighted towards the most recent quarter -> powers the churn trend.
      const lapseDaysAgo = Math.max(0, Math.round(r() ** 1.7 * 364));
      pushEvent("customer_events", r() < 0.58 ? "policy_lapsed" : "policy_cancelled", "critical", lapseDaysAgo, {
        reason: pick(r, [
          "premium_non_payment",
          "switched_to_competitor",
          "budget_pressure",
          "poor_claim_experience",
          "no_longer_needs_cover",
        ] as const),
        outstandingBalance: Math.round(premiumMonthly * clamp(financialStress, 0, 3)),
        renewalDueInDays,
      });
    } else {
      pushEvent("customer_events", renewalDueInDays <= 45 ? "renewal_reminder_sent" : "policy_viewed", "info", intBetween(r, 0, 45), {
        renewalDueInDays,
        premiumMonthly,
      });
    }
  }

  events.sort((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime());
  events.forEach((e, idx) => {
    e.streamOffset = idx + 1;
  });

  return { customers: rows, events };
}
