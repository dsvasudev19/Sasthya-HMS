import { useQuery } from '@tanstack/react-query'
import { BadgeCheck, HeartPulse, ShieldAlert } from 'lucide-react'
import { useParams } from 'react-router-dom'
import { api } from '../lib/api'
import { fmtDate } from '../lib/format'

interface Result { valid: boolean; rxNo?: string; hospital?: string; doctor?: string | null; issuedAt?: string; patient?: string; items?: { name: string; dose: string | null; frequency: string | null; durationDays: number | null; quantity: number }[] }

/** Public page behind the QR code on every signed prescription: a pharmacist or insurer can confirm it is genuine without logging in. */
export default function VerifyRx() {
  const { tenantId, code } = useParams()
  const { data, isLoading } = useQuery({ queryKey: ['verify-rx', tenantId, code], queryFn: () => api<Result>(`/public/rx/${tenantId}/${code}`) })
  return (
    <div className="grid min-h-screen place-items-center bg-gradient-to-br from-[#0b1a33] via-[#10294f] to-[#0d4a4b] p-4">
      <div className="w-full max-w-md rounded-card bg-white p-7 shadow-xl ring-1 ring-line">
        <p className="mb-5 flex items-center gap-2 text-lg font-extrabold italic text-brand-900"><HeartPulse size={22} /> Swasthya</p>
        {isLoading ? <p className="text-sm text-muted">Checking…</p> : data?.valid ? (
          <div className="space-y-4">
            <p className="flex items-center gap-2 text-lg font-semibold text-brand-800"><BadgeCheck size={24} /> Genuine prescription</p>
            <dl className="space-y-1 text-sm"><div className="flex justify-between"><dt className="text-muted">Number</dt><dd className="font-semibold">{data.rxNo}</dd></div><div className="flex justify-between"><dt className="text-muted">Hospital</dt><dd className="font-semibold">{data.hospital}</dd></div><div className="flex justify-between"><dt className="text-muted">Doctor</dt><dd className="font-semibold">{data.doctor ? `Dr ${data.doctor.replace(/^Dr\.?\s+/i, '')}` : '-'}</dd></div><div className="flex justify-between"><dt className="text-muted">Issued</dt><dd className="font-semibold">{fmtDate(data.issuedAt)}</dd></div><div className="flex justify-between"><dt className="text-muted">Patient</dt><dd className="font-semibold">{data.patient}</dd></div></dl>
            <ul className="space-y-1.5 rounded-2xl bg-surface p-4 text-sm">{data.items?.map((i, k) => <li key={k}><b>{i.name}</b><span className="text-muted"> · {[i.dose, i.frequency, i.durationDays ? `${i.durationDays} days` : null, `qty ${i.quantity}`].filter(Boolean).join(' · ')}</span></li>)}</ul>
            <p className="text-xs text-muted">Compare these medicines with the paper. If they differ, do not dispense.</p>
          </div>
        ) : <p className="flex items-center gap-2 text-lg font-semibold text-red-700"><ShieldAlert size={24} /> Not a valid prescription</p>}
      </div>
    </div>
  )
}
