import { createHash, createHmac, randomBytes, randomInt, scrypt as scryptCb, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const scrypt = promisify(scryptCb) as (pw: string, salt: Buffer, len: number) => Promise<Buffer>;

/** Format: scrypt$<salt hex>$<hash hex> */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const hash = await scrypt(password, salt, 64);
  return `scrypt$${salt.toString("hex")}$${hash.toString("hex")}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [scheme, saltHex, hashHex] = stored.split("$");
  if (scheme !== "scrypt" || !saltHex || !hashHex) return false;
  const expected = Buffer.from(hashHex, "hex");
  const actual = await scrypt(password, Buffer.from(saltHex, "hex"), expected.length);
  return timingSafeEqual(actual, expected);
}

/** A role key. Built-in keys (OWNER, ADMIN, ...) exist in every hospital; hospitals can define more. */
export type Role = string;

export const ROLE_ORDER: string[] = ["OWNER", "ADMIN", "DOCTOR", "NURSE", "PHARMACIST", "LAB_TECH", "RECEPTIONIST"];
export const primaryRole = (roles: Role[]): Role => ROLE_ORDER.find((r) => roles.includes(r)) ?? roles[0]!;

/** Hospital staff token: tied to one hospital. A person can hold several roles there (for example owner and doctor). */
export interface StaffClaims {
  kind: "staff";
  sub: string; // identity id
  tid: string; // tenant id
  role: Role; // primary role, for display
  roles: Role[];
}

/** Patient app token: only the phone-verified identity. Hospital access is decided per request from patient links. */
export interface PatientClaims {
  kind: "patient";
  sub: string; // identity id
}

/** Our own staff (platform operators). */
export interface PlatformClaims {
  kind: "platform";
  sub: string;
}

export type AccessClaims = StaffClaims | PatientClaims | PlatformClaims;

/** At least 8 characters with a letter and a digit. */
export const passwordProblem = (pw: string): string | null =>
  pw.length < 8 ? "Use at least 8 characters" : !/[A-Za-z]/.test(pw) || !/\d/.test(pw) ? "Use letters and numbers" : null;

/** A random password for a new staff account, shown once. No look-alike characters. */
export function temporaryPassword(): string {
  const chars = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789";
  let out = "";
  for (let i = 0; i < 12; i++) out += chars[randomInt(0, chars.length)];
  return `${out}7`;
}

export function newRefreshToken(): { token: string; hash: string } {
  const token = randomBytes(32).toString("base64url");
  return { token, hash: hashToken(token) };
}
export const hashToken = (t: string) => createHash("sha256").update(t).digest("hex");

// ───────────── permissions (the catalogue hospitals build their roles from) ─────────────

export interface PermissionDef { key: string; group: string; label: string }

export const PERMISSION_CATALOG: PermissionDef[] = [
  { key: "patients:read", group: "Patients", label: "View patients" },
  { key: "patients:write", group: "Patients", label: "Register and edit patients" },
  { key: "appointments:read", group: "Appointments", label: "View appointments" },
  { key: "appointments:write", group: "Appointments", label: "Book and update appointments" },
  { key: "appointments:override_slot", group: "Appointments", label: "Book outside a doctor's schedule" },
  { key: "clinical:read", group: "Clinical", label: "Read consultations and notes" },
  { key: "clinical:write", group: "Clinical", label: "Write consultations and prescriptions" },
  { key: "vitals:write", group: "Clinical", label: "Record vitals" },
  { key: "documents:read", group: "Documents", label: "View patient documents and the full history" },
  { key: "documents:write", group: "Documents", label: "Upload, scan and hide documents" },
  { key: "tele:conduct", group: "Clinical", label: "Run video consultations" },
  { key: "doctors:manage", group: "Clinical", label: "Manage doctor profiles and schedules" },
  { key: "cards:read", group: "Health cards", label: "View health cards" },
  { key: "cards:write", group: "Health cards", label: "Issue and renew health cards" },
  { key: "billing:read", group: "Billing", label: "View bills and collections" },
  { key: "billing:write", group: "Billing", label: "Create bills and take payments" },
  { key: "billing:refund", group: "Billing", label: "Refund money" },
  { key: "billing:close", group: "Billing", label: "Void bills, close the day, change prices" },
  { key: "pharmacy:read", group: "Pharmacy", label: "View medicines and stock" },
  { key: "pharmacy:write", group: "Pharmacy", label: "Manage medicines and adjust stock" },
  { key: "pharmacy:pos", group: "Pharmacy", label: "Sell at the counter (POS)" },
  { key: "pharmacy:purchase", group: "Pharmacy", label: "Suppliers, purchase orders and goods receipts" },
  { key: "pharmacy:returns", group: "Pharmacy", label: "Take sale returns" },
  { key: "pharmacy:transfer", group: "Pharmacy", label: "Transfer stock between branches" },
  { key: "pharmacy:reports", group: "Pharmacy", label: "Pharmacy reports and stock value" },
  { key: "lab:read", group: "Laboratory", label: "View lab orders and results" },
  { key: "lab:order", group: "Laboratory", label: "Order tests" },
  { key: "lab:write", group: "Laboratory", label: "Collect samples, enter and release results" },
  { key: "lab:release_override", group: "Laboratory", label: "Release a report before the bill is paid" },
  { key: "messages:read", group: "Messages", label: "View messages" },
  { key: "messages:write", group: "Messages", label: "Send and retry messages" },
  { key: "settings:write", group: "Administration", label: "Hospital profile and message settings" },
  { key: "team:manage", group: "Administration", label: "Manage staff accounts" },
  { key: "roles:manage", group: "Administration", label: "Create and edit roles" },
  { key: "policies:manage", group: "Administration", label: "Create and edit access policies" },
  { key: "branches:manage", group: "Administration", label: "Create and edit branches" },
  { key: "branches:all", group: "Administration", label: "Work in every branch" },
  { key: "ipd:read", group: "Inpatient", label: "View wards, beds and admitted patients" },
  { key: "ipd:write", group: "Inpatient", label: "Admit, transfer, record notes and discharge" },
  { key: "ipd:manage", group: "Inpatient", label: "Set up wards and beds" },
  { key: "insurance:read", group: "Insurance", label: "View claims and payers" },
  { key: "insurance:write", group: "Insurance", label: "Raise claims, pre-authorisations and record settlements" },
  { key: "insurance:manage", group: "Insurance", label: "Set up payers" },
  { key: "ot:read", group: "Operation theatre", label: "View the theatre schedule" },
  { key: "ot:write", group: "Operation theatre", label: "Book and record surgeries" },
  { key: "ot:manage", group: "Operation theatre", label: "Set up theatres" },
  { key: "er:read", group: "Emergency", label: "View the emergency board" },
  { key: "er:write", group: "Emergency", label: "Register, triage and treat emergency patients" },
  { key: "roster:read", group: "Staff", label: "View rosters, attendance and leave" },
  { key: "roster:manage", group: "Staff", label: "Plan rosters and decide leave" },
  { key: "payouts:read", group: "Staff", label: "View doctor revenue-share statements" },
  { key: "payouts:manage", group: "Staff", label: "Set doctor shares and approve payouts" },
  { key: "feedback:read", group: "Administration", label: "View patient feedback" },
  { key: "exports:read", group: "Administration", label: "Download exports and manage scheduled reports" },
  { key: "security:manage", group: "Administration", label: "Sign-in security for the organization" },
  { key: "executive:read", group: "Administration", label: "View the executive dashboard" },
  { key: "audit:read", group: "Administration", label: "Read the audit trail" },
  { key: "reports:read", group: "Administration", label: "View hospital reports and analytics" },
  { key: "tasks:manage", group: "Administration", label: "Create and assign tasks" },
  { key: "subscription:manage", group: "Administration", label: "Plan and Swasthya billing" },
];

export type Permission = string;
export const ALL_PERMISSIONS = PERMISSION_CATALOG.map((p) => p.key);
const OWNER_ONLY = ["subscription:manage", "roles:manage", "policies:manage", "security:manage"];

export interface RoleDef { key: string; name: string; description: string; permissions: string[] }

/** Roles every hospital starts with. A hospital can edit them (except Owner) or add its own. */
export const DEFAULT_ROLES: RoleDef[] = [
  { key: "OWNER", name: "Organization admin", description: "Controls the whole organisation: roles, permissions, access policies, plan and every feature", permissions: ["*"] },
  { key: "ADMIN", name: "Admin", description: "Runs the hospital day to day", permissions: ALL_PERMISSIONS.filter((p) => !OWNER_ONLY.includes(p)) },
  { key: "DOCTOR", name: "Doctor", description: "Consults, prescribes and orders tests", permissions: ["er:read", "er:write", "ot:read", "ot:write", "ipd:read", "ipd:write", "patients:read", "appointments:read", "appointments:write", "cards:read", "clinical:read", "clinical:write", "vitals:write", "pharmacy:read", "lab:read", "lab:order", "documents:read", "documents:write", "tele:conduct"] },
  { key: "NURSE", name: "Nurse", description: "Vitals and the clinical record", permissions: ["er:read", "er:write", "ot:read", "ipd:read", "ipd:write", "patients:read", "appointments:read", "cards:read", "clinical:read", "vitals:write", "pharmacy:read", "lab:read", "documents:read", "documents:write"] },
  { key: "RECEPTIONIST", name: "Reception", description: "Registration, appointments, health cards and bills", permissions: ["er:read", "er:write", "insurance:read", "insurance:write", "ipd:read", "ipd:write", "patients:read", "patients:write", "appointments:read", "appointments:write", "cards:read", "cards:write", "billing:read", "billing:write", "lab:read", "messages:read", "messages:write", "documents:read", "documents:write"] },
  { key: "PHARMACIST", name: "Pharmacist", description: "Runs the pharmacy and its counter", permissions: ["patients:read", "pharmacy:read", "pharmacy:write", "pharmacy:pos", "pharmacy:purchase", "pharmacy:returns", "pharmacy:transfer", "pharmacy:reports"] },
  { key: "CASHIER", name: "Pharmacy cashier", description: "Sells at the counter and takes returns, nothing else", permissions: ["patients:read", "pharmacy:read", "pharmacy:pos", "pharmacy:returns"] },
  { key: "LAB_TECH", name: "Lab technician", description: "Collects samples and reports results", permissions: ["patients:read", "lab:read", "lab:write", "documents:read", "documents:write"] },
];

const matches = (granted: string, wanted: string) => granted === "*" || granted === wanted || (granted.endsWith(":*") && wanted.startsWith(granted.slice(0, -1)));

/** True when any granted permission covers `wanted`. `*` grants everything and `group:*` a whole group. */
export function can(granted: string[] | Set<string>, wanted: Permission): boolean {
  for (const g of granted) if (matches(g, wanted)) return true;
  return false;
}

// ───────────── policies: attribute rules on top of roles ─────────────

export type Op = "eq" | "ne" | "gt" | "gte" | "lt" | "lte" | "in" | "notIn" | "containsAny" | "notContainsAny";
export interface Condition { attr: string; op: Op; value: unknown }
export interface Policy {
  id: string; name: string; enabled: boolean; permission: string; appliesToRoles: string[]; conditions: Condition[]; message: string;
  /** ALL (default): every condition must hold. ANY: one is enough. */
  match?: "ALL" | "ANY";
  exceptRoles?: string[];
  validFrom?: Date | null;
  validUntil?: Date | null;
}

/** What a policy can look at. `roles` is the caller's role keys; the rest comes from the request or the action. */
export interface PolicyContext { permission: string; roles: string[]; attrs: Record<string, unknown>; now?: Date }

export const POLICY_ATTRIBUTES: { attr: string; label: string; type: "number" | "list" | "text"; hint: string }[] = [
  { attr: "amountPaise", label: "Amount (paise)", type: "number", hint: "Refund, payment or sale value" },
  { attr: "discountPercent", label: "Discount (%)", type: "number", hint: "Discount on a bill or sale" },
  { attr: "quantity", label: "Quantity", type: "number", hint: "Units adjusted or written off" },
  { attr: "hour", label: "Hour of day (0-23, IST)", type: "number", hint: "Time of the request" },
  { attr: "weekday", label: "Weekday (0 = Sunday)", type: "number", hint: "Day of the request" },
  { attr: "roles", label: "Caller's roles", type: "list", hint: "Role keys such as OWNER" },
  { attr: "branchCode", label: "Branch code", type: "text", hint: "Branch the action happens in" },
  { attr: "userId", label: "Person", type: "text", hint: "The signed-in person's id" },
  { attr: "date", label: "Date (YYYY-MM-DD, IST)", type: "text", hint: "Today's date, for a named day or holiday" },
];

function compare(actual: unknown, op: Op, expected: unknown): boolean {
  const list = (v: unknown) => (Array.isArray(v) ? v : [v]);
  switch (op) {
    case "eq": return actual === expected;
    case "ne": return actual !== expected;
    case "gt": return typeof actual === "number" && typeof expected === "number" && actual > expected;
    case "gte": return typeof actual === "number" && typeof expected === "number" && actual >= expected;
    case "lt": return typeof actual === "number" && typeof expected === "number" && actual < expected;
    case "lte": return typeof actual === "number" && typeof expected === "number" && actual <= expected;
    case "in": return list(expected).includes(actual);
    case "notIn": return !list(expected).includes(actual);
    case "containsAny": return list(actual).some((a) => list(expected).includes(a));
    case "notContainsAny": return !list(actual).some((a) => list(expected).includes(a));
    default: return false;
  }
}

/**
 * Returns the first enabled policy that denies the action, or null. A condition on an attribute the action does not supply
 * is false, so a rule about amounts never fires on an action that has no amount. A malformed rule never grants access.
 */
export function deniedBy(policies: Policy[], ctx: PolicyContext): Policy | null {
  const now = ctx.now ?? new Date();
  for (const p of policies) {
    if (!p.enabled || !matches(p.permission, ctx.permission)) continue;
    if (p.validFrom && now < p.validFrom) continue;
    if (p.validUntil && now >= p.validUntil) continue;
    if (p.appliesToRoles.length > 0 && !ctx.roles.some((r) => p.appliesToRoles.includes(r))) continue;
    if (p.exceptRoles?.length && ctx.roles.some((r) => p.exceptRoles!.includes(r))) continue;
    const attrs: Record<string, unknown> = { ...ctx.attrs, roles: ctx.roles };
    const test = (c: Condition) => c.attr in attrs && compare(attrs[c.attr], c.op, c.value);
    if (p.conditions.length === 0) return p;
    if ((p.match === "ANY" ? p.conditions.some(test) : p.conditions.every(test))) return p;
  }
  return null;
}

// ───────────── per-person exceptions ─────────────

export interface AccessOverride { permission: string; effect: "GRANT" | "REVOKE"; expiresAt?: Date | null }

/** Turns wildcards into the concrete permissions they stand for, so single permissions can be added or taken away. */
export function expandPermissions(granted: Iterable<string>): Set<string> {
  const out = new Set<string>();
  for (const g of granted) {
    if (g === "*") { for (const p of ALL_PERMISSIONS) out.add(p); continue; }
    if (g.endsWith(":*")) { for (const p of ALL_PERMISSIONS) if (p.startsWith(g.slice(0, -1))) out.add(p); continue; }
    out.add(g);
  }
  return out;
}

/** What a person can do: their roles, plus their unexpired grants, minus their unexpired revokes. A revoke wins over a grant. */
export function effectivePermissions(rolePermissions: Iterable<string>, overrides: AccessOverride[], now = new Date()): Set<string> {
  const set = expandPermissions(rolePermissions);
  const live = overrides.filter((o) => !o.expiresAt || o.expiresAt > now);
  for (const o of live) if (o.effect === "GRANT") for (const p of expandPermissions([o.permission])) set.add(p);
  for (const o of live) if (o.effect === "REVOKE") for (const p of expandPermissions([o.permission])) set.delete(p);
  return set;
}

/** 6-digit one-time code. */
export function generateOtp(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, "0");
}

export function hashOtp(phone: string, code: string, secret: string): string {
  return createHmac("sha256", secret).update(`${phone}:${code}`).digest("hex");
}

export function safeEqualHex(a: string, b: string): boolean {
  const x = Buffer.from(a, "hex");
  const y = Buffer.from(b, "hex");
  return x.length === y.length && timingSafeEqual(x, y);
}
