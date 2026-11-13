import { useEffect, useState } from 'react'
import { Linking, Text, View } from 'react-native'
import { Button, Card, colors, ErrorText, Muted, Screen, Title } from '@hms/ui-native'
import { api } from '../api'
import { fmtDate } from '../format'
import type { Records } from '../types'

const flagColor = (f: string | null) => (f?.startsWith('CRITICAL') ? colors.red : f === 'LOW' || f === 'HIGH' ? colors.amber : colors.brand700)
const flagLabel = (f: string | null) => (f === 'CRITICAL_LOW' ? 'Critically low' : f === 'CRITICAL_HIGH' ? 'Critically high' : f === 'LOW' ? 'Low' : f === 'HIGH' ? 'High' : f === 'NORMAL' ? 'Normal' : '')

export default function RecordsScreen() {
  const [data, setData] = useState<Records | null>(null)
  const [files, setFiles] = useState<{ id: string; title: string; kind: string; createdAt: string; hospital: { id: string; name: string } }[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  // Files need a login the phone's viewer cannot send, so the server hands back a link that works for two minutes.
  const open = async (path: string) => {
    setError(null)
    try { const r = await api<{ url: string }>(path, { method: 'POST' }); await Linking.openURL(r.url) } catch (e) { setError((e as Error).message) }
  }
  useEffect(() => { api<Records>('/patient/records').then(setData).catch(() => setData({ consultations: [], labReports: [] })); api<NonNullable<typeof files>>('/patient/documents').then(setFiles).catch(() => setFiles([])) }, [])
  return (
    <Screen>
      <Title>My records</Title>
      <Text style={{ fontWeight: '700', color: colors.ink }}>Prescriptions</Text>
      <View style={{ gap: 10 }}>
        {data?.consultations.map((c) => (
          <Card key={c.id} style={{ gap: 6 }}>
            <Text style={{ fontWeight: '700', color: colors.ink }}>{c.diagnosis ?? 'Consultation'}</Text>
            <Muted>{c.hospital.name} · {c.doctor ? `Dr. ${c.doctor}` : ''} · {fmtDate(c.date)}</Muted>
            {c.items.map((i) => (
              <View key={i.id} style={{ paddingVertical: 4 }}>
                <Text style={{ color: colors.ink, fontWeight: '600' }}>{i.name}</Text>
                <Muted>{[i.dose, i.frequency, i.durationDays ? `${i.durationDays} days` : null, i.instructions].filter(Boolean).join(' · ') || `Quantity ${i.quantity}`}</Muted>
              </View>
            ))}
            {c.advice ? <Muted>Advice: {c.advice}</Muted> : null}
            {c.followUpOn ? <Text style={{ color: colors.brand700, fontWeight: '600' }}>Follow-up on {fmtDate(c.followUpOn)}</Text> : null}
            <Button title="Open prescription (PDF)" variant="ghost" onPress={() => open(`/patient/prescriptions/${c.hospital.id}/${c.id}/link`)} />
          </Card>
        ))}
        {data && data.consultations.length === 0 && <Muted>No prescriptions yet.</Muted>}
      </View>
      <ErrorText>{error}</ErrorText>
      <Text style={{ fontWeight: '700', color: colors.ink }}>My files</Text>
      <View style={{ gap: 10 }}>
        {files?.map((f) => (
          <Card key={f.id} style={{ gap: 4 }}>
            <Text style={{ fontWeight: '700', color: colors.ink }}>{f.title}</Text>
            <Muted>{f.hospital.name} · {fmtDate(f.createdAt)}</Muted>
            <Button title="Open" variant="ghost" onPress={() => open(`/patient/documents/${f.hospital.id}/${f.id}/link`)} />
          </Card>
        ))}
        {files && files.length === 0 && <Muted>No scanned papers or outside reports yet.</Muted>}
      </View>
      <Text style={{ fontWeight: '700', color: colors.ink }}>Lab reports</Text>
      <View style={{ gap: 10 }}>
        {data?.labReports.map((r) => (
          <Card key={r.id} style={{ gap: 6 }}>
            <Text style={{ fontWeight: '700', color: colors.ink }}>{r.orderNo}</Text>
            <Muted>{r.hospital.name} · {fmtDate(r.date)}</Muted>
            {r.items.map((i) => (
              <View key={i.id} style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 8, paddingVertical: 4 }}>
                <View style={{ flex: 1 }}><Text style={{ color: colors.ink, fontWeight: '600' }}>{i.testName}</Text>{i.refRange ? <Muted>Normal {i.refRange} {i.unit ?? ''}</Muted> : null}</View>
                <View style={{ alignItems: 'flex-end' }}><Text style={{ fontWeight: '800', color: flagColor(i.flag) }}>{i.resultValue ?? i.resultText} {i.unit ?? ''}</Text>{i.flag ? <Text style={{ fontSize: 11, fontWeight: '700', color: flagColor(i.flag) }}>{flagLabel(i.flag)}</Text> : null}</View>
              </View>
            ))}
          </Card>
        ))}
        {data && data.labReports.length === 0 && <Muted>No lab reports released yet.</Muted>}
      </View>
    </Screen>
  )
}
