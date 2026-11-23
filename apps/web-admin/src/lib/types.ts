export interface PatientRow {
  id: string
  patientNo: string
  fullName: string
  gender: 'FEMALE' | 'MALE' | 'OTHER' | null
  dateOfBirth: string | null
  phone: string | null
  abhaNumber?: string | null
  abhaAddress?: string | null
  createdAt: string
}

export type Status = 'SCHEDULED' | 'CHECKED_IN' | 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED' | 'NO_SHOW'

export interface AppointmentRow {
  id: string
  scheduledAt: string
  tokenNo: number | null
  channel: 'IN_PERSON' | 'TELE'
  status: Status
  reason: string | null
  patient: PatientRow
  doctor: { id: string; fullName: string | null } | null
  feeWaived: boolean
  invoice: { id: string; invoiceNo: string; status: InvoiceStatus; totalPaise: number; paidPaise: number } | null
}

export interface CardPlan {
  id: string
  name: string
  type: 'INDIVIDUAL' | 'FAMILY'
  issueFeePaise: number
  planPricePaise: number
  durationMonths: number
  maxMembers: number
  inPersonVisits: number
  teleVisits: number
}

export interface Coverage {
  cardNo: string
  subscriptionId: string | null
  endsAt: string | null
  remaining: { inPerson: number; tele: number }
  limits: { inPerson: number; tele: number }
}

export interface CardListRow {
  id: string
  cardNo: string
  status: 'ACTIVE' | 'BLOCKED'
  plan: CardPlan
  owner: PatientRow
  members: { id: string }[]
  planEndsAt: string | null
}

export interface CardDetail {
  id: string
  cardNo: string
  status: 'ACTIVE' | 'BLOCKED'
  plan: CardPlan
  owner: PatientRow
  members: { patient: PatientRow; coverage: Coverage | null }[]
  subscriptions: { id: string; startsAt: string; endsAt: string; pricePaise: number; paymentMethod: string }[]
  activeSubscription: { endsAt: string } | null
  amountDuePaise?: number
}

export type InvoiceStatus = 'UNPAID' | 'PARTIAL' | 'PAID' | 'REFUNDED' | 'VOID'
export interface InvoiceRow {
  id: string
  invoiceNo: string
  status: InvoiceStatus
  totalPaise: number
  paidPaise: number
  createdAt: string
  customerName?: string | null
  customerPhone?: string | null
  /** Walk-in counter sales have no registered patient. */
  patient: { id: string; fullName: string; patientNo: string } | null
}
export interface InvoiceDetail extends InvoiceRow {
  subtotalPaise: number
  discountPaise: number
  taxPaise: number
  refundedPaise: number
  hospital: { legalName: string; address: string; phone: string; gstin: string; upiVpa: string }
  taxBreakup: { gstPercent: number; taxablePaise: number; cgstPaise: number; sgstPaise: number }[]
  gatewayEnabled: boolean
  refunds: { id: string; amountPaise: number; method: 'CASH' | 'UPI' | 'CARD'; reason: string; createdAt: string }[]
  note: string | null
  patient: (NonNullable<InvoiceRow['patient']> & { phone: string | null }) | null
  lines: { id: string; description: string; quantity: number; unitPaise: number; amountPaise: number }[]
  payments: { id: string; amountPaise: number; method: string; reference: string | null; receivedAt: string }[]
}
export interface Collections {
  date: string
  collectedPaise: number
  refundedPaise: number
  byMethod: Record<string, number>
  paymentCount: number
  invoicesIssued: number
  billedPaise: number
  outstandingPaise: number
  closing: { expectedCashPaise: number; countedCashPaise: number; notes: string | null } | null
}
export interface Closing {
  id: string
  date: string
  expectedCashPaise: number
  countedCashPaise: number
  differencePaise: number
  totalCollectedPaise: number
  notes: string | null
}

export interface PatientAdvance {
  id: string
  receiptNo: string
  patientId: string
  amountPaise: number
  balancePaise: number
  method: string
  reference?: string | null
  notes?: string | null
  createdAt: string
  patient?: { id: string; fullName: string; patientNo: string; phone?: string | null }
}

export interface FeeItem {
  id: string
  code: string
  name: string
  kind: string
  pricePaise: number
  active: boolean
}

export interface Vitals { bpSystolic?: number; bpDiastolic?: number; pulse?: number; tempC?: number; spo2?: number; weightKg?: number; heightCm?: number }
export interface RxItem {
  id?: string
  medicineId?: string | null
  name: string
  dose?: string | null
  frequency?: string | null
  durationDays?: number | null
  instructions?: string | null
  quantity: number
  available?: number | null
}
export interface LabItem {
  id: string
  testName: string
  unit: string | null
  refRange: string | null
  pricePaise: number
  resultText: string | null
  resultValue: string | null
  flag: 'NORMAL' | 'LOW' | 'HIGH' | 'CRITICAL_LOW' | 'CRITICAL_HIGH' | null
  notes: string | null
  method?: string | null
  sampleBarcode?: string | null
  resultedAt: string | null
}
export interface LabOrder {
  id: string
  orderNo: string
  sampleBarcode?: string | null
  clinicalNotes?: string | null
  rejectionReason?: string | null
  status: 'ORDERED' | 'COLLECTED' | 'RESULTED' | 'RELEASED' | 'CANCELLED'
  createdAt: string
  collectedAt: string | null
  releasedAt: string | null
  patient: { id: string; fullName: string; patientNo: string; phone: string | null; dateOfBirth: string | null; gender: string | null }
  invoice: { id: string; invoiceNo: string; status: InvoiceStatus; totalPaise: number; paidPaise: number } | null
  items: LabItem[]
}
export interface LabTest {
  id: string
  code: string
  name: string
  department?: string | null
  sampleType: string
  method?: string | null
  pricePaise: number
  unit: string | null
  refLow: string | null
  refHigh: string | null
  critLow?: string | null
  critHigh?: string | null
  turnaroundHours?: number | null
  active?: boolean
}
export interface Consultation {
  id: string
  complaints: string | null
  vitals: Vitals | null
  diagnosis: string | null
  advice: string | null
  followUpOn: string | null
  completedAt: string | null
  rxNo?: string | null
  items: RxItem[]
  labOrders: LabOrder[]
  doctor?: { fullName: string | null } | null
}
export interface ConsultationBundle {
  appointment: AppointmentRow
  consultation: Consultation | null
  history: (Consultation & { createdAt: string })[]
}
export interface Medicine {
  id: string
  name: string
  genericName: string | null
  form: string
  strength: string | null
  unitLabel: string
  pricePaise: number
  reorderLevel: number
  active: boolean
  onHand: number
  nextExpiry: string | null
  barcode: string | null
  manufacturer: string | null
  hsnCode: string | null
  rack: string | null
  gstPercent: number
  scheduleDrug: boolean
  packSize: number
  packLabel: string
}
export interface Batch { id: string; batchNo: string; expiryDate: string; qtyReceived: number; qtyOnHand: number; costPaise: number | null }
export interface PendingRx {
  id: string
  completedAt: string
  patient: { id: string; fullName: string; patientNo: string }
  doctor: { fullName: string | null } | null
  items: RxItem[]
}

export interface MessageRow {
  id: string
  template: string
  status: 'QUEUED' | 'SENT' | 'FAILED' | 'SKIPPED'
  body: string
  toPhone: string
  attempts: number
  error: string | null
  createdAt: string
  sentAt: string | null
  patient: { id: string; fullName: string; patientNo: string } | null
}
export interface MessagingSettings {
  appointmentConfirmed: boolean
  appointmentReminder: boolean
  followUpReminder: boolean
  cardExpiry: boolean
  reportReady: boolean
}
