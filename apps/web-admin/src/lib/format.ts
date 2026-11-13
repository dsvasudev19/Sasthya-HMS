export function ageOf(dob: string | null | undefined): number | null {
  if (!dob) return null
  const d = new Date(dob)
  const now = new Date()
  let age = now.getFullYear() - d.getFullYear()
  if (now < new Date(now.getFullYear(), d.getMonth(), d.getDate())) age--
  return age
}

export const fmtDob = (dob: string | null | undefined) =>
  dob ? new Date(dob).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : 'DOB not set'

export const fmtTime = (iso: string) => new Date(iso).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' })

export { initials } from '@hms/ui-web'

export const rupees = (paise: number) => `₹${(paise / 100).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`
export const fmtDate = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '-'
