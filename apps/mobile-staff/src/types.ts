export interface Me {
  /** What this person may do, resolved by the server from their roles, personal exceptions and the hospital's settings. */
  permissions: string[]
  user: { id: string; name: string | null; role: string; roles: string[] }
  tenant: { id: string; name: string; status?: string }
  mustChangePassword?: boolean
}
export interface HospitalChoice { tenantId: string; name: string; roles: string[] }
export type Status = 'SCHEDULED' | 'CHECKED_IN' | 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED' | 'NO_SHOW'
export interface Appt {
  id: string
  scheduledAt: string
  tokenNo: number | null
  channel: 'IN_PERSON' | 'TELE'
  status: Status
  reason: string | null
  feeWaived: boolean
  patient: { id: string; fullName: string; patientNo: string; phone: string | null }
  doctor: { id: string; fullName: string | null } | null
}
export interface CardLookup {
  cardNo: string
  plan: { name: string; type: string }
  owner: { fullName: string }
  activeSubscription: { endsAt: string } | null
  members: { patient: { id: string; fullName: string }; coverage: { subscriptionId: string | null; remaining: { inPerson: number; tele: number }; limits: { inPerson: number; tele: number } } | null }[]
}
