import { useMutation, useQueryClient } from '@tanstack/react-query'
import clsx from 'clsx'
import { CheckCircle2, Shield } from 'lucide-react'
import { QRCodeSVG } from 'qrcode.react'
import { useState } from 'react'
import { api } from '../lib/api'
import Select from './Select'
import { Button, Field, inputCls, Modal } from './ui'

interface PatientSummary {
  id: string
  fullName: string
  patientNo: string
  phone?: string | null
  abhaNumber?: string | null
  abhaAddress?: string | null
}

export default function AbhaModal({
  patient,
  onClose,
}: {
  patient: PatientSummary
  onClose: () => void
}) {
  const qc = useQueryClient()
  const [tab, setTab] = useState<'link' | 'generate'>('link')

  // Link existing
  const [abhaNumber, setAbhaNumber] = useState(patient.abhaNumber ?? '')
  const [abhaAddress, setAbhaAddress] = useState(patient.abhaAddress ?? '')

  // Generate new
  const [identifier, setIdentifier] = useState(patient.phone ?? '')
  const [authMode, setAuthMode] = useState<'MOBILE_OTP' | 'AADHAAR_OTP'>('MOBILE_OTP')
  const [step, setStep] = useState<'INPUT' | 'OTP' | 'SUCCESS'>('INPUT')
  const [txnId, setTxnId] = useState('')
  const [otp, setOtp] = useState('')
  const [otpHint, setOtpHint] = useState('')
  const [createdAbha, setCreatedAbha] = useState<{ number: string; address: string } | null>(null)

  const linkMutation = useMutation({
    mutationFn: (body: { abhaNumber: string; abhaAddress?: string }) =>
      api(`/patients/${patient.id}/abha/link`, {
        method: 'POST',
        body: JSON.stringify(body),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['patient', patient.id] })
      qc.invalidateQueries({ queryKey: ['patient-history', patient.id] })
      onClose()
    },
  })

  const unlinkMutation = useMutation({
    mutationFn: () =>
      api(`/patients/${patient.id}/abha/unlink`, {
        method: 'POST',
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['patient', patient.id] })
      qc.invalidateQueries({ queryKey: ['patient-history', patient.id] })
      onClose()
    },
  })

  const generateOtpMutation = useMutation({
    mutationFn: () =>
      api<{ txnId: string; sandboxOtp: string; message: string }>('/abdm/abha/generate-otp', {
        method: 'POST',
        body: JSON.stringify({ identifier, authMode }),
      }),
    onSuccess: (data) => {
      setTxnId(data.txnId)
      setOtp(data.sandboxOtp) // Pre-fill sandbox OTP for frictionless testing
      setOtpHint(data.message)
      setStep('OTP')
    },
  })

  const verifyOtpMutation = useMutation({
    mutationFn: () =>
      api<{ verified: boolean; abhaNumber: string; abhaAddress: string }>('/abdm/abha/verify-otp', {
        method: 'POST',
        body: JSON.stringify({ txnId, otp, name: patient.fullName }),
      }),
    onSuccess: async (data) => {
      setCreatedAbha({ number: data.abhaNumber, address: data.abhaAddress })
      // Auto-link to patient
      await linkMutation.mutateAsync({ abhaNumber: data.abhaNumber, abhaAddress: data.abhaAddress })
      setStep('SUCCESS')
    },
  })

  const formatAbha = (n: string) => n.replace(/[\s-]/g, '').replace(/(\d{2})(\d{4})(\d{4})(\d{4})/, '$1-$2-$3-$4')

  return (
    <Modal title="ABHA Digital Health Account (ABDM)" onClose={onClose} size="lg">
      <div className="space-y-4">
        {/* Existing ABHA Status Card */}
        {patient.abhaNumber ? (
          <div className="rounded-2xl border-2 border-emerald-500/40 bg-gradient-to-r from-emerald-50 to-teal-50 p-5 shadow-xs">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div className="space-y-1">
                <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2.5 py-0.5 text-xs font-bold text-emerald-800">
                  <Shield size={12} className="text-emerald-700" /> ABDM VERIFIED
                </span>
                <p className="font-mono text-xl font-black tracking-wide text-slate-900">
                  {formatAbha(patient.abhaNumber)}
                </p>
                {patient.abhaAddress && (
                  <p className="text-sm font-semibold text-emerald-800">{patient.abhaAddress}</p>
                )}
                <p className="text-xs text-muted">
                  Linked to {patient.fullName} ({patient.patientNo})
                </p>
              </div>

              <div className="rounded-xl bg-white p-2 border border-emerald-200 shadow-xs">
                <QRCodeSVG value={patient.abhaAddress ?? patient.abhaNumber} size={72} />
              </div>
            </div>

            <div className="mt-4 pt-3 border-t border-emerald-200/60 flex justify-between items-center text-xs">
              <span className="text-muted">HIP Care Contexts registered and active</span>
              <button
                type="button"
                disabled={unlinkMutation.isPending}
                onClick={() => confirm('Unlink ABHA from this patient profile?') && unlinkMutation.mutate()}
                className="font-semibold text-red-600 hover:underline"
              >
                Unlink ABHA
              </button>
            </div>
          </div>
        ) : (
          <>
            <div className="flex rounded-xl bg-surface p-1 ring-1 ring-line">
              <button
                type="button"
                onClick={() => setTab('link')}
                className={clsx(
                  'flex-1 rounded-lg py-2 text-xs font-bold transition',
                  tab === 'link' ? 'bg-white text-brand-700 shadow-sm' : 'text-muted hover:text-ink'
                )}
              >
                Link Existing ABHA Number
              </button>
              <button
                type="button"
                onClick={() => setTab('generate')}
                className={clsx(
                  'flex-1 rounded-lg py-2 text-xs font-bold transition',
                  tab === 'generate' ? 'bg-white text-brand-700 shadow-sm' : 'text-muted hover:text-ink'
                )}
              >
                Create New ABHA (Aadhaar / Mobile OTP)
              </button>
            </div>

            {tab === 'link' ? (
              <form
                className="space-y-4"
                onSubmit={(e) => {
                  e.preventDefault()
                  if (abhaNumber.replace(/[\s-]/g, '').length === 14) {
                    linkMutation.mutate({
                      abhaNumber,
                      abhaAddress: abhaAddress.trim() || undefined,
                    })
                  }
                }}
              >
                <Field label="14-Digit ABHA Number">
                  <input
                    className={`${inputCls} font-mono`}
                    inputMode="numeric"
                    placeholder="12-3456-7890-1234"
                    value={abhaNumber}
                    onChange={(e) => setAbhaNumber(e.target.value)}
                    autoFocus
                  />
                </Field>

                <Field label="ABHA Address (PHR Handle, e.g. name@abdm)">
                  <input
                    className={inputCls}
                    placeholder="e.g. rajesh.kumar@abdm"
                    value={abhaAddress}
                    onChange={(e) => setAbhaAddress(e.target.value)}
                  />
                </Field>

                {linkMutation.error && (
                  <p className="text-sm text-red-600">{(linkMutation.error as Error).message}</p>
                )}

                <Button
                  type="submit"
                  className="w-full font-bold"
                  disabled={abhaNumber.replace(/[\s-]/g, '').length !== 14 || linkMutation.isPending}
                >
                  Verify & Link to Patient Record
                </Button>
              </form>
            ) : (
              <div className="space-y-4">
                {step === 'INPUT' && (
                  <div className="space-y-4">
                    <Field label="Authentication Mode">
                      <Select
                        value={authMode}
                        onChange={(m: string) => setAuthMode(m as 'MOBILE_OTP' | 'AADHAAR_OTP')}
                        options={[
                          { value: 'MOBILE_OTP', label: 'Mobile Number OTP' },
                          { value: 'AADHAAR_OTP', label: 'Aadhaar Registered Mobile OTP' },
                        ]}
                      />
                    </Field>

                    <Field label={authMode === 'AADHAAR_OTP' ? '12-Digit Aadhaar Number' : '10-Digit Mobile Number'}>
                      <input
                        className={`${inputCls} font-mono`}
                        inputMode="numeric"
                        placeholder={authMode === 'AADHAAR_OTP' ? 'xxxx xxxx xxxx' : '9876543210'}
                        value={identifier}
                        onChange={(e) => setIdentifier(e.target.value)}
                        autoFocus
                      />
                    </Field>

                    <p className="text-xs text-muted">
                      An OTP will be transmitted via NHA Sandbox Gateway to verify the patient's identity.
                    </p>

                    {generateOtpMutation.error && (
                      <p className="text-sm text-red-600">{(generateOtpMutation.error as Error).message}</p>
                    )}

                    <Button
                      className="w-full font-bold"
                      disabled={identifier.trim().length < 10 || generateOtpMutation.isPending}
                      onClick={() => generateOtpMutation.mutate()}
                    >
                      {generateOtpMutation.isPending ? 'Requesting OTP...' : 'Send OTP'}
                    </Button>
                  </div>
                )}

                {step === 'OTP' && (
                  <div className="space-y-4">
                    <div className="rounded-xl bg-amber-50 border border-amber-200 p-3 text-xs text-amber-900">
                      <p className="font-semibold">{otpHint}</p>
                    </div>

                    <Field label="Enter 6-Digit OTP">
                      <input
                        className={`${inputCls} font-mono text-center tracking-widest text-lg font-bold`}
                        inputMode="numeric"
                        maxLength={6}
                        value={otp}
                        onChange={(e) => setOtp(e.target.value.replace(/\D/g, ''))}
                        autoFocus
                      />
                    </Field>

                    {verifyOtpMutation.error && (
                      <p className="text-sm text-red-600">{(verifyOtpMutation.error as Error).message}</p>
                    )}

                    <div className="flex gap-2">
                      <Button variant="ghost" onClick={() => setStep('INPUT')}>
                        Back
                      </Button>
                      <Button
                        className="flex-1 font-bold"
                        disabled={otp.length !== 6 || verifyOtpMutation.isPending}
                        onClick={() => verifyOtpMutation.mutate()}
                      >
                        {verifyOtpMutation.isPending ? 'Verifying...' : 'Verify OTP & Issue ABHA'}
                      </Button>
                    </div>
                  </div>
                )}

                {step === 'SUCCESS' && createdAbha && (
                  <div className="space-y-4 text-center py-4">
                    <div className="mx-auto grid size-14 place-items-center rounded-full bg-emerald-100 text-emerald-700">
                      <CheckCircle2 size={32} />
                    </div>
                    <div>
                      <h3 className="text-lg font-bold text-ink">ABHA Generated & Linked Successfully!</h3>
                      <p className="font-mono text-xl font-black text-brand-700 mt-1">
                        {formatAbha(createdAbha.number)}
                      </p>
                      <p className="text-sm font-semibold text-emerald-800">{createdAbha.address}</p>
                    </div>
                    <Button className="w-full font-bold" onClick={onClose}>
                      Done
                    </Button>
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </Modal>
  )
}
