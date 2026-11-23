import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import clsx from 'clsx'
import {
  Building2,
  Edit2,
  KeyRound,
  Plus,
  Search,
  ShieldCheck,
  Trash2,
  UserCheck,
  UserCog,
  Users,
} from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { grants, useAuth } from '../auth'
import { Button, Field, inputCls, Modal } from './ui'
import { api } from '../lib/api'
import Access from '../pages/settings/Access'
import { useRoles } from '../pages/settings/Roles'

export interface Member {
  identityId: string
  name: string | null
  email?: string | null
  phone?: string | null
  roles: string[]
  branchIds: string[]
  mustChangePassword: boolean
}

interface SecretProps {
  title: string
  account: string
  password: string
  onClose: () => void
}

function SecretModal({ title, account, password, onClose }: SecretProps) {
  return (
    <Modal title={title} onClose={onClose}>
      <div className="space-y-4 text-sm">
        <p>
          Share this with the staff member now. It is shown <b>only once</b>, and they will be prompted to set their own permanent password on first sign-in.
        </p>
        <div className="rounded-2xl bg-surface p-4">
          <p className="text-xs text-muted">Sign-in account / Username</p>
          <p className="font-semibold text-ink">{account}</p>
          <p className="mt-3 text-xs text-muted">One-time temporary password</p>
          <p className="select-all font-mono text-lg font-bold tracking-wider text-brand-700">{password}</p>
        </div>
        <Button className="w-full" onClick={onClose}>Done</Button>
      </div>
    </Modal>
  )
}

function RoleChips({ value, onChange }: { value: string[]; onChange: (v: string[]) => void }) {
  const { me } = useAuth()
  const { data: roles } = useRoles()
  return (
    <div className="flex flex-wrap gap-2">
      {roles
        ?.filter((r) => value.includes(r.key) || r.permissions.every((p) => grants(me?.permissions ?? [], p)))
        .map((r) => {
          const on = value.includes(r.key)
          return (
            <button
              key={r.key}
              type="button"
              title={r.description ?? ''}
              onClick={() => onChange(on ? value.filter((x) => x !== r.key) : [...value, r.key])}
              className={clsx(
                'rounded-full border px-3 py-1.5 text-xs font-semibold transition',
                on ? 'border-brand-800 bg-brand-800 text-white' : 'border-line bg-white text-ink hover:border-brand-300',
              )}
            >
              {r.name}
            </button>
          )
        })}
    </div>
  )
}

export default function TeamDirectory() {
  const { me, can } = useAuth()
  const qc = useQueryClient()
  const { data: roleList } = useRoles()
  const roleLabel = (r: string) => roleList?.find((x) => x.key === r)?.name ?? r

  const { data: allBranches } = useQuery({
    queryKey: ['branches-manage'],
    queryFn: () => api<{ id: string; code: string; name: string; active: boolean }[]>('/branches/manage'),
    enabled: can('branches:manage'),
  })

  const { data } = useQuery({
    queryKey: ['team'],
    queryFn: () => api<{ members: Member[]; seats: { used: number; limit: number } }>('/team'),
  })

  const [query, setQuery] = useState('')
  const [roleFilter, setRoleFilter] = useState<string>('ALL')
  const [inspecting, setInspecting] = useState<Member | null>(null)
  const [placing, setPlacing] = useState<Member | null>(null)
  const [placed, setPlaced] = useState<string[]>([])
  const [editingProfile, setEditingProfile] = useState<Member | null>(null)
  const [profileForm, setProfileForm] = useState({ fullName: '', email: '', phone: '' })

  const [adding, setAdding] = useState(false)
  const [editingRoles, setEditingRoles] = useState<Member | null>(null)
  const [roles, setRoles] = useState<string[]>([])
  const [secret, setSecret] = useState<{ title: string; account: string; password: string } | null>(null)
  const [f, setF] = useState({ fullName: '', email: '', phone: '', roles: [] as string[] })

  const done = () => {
    qc.invalidateQueries({ queryKey: ['team'] })
    qc.invalidateQueries({ queryKey: ['team-stats'] })
  }

  const add = useMutation({
    mutationFn: () =>
      api<{ identityId: string; email?: string; phone?: string; temporaryPassword?: string }>('/team', {
        method: 'POST',
        body: JSON.stringify(f),
      }),
    onSuccess: (r) => {
      done()
      setAdding(false)
      if (r.temporaryPassword) {
        setSecret({
          title: 'Account created successfully',
          account: r.email || r.phone || f.email,
          password: r.temporaryPassword,
        })
      }
      setF({ fullName: '', email: '', phone: '', roles: [] })
    },
  })

  const saveRoles = useMutation({
    mutationFn: () => api(`/team/${editingRoles!.identityId}/roles`, { method: 'PUT', body: JSON.stringify({ roles }) }),
    onSuccess: () => {
      done()
      setEditingRoles(null)
    },
  })

  const saveBranches = useMutation({
    mutationFn: () => api(`/team/${placing!.identityId}/branches`, { method: 'PUT', body: JSON.stringify({ branchIds: placed }) }),
    onSuccess: () => {
      done()
      setPlacing(null)
    },
  })

  const updateProfile = useMutation({
    mutationFn: () =>
      api(`/team/${editingProfile!.identityId}`, {
        method: 'PATCH',
        body: JSON.stringify({
          fullName: profileForm.fullName.trim() || undefined,
          email: profileForm.email.trim() || undefined,
          phone: profileForm.phone.trim() || undefined,
        }),
      }),
    onSuccess: () => {
      done()
      setEditingProfile(null)
    },
  })

  const remove = useMutation({
    mutationFn: (id: string) => api(`/team/${id}`, { method: 'DELETE' }),
    onSuccess: done,
  })

  const resetPassword = useMutation({
    mutationFn: (m: Member) =>
      api<{ temporaryPassword: string }>(`/team/${m.identityId}/reset-password`, { method: 'POST', body: '{}' }).then((r) => ({
        m,
        r,
      })),
    onSuccess: ({ m, r }) =>
      setSecret({
        title: 'Temporary password generated',
        account: m.email || m.phone || '',
        password: r.temporaryPassword,
      }),
  })

  const members = data?.members ?? []
  const filtered = members.filter((m) => {
    const q = query.toLowerCase().trim()
    const matchesQuery =
      !q ||
      (m.name && m.name.toLowerCase().includes(q)) ||
      (m.email && m.email.toLowerCase().includes(q)) ||
      (m.phone && m.phone.includes(q)) ||
      m.roles.some((r) => r.toLowerCase().includes(q))
    const matchesRole = roleFilter === 'ALL' || m.roles.includes(roleFilter)
    return matchesQuery && matchesRole
  })

  const err = (add.error || saveRoles.error || saveBranches.error || updateProfile.error || remove.error || resetPassword.error) as Error | null

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="relative w-64 sm:w-80">
            <Search className="absolute left-3 top-2.5 text-muted" size={16} />
            <input
              className={`${inputCls} !pl-9`}
              placeholder="Search staff by name, email, phone..."
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
          <span className="text-xs text-muted">
            <b>{members.length}</b> staff account{members.length === 1 ? '' : 's'} (
            {data && data.seats.limit >= 1000 ? 'Unlimited seats' : `${data?.seats.used ?? 0} of ${data?.seats.limit} seats used`})
          </span>
        </div>

        {can('team:manage') && (
          <Button onClick={() => setAdding(true)}>
            <Plus size={16} /> Add Staff Member
          </Button>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-1.5 pt-1">
        <span className="mr-1 text-xs font-semibold text-muted">Role filter:</span>
        {['ALL', 'DOCTOR', 'NURSE', 'RECEPTIONIST', 'PHARMACIST', 'LAB_TECH', 'ADMIN', 'OWNER'].map((rf) => (
          <button
            key={rf}
            onClick={() => setRoleFilter(rf)}
            className={clsx(
              'rounded-full px-3 py-1 text-xs font-medium transition',
              roleFilter === rf ? 'bg-brand-800 text-white shadow-sm' : 'border border-line bg-surface text-muted hover:text-ink',
            )}
          >
            {rf === 'ALL' ? 'All Roles' : roleLabel(rf)}
          </button>
        ))}
      </div>

      {err && <p className="text-sm font-medium text-red-600">{err.message}</p>}

      <div className="overflow-x-auto rounded-2xl ring-1 ring-line">
        <table className="w-full min-w-[700px] text-left text-sm">
          <thead className="bg-surface text-xs font-semibold">
            <tr>
              <th className="px-4 py-3.5">Staff Member</th>
              <th className="px-4 py-3.5">Contact Details</th>
              <th className="px-4 py-3.5">Assigned Roles</th>
              <th className="px-4 py-3.5">Branches</th>
              <th className="px-4 py-3.5 text-right">Access & Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {filtered.map((m) => {
              const locked = !can('roles:manage') && m.roles.some((r) => r === 'OWNER' || r === 'ADMIN')
              const isMe = m.identityId === me?.user.id
              const branchNames = allBranches
                ? m.branchIds.map((bid) => allBranches.find((b) => b.id === bid)?.name).filter(Boolean)
                : []

              return (
                <tr key={m.identityId} className="hover:bg-surface/50">
                  <td className="px-4 py-3.5">
                    <div className="flex items-center gap-2.5">
                      <div className="grid size-9 shrink-0 place-items-center rounded-full bg-brand-100 font-semibold text-brand-800">
                        {m.name ? m.name.charAt(0).toUpperCase() : 'U'}
                      </div>
                      <div>
                        <p className="font-semibold text-ink">
                          {m.name || 'Unnamed staff'}
                          {isMe && (
                            <span className="ml-2 rounded-full bg-brand-100 px-2 py-0.5 text-[10px] font-semibold text-brand-700">
                              You
                            </span>
                          )}
                        </p>
                        {m.mustChangePassword ? (
                          <span className="text-[11px] font-medium text-amber-600">Pending first sign-in</span>
                        ) : (
                          <span className="flex items-center gap-1 text-[11px] text-emerald-600">
                            <UserCheck size={11} /> Active
                          </span>
                        )}
                      </div>
                    </div>
                  </td>

                  <td className="px-4 py-3.5 text-xs text-muted">
                    <p className="font-medium text-ink">{m.email || '-'}</p>
                    {m.phone && <p>{m.phone}</p>}
                  </td>

                  <td className="px-4 py-3.5">
                    <div className="flex flex-wrap gap-1.5">
                      {m.roles.map((r) => (
                        <span
                          key={r}
                          className="rounded-full bg-surface px-2.5 py-0.5 text-xs font-semibold text-ink ring-1 ring-line"
                        >
                          {roleLabel(r)}
                        </span>
                      ))}
                    </div>
                  </td>

                  <td className="px-4 py-3.5 text-xs text-muted">
                    {branchNames.length > 0 ? (
                      branchNames.join(', ')
                    ) : (
                      <span className="text-muted">Main Branch</span>
                    )}
                  </td>

                  <td className="px-4 py-3.5 text-right">
                    <div className="inline-flex items-center gap-1">
                      <button
                        className="rounded-lg p-1.5 text-muted hover:bg-surface hover:text-brand-700"
                        title="Granular Permissions & Exceptions"
                        aria-label="Granular Permissions & Exceptions"
                        onClick={() => setInspecting(m)}
                      >
                        <ShieldCheck size={17} />
                      </button>

                      {!locked && !isMe && can('team:manage') && (
                        <>
                          <button
                            className="rounded-lg p-1.5 text-muted hover:bg-surface hover:text-ink"
                            title="Edit Profile"
                            aria-label="Edit Profile"
                            onClick={() => {
                              setEditingProfile(m)
                              setProfileForm({
                                fullName: m.name ?? '',
                                email: m.email ?? '',
                                phone: m.phone ?? '',
                              })
                            }}
                          >
                            <Edit2 size={16} />
                          </button>

                          <button
                            className="rounded-lg p-1.5 text-muted hover:bg-surface hover:text-ink"
                            title="Change Roles"
                            aria-label="Change Roles"
                            onClick={() => {
                              setEditingRoles(m)
                              setRoles(m.roles)
                            }}
                          >
                            <UserCog size={17} />
                          </button>

                          {allBranches && allBranches.length > 1 && (
                            <button
                              className="rounded-lg p-1.5 text-muted hover:bg-surface hover:text-ink"
                              title="Assign Branches"
                              aria-label="Assign Branches"
                              onClick={() => {
                                setPlacing(m)
                                setPlaced(m.branchIds)
                              }}
                            >
                              <Building2 size={16} />
                            </button>
                          )}

                          <button
                            className="rounded-lg p-1.5 text-muted hover:bg-surface hover:text-amber-700"
                            title="Reset Password"
                            aria-label="Reset Password"
                            onClick={() => resetPassword.mutate(m)}
                          >
                            <KeyRound size={16} />
                          </button>

                          <button
                            className="rounded-lg p-1.5 text-muted hover:bg-red-50 hover:text-red-600"
                            title="Remove Member"
                            aria-label="Remove Member"
                            onClick={() => {
                              if (confirm(`Remove ${m.name || 'this staff member'} from the hospital?`)) {
                                remove.mutate(m.identityId)
                              }
                            }}
                          >
                            <Trash2 size={16} />
                          </button>
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>

        {filtered.length === 0 && (
          <div className="py-12 text-center text-sm text-muted">
            <Users className="mx-auto mb-2 text-muted" size={28} />
            <p>No staff members matched your search or filter.</p>
          </div>
        )}
      </div>

      {adding && (
        <Modal title="Add Staff Member" onClose={() => setAdding(false)}>
          <form
            onSubmit={(e: FormEvent) => {
              e.preventDefault()
              add.mutate()
            }}
            className="space-y-4"
          >
            <Field label="Full name">
              <input
                className={inputCls}
                required
                minLength={2}
                placeholder="Dr. Rajesh Sharma"
                value={f.fullName}
                onChange={(e) => setF({ ...f, fullName: e.target.value })}
                autoFocus
              />
            </Field>

            <Field label="Official email address (Sign-in username)">
              <input
                className={inputCls}
                type="email"
                required
                placeholder="rajesh.sharma@hospital.com"
                value={f.email}
                onChange={(e) => setF({ ...f, email: e.target.value })}
              />
            </Field>

            <Field label="Mobile number (optional)">
              <input
                className={inputCls}
                inputMode="numeric"
                maxLength={10}
                placeholder="10-digit mobile"
                value={f.phone}
                onChange={(e) => setF({ ...f, phone: e.target.value.replace(/\D/g, '') })}
              />
            </Field>

            <Field label="Assign initial roles">
              <RoleChips value={f.roles} onChange={(v) => setF({ ...f, roles: v })} />
            </Field>

            {add.error && <p className="text-sm text-red-600">{(add.error as Error).message}</p>}

            <Button type="submit" className="w-full" disabled={f.roles.length === 0 || !f.email || add.isPending}>
              Create Staff Account
            </Button>
          </form>
        </Modal>
      )}

      {editingRoles && (
        <Modal title={`Roles for ${editingRoles.name || 'Staff'}`} onClose={() => setEditingRoles(null)}>
          <div className="space-y-4">
            <RoleChips value={roles} onChange={setRoles} />
            <p className="text-xs text-muted">
              Permissions take effect on the staff member's active session or next sign-in.
            </p>
            {saveRoles.error && <p className="text-sm text-red-600">{(saveRoles.error as Error).message}</p>}
            <Button className="w-full" disabled={roles.length === 0 || saveRoles.isPending} onClick={() => saveRoles.mutate()}>
              Save Role Assignments
            </Button>
          </div>
        </Modal>
      )}

      {editingProfile && (
        <Modal title={`Edit Profile: ${editingProfile.name}`} onClose={() => setEditingProfile(null)}>
          <div className="space-y-4">
            <Field label="Full Name">
              <input
                className={inputCls}
                value={profileForm.fullName}
                onChange={(e) => setProfileForm({ ...profileForm, fullName: e.target.value })}
              />
            </Field>
            <Field label="Email Address">
              <input
                className={inputCls}
                type="email"
                value={profileForm.email}
                onChange={(e) => setProfileForm({ ...profileForm, email: e.target.value })}
              />
            </Field>
            <Field label="Mobile Phone">
              <input
                className={inputCls}
                value={profileForm.phone}
                onChange={(e) => setProfileForm({ ...profileForm, phone: e.target.value.replace(/\D/g, '') })}
              />
            </Field>
            {updateProfile.error && <p className="text-sm text-red-600">{(updateProfile.error as Error).message}</p>}
            <Button
              className="w-full"
              disabled={!profileForm.fullName.trim() || updateProfile.isPending}
              onClick={() => updateProfile.mutate()}
            >
              Update Staff Profile
            </Button>
          </div>
        </Modal>
      )}

      {placing && allBranches && (
        <Modal title={`Branch Access for ${placing.name || 'Staff'}`} onClose={() => setPlacing(null)}>
          <div className="space-y-4">
            <div className="flex flex-wrap gap-2">
              {allBranches
                .filter((b) => b.active)
                .map((b) => {
                  const on = placed.includes(b.id)
                  return (
                    <button
                      key={b.id}
                      type="button"
                      onClick={() => setPlaced(on ? placed.filter((x) => x !== b.id) : [...placed, b.id])}
                      className={clsx(
                        'rounded-full border px-3 py-1.5 text-xs font-semibold transition',
                        on ? 'border-brand-800 bg-brand-800 text-white' : 'border-line bg-white hover:border-brand-300',
                      )}
                    >
                      {b.name}
                    </button>
                  )
                })}
            </div>
            <p className="text-xs text-muted">
              With none selected, the staff member works in the Main branch. Staff members with role permissions for all branches are not limited by this selection.
            </p>
            {saveBranches.error && <p className="text-sm text-red-600">{(saveBranches.error as Error).message}</p>}
            <Button className="w-full" disabled={saveBranches.isPending} onClick={() => saveBranches.mutate()}>
              Save Branch Access
            </Button>
          </div>
        </Modal>
      )}

      {inspecting && (
        <Access personId={inspecting.identityId} canEdit={can('roles:manage')} onClose={() => setInspecting(null)} />
      )}

      {secret && <SecretModal {...secret} onClose={() => setSecret(null)} />}
    </div>
  )
}
