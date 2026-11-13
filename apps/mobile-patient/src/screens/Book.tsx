import { useEffect, useMemo, useState } from 'react'
import { Pressable, Text, View } from 'react-native'
import { Button, Card, Chip, colors, ErrorText, Muted, Row, Screen, TextField, Title } from '@hms/ui-native'
import { api } from '../api'
import { useSession } from '../session'
import type { Branch, Doctor, Hospital, Slot } from '../types'

const SLOTS = [[9, 0], [10, 0], [11, 0], [12, 0], [16, 0], [17, 0], [18, 0]] as const

const atSlot = (dayOffset: number, [h, m]: readonly [number, number]) => {
  const d = new Date()
  d.setDate(d.getDate() + dayOffset)
  d.setHours(h, m, 0, 0)
  return d
}

export default function Book({ done }: { done: () => void }) {
  const { me, refresh } = useSession()
  const [q, setQ] = useState('')
  const [hospitals, setHospitals] = useState<Hospital[]>([])
  const [hospital, setHospital] = useState<Hospital | null>(null)
  const [fullName, setFullName] = useState(me?.identity.name ?? '')
  const [doctors, setDoctors] = useState<Doctor[]>([])
  const [branches, setBranches] = useState<Branch[]>([])
  const [branchId, setBranchId] = useState<string | undefined>()
  const [openSlots, setOpenSlots] = useState<Slot[] | null>(null)
  const [slotTime, setSlotTime] = useState<string | null>(null)
  const [doctorId, setDoctorId] = useState<string | undefined>()
  const [day, setDay] = useState(0)
  const [slot, setSlot] = useState<number | null>(null)
  const [channel, setChannel] = useState<'IN_PERSON' | 'TELE'>('IN_PERSON')
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [booked, setBooked] = useState<{ tokenNo: number } | null>(null)

  useEffect(() => {
    const t = setTimeout(() => api<Hospital[]>(`/public/hospitals?q=${encodeURIComponent(q)}`).then(setHospitals).catch(() => setHospitals([])), 250)
    return () => clearTimeout(t)
  }, [q])

  const linked = !!hospital && !!me?.hospitals.some((h) => h.tenantId === hospital.id)

  useEffect(() => {
    if (!hospital) return
    api<Branch[]>(`/public/hospitals/${hospital.id}/branches`).then((b) => { setBranches(b); setBranchId((cur) => cur ?? b.find((x) => x.isMain)?.id ?? b[0]?.id) }).catch(() => setBranches([]))
  }, [hospital])
  useEffect(() => {
    if (!hospital) return
    setDoctorId(undefined)
    api<Doctor[]>(`/public/hospitals/${hospital.id}/doctors${branchId ? `?branchId=${branchId}` : ''}`).then(setDoctors).catch(() => setDoctors([]))
  }, [hospital, branchId])

  // A doctor who keeps a schedule is booked into their real free slots; otherwise the usual times are offered.
  const chosen = doctors.find((d) => d.id === doctorId)
  const scheduled = !!chosen?.hasSchedule && !!branchId
  const dayKey = useMemo(() => { const d = new Date(); d.setDate(d.getDate() + day); return new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 10) }, [day])
  useEffect(() => {
    setSlotTime(null); setOpenSlots(null)
    if (!hospital || !scheduled || !doctorId || !branchId) return
    api<Slot[]>(`/public/hospitals/${hospital.id}/doctors/${doctorId}/slots?date=${dayKey}&branchId=${branchId}`).then(setOpenSlots).catch(() => setOpenSlots([]))
  }, [hospital, scheduled, doctorId, branchId, dayKey])

  const days = useMemo(() => Array.from({ length: 7 }, (_, i) => atSlot(i, [0, 0])), [])
  const slotTimes = useMemo(() => SLOTS.map((s, i) => ({ i, date: atSlot(day, s) })).filter((s) => s.date.getTime() > Date.now()), [day])

  const join = async () => {
    if (!hospital) return
    setBusy(true); setError(null)
    try {
      await api(`/patient/hospitals/${hospital.id}/join`, { method: 'POST', body: JSON.stringify({ fullName: fullName || undefined }) })
      await refresh()
    } catch (e) { setError((e as Error).message) } finally { setBusy(false) }
  }

  const confirm = async () => {
    if (!hospital || (scheduled ? slotTime === null : slot === null)) return
    setBusy(true); setError(null)
    try {
      const r = await api<{ tokenNo: number }>('/patient/appointments', {
        method: 'POST',
        body: JSON.stringify({ tenantId: hospital.id, branchId, doctorId, scheduledAt: scheduled ? slotTime : atSlot(day, SLOTS[slot!]!).toISOString(), channel, reason: reason || undefined }),
      })
      setBooked(r)
    } catch (e) { setError((e as Error).message) } finally { setBusy(false) }
  }

  if (booked) {
    return (
      <Screen>
        <Card highlight style={{ alignItems: 'center', gap: 8, paddingVertical: 28 }}>
          <Text style={{ fontSize: 40 }}>✓</Text>
          <Title>Appointment booked</Title>
          <Muted>Your token number</Muted>
          <Text style={{ fontSize: 48, fontWeight: '800', color: colors.brand700 }}>#{booked.tokenNo}</Text>
          <Muted>{hospital?.name}</Muted>
        </Card>
        <Button title="Done" onPress={done} />
      </Screen>
    )
  }

  return (
    <Screen>
      <Title>Book an appointment</Title>

      {!hospital && (
        <View style={{ gap: 10 }}>
          <TextField label="Find your hospital" value={q} onChangeText={setQ} placeholder="Search by name" />
          {hospitals.map((h) => (
            <Pressable key={h.id} onPress={() => setHospital(h)}>
              <Card><Text style={{ fontWeight: '700', color: colors.ink, fontSize: 16 }}>{h.name}</Text><Muted>{h.kind === 'CLINIC' ? 'Clinic' : 'Hospital'}</Muted></Card>
            </Pressable>
          ))}
          {hospitals.length === 0 && <Muted>No hospitals found.</Muted>}
        </View>
      )}

      {hospital && (
        <>
          <Card><Row style={{ justifyContent: 'space-between' }}><Text style={{ fontWeight: '700', color: colors.ink, flex: 1 }}>{hospital.name}</Text><Chip label="Change" onPress={() => { setHospital(null); setSlot(null); setDoctorId(undefined) }} /></Row></Card>

          {!linked ? (
            <Card style={{ gap: 12 }}>
              <Text style={{ fontWeight: '700', color: colors.ink }}>First visit here? Register in a few seconds.</Text>
              <Muted>If the hospital already has you on record, we will connect you to it.</Muted>
              <TextField label="Your full name" value={fullName} onChangeText={setFullName} />
              <ErrorText>{error}</ErrorText>
              <Button title="Continue" onPress={join} loading={busy} />
            </Card>
          ) : (
            <>
              {branches.length > 1 && (
                <View style={{ gap: 8 }}>
                  <Text style={{ fontWeight: '700', color: colors.ink }}>Branch</Text>
                  <Row>{branches.map((b) => <Chip key={b.id} label={b.name} selected={branchId === b.id} onPress={() => { setBranchId(b.id); setSlot(null) }} />)}</Row>
                </View>
              )}
              <View style={{ gap: 8 }}>
                <Text style={{ fontWeight: '700', color: colors.ink }}>Doctor</Text>
                <Row>
                  <Chip label="Any doctor" selected={!doctorId} onPress={() => setDoctorId(undefined)} />
                  {doctors.map((d) => <Chip key={d.id} label={d.name ?? 'Doctor'} selected={doctorId === d.id} onPress={() => setDoctorId(d.id)} />)}
                </Row>
                {chosen && (chosen.specialty || chosen.feeInPersonPaise != null) ? <Muted>{[chosen.specialty, chosen.qualification, chosen.feeInPersonPaise != null ? `Fee ₹${chosen.feeInPersonPaise / 100}` : null].filter(Boolean).join(' · ')}</Muted> : null}
              </View>
              <View style={{ gap: 8 }}>
                <Text style={{ fontWeight: '700', color: colors.ink }}>Day</Text>
                <Row>{days.map((d, i) => <Chip key={i} label={i === 0 ? 'Today' : d.toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric' })} selected={day === i} onPress={() => { setDay(i); setSlot(null); setSlotTime(null) }} />)}</Row>
              </View>
              <View style={{ gap: 8 }}>
                <Text style={{ fontWeight: '700', color: colors.ink }}>Time</Text>
                {scheduled ? (
                  <>
                    <Row>{(openSlots ?? []).filter((s) => s.available).map((s) => <Chip key={s.time} label={new Date(s.time).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' })} selected={slotTime === s.time} onPress={() => setSlotTime(s.time)} />)}</Row>
                    {openSlots === null && <Muted>Looking for free times…</Muted>}
                    {openSlots !== null && openSlots.filter((s) => s.available).length === 0 && <Muted>No free times with this doctor on this day. Try another day.</Muted>}
                  </>
                ) : (
                  <>
                    <Row>{slotTimes.map(({ i, date }) => <Chip key={i} label={date.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' })} selected={slot === i} onPress={() => setSlot(i)} />)}</Row>
                    {slotTimes.length === 0 && <Muted>No more slots today. Pick another day.</Muted>}
                  </>
                )}
              </View>
              <View style={{ gap: 8 }}>
                <Text style={{ fontWeight: '700', color: colors.ink }}>Visit type</Text>
                <Row><Chip label="In person" selected={channel === 'IN_PERSON'} onPress={() => setChannel('IN_PERSON')} /><Chip label="Tele-consultation" selected={channel === 'TELE'} onPress={() => setChannel('TELE')} /></Row>
              </View>
              <TextField label="Reason for visit (optional)" value={reason} onChangeText={setReason} maxLength={300} />
              <ErrorText>{error}</ErrorText>
              <Button title="Confirm appointment" onPress={confirm} loading={busy} disabled={scheduled ? slotTime === null : slot === null} />
            </>
          )}
        </>
      )}
    </Screen>
  )
}
