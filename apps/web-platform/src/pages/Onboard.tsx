import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import clsx from 'clsx'
import { ArrowLeft, Check, Copy, Printer, ShieldCheck } from 'lucide-react'
import { useEffect, useState, type ReactNode } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Button, inputCls, Select } from '@hms/ui-web'
import { api } from '../lib/api'

interface Catalog { catalog: { key: string; label: string; description: string; group: string }[]; plans: { code: string; label: string; features: string[] }[] }
interface Result { tenant: { id: string; name: string; status: string; trialEndsAt: string | null }; owner: { name: string; phone: string; temporaryPassword?: string; existingAccount: boolean } }
type Kind = 'HOSPITAL' | 'CLINIC' | 'PHARMACY'
type AgKind = 'MSA' | 'DPA' | 'ORDER_FORM'
interface Ag { on: boolean; version: string; signedByName: string; signedByTitle: string; signedByEmail: string; signedAt: string; effectiveFrom: string; termMonths: string; autoRenew: boolean; documentRef: string }
const today = new Date().toISOString().slice(0, 10)
const blankAg = (version: string, term: string, on: boolean): Ag => ({ on, version, signedByName: '', signedByTitle: '', signedByEmail: '', signedAt: today, effectiveFrom: today, termMonths: term, autoRenew: true, documentRef: '' })
const INITIAL = {
  kind: 'HOSPITAL' as Kind, name: '', legalName: '', entityType: 'PRIVATE_LIMITED', registrationNo: '', drugLicenceNo: '', gstin: '', pan: '', bedCount: '',
  addressLine1: '', addressLine2: '', city: '', state: '', pincode: '', contactEmail: '', contactPhone: '', website: '', billingContact: '', billingEmail: '',
  adminName: '', adminDesignation: '', adminPhone: '', adminEmail: '',
  planCode: 'STARTER' as 'PAY_PER_PATIENT' | 'STARTER' | 'UNLIMITED', status: 'TRIAL' as 'TRIAL' | 'ACTIVE', trialDays: '30', branchName: '', note: '',
  maxSeats: '', maxBranches: '', flip: {} as Record<string, boolean>,
  ag: { MSA: blankAg('2026.1', '12', true), DPA: blankAg('2026.1', '12', true), ORDER_FORM: blankAg('2026.1', '12', false) } as Record<AgKind, Ag>, attest: false,
}
type Form = typeof INITIAL
const AG_LABEL: Record<AgKind, [string, string]> = { MSA: ['Master Services Agreement', 'Required. Governs the service, fees, uptime and termination.'], DPA: ['Data Processing Agreement', 'Recommended. How patient data is held, processed and protected (DPDP Act).'], ORDER_FORM: ['Order Form', 'Optional. Commercial terms specific to this account.'] }
const STATES = ['Andhra Pradesh', 'Arunachal Pradesh', 'Assam', 'Bihar', 'Chhattisgarh', 'Goa', 'Gujarat', 'Haryana', 'Himachal Pradesh', 'Jharkhand', 'Karnataka', 'Kerala', 'Madhya Pradesh', 'Maharashtra', 'Manipur', 'Meghalaya', 'Mizoram', 'Nagaland', 'Odisha', 'Punjab', 'Rajasthan', 'Sikkim', 'Tamil Nadu', 'Telangana', 'Tripura', 'Uttar Pradesh', 'Uttarakhand', 'West Bengal', 'Andaman and Nicobar Islands', 'Chandigarh', 'Dadra and Nagar Haveli and Daman and Diu', 'Delhi', 'Jammu and Kashmir', 'Ladakh', 'Lakshadweep', 'Puducherry']
const ENTITY = [['PRIVATE_LIMITED', 'Private limited company'], ['LLP', 'LLP'], ['PARTNERSHIP', 'Partnership firm'], ['PROPRIETORSHIP', 'Proprietorship'], ['TRUST', 'Trust / society'], ['GOVERNMENT', 'Government'], ['OTHER', 'Other']] as const
const STEPS = ['Organization', 'Address & contacts', 'Organization admin', 'Plan & commercial', 'Modules & limits', 'Agreements', 'Review & create']
const GSTIN = /^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/
const PAN = /^[A-Z]{5}\d{4}[A-Z]$/
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

function F({ label, hint, error, children, wide }: { label: string; hint?: string; error?: string | false; children: ReactNode; wide?: boolean }) {
  return <label className={clsx('block text-sm font-medium', wide && 'sm:col-span-2')}>{label}<div className="mt-1.5">{children}</div>{error ? <span className="mt-1 block text-xs text-red-600">{error}</span> : hint && <span className="mt-1 block text-xs font-normal text-muted">{hint}</span>}</label>
}

/** The errors that stop someone moving on from a step. */
function problems(f: Form, step: number): Record<string, string> {
  const e: Record<string, string> = {}
  if (step === 0) {
    if (f.name.trim().length < 3) e.name = 'Enter the name people know it by'
    if (f.legalName.trim().length < 3) e.legalName = 'Enter the registered legal name'
    if (f.kind === 'PHARMACY' ? !f.drugLicenceNo.trim() : !f.registrationNo.trim()) e[f.kind === 'PHARMACY' ? 'drugLicenceNo' : 'registrationNo'] = f.kind === 'PHARMACY' ? 'A drug licence number is required' : 'A clinical establishment registration number is required'
    if (f.gstin && !GSTIN.test(f.gstin.toUpperCase())) e.gstin = 'This is not a valid GSTIN'
    if (f.pan && !PAN.test(f.pan.toUpperCase())) e.pan = 'This is not a valid PAN'
  }
  if (step === 1) {
    if (f.addressLine1.trim().length < 3) e.addressLine1 = 'Required'
    if (f.city.trim().length < 2) e.city = 'Required'
    if (!f.state) e.state = 'Choose a state'
    if (!/^[1-9]\d{5}$/.test(f.pincode)) e.pincode = 'Enter a 6-digit pincode'
    if (!EMAIL.test(f.contactEmail)) e.contactEmail = 'Enter an official email address'
    if (f.billingEmail && !EMAIL.test(f.billingEmail)) e.billingEmail = 'Not a valid email'
  }
  if (step === 2) {
    if (f.adminName.trim().length < 2) e.adminName = 'Required'
    if (!/^[6-9]\d{9}$/.test(f.adminPhone)) e.adminPhone = 'Enter a 10-digit Indian mobile number'
    if (!EMAIL.test(f.adminEmail)) e.adminEmail = 'Enter their official email address'
  }
  if (step === 3 && f.status === 'TRIAL' && !(Number(f.trialDays) >= 1 && Number(f.trialDays) <= 365)) e.trialDays = '1 to 365 days'
  if (step === 5) {
    for (const k of Object.keys(f.ag) as AgKind[]) {
      const a = f.ag[k]; if (!a.on) continue
      if (a.signedByName.trim().length < 2 || a.signedByTitle.trim().length < 2 || !EMAIL.test(a.signedByEmail) || !a.version.trim() || !(Number(a.termMonths) >= 1)) e[k] = 'Complete the signatory, version and term'
    }
    if (!f.attest) e.attest = 'Confirm that signed copies are on file'
  }
  return e
}

export default function Onboard() {
  const nav = useNavigate()
  const qc = useQueryClient()
  const { data: cat } = useQuery({ queryKey: ['feature-catalog'], queryFn: () => api<Catalog>('/platform/features') })
  const [f, setF] = useState<Form>(() => { try { const d = sessionStorage.getItem('onboard-draft'); return d ? { ...INITIAL, ...JSON.parse(d) } : INITIAL } catch { return INITIAL } })
  const [step, setStep] = useState(0)
  const [done, setDone] = useState(0)
  const [shown, setShown] = useState(false)
  const [result, setResult] = useState<Result | null>(null)
  const [copied, setCopied] = useState(false)
  useEffect(() => { try { sessionStorage.setItem('onboard-draft', JSON.stringify({ ...f, attest: false })) } catch { /* no storage */ } }, [f])
  const set = <K extends keyof Form>(k: K, v: Form[K]) => setF((x) => ({ ...x, [k]: v }))
  const txt = (k: keyof Form, extra?: { upper?: boolean; digits?: boolean; max?: number; ph?: string }) => (
    <input className={inputCls} value={f[k] as string} maxLength={extra?.max} placeholder={extra?.ph} onChange={(e) => { let v = e.target.value; if (extra?.digits) v = v.replace(/\D/g, ''); if (extra?.upper) v = v.toUpperCase(); set(k, v as never) }} />
  )
  const err = shown ? problems(f, step) : {}
  const planOn = (key: string) => (cat?.plans.find((p) => p.code === f.planCode)?.features ?? []).includes(key) || (f.kind === 'PHARMACY' && key === 'pharmacy')
  const on = (key: string) => (key in f.flip ? f.flip[key]! : planOn(key))
  const next = () => { setShown(true); if (Object.keys(problems(f, step)).length === 0) { setShown(false); setDone(Math.max(done, step + 1)); setStep(step + 1); window.scrollTo(0, 0) } }
  const go = (i: number) => { if (i <= done) { setShown(false); setStep(i) } }

  const create = useMutation({
    mutationFn: () => api<Result>('/platform/tenants', { method: 'POST', body: JSON.stringify({
      name: f.name, kind: f.kind, planCode: f.planCode, status: f.status, trialDays: Number(f.trialDays) || 30, branchName: f.branchName || undefined, note: f.note || undefined,
      owner: { name: f.adminName, phone: f.adminPhone },
      profile: { legalName: f.legalName, entityType: f.entityType, registrationNo: f.registrationNo, drugLicenceNo: f.drugLicenceNo, gstin: f.gstin, pan: f.pan, addressLine1: f.addressLine1, addressLine2: f.addressLine2, city: f.city, state: f.state, pincode: f.pincode, contactEmail: f.contactEmail, contactPhone: f.contactPhone, website: f.website, bedCount: f.bedCount ? Number(f.bedCount) : undefined, adminDesignation: f.adminDesignation, adminEmail: f.adminEmail, billingEmail: f.billingEmail, billingContact: f.billingContact },
      agreements: (Object.entries(f.ag) as [AgKind, Ag][]).filter(([, a]) => a.on).map(([kind, a]) => ({ kind, version: a.version, signedByName: a.signedByName, signedByTitle: a.signedByTitle, signedByEmail: a.signedByEmail, signedAt: new Date(a.signedAt).toISOString(), effectiveFrom: a.effectiveFrom, termMonths: Number(a.termMonths), autoRenew: a.autoRenew, documentRef: a.documentRef })),
      features: Object.entries(f.flip).filter(([k, v]) => v !== planOn(k)).map(([feature, enabled]) => ({ feature, enabled })),
      limits: f.maxSeats || f.maxBranches ? { maxSeats: f.maxSeats ? Number(f.maxSeats) : null, maxBranches: f.maxBranches ? Number(f.maxBranches) : null } : undefined,
    }) }),
    onSuccess: (r) => { try { sessionStorage.removeItem('onboard-draft') } catch { /* no storage */ } setResult(r); for (const k of ['hospitals', 'overview']) qc.invalidateQueries({ queryKey: [k] }) },
  })

  if (result) {
    const text = `${result.tenant.name}\nOrganization admin: ${result.owner.name}\nMobile number: ${result.owner.phone}\n${result.owner.temporaryPassword ? `Temporary password: ${result.owner.temporaryPassword}\nThey must choose their own password at first sign-in.` : 'They sign in with their existing password.'}`
    return (
      <div className="mx-auto max-w-xl py-10 text-sm">
        <p className="mb-6 flex items-center gap-2 rounded-xl bg-brand-50 px-4 py-3 font-semibold text-brand-800"><Check size={16} /> {result.tenant.name} has been onboarded.</p>
        <div className="space-y-1 rounded-2xl bg-surface p-5 ring-1 ring-line">
          <p className="text-xs text-muted">Organization admin</p><p className="font-semibold">{result.owner.name} · {result.owner.phone}</p>
          {result.owner.temporaryPassword ? <><p className="pt-3 text-xs text-muted">Temporary password. This is shown once and cannot be retrieved later.</p><p className="select-all font-mono text-xl font-bold tracking-wider">{result.owner.temporaryPassword}</p></> : <p className="pt-2 text-muted">This number already has an account, so their current password still works.</p>}
        </div>
        <p className="mt-4 text-muted">The organization admin now controls the organization's roles, permissions, access policies and staff accounts, within the modules and limits you set.</p>
        <div className="mt-5 flex gap-2">
          <Button variant="ghost" onClick={() => { void navigator.clipboard?.writeText(text); setCopied(true) }}><Copy size={15} /> {copied ? 'Copied' : 'Copy'}</Button>
          <Button variant="ghost" onClick={() => window.print()}><Printer size={15} /> Print</Button>
          <Button className="ml-auto" onClick={() => nav(`/hospitals/${result.tenant.id}`)}>Open organization</Button>
        </div>
      </div>
    )
  }

  const pharmacy = f.kind === 'PHARMACY'
  const sum = (rows: [string, string | undefined][], title: string, i: number) => (
    <section className="rounded-2xl p-5 ring-1 ring-line"><div className="mb-3 flex items-center justify-between"><h3 className="font-semibold">{title}</h3><button className="text-xs font-semibold text-brand-700 hover:underline" onClick={() => go(i)}>Edit</button></div>
      <dl className="grid gap-x-6 gap-y-1.5 text-sm sm:grid-cols-2">{rows.filter(([, v]) => v).map(([k, v]) => <div key={k} className="flex justify-between gap-3"><dt className="text-muted">{k}</dt><dd className="text-right font-medium">{v}</dd></div>)}</dl></section>
  )
  return (
    <div>
      <Link to="/hospitals" className="mb-3 inline-flex items-center gap-1.5 text-sm text-muted hover:text-ink"><ArrowLeft size={15} /> Organizations</Link>
      <h1 className="mb-8 text-3xl font-semibold tracking-tight">Onboard an organization</h1>
      <div className="grid gap-10 lg:grid-cols-[15rem_1fr]">
        <nav aria-label="Onboarding steps" className="lg:sticky lg:top-6 lg:self-start">
          <ol className="flex gap-2 overflow-x-auto lg:flex-col lg:gap-1">
            {STEPS.map((s, i) => (
              <li key={s}><button type="button" disabled={i > done} onClick={() => go(i)} aria-current={i === step ? 'step' : undefined} className={clsx('flex w-full items-center gap-3 whitespace-nowrap rounded-xl px-3 py-2.5 text-left text-sm', i === step ? 'bg-brand-50 font-semibold text-brand-800' : i <= done ? 'hover:bg-surface' : 'text-slate-400')}>
                <span className={clsx('grid size-6 shrink-0 place-items-center rounded-full text-xs font-bold', i < done && i !== step ? 'bg-brand-700 text-white' : i === step ? 'bg-brand-700 text-white' : 'bg-slate-200 text-slate-500')}>{i < done && i !== step ? <Check size={13} /> : i + 1}</span>{s}</button></li>
            ))}
          </ol>
        </nav>
        <div className="max-w-3xl">
          <h2 className="mb-1 text-xl font-semibold">{STEPS[step]}</h2>
          <p className="mb-6 text-sm text-muted">{['Who the organization is, and the registrations that allow it to operate.', 'Where it operates and who to contact.', 'The person who will administer this organization. They control roles, permissions and access for their own staff.', 'The plan and how the account starts.', 'Which modules this organization can use, and its limits.', 'Record the signed agreements. The account cannot be created without a master services agreement.', 'Check everything before the account is created.'][step]}</p>
          {step === 0 && (
            <div className="grid gap-5 sm:grid-cols-2">
              <F label="Type of organization" wide><Select value={f.kind} onChange={(v) => set('kind', v)} options={[{ value: 'HOSPITAL', label: 'Hospital' }, { value: 'CLINIC', label: 'Clinic or independent practice' }, { value: 'PHARMACY', label: 'Pharmacy / medical store (standalone)' }]} /></F>
              <F label="Display name" error={err.name} hint="How staff and patients know it">{txt('name', { ph: 'Sunrise Rural Hospital' })}</F>
              <F label="Registered legal name" error={err.legalName}>{txt('legalName', { ph: 'Sunrise Healthcare Pvt Ltd' })}</F>
              <F label="Entity type"><Select value={f.entityType} onChange={(v) => set('entityType', v)} options={ENTITY.map(([value, label]) => ({ value, label }))} /></F>
              {pharmacy ? <F label="Drug licence number" error={err.drugLicenceNo} hint="Form 20/21 licence">{txt('drugLicenceNo')}</F> : <F label="Clinical establishment registration no." error={err.registrationNo}>{txt('registrationNo')}</F>}
              <F label="GSTIN" error={err.gstin} hint="Needed to issue GST invoices">{txt('gstin', { upper: true, max: 15 })}</F>
              <F label="PAN" error={err.pan}>{txt('pan', { upper: true, max: 10 })}</F>
              {f.kind === 'HOSPITAL' && <F label="Number of beds">{txt('bedCount', { digits: true, max: 5 })}</F>}
            </div>
          )}
          {step === 1 && (
            <div className="grid gap-5 sm:grid-cols-2">
              <F label="Address line 1" error={err.addressLine1} wide>{txt('addressLine1')}</F>
              <F label="Address line 2" wide>{txt('addressLine2')}</F>
              <F label="City" error={err.city}>{txt('city')}</F>
              <F label="State" error={err.state}><Select value={f.state} onChange={(v) => set('state', v)} options={[{ value: '', label: 'Choose a state' }, ...STATES.map((s) => ({ value: s, label: s }))]} /></F>
              <F label="Pincode" error={err.pincode}>{txt('pincode', { digits: true, max: 6 })}</F>
              <F label="Official email" error={err.contactEmail}>{txt('contactEmail')}</F>
              <F label="Phone">{txt('contactPhone', { digits: true, max: 12 })}</F>
              <F label="Website">{txt('website')}</F>
              <F label="Billing contact" hint="Who receives invoices. Leave blank to use the administrator.">{txt('billingContact')}</F>
              <F label="Billing email" error={err.billingEmail}>{txt('billingEmail')}</F>
            </div>
          )}
          {step === 2 && (
            <div className="space-y-6">
              <div className="grid gap-5 sm:grid-cols-2">
                <F label="Full name" error={err.adminName}>{txt('adminName')}</F>
                <F label="Designation" hint="For example Director, Medical Superintendent">{txt('adminDesignation')}</F>
                <F label="Mobile number" error={err.adminPhone} hint="They sign in with this number">{txt('adminPhone', { digits: true, max: 10 })}</F>
                <F label="Official email" error={err.adminEmail}>{txt('adminEmail')}</F>
              </div>
              <div className="flex gap-3 rounded-2xl bg-surface p-5 text-sm ring-1 ring-line"><ShieldCheck className="mt-0.5 shrink-0 text-brand-700" size={18} />
                <div><p className="font-semibold">What the organization admin can do</p><ul className="mt-1.5 list-disc space-y-1 pl-5 text-muted"><li>Create and edit roles, and decide what each role may do</li><li>Grant or revoke individual permissions, and set access policies and limits</li><li>Add staff, assign branches, and deactivate accounts</li><li>See their organization's audit trail</li></ul>
                  <p className="mt-2 text-muted">They cannot use a module you have switched off, exceed the staff limit, or see any other organization. A temporary password is generated and shown to you once.</p></div></div>
            </div>
          )}
          {step === 3 && (
            <div className="grid gap-5 sm:grid-cols-2">
              <F label="Plan"><Select value={f.planCode} onChange={(v) => set('planCode', v)} options={[{ value: 'PAY_PER_PATIENT', label: 'Pay per patient · Rs 200 lifetime per patient' }, { value: 'STARTER', label: 'Starter · Rs 10,000 per month' }, { value: 'UNLIMITED', label: 'Unlimited · Rs 20,000 per month' }]} /></F>
              <F label="Account starts as"><Select value={f.status} onChange={(v) => set('status', v)} options={[{ value: 'TRIAL', label: 'Free trial (every module)' }, { value: 'ACTIVE', label: 'Active (billed from the agreement start)' }]} /></F>
              {f.status === 'TRIAL' && <F label="Trial length (days)" error={err.trialDays}>{txt('trialDays', { digits: true, max: 3 })}</F>}
              <F label="First branch name" hint="Defaults to Main branch">{txt('branchName')}</F>
              <F label="Internal note" wide>{txt('note', { max: 300 })}</F>
              <p className="text-xs text-muted sm:col-span-2">All prices are exclusive of 18% GST.</p>
            </div>
          )}
          {step === 4 && (
            <div className="space-y-6">
              <ul className="grid gap-2 sm:grid-cols-2">
                {cat?.catalog.map((c) => { const v = on(c.key); const changed = v !== planOn(c.key); return (
                  <li key={c.key}><button type="button" role="switch" aria-checked={v} onClick={() => set('flip', { ...f.flip, [c.key]: !v })} className={clsx('flex w-full items-start gap-3 rounded-xl border p-3 text-left transition', v ? 'border-brand-300 bg-brand-50' : 'border-line bg-white', changed && 'ring-2 ring-amber-300')}>
                    <span className={clsx('mt-0.5 grid size-5 shrink-0 place-items-center rounded-md', v ? 'bg-brand-700 text-white' : 'border border-slate-300')}>{v && <Check size={13} />}</span>
                    <span><span className="block text-sm font-semibold">{c.label}{changed && <span className="ml-2 text-[10px] font-bold uppercase text-amber-700">differs from plan</span>}</span><span className="block text-xs text-muted">{c.description}</span></span></button></li>) })}
              </ul>
              <div className="grid gap-5 sm:grid-cols-2">
                <F label="Staff accounts allowed" hint="Blank follows the plan">{txt('maxSeats', { digits: true, max: 5 })}</F>
                <F label="Branches allowed" hint="Blank means no limit">{txt('maxBranches', { digits: true, max: 3 })}</F>
              </div>
            </div>
          )}
          {step === 5 && (
            <div className="space-y-5">
              {(Object.keys(f.ag) as AgKind[]).map((k) => { const a = f.ag[k]; const up = (p: Partial<Ag>) => set('ag', { ...f.ag, [k]: { ...a, ...p } }); return (
                <section key={k} className={clsx('rounded-2xl p-5 ring-1', a.on ? 'ring-line' : 'bg-surface/60 ring-line')}>
                  <div className="flex items-start justify-between gap-4"><div><h3 className="font-semibold">{AG_LABEL[k][0]}</h3><p className="text-xs text-muted">{AG_LABEL[k][1]}</p></div>
                    {k === 'MSA' ? <span className="rounded-full bg-brand-100 px-2.5 py-1 text-[11px] font-bold text-brand-700">REQUIRED</span> : <label className="flex items-center gap-2 text-xs font-semibold"><input type="checkbox" checked={a.on} onChange={(e) => up({ on: e.target.checked })} /> Signed</label>}</div>
                  {a.on && (
                    <div className="mt-4 grid gap-4 sm:grid-cols-2">
                      <F label="Version"><input className={inputCls} value={a.version} onChange={(e) => up({ version: e.target.value })} /></F>
                      <F label="Term (months)"><input className={inputCls} inputMode="numeric" value={a.termMonths} onChange={(e) => up({ termMonths: e.target.value.replace(/\D/g, '') })} /></F>
                      <F label="Signed by (name)"><input className={inputCls} value={a.signedByName} onChange={(e) => up({ signedByName: e.target.value })} /></F>
                      <F label="Designation"><input className={inputCls} value={a.signedByTitle} onChange={(e) => up({ signedByTitle: e.target.value })} /></F>
                      <F label="Signatory email"><input className={inputCls} value={a.signedByEmail} onChange={(e) => up({ signedByEmail: e.target.value })} /></F>
                      <F label="Document reference" hint="E-sign envelope id or file number"><input className={inputCls} value={a.documentRef} onChange={(e) => up({ documentRef: e.target.value })} /></F>
                      <F label="Date signed"><input type="date" max={today} className={inputCls} value={a.signedAt} onChange={(e) => up({ signedAt: e.target.value })} /></F>
                      <F label="Effective from"><input type="date" className={inputCls} value={a.effectiveFrom} onChange={(e) => up({ effectiveFrom: e.target.value })} /></F>
                      <label className="flex items-center gap-2 text-sm sm:col-span-2"><input type="checkbox" checked={a.autoRenew} onChange={(e) => up({ autoRenew: e.target.checked })} /> Renews automatically at the end of the term</label>
                    </div>)}
                  {err[k] && <p className="mt-3 text-xs text-red-600">{err[k]}</p>}
                </section>) })}
              <label className="flex items-start gap-3 rounded-2xl bg-surface p-4 text-sm ring-1 ring-line"><input type="checkbox" className="mt-1" checked={f.attest} onChange={(e) => set('attest', e.target.checked)} /><span>I confirm that signed copies of these agreements are held on file, and that the signatory is authorised to bind the organization.{err.attest && <span className="mt-1 block text-xs text-red-600">{err.attest}</span>}</span></label>
              <p className="text-xs text-muted">Agreements are stored as a permanent record. They cannot be edited or deleted afterwards. A renewal or amendment is added as a new entry.</p>
            </div>
          )}
          {step === 6 && (
            <div className="space-y-4">
              {sum([['Display name', f.name], ['Legal name', f.legalName], ['Type', f.kind.toLowerCase()], [pharmacy ? 'Drug licence' : 'Registration', pharmacy ? f.drugLicenceNo : f.registrationNo], ['GSTIN', f.gstin], ['PAN', f.pan]], 'Organization', 0)}
              {sum([['Address', [f.addressLine1, f.addressLine2, f.city, f.state, f.pincode].filter(Boolean).join(', ')], ['Email', f.contactEmail], ['Billing', f.billingEmail]], 'Address and contacts', 1)}
              {sum([['Name', f.adminName], ['Designation', f.adminDesignation], ['Mobile', f.adminPhone], ['Email', f.adminEmail]], 'Organization admin', 2)}
              {sum([['Plan', f.planCode.replace(/_/g, ' ').toLowerCase()], ['Starts as', f.status === 'TRIAL' ? `Trial, ${f.trialDays} days` : 'Active']], 'Plan', 3)}
              {sum([['Modules on', String(cat?.catalog.filter((c) => on(c.key)).length ?? 0)], ['Changed from plan', String(Object.entries(f.flip).filter(([k, v]) => v !== planOn(k)).length)], ['Staff limit', f.maxSeats || 'Plan default'], ['Branch limit', f.maxBranches || 'None']], 'Modules and limits', 4)}
              {sum((Object.entries(f.ag) as [AgKind, Ag][]).filter(([, a]) => a.on).map(([k, a]) => [AG_LABEL[k][0], `v${a.version} · ${a.termMonths} months · ${a.signedByName}`] as [string, string]), 'Agreements', 5)}
              {create.error && <p className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">{(create.error as Error).message}</p>}
            </div>
          )}
          <div className="mt-8 flex justify-between gap-2 border-t border-line pt-5">
            <Button variant="ghost" onClick={() => (step === 0 ? nav('/hospitals') : go(step - 1))}>{step === 0 ? 'Cancel' : 'Back'}</Button>
            {step < 6 ? <Button onClick={next}>Continue</Button> : <Button disabled={create.isPending} onClick={() => create.mutate()}>{create.isPending ? 'Creating…' : 'Create organization'}</Button>}
          </div>
        </div>
      </div>
    </div>
  )
}
