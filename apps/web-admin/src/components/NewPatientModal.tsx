import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useState, type FormEvent } from 'react'
import { api } from '../lib/api'
import type { PatientRow } from '../lib/types'
import { Button, Field, inputCls, Modal } from './ui'
import Select from './Select'

export default function NewPatientModal({ initialName = '', onClose, onCreated }: { initialName?: string; onClose: () => void; onCreated?: (p: PatientRow) => void }) {
  const qc = useQueryClient()
  const digits = /^\d+$/.test(initialName)
  const [f, setF] = useState({ fullName: digits ? '' : initialName, phone: digits ? initialName.slice(0, 10) : '', gender: '' as '' | 'FEMALE' | 'MALE' | 'OTHER', dateOfBirth: '' })
  const create = useMutation({
    mutationFn: () => api<PatientRow>('/patients', { method: 'POST', body: JSON.stringify({ fullName: f.fullName, phone: f.phone || undefined, gender: f.gender || undefined, dateOfBirth: f.dateOfBirth || undefined }) }),
    onSuccess: (p) => { qc.invalidateQueries({ queryKey: ['patients'] }); onCreated?.(p); onClose() },
  })
  const submit = (e: FormEvent) => { e.preventDefault(); create.mutate() }
  return (
    <Modal title="Register patient" onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        <Field label="Full name"><input className={inputCls} required minLength={2} value={f.fullName} onChange={(e) => setF({ ...f, fullName: e.target.value })} autoFocus /></Field>
        <Field label="Mobile number"><input className={inputCls} inputMode="numeric" maxLength={10} value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value.replace(/\D/g, '') })} /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Gender">
            <Select value={f.gender} onChange={(v) => setF({ ...f, gender: v })} placeholder="Not set" options={[{ value: 'FEMALE', label: 'Female' }, { value: 'MALE', label: 'Male' }, { value: 'OTHER', label: 'Other' }]} />
          </Field>
          <Field label="Date of birth"><input type="date" className={inputCls} value={f.dateOfBirth} max={new Date().toISOString().slice(0, 10)} onChange={(e) => setF({ ...f, dateOfBirth: e.target.value })} /></Field>
        </div>
        {create.error && <p className="text-sm text-red-600">{(create.error as Error).message}</p>}
        <Button type="submit" className="w-full" disabled={create.isPending}>{create.isPending ? 'Saving…' : 'Register patient'}</Button>
      </form>
    </Modal>
  )
}
