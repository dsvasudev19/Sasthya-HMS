import { useMutation, useQuery } from '@tanstack/react-query'
import clsx from 'clsx'
import { HeartPulse } from 'lucide-react'
import { useState } from 'react'
import { useParams } from 'react-router-dom'
import { api } from '../lib/api'

/** The page a patient reaches from the link in their message. No sign-in. */
export default function GiveFeedback() {
  const { tenantId, token } = useParams()
  const { data, error } = useQuery({ queryKey: ['public-feedback', tenantId, token], queryFn: () => api<{ hospital: string; doctor: string | null; answered: boolean; context: string }>(`/public/feedback/${tenantId}/${token}`), retry: false })
  const [score, setScore] = useState<number | null>(null)
  const [comment, setComment] = useState('')
  const send = useMutation({ mutationFn: () => api(`/public/feedback/${tenantId}/${token}`, { method: 'POST', body: JSON.stringify({ score, comment: comment || undefined }) }) })
  return (
    <div className="grid min-h-screen place-items-center bg-surface p-4">
      <div className="w-full max-w-md space-y-5 rounded-2xl bg-white p-7 shadow-xl ring-1 ring-line">
        <div className="flex items-center gap-2 text-xl font-bold"><HeartPulse className="text-brand-800" /> Swasthya</div>
        {error ? <p className="text-sm text-muted">This link is not valid.</p> : !data ? <p className="text-sm text-muted">Loading…</p> : send.isSuccess || data.answered ? (
          <div><h1 className="text-xl font-semibold">Thank you</h1><p className="mt-1 text-sm text-muted">Your feedback helps {data.hospital} look after patients better.</p></div>
        ) : (
          <>
            <div><h1 className="text-xl font-semibold">How was your {data.context === 'ADMISSION' ? 'stay' : 'visit'} at {data.hospital}?</h1>{data.doctor && <p className="mt-1 text-sm text-muted">With Dr {data.doctor}</p>}</div>
            <div><p className="mb-2 text-sm font-medium">How likely are you to recommend us to a friend or family member?</p>
              <div className="grid grid-cols-6 gap-1.5 sm:grid-cols-11">{Array.from({ length: 11 }, (_, i) => <button key={i} type="button" onClick={() => setScore(i)} aria-pressed={score === i} className={clsx('rounded-lg py-2.5 text-sm font-bold ring-1 transition', score === i ? 'bg-brand-700 text-white ring-brand-700' : 'bg-white ring-line hover:bg-surface')}>{i}</button>)}</div>
              <p className="mt-1 flex justify-between text-[11px] text-muted"><span>Not at all likely</span><span>Extremely likely</span></p></div>
            <label className="block text-sm font-medium">Anything you would like to tell us? <span className="font-normal text-muted">(optional)</span><textarea className="mt-1.5 w-full rounded-xl border border-line p-3 text-sm outline-none focus:border-brand-500" rows={3} maxLength={1000} value={comment} onChange={(e) => setComment(e.target.value)} /></label>
            {send.error && <p className="text-sm text-red-600">{(send.error as Error).message}</p>}
            <button type="button" disabled={score === null || send.isPending} onClick={() => send.mutate()} className="w-full rounded-xl bg-brand-700 py-3 font-semibold text-white disabled:opacity-50">Send</button>
          </>)}
      </div>
    </div>
  )
}
