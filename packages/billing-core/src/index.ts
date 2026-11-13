export type PlanCode = "PAY_PER_PATIENT" | "STARTER" | "UNLIMITED";
export type Feature = "cards" | "pharmacy" | "lab" | "messaging" | "multi_branch" | "api" | "documents" | "tele" | "tasks" | "reports" | "scan" | "imports" | "ipd" | "insurance" | "ot" | "emergency" | "workforce" | "feedback";

/** Every switchable feature, for the operator's console. `group` only organises the list. */
export const FEATURE_CATALOG: { key: Feature; label: string; description: string; group: "Clinical" | "Operations" | "Growth" }[] = [
  { key: "cards", label: "Health cards", description: "Subscription health cards with covered visits", group: "Growth" },
  { key: "pharmacy", label: "Pharmacy and POS", description: "Medicine catalogue, stock, counter sales, purchasing, returns", group: "Operations" },
  { key: "lab", label: "Laboratory", description: "Test orders, sample collection, results and reports", group: "Clinical" },
  { key: "messaging", label: "SMS and WhatsApp", description: "Appointment confirmations, reminders and report alerts", group: "Growth" },
  { key: "multi_branch", label: "Multiple branches", description: "More than one branch with per-branch scoping", group: "Operations" },
  { key: "api", label: "API access", description: "Integrations with other software", group: "Growth" },
  { key: "documents", label: "Documents and scans", description: "Scanned prescriptions and outside reports in the record", group: "Clinical" },
  { key: "tele", label: "Tele-consultation", description: "Video visits and the waiting room", group: "Clinical" },
  { key: "tasks", label: "Tasks", description: "Assigning follow-ups and chores to staff", group: "Operations" },
  { key: "reports", label: "Reports and analytics", description: "Revenue, visit, patient, clinical and lab reports", group: "Operations" },
  { key: "scan", label: "Scan to act", description: "Barcode and QR scanning that checks in, collects and opens", group: "Operations" },
  { key: "ipd", label: "Inpatient care (IPD)", description: "Wards and beds, admissions, nursing notes, transfers and discharge summaries", group: "Clinical" },
  { key: "insurance", label: "Insurance and TPA", description: "Pre-authorisation, claims, settlements and payer receivables", group: "Operations" },
  { key: "ot", label: "Operation theatres", description: "Theatre schedule, surgery booking with clash checks, and the surgical record", group: "Clinical" },
  { key: "emergency", label: "Emergency", description: "Triage board, arrival modes, door-to-doctor times and admission from the ER", group: "Clinical" },
  { key: "workforce", label: "Staff rosters and payouts", description: "Shifts, attendance, leave, and doctor revenue-share statements", group: "Operations" },
  { key: "feedback", label: "Patient feedback", description: "Satisfaction scores and comments after visits and discharge", group: "Growth" },
  { key: "imports", label: "Spreadsheet import", description: "Bulk import of patients and medicines", group: "Operations" },
];
const COMMON: Feature[] = ["documents", "tele", "tasks", "reports", "scan", "imports", "feedback"];

export interface Plan {
  code: PlanCode;
  label: string;
  /** Flat monthly fee in paise (before GST). */
  monthlyPaise: number;
  /** Fee per newly registered patient, once for life, in paise (before GST). */
  perPatientPaise: number;
  /** Staff accounts allowed. */
  seats: number;
  /** Free SMS/WhatsApp messages per month; each message above this is billed at MESSAGE_OVERAGE_PAISE. */
  messageQuota: number;
  features: Feature[];
}

export const PLANS: Record<PlanCode, Plan> = {
  PAY_PER_PATIENT: { code: "PAY_PER_PATIENT", label: "Pay per patient", monthlyPaise: 0, perPatientPaise: 20_000, seats: 3, messageQuota: 0, features: ["cards", ...COMMON] },
  STARTER: { code: "STARTER", label: "Starter", monthlyPaise: 1_000_000, perPatientPaise: 0, seats: 10, messageQuota: 500, features: ["cards", "pharmacy", "lab", "messaging", ...COMMON] },
  UNLIMITED: { code: "UNLIMITED", label: "Unlimited", monthlyPaise: 2_000_000, perPatientPaise: 0, seats: 1000, messageQuota: 2000, features: ["cards", "pharmacy", "lab", "messaging", "multi_branch", "api", "ipd", "insurance", "ot", "emergency", "workforce", ...COMMON] },
};

/** Cost passed through for each message beyond the plan quota: Rs 0.25. */
export const MESSAGE_OVERAGE_PAISE = 25;
/** GST charged on our own invoices to hospitals. */
export const PLATFORM_GST_PERCENT = 18;
export const TRIAL_DAYS = 30;
/** A hospital with an invoice overdue by more than this is suspended (read-only). */
export const GRACE_DAYS = 7;
export const INVOICE_DUE_DAYS = 10;

export const hasFeature = (plan: PlanCode, f: Feature) => PLANS[plan].features.includes(f);
export const seatLimit = (plan: PlanCode, override?: number | null) => override ?? PLANS[plan].seats;

/**
 * What a hospital can use: its plan's features, with the operator's per-hospital switches on top. A running trial unlocks everything the plan
 * tops out at, but an explicit "off" still wins, so the operator can hold back a module even during a trial.
 */
export function resolveFeatures(plan: PlanCode, overrides: Record<string, boolean> = {}, extra: Feature[] = []): Feature[] {
  const on = new Set<Feature>([...PLANS[plan].features, ...extra]);
  for (const [k, v] of Object.entries(overrides)) { if (v) on.add(k as Feature); else on.delete(k as Feature); }
  return [...on];
}

export interface InvoiceLine { description: string; quantity: number; unitPaise: number; amountPaise: number }

/** What a hospital owes for one calendar month. Pay-per-patient hospitals pay for patients registered in the month. */
export function computePlatformInvoice(o: { plan: PlanCode; patientsAdded: number; messagesSent: number }) {
  const p = PLANS[o.plan];
  const lines: InvoiceLine[] = [];
  if (p.monthlyPaise > 0) lines.push({ description: `${p.label} plan, monthly subscription`, quantity: 1, unitPaise: p.monthlyPaise, amountPaise: p.monthlyPaise });
  if (p.perPatientPaise > 0 && o.patientsAdded > 0) lines.push({ description: "New patient registrations", quantity: o.patientsAdded, unitPaise: p.perPatientPaise, amountPaise: o.patientsAdded * p.perPatientPaise });
  const over = Math.max(0, o.messagesSent - p.messageQuota);
  if (over > 0 && p.messageQuota > 0) lines.push({ description: `Messages above the ${p.messageQuota} included`, quantity: over, unitPaise: MESSAGE_OVERAGE_PAISE, amountPaise: over * MESSAGE_OVERAGE_PAISE });
  const subtotalPaise = lines.reduce((s, l) => s + l.amountPaise, 0);
  const gstPaise = Math.round((subtotalPaise * PLATFORM_GST_PERCENT) / 100);
  return { lines, subtotalPaise, gstPaise, totalPaise: subtotalPaise + gstPaise };
}

/** Tax contained in a tax-inclusive amount: amount - amount / (1 + rate). */
export const taxInside = (amountPaise: number, gstPercent: number) => (gstPercent === 0 ? 0 : amountPaise - Math.round((amountPaise * 100) / (100 + gstPercent)));

/** First and last day of the calendar month (UTC dates) containing `d` in IST. */
export function monthOf(d: Date) {
  const ist = new Date(d.getTime() + 5.5 * 3600_000);
  const y = ist.getUTCFullYear();
  const m = ist.getUTCMonth();
  return { start: new Date(Date.UTC(y, m, 1)), end: new Date(Date.UTC(y, m + 1, 0)), label: `${y}-${String(m + 1).padStart(2, "0")}` };
}

export interface TenantPlanState { planCode: PlanCode; status: "TRIAL" | "ACTIVE" | "SUSPENDED" | "CLOSED"; trialEndsAt: Date | null }

/** During a running trial every feature is unlocked; afterwards the chosen plan applies. */
export const effectivePlan = (t: TenantPlanState, now = new Date()): PlanCode => (t.status === "TRIAL" && t.trialEndsAt && t.trialEndsAt > now ? "UNLIMITED" : t.planCode);

/** Why the hospital can only read, not write; null when it can work normally. */
export function readOnlyReason(t: TenantPlanState, suspendedReason?: string | null, now = new Date()): string | null {
  if (t.status === "SUSPENDED") return suspendedReason === "unpaid_invoice" ? "Your account is read-only because a Swasthya invoice is overdue. Pay it to continue." : "Your account is suspended. Contact Swasthya support.";
  if (t.status === "CLOSED") return "This hospital account is closed.";
  if (t.status === "TRIAL" && t.trialEndsAt && t.trialEndsAt <= now) return "Your free trial has ended. Choose a plan to continue.";
  return null;
}
export * from "./gateway";
