export interface Hospital { id: string; name: string; kind: 'HOSPITAL' | 'CLINIC' }
export interface Doctor { id: string; name: string | null; specialty?: string | null; qualification?: string | null; feeInPersonPaise?: number | null; feeTelePaise?: number | null; hasSchedule?: boolean }
export interface Branch { id: string; code: string; name: string; address: string | null; isMain: boolean }
export interface Slot { time: string; available: boolean }
export interface Me {
  identity: { id: string; phone: string; name: string | null }
  hospitals: { tenantId: string; name: string; patientId: string }[]
}
export type Status = 'SCHEDULED' | 'CHECKED_IN' | 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED' | 'NO_SHOW'
export interface Visit {
  id: string
  scheduledAt: string
  tokenNo: number | null
  channel: 'IN_PERSON' | 'TELE'
  status: Status
  reason: string | null
  feeWaived: boolean
  ahead: number | null
  hospital: { id: string; name: string }
  doctor: { id: string; fullName: string | null } | null
}
export interface PatientCard {
  hospital: { id: string; name: string }
  cardNo: string
  planName: string
  type: 'INDIVIDUAL' | 'FAMILY'
  members: string[]
  coverage: {
    subscriptionId: string | null
    endsAt: string | null
    remaining: { inPerson: number; tele: number }
    limits: { inPerson: number; tele: number }
  } | null
}

export interface Bill {
  id: string
  invoiceNo: string
  status: 'UNPAID' | 'PARTIAL' | 'PAID' | 'REFUNDED' | 'VOID'
  totalPaise: number
  paidPaise: number
  discountPaise: number
  note: string | null
  createdAt: string
  hospital: { id: string; name: string }
  lines: { id: string; description: string; amountPaise: number }[]
}

export interface Records {
  consultations: {
    id: string
    date: string
    hospital: { id: string; name: string }
    doctor: string | null
    diagnosis: string | null
    advice: string | null
    followUpOn: string | null
    items: { id: string; name: string; dose: string | null; frequency: string | null; durationDays: number | null; instructions: string | null; quantity: number }[]
  }[]
  labReports: {
    id: string
    orderNo: string
    date: string
    hospital: { id: string; name: string }
    items: { id: string; testName: string; unit: string | null; refRange: string | null; resultValue: string | null; resultText: string | null; flag: 'NORMAL' | 'LOW' | 'HIGH' | 'CRITICAL_LOW' | 'CRITICAL_HIGH' | null }[]
  }[]
}
