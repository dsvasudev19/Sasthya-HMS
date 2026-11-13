import { useCallback, useEffect, useState } from 'react'
import { RefreshControl, ScrollView, Text, View } from 'react-native'
import { Button, Card, colors, ErrorText, Muted, Row, StatusBadge, TextField, Title } from '@hms/ui-native'
import { api } from '../api'
import { useSession } from '../session'
import RxScanner from './RxScanner'
import type { Appt, Status } from '../types'

const NEXT: Partial<Record<Status, { label: string; to: Status }>> = {
  SCHEDULED: { label: 'Check in', to: 'CHECKED_IN' },
  CHECKED_IN: { label: 'Start consultation', to: 'IN_PROGRESS' },
  IN_PROGRESS: { label: 'Complete', to: 'COMPLETED' },
}
const VITALS: { key: string; label: string }[] = [
  { key: 'bpSystolic', label: 'BP high (mmHg)' }, { key: 'bpDiastolic', label: 'BP low (mmHg)' }, { key: 'pulse', label: 'Pulse (/min)' },
  { key: 'tempC', label: 'Temperature (°C)' }, { key: 'spo2', label: 'SpO₂ (%)' }, { key: 'weightKg', label: 'Weight (kg)' },
]

function VitalsForm({ id, onDone }: { id: string; onDone: (msg: string) => void }) {
  const [v, setV] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const save = async () => {
    setBusy(true); setError(null)
    try {
      const body = Object.fromEntries(Object.entries(v).filter(([, x]) => x !== '').map(([k, x]) => [k, Number(x)]))
      await api(`/appointments/${id}/vitals`, { method: 'PUT', body: JSON.stringify(body) })
      onDone('Vitals saved')
    } catch (e) { setError((e as Error).message) } finally { setBusy(false) }
  }
  return (
    <View style={{ gap: 10, marginTop: 6 }}>
      {VITALS.map((f) => <TextField key={f.key} label={f.label} keyboardType="decimal-pad" value={v[f.key] ?? ''} onChangeText={(t) => setV((x) => ({ ...x, [f.key]: t.replace(/[^\d.]/g, '') }))} />)}
      <ErrorText>{error}</ErrorText>
      <Button title="Save vitals" onPress={save} loading={busy} disabled={Object.values(v).every((x) => !x)} />
    </View>
  )
}

const time = (iso: string) => new Date(iso).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' })

export default function Queue() {
  const { can } = useSession()
  const canAdvance = can('appointments:write')
  const canVitals = can('vitals:write')
  const [vitalsFor, setVitalsFor] = useState<string | null>(null)
  const [scanFor, setScanFor] = useState<string | null>(null)
  const canScan = can('documents:write')
  const [data, setData] = useState<{ total: number; completed: number; appointments: Appt[] } | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  const [note, setNote] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)

  const load = useCallback(async () => { setData(await api<{ total: number; completed: number; appointments: Appt[] }>('/dashboard/today').catch(() => null)) }, [])
  useEffect(() => { load(); const t = setInterval(load, 20_000); return () => clearInterval(t) }, [load])

  const advance = async (a: Appt, to: Status) => {
    setBusyId(a.id); setNote(null)
    try {
      const r = await api<Appt>(`/appointments/${a.id}`, { method: 'PATCH', body: JSON.stringify({ status: to }) })
      if (to === 'CHECKED_IN') setNote(r.feeWaived ? `${a.patient.fullName}: consultation covered by health card` : `${a.patient.fullName}: collect the consultation fee`)
      await load()
    } catch (e) { setNote((e as Error).message) } finally { setBusyId(null) }
  }

  return (
    <ScrollView style={{ flex: 1, backgroundColor: colors.surface }} contentContainerStyle={{ padding: 20, gap: 12 }}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false) }} />}>
      <Title>Patients today: <Text style={{ color: colors.brand700 }}>{data?.completed ?? 0}</Text><Text style={{ fontSize: 16, color: colors.muted }}>/{data?.total ?? 0}</Text></Title>
      {note ? <Card style={{ backgroundColor: colors.brand100 }}><Text style={{ color: colors.brand800, fontWeight: '600' }}>{note}</Text></Card> : null}
      {data?.appointments.map((a) => {
        const next = NEXT[a.status]
        return (
          <Card key={a.id} highlight={a.status === 'IN_PROGRESS'} style={{ gap: 8 }}>
            <Row style={{ justifyContent: 'space-between' }}>
              <Text style={{ fontSize: 17, fontWeight: '700', color: colors.ink, flex: 1 }}>#{a.tokenNo} {a.patient.fullName}</Text>
              <StatusBadge status={a.status} />
            </Row>
            <Muted>{time(a.scheduledAt)} · {a.channel === 'TELE' ? 'Tele' : 'In person'} · {a.reason ?? 'No reason given'}</Muted>
            {a.feeWaived ? <Muted>Covered by health card</Muted> : null}
            {canVitals && (a.status === 'CHECKED_IN' || a.status === 'IN_PROGRESS') && (
              vitalsFor === a.id
                ? <VitalsForm id={a.id} onDone={(m) => { setNote(`${a.patient.fullName}: ${m}`); setVitalsFor(null) }} />
                : <View style={{ marginTop: 4 }}><Button title="Record vitals" variant="ghost" onPress={() => setVitalsFor(a.id)} /></View>
            )}
            {canScan && a.status !== 'COMPLETED' && a.status !== 'CANCELLED' && (
              scanFor === a.id
                ? <RxScanner patientId={a.patient.id} appointmentId={a.id} onDone={(m) => { setNote(`${a.patient.fullName}: ${m}`); setScanFor(null) }} />
                : <View style={{ marginTop: 4 }}><Button title="Scan prescription" variant="ghost" onPress={() => setScanFor(a.id)} /></View>
            )}
            {canAdvance && next && (
              <View style={{ marginTop: 4 }}>
                <Button title={next.label} onPress={() => advance(a, next.to)} loading={busyId === a.id} />
              </View>
            )}
          </Card>
        )
      })}
      {data && data.appointments.length === 0 && <Muted>No appointments today.</Muted>}
    </ScrollView>
  )
}
