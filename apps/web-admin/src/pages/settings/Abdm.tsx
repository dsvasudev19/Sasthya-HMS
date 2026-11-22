import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { CheckCircle2, Copy, ExternalLink, RefreshCw, Shield, ShieldCheck } from 'lucide-react'
import { useState } from 'react'
import { api } from '../../lib/api'
import { fmtDate } from '../../lib/format'
import { Button, Field, inputCls } from '../../components/ui'

interface AbdmFacilityConfig {
  tenantId: string
  hfrFacilityId: string | null
  facilityName: string | null
  hipId: string | null
  clientId: string | null
  clientSecret?: string | null
  sandbox: boolean
  active: boolean
}

interface ConsentArtifact {
  id: string
  consentId: string
  status: string
  hiTypes: string[]
  patient: {
    fullName: string
    patientNo: string
    abhaAddress: string | null
  }
  permissionFrom: string
  permissionTo: string
  createdAt: string
}

export default function Abdm() {
  const qc = useQueryClient()
  const [copied, setCopied] = useState<string | null>(null)

  const configQuery = useQuery({
    queryKey: ['abdm-config'],
    queryFn: () => api<AbdmFacilityConfig>('/abdm/facility-config'),
  })

  const consentsQuery = useQuery({
    queryKey: ['abdm-consents'],
    queryFn: () => api<ConsentArtifact[]>('/abdm/consents'),
  })

  const [form, setForm] = useState<Partial<AbdmFacilityConfig> | null>(null)

  const config = form ?? configQuery.data
  const isEditing = form !== null

  const saveMutation = useMutation({
    mutationFn: (body: Partial<AbdmFacilityConfig>) =>
      api<AbdmFacilityConfig>('/abdm/facility-config', {
        method: 'PUT',
        body: JSON.stringify(body),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['abdm-config'] })
      setForm(null)
    },
  })

  const copyText = (txt: string, label: string) => {
    navigator.clipboard.writeText(txt)
    setCopied(label)
    setTimeout(() => setCopied(null), 2000)
  }

  const discoveryUrl = `${window.location.origin}/api/abdm/v1.0/care-contexts/discover`

  return (
    <div className="space-y-8 max-w-4xl">
      {/* Overview Banner */}
      <div className="rounded-2xl border border-sky-200 bg-sky-50/70 p-5 shadow-sm">
        <div className="flex items-start gap-3">
          <div className="rounded-xl bg-sky-600 p-2 text-white">
            <Shield className="size-6" />
          </div>
          <div className="flex-1">
            <h2 className="text-base font-bold text-sky-950">
              Ayushman Bharat Digital Mission (ABDM) & Indian Statutory Compliance
            </h2>
            <p className="mt-1 text-xs leading-relaxed text-sky-900">
              Swasthya HMS is pre-engineered for ABDM Milestones 1, 2, and 3 conformance according to National Health Authority (NHA) & NRCeS standards. Seamlessly manage Health Facility Registry (HFR), Health Information Provider (HIP) endpoints, NRCeS FHIR R4 clinical exports, and DPDP Act 2023 patient consent logs.
            </p>
            <div className="mt-3 flex flex-wrap gap-2 text-xs">
              <span className="inline-flex items-center gap-1 rounded-full bg-white px-3 py-1 font-semibold text-sky-800 shadow-xs">
                <ShieldCheck size={13} className="text-emerald-600" /> M1: ABHA Registration & Linking
              </span>
              <span className="inline-flex items-center gap-1 rounded-full bg-white px-3 py-1 font-semibold text-sky-800 shadow-xs">
                <ShieldCheck size={13} className="text-emerald-600" /> M2: Care Context Discovery & HIP
              </span>
              <span className="inline-flex items-center gap-1 rounded-full bg-white px-3 py-1 font-semibold text-sky-800 shadow-xs">
                <ShieldCheck size={13} className="text-emerald-600" /> M3: NRCeS FHIR R4 Bundle Export
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Facility & Gateway Configuration */}
      <section className="rounded-2xl border border-line bg-white p-6 shadow-sm space-y-5">
        <div className="flex items-center justify-between border-b border-line pb-4">
          <div>
            <h3 className="text-base font-semibold text-ink">Health Facility Registry (HFR) & HIP Configuration</h3>
            <p className="text-xs text-muted">Register your facility credentials issued by the NHA ABDM Developer Sandbox or Live Portal.</p>
          </div>
          {config?.hfrFacilityId ? (
            <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-3 py-1 text-xs font-semibold text-emerald-800">
              <CheckCircle2 size={13} /> Configured
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-3 py-1 text-xs font-semibold text-amber-800">
              Pending Setup
            </span>
          )}
        </div>

        {configQuery.isLoading ? (
          <p className="py-4 text-xs text-muted">Loading ABDM settings…</p>
        ) : (
          <form
            onSubmit={(e) => {
              e.preventDefault()
              if (config) {
                saveMutation.mutate({
                  hfrFacilityId: config.hfrFacilityId,
                  facilityName: config.facilityName,
                  hipId: config.hipId,
                  clientId: config.clientId,
                  clientSecret: config.clientSecret,
                  sandbox: config.sandbox ?? true,
                })
              }
            }}
            className="space-y-4"
          >
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Facility Name (as on HFR Registry)">
                <input
                  className={inputCls}
                  placeholder="e.g. Sanskar Hospital"
                  value={config?.facilityName ?? ''}
                  onChange={(e) => setForm({ ...(config ?? {}), facilityName: e.target.value })}
                />
              </Field>

              <Field label="HFR Facility ID (NHA Health Facility ID)">
                <input
                  className={inputCls}
                  placeholder="e.g. IN2910001234"
                  value={config?.hfrFacilityId ?? ''}
                  onChange={(e) => setForm({ ...(config ?? {}), hfrFacilityId: e.target.value })}
                />
              </Field>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Health Information Provider (HIP) ID">
                <input
                  className={inputCls}
                  placeholder="e.g. SANSKAR-HIP-01"
                  value={config?.hipId ?? ''}
                  onChange={(e) => setForm({ ...(config ?? {}), hipId: e.target.value })}
                />
              </Field>

              <Field label="ABDM Gateway Client ID">
                <input
                  className={inputCls}
                  placeholder="e.g. SBX_001928"
                  value={config?.clientId ?? ''}
                  onChange={(e) => setForm({ ...(config ?? {}), clientId: e.target.value })}
                />
              </Field>
            </div>

            <Field label="ABDM Gateway Client Secret">
              <input
                className={inputCls}
                type="password"
                placeholder="Enter client secret"
                value={config?.clientSecret ?? ''}
                onChange={(e) => setForm({ ...(config ?? {}), clientSecret: e.target.value })}
              />
            </Field>

            <div className="flex items-center justify-between rounded-xl bg-surface p-4 ring-1 ring-line">
              <div>
                <p className="text-sm font-semibold">Gateway Environment</p>
                <p className="text-xs text-muted">
                  Use NHA ABDM Sandbox (sbx.abdm.gov.in) for validation and simulated OTPs, or Production for live ABHA linking.
                </p>
              </div>
              <label className="flex items-center gap-2 cursor-pointer font-semibold text-xs text-ink">
                <input
                  type="checkbox"
                  checked={config?.sandbox ?? true}
                  onChange={(e) => setForm({ ...(config ?? {}), sandbox: e.target.checked })}
                  className="rounded border-line text-brand-600 focus:ring-brand-500"
                />
                Sandbox Gateway
              </label>
            </div>

            {saveMutation.error && (
              <p className="text-xs text-red-600">{(saveMutation.error as Error).message}</p>
            )}

            <div className="flex justify-end gap-3 pt-2">
              {isEditing && (
                <Button variant="ghost" onClick={() => setForm(null)}>
                  Discard
                </Button>
              )}
              <Button
                type="submit"
                disabled={!isEditing || saveMutation.isPending}
              >
                {saveMutation.isPending ? 'Saving…' : 'Save ABDM Settings'}
              </Button>
            </div>
          </form>
        )}
      </section>

      {/* Discovery & Bridge Webhook Endpoints */}
      <section className="rounded-2xl border border-line bg-white p-6 shadow-sm space-y-4">
        <h3 className="text-base font-semibold text-ink">NHA Gateway Bridge & Discovery Webhooks</h3>
        <p className="text-xs text-muted">
          Provide these endpoints to your ABDM Bridge software or directly in the ABDM Developer Portal for incoming patient discovery and care-context queries.
        </p>

        <div className="space-y-3 text-xs">
          <div className="rounded-xl bg-surface p-3 ring-1 ring-line flex items-center justify-between gap-4">
            <div className="min-w-0">
              <span className="font-semibold text-ink">Patient Discovery Callback:</span>
              <p className="font-mono text-muted truncate mt-0.5">{discoveryUrl}</p>
            </div>
            <button
              onClick={() => copyText(discoveryUrl, 'discovery')}
              className="inline-flex items-center gap-1 rounded-lg bg-white px-3 py-1.5 font-semibold text-brand-700 ring-1 ring-line hover:bg-brand-50"
            >
              {copied === 'discovery' ? <CheckCircle2 size={13} className="text-emerald-600" /> : <Copy size={13} />}
              {copied === 'discovery' ? 'Copied' : 'Copy URL'}
            </button>
          </div>

          <div className="rounded-xl bg-surface p-3 ring-1 ring-line flex items-center justify-between gap-4">
            <div className="min-w-0">
              <span className="font-semibold text-ink">FHIR R4 Specification:</span>
              <p className="text-muted mt-0.5">NRCeS India FHIR R4 (OPConsultRecord Document Bundle)</p>
            </div>
            <a
              href="https://nrces.in/ndhm/fhir/r4/"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-sky-700 hover:underline font-semibold"
            >
              NRCeS Docs <ExternalLink size={12} />
            </a>
          </div>
        </div>
      </section>

      {/* DPDP Act 2023 Consent Logs */}
      <section className="rounded-2xl border border-line bg-white p-6 shadow-sm space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-base font-semibold text-ink">DPDP Act 2023 & ABDM Consent Artifacts</h3>
            <p className="text-xs text-muted">Audit trail of health data access requests approved by patients.</p>
          </div>
          <button
            onClick={() => consentsQuery.refetch()}
            className="rounded-full p-2 text-muted hover:bg-surface hover:text-ink"
            title="Refresh Consents"
          >
            <RefreshCw size={14} className={consentsQuery.isFetching ? 'animate-spin' : ''} />
          </button>
        </div>

        <div className="overflow-x-auto rounded-xl ring-1 ring-line">
          <table className="w-full min-w-[600px] text-left text-xs">
            <thead className="bg-surface font-semibold text-muted">
              <tr>
                <th className="px-3.5 py-3">Consent ID</th>
                <th className="px-3.5 py-3">Patient</th>
                <th className="px-3.5 py-3">ABHA Address</th>
                <th className="px-3.5 py-3">Health Info Types</th>
                <th className="px-3.5 py-3">Status</th>
                <th className="px-3.5 py-3">Granted Date</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {(consentsQuery.data ?? []).map((c) => (
                <tr key={c.id}>
                  <td className="px-3.5 py-2.5 font-mono text-ink">{c.consentId.slice(0, 16)}…</td>
                  <td className="px-3.5 py-2.5 font-medium">{c.patient.fullName}</td>
                  <td className="px-3.5 py-2.5 text-muted">{c.patient.abhaAddress || '—'}</td>
                  <td className="px-3.5 py-2.5">
                    <div className="flex flex-wrap gap-1">
                      {c.hiTypes.map((t) => (
                        <span key={t} className="rounded-sm bg-sky-50 px-1.5 py-0.5 text-[10px] font-semibold text-sky-800">
                          {t}
                        </span>
                      ))}
                    </div>
                  </td>
                  <td className="px-3.5 py-2.5">
                    <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-bold text-emerald-800">
                      {c.status}
                    </span>
                  </td>
                  <td className="px-3.5 py-2.5 text-muted">{fmtDate(c.createdAt)}</td>
                </tr>
              ))}
              {(!consentsQuery.data || consentsQuery.data.length === 0) && (
                <tr>
                  <td colSpan={6} className="py-8 text-center text-muted">
                    No active ABDM consent artifacts recorded yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  )
}
