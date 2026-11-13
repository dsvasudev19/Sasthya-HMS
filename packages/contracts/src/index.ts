import { z } from "zod";

export const genderSchema = z.enum(["FEMALE", "MALE", "OTHER"]);

export const createPatientInput = z.object({
  fullName: z.string().trim().min(2).max(120),
  gender: genderSchema.optional(),
  dateOfBirth: z.coerce.date().optional(),
  phone: z
    .string()
    .regex(/^[6-9]\d{9}$/, "Enter a 10-digit Indian mobile number")
    .optional(),
});
export type CreatePatientInput = z.infer<typeof createPatientInput>;

export const patientDto = z.object({
  id: z.string().uuid(),
  patientNo: z.string(),
  fullName: z.string(),
  gender: genderSchema.nullable(),
  dateOfBirth: z.coerce.date().nullable(),
  phone: z.string().nullable(),
  createdAt: z.coerce.date(),
});
export type PatientDto = z.infer<typeof patientDto>;

export const loginInput = z.object({
  phone: z.string().regex(/^[6-9]\d{9}$/, "Enter a 10-digit Indian mobile number"),
  password: z.string().min(8).max(128),
  tenantId: z.string().uuid().optional(),
});
export type LoginInput = z.infer<typeof loginInput>;

export const appointmentStatusSchema = z.enum(["SCHEDULED", "CHECKED_IN", "IN_PROGRESS", "COMPLETED", "CANCELLED", "NO_SHOW"]);
export type AppointmentStatus = z.infer<typeof appointmentStatusSchema>;

export const createAppointmentInput = z.object({
  patientId: z.string().uuid(),
  doctorId: z.string().uuid().optional(),
  scheduledAt: z.coerce.date(),
  channel: z.enum(["IN_PERSON", "TELE"]).default("IN_PERSON"),
  reason: z.string().trim().max(300).optional(),
});
export type CreateAppointmentInput = z.infer<typeof createAppointmentInput>;

export const updateAppointmentStatusInput = z.object({ status: appointmentStatusSchema });

const phone = z.string().regex(/^[6-9]\d{9}$/, "Enter a 10-digit Indian mobile number");
export const otpRequestInput = z.object({ phone });
export const otpVerifyInput = z.object({ phone, code: z.string().regex(/^\d{6}$/) });

export const paymentMethodSchema = z.enum(["CASH", "UPI", "CARD"]);
export type PaymentMethod = z.infer<typeof paymentMethodSchema>;

export const issueCardInput = z.object({
  planId: z.string().uuid(),
  ownerPatientId: z.string().uuid(),
  memberPatientIds: z.array(z.string().uuid()).max(4).default([]), // other members, besides the owner
  paymentMethod: paymentMethodSchema,
});
export const renewCardInput = z.object({ paymentMethod: paymentMethodSchema });
export const addMemberInput = z.object({ patientId: z.string().uuid() });

export const joinHospitalInput = z.object({
  fullName: z.string().trim().min(2).max(120).optional(),
  gender: genderSchema.optional(),
  dateOfBirth: z.coerce.date().optional(),
});
export const patientBookingInput = z.object({
  tenantId: z.string().uuid(),
  branchId: z.string().uuid().optional(),
  doctorId: z.string().uuid().optional(),
  scheduledAt: z.coerce.date(),
  channel: z.enum(["IN_PERSON", "TELE"]).default("IN_PERSON"),
  reason: z.string().trim().max(300).optional(),
});

const paise = z.number().int().min(0).max(100_000_000);
export const lineKindSchema = z.enum(["CONSULTATION", "CARD_ISSUE", "CARD_PLAN", "SERVICE", "MEDICINE", "LAB", "OTHER"]);

export const createInvoiceInput = z.object({
  patientId: z.string().uuid(),
  appointmentId: z.string().uuid().optional(),
  lines: z
    .array(z.object({ kind: lineKindSchema.default("SERVICE"), description: z.string().trim().min(1).max(200), quantity: z.number().int().min(1).max(1000).default(1), unitPaise: paise }))
    .min(1)
    .max(30),
  discountPaise: paise.default(0),
  note: z.string().trim().max(300).optional(),
  // Optional immediate payment: omit amountPaise to pay the full total.
  payment: z.object({ method: paymentMethodSchema, amountPaise: paise.min(1).optional(), reference: z.string().trim().max(80).optional() }).optional(),
});
export const paymentInput = z.object({ amountPaise: paise.min(1), method: paymentMethodSchema, reference: z.string().trim().max(80).optional() });
export const closingInput = z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), countedCashPaise: paise, notes: z.string().trim().max(300).optional() });
export const updateFeeInput = z.object({ pricePaise: paise });

// ── clinical ──
const num = (min: number, max: number) => z.number().min(min).max(max);
export const vitalsSchema = z.object({
  bpSystolic: num(40, 300).optional(),
  bpDiastolic: num(20, 200).optional(),
  pulse: num(20, 250).optional(),
  tempC: num(30, 45).optional(),
  spo2: num(30, 100).optional(),
  weightKg: num(0.3, 400).optional(),
  heightCm: num(20, 260).optional(),
});
export type Vitals = z.infer<typeof vitalsSchema>;

export const prescriptionItemInput = z.object({
  medicineId: z.string().uuid().optional(),
  name: z.string().trim().min(1).max(120),
  dose: z.string().trim().max(60).optional(),
  frequency: z.string().trim().max(60).optional(),
  durationDays: z.number().int().min(1).max(365).optional(),
  instructions: z.string().trim().max(160).optional(),
  quantity: z.number().int().min(1).max(1000).default(1),
});
export const consultationInput = z.object({
  complaints: z.string().trim().max(2000).optional(),
  vitals: vitalsSchema.optional(),
  diagnosis: z.string().trim().max(1000).optional(),
  advice: z.string().trim().max(2000).optional(),
  followUpOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
  items: z.array(prescriptionItemInput).max(30).optional(),
});

// ── pharmacy ──
export const medicineFormSchema = z.enum(["TABLET", "CAPSULE", "SYRUP", "INJECTION", "OINTMENT", "DROPS", "OTHER"]);
export const medicineInput = z.object({
  name: z.string().trim().min(2).max(120),
  genericName: z.string().trim().max(120).optional(),
  form: medicineFormSchema.default("TABLET"),
  strength: z.string().trim().max(40).optional(),
  unitLabel: z.string().trim().min(1).max(20).default("tablet"),
  packSize: z.number().int().min(1).max(10_000).default(1),
  packLabel: z.string().trim().min(1).max(20).default("strip"),
  pricePaise: z.number().int().min(0).max(10_000_000),
  reorderLevel: z.number().int().min(0).max(100_000).default(10),
  gstPercent: z.union([z.literal(0), z.literal(5), z.literal(12), z.literal(18), z.literal(28)]).default(12),
  barcode: z.string().trim().min(3).max(40).optional(),
  manufacturer: z.string().trim().max(80).optional(),
  hsnCode: z.string().trim().max(12).optional(),
  rack: z.string().trim().max(30).optional(),
  scheduleDrug: z.boolean().default(false),
});
export const documentKindSchema = z.enum(["PRESCRIPTION_SCAN", "LAB_REPORT", "IMAGING", "DISCHARGE_SUMMARY", "ID_PROOF", "CONSENT", "INSURANCE", "OTHER"]);
export const documentFieldsInput = z.object({
  kind: documentKindSchema.default("OTHER"),
  title: z.string().trim().max(120).optional(),
  note: z.string().trim().max(500).optional(),
  appointmentId: z.string().uuid().optional(),
  visibleToPatient: z.enum(["true", "false"]).default("true"),
});
export const clinicalProfileInput = z.object({
  bloodGroup: z.enum(["A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-"]).nullable().optional(),
  allergies: z.array(z.string().trim().min(1).max(60)).max(30).optional(),
  chronicConditions: z.array(z.string().trim().min(1).max(60)).max(30).optional(),
  clinicalNotes: z.string().trim().max(2000).nullable().optional(),
  // Ayushman Bharat Digital Mission health ID. Spaces and dashes are tolerated when typed or scanned.
  abhaNumber: z.string().trim().transform((v) => v.replace(/[\s-]/g, "")).pipe(z.string().regex(/^\d{14}$/, "An ABHA number has 14 digits")).nullable().optional().or(z.literal("").transform(() => null)),
  abhaAddress: z.string().trim().toLowerCase().regex(/^[a-z0-9._]{4,30}@(abdm|sbx)$/, "An ABHA address looks like name@abdm").nullable().optional().or(z.literal("").transform(() => null)),
});
export const taskInput = z.object({
  title: z.string().trim().min(2).max(160),
  details: z.string().trim().max(1000).optional(),
  priority: z.enum(["LOW", "NORMAL", "HIGH", "URGENT"]).default("NORMAL"),
  dueAt: z.coerce.date().nullable().optional(),
  assignedTo: z.string().uuid().nullable().optional(),
  patientId: z.string().uuid().nullable().optional(),
});
export const taskPatch = z.object({
  title: z.string().trim().min(2).max(160).optional(),
  details: z.string().trim().max(1000).nullable().optional(),
  priority: z.enum(["LOW", "NORMAL", "HIGH", "URGENT"]).optional(),
  dueAt: z.coerce.date().nullable().optional(),
  assignedTo: z.string().uuid().nullable().optional(),
  status: z.enum(["OPEN", "DONE", "CANCELLED"]).optional(),
});
export const medicineImportRow = z.object({
  name: z.string().trim().min(2).max(120),
  strength: z.string().trim().max(40).optional(),
  genericName: z.string().trim().max(120).optional(),
  form: medicineFormSchema.optional(),
  unitLabel: z.string().trim().min(1).max(20).optional(),
  packSize: z.number().int().min(1).max(10_000).optional(),
  pricePaise: z.number().int().min(0).max(10_000_000),
  gstPercent: z.union([z.literal(0), z.literal(5), z.literal(12), z.literal(18), z.literal(28)]).optional(),
  barcode: z.string().trim().min(3).max(40).optional(),
  manufacturer: z.string().trim().max(80).optional(),
  hsnCode: z.string().trim().max(12).optional(),
  rack: z.string().trim().max(30).optional(),
  reorderLevel: z.number().int().min(0).max(100_000).optional(),
  scheduleDrug: z.boolean().optional(),
  // Opening stock, all three or none.
  batchNo: z.string().trim().min(1).max(40).optional(),
  expiryDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  qty: z.number().int().min(1).max(1_000_000).optional(),
  costPaise: z.number().int().min(0).max(10_000_000).optional(),
});
export const medicineImportInput = z.object({ rows: z.array(z.record(z.string(), z.unknown())).min(1).max(500), dryRun: z.boolean().default(false) });
export const collectDuesInput = z.object({ amountPaise: z.number().int().min(1).max(100_000_000), method: z.enum(["CASH", "UPI", "CARD"]), reference: z.string().trim().max(80).optional() });
export const medicinePatch = medicineInput.partial().extend({ active: z.boolean().optional() });
export const receiptInput = z.object({
  medicineId: z.string().uuid(),
  batchNo: z.string().trim().min(1).max(40),
  expiryDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  qty: z.number().int().min(1).max(1_000_000),
  costPaise: z.number().int().min(0).max(10_000_000).optional(),
});
export const adjustmentInput = z.object({
  batchId: z.string().uuid(),
  qtyDelta: z.number().int().min(-1_000_000).max(1_000_000).refine((n) => n !== 0, "Quantity cannot be zero"),
  reason: z.enum(["DAMAGE", "EXPIRED", "COUNT_CORRECTION"]),
  note: z.string().trim().max(200).optional(),
});
export const dispenseInput = z.object({
  patientId: z.string().uuid(),
  consultationId: z.string().uuid().optional(),
  items: z.array(z.object({ medicineId: z.string().uuid(), qty: z.number().int().min(1).max(10_000) })).min(1).max(30),
  payment: z.object({ method: paymentMethodSchema }).optional(),
});

// ── lab ──
const decimal = z.number().min(-1e9).max(1e9);
export const labTestInput = z.object({
  code: z.string().trim().toUpperCase().regex(/^[A-Z0-9_]{2,20}$/),
  name: z.string().trim().min(2).max(120),
  sampleType: z.enum(["BLOOD", "URINE", "STOOL", "SWAB", "OTHER"]).default("BLOOD"),
  pricePaise: z.number().int().min(0).max(10_000_000),
  unit: z.string().trim().max(20).optional(),
  refLow: decimal.optional().nullable(),
  refHigh: decimal.optional().nullable(),
  critLow: decimal.optional().nullable(),
  critHigh: decimal.optional().nullable(),
});
export const labTestPatch = labTestInput.partial().extend({ active: z.boolean().optional() });
export const labOrderInput = z.object({ testIds: z.array(z.string().uuid()).min(1).max(20) });
export const walkInLabOrderInput = labOrderInput.extend({ patientId: z.string().uuid(), payment: z.object({ method: paymentMethodSchema }).optional() });
export const labResultsInput = z.object({
  results: z.array(z.object({ itemId: z.string().uuid(), resultValue: decimal.optional(), resultText: z.string().trim().max(200).optional(), notes: z.string().trim().max(300).optional() })).min(1).max(30),
});
export const releaseInput = z.object({ force: z.boolean().default(false) });

// ── messaging ──
export const messagingSettingsInput = z.object({
  appointmentConfirmed: z.boolean(),
  appointmentReminder: z.boolean(),
  followUpReminder: z.boolean(),
  cardExpiry: z.boolean(),
  reportReady: z.boolean(),
});
export const manualMessageInput = z.object({ patientId: z.string().uuid(), text: z.string().trim().min(2).max(500) });
export const languageSchema = z.enum(["en", "hi"]);
export const patientPatchInput = z.object({ language: languageSchema.optional(), reminderOptOut: z.boolean().optional() });

// ── accounts, team, subscription ──
export const roleSchema = z.enum(["OWNER", "ADMIN", "DOCTOR", "NURSE", "RECEPTIONIST", "PHARMACIST", "LAB_TECH"]);
export const planCodeSchema = z.enum(["PAY_PER_PATIENT", "STARTER", "UNLIMITED"]);
const passwordRule = z.string().min(8).max(128).regex(/[A-Za-z]/, "Use letters and numbers").regex(/\d/, "Use letters and numbers");

export const signupInput = z.object({
  hospitalName: z.string().trim().min(3).max(100),
  kind: z.enum(["HOSPITAL", "CLINIC", "PHARMACY"]),
  ownerName: z.string().trim().min(2).max(100),
  phone: z.string().regex(/^[6-9]\d{9}$/, "Enter a 10-digit Indian mobile number"),
  code: z.string().regex(/^\d{6}$/),
  password: passwordRule,
  planCode: planCodeSchema.default("STARTER"),
  client: z.enum(["web", "mobile"]).optional(),
});
const roleKey = z.string().trim().toUpperCase().regex(/^[A-Z][A-Z0-9_]{1,30}$/);
export const teamAddInput = z.object({
  phone: z.string().regex(/^[6-9]\d{9}$/, "Enter a 10-digit Indian mobile number"),
  fullName: z.string().trim().min(2).max(100),
  roles: z.array(roleKey).min(1).max(4),
  branchIds: z.array(z.string().uuid()).max(100).optional(),
});
export const teamRolesInput = z.object({ roles: z.array(roleKey).min(1).max(4) });
export const subscriptionPlanInput = z.object({ planCode: planCodeSchema });
export const platformTenantPatch = z.object({
  planCode: planCodeSchema.optional(),
  status: z.enum(["TRIAL", "ACTIVE", "SUSPENDED", "CLOSED"]).optional(),
  suspendedReason: z.string().trim().max(200).optional(),
  extendTrialDays: z.number().int().min(1).max(365).optional(),
});
export const generateInvoicesInput = z.object({ month: z.string().regex(/^\d{4}-\d{2}$/), tenantIds: z.array(z.string().uuid()).max(500).optional() });
export const enforceInput = z.object({ tenantIds: z.array(z.string().uuid()).max(500).optional() });
export const payPlatformInvoiceInput = z.object({ paymentRef: z.string().trim().min(2).max(80) });

// ── refunds, profile, payment links ──
export const refundInput = z.object({ amountPaise: z.number().int().min(1).max(100_000_000), method: paymentMethodSchema, reason: z.string().trim().min(3).max(200) });
export const profileInput = z.object({
  legalName: z.string().trim().min(2).max(120),
  address: z.string().trim().max(300).optional().default(""),
  phone: z.string().trim().max(20).optional().default(""),
  gstin: z.string().trim().toUpperCase().regex(/^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/, "Enter a valid 15-character GSTIN").optional().or(z.literal("")).default(""),
  upiVpa: z.string().trim().regex(/^[\w.\-]{2,}@[A-Za-z]{2,}$/, "Enter a UPI id like name@bank").optional().or(z.literal("")).default(""),
  // Printed on pharmacy bills; a medical store must show it.
  drugLicence: z.string().trim().max(80).optional().default(""),
});

// ── branches, doctors, access control ──
export const branchInput = z.object({
  code: z.string().trim().toUpperCase().regex(/^[A-Z0-9]{2,8}$/, "2 to 8 letters or digits"),
  name: z.string().trim().min(2).max(100),
  address: z.string().trim().max(300).optional(),
  phone: z.string().trim().max(20).optional(),
});
export const branchPatch = branchInput.partial().extend({ active: z.boolean().optional() });
export const staffBranchesInput = z.object({ branchIds: z.array(z.string().uuid()).max(100) });

export const doctorProfileInput = z.object({
  displayName: z.string().trim().min(2).max(100),
  specialty: z.string().trim().max(80).optional(),
  qualification: z.string().trim().max(120).optional(),
  registrationNo: z.string().trim().max(40).optional(),
  feeInPersonPaise: z.number().int().min(0).max(10_000_000).nullable().optional(),
  feeTelePaise: z.number().int().min(0).max(10_000_000).nullable().optional(),
  slotMinutes: z.number().int().min(5).max(120).default(15),
  active: z.boolean().default(true),
});
export const doctorScheduleInput = z.object({
  branchId: z.string().uuid(),
  slots: z.array(z.object({ weekday: z.number().int().min(0).max(6), startMinute: z.number().int().min(0).max(1439), endMinute: z.number().int().min(1).max(1440) }).refine((s) => s.startMinute < s.endMinute, "Start must be before end")).max(60),
});
export const doctorLeaveInput = z.object({ fromDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), toDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), reason: z.string().trim().max(200).optional() });

export const roleInput = z.object({
  key: z.string().trim().toUpperCase().regex(/^[A-Z][A-Z0-9_]{1,30}$/, "Letters, digits and underscores"),
  name: z.string().trim().min(2).max(60),
  description: z.string().trim().max(200).optional(),
  permissions: z.array(z.string().min(1).max(60)).max(100),
});
export const rolePatch = z.object({ name: z.string().trim().min(2).max(60).optional(), description: z.string().trim().max(200).optional(), permissions: z.array(z.string().min(1).max(60)).max(100).optional() });
export const conditionSchema = z.object({
  attr: z.enum(["amountPaise", "discountPercent", "quantity", "hour", "weekday", "roles", "branchCode"]),
  op: z.enum(["eq", "ne", "gt", "gte", "lt", "lte", "in", "notIn", "containsAny", "notContainsAny"]),
  value: z.union([z.number(), z.string(), z.array(z.union([z.string(), z.number()]))]),
});
export const policyInput = z.object({
  name: z.string().trim().min(3).max(100),
  description: z.string().trim().max(300).optional(),
  enabled: z.boolean().default(true),
  permission: z.string().trim().min(1).max(60),
  appliesToRoles: z.array(z.string().max(40)).max(20).default([]),
  exceptRoles: z.array(z.string().max(40)).max(20).default([]),
  match: z.enum(["ALL", "ANY"]).default("ALL"),
  conditions: z.array(conditionSchema).max(10),
  validFrom: z.coerce.date().nullable().optional(),
  validUntil: z.coerce.date().nullable().optional(),
  message: z.string().trim().min(3).max(200),
});
export const policySimulateInput = z.object({ permission: z.string().min(1).max(60), roles: z.array(z.string()).max(10), attrs: z.record(z.string(), z.union([z.number(), z.string(), z.array(z.string())])).default({}), at: z.coerce.date().optional() });
export const overrideInput = z.object({
  permission: z.string().trim().min(1).max(60),
  effect: z.enum(["GRANT", "REVOKE"]),
  reason: z.string().trim().min(3).max(200),
  expiresAt: z.coerce.date().nullable().optional(),
});
export const auditQuery = z.object({
  action: z.string().trim().max(60).optional(),
  actor: z.string().uuid().optional(),
  entity: z.string().trim().max(40).optional(),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(60),
  before: z.string().datetime().optional(),
});

// ── pharmacy POS, purchasing, returns, transfers ──
const money = z.number().int().min(0).max(100_000_000);
export const posSaleInput = z.object({
  patientId: z.string().uuid().optional(),
  customerName: z.string().trim().max(100).optional(),
  customerPhone: z.string().trim().max(15).optional(),
  prescriber: z.string().trim().max(100).optional(),
  consultationId: z.string().uuid().optional(),
  items: z.array(z.object({ medicineId: z.string().uuid(), qty: z.number().int().min(1).max(10_000) })).min(1).max(60),
  discountPercent: z.number().min(0).max(100).optional(),
  discountPaise: money.optional(),
  payments: z.array(z.object({ method: paymentMethodSchema, amountPaise: money.min(1), reference: z.string().trim().max(80).optional() })).max(4).default([]),
});
export const shiftOpenInput = z.object({ openingCashPaise: money });
export const shiftCloseInput = z.object({ countedCashPaise: money, notes: z.string().trim().max(300).optional() });
export const saleReturnInput = z.object({
  dispenseId: z.string().uuid(),
  items: z.array(z.object({ dispenseLineId: z.string().uuid(), qty: z.number().int().min(1).max(10_000) })).min(1).max(60),
  reason: z.string().trim().min(3).max(200),
  refundMethod: paymentMethodSchema,
});
export const supplierInput = z.object({ name: z.string().trim().min(2).max(100), phone: z.string().trim().max(20).optional(), gstin: z.string().trim().max(15).optional(), address: z.string().trim().max(300).optional() });
export const supplierPatch = supplierInput.partial().extend({ active: z.boolean().optional() });
export const purchaseOrderInput = z.object({
  supplierId: z.string().uuid(),
  notes: z.string().trim().max(300).optional(),
  lines: z.array(z.object({ medicineId: z.string().uuid(), qty: z.number().int().min(1).max(1_000_000), costPaise: money })).min(1).max(100),
  placeOrder: z.boolean().default(false),
});
export const goodsReceiptInput = z.object({
  supplierId: z.string().uuid(),
  poId: z.string().uuid().optional(),
  billNo: z.string().trim().max(40).optional(),
  billDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  lines: z.array(z.object({ medicineId: z.string().uuid(), batchNo: z.string().trim().min(1).max(40), expiryDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), qty: z.number().int().min(1).max(1_000_000), costPaise: money })).min(1).max(100),
  payment: z.object({ method: paymentMethodSchema, amountPaise: money.min(1), reference: z.string().trim().max(80).optional() }).optional(),
});
export const supplierPaymentInput = z.object({ amountPaise: money.min(1), method: paymentMethodSchema, reference: z.string().trim().max(80).optional(), grnId: z.string().uuid().optional() });
export const transferInput = z.object({ toBranchId: z.string().uuid(), items: z.array(z.object({ batchId: z.string().uuid(), qty: z.number().int().min(1).max(1_000_000) })).min(1).max(60), note: z.string().trim().max(200).optional() });
