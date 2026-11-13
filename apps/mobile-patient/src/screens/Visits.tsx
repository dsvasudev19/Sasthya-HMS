import { useCallback, useEffect, useState } from 'react'
import { Text, View } from 'react-native'
import { Linking } from 'react-native'
import { Button, Card, colors, Muted, Row, Screen, StatusBadge, Title } from '@hms/ui-native'
import { api } from '../api'
import { fmtDay, fmtTime, isLive, rupees } from '../format'
import type { Bill, Visit } from '../types'

export default function Visits() {
  const [visits, setVisits] = useState<Visit[] | null>(null)
  const [bills, setBills] = useState<Bill[] | null>(null)
  const [payError, setPayError] = useState<string | null>(null)
  const [teleNote, setTeleNote] = useState<Record<string, string>>({})
  const load = useCallback(() => api<Visit[]>('/patient/appointments').then(setVisits).catch(() => setVisits([])), [])
  useEffect(() => { load(); api<Bill[]>('/patient/invoices').then(setBills).catch(() => setBills([])) }, [load])

  const payOnline = async (b: Bill) => {
    try {
      const r = await api<{ url: string }>(`/patient/invoices/${b.hospital.id}/${b.id}/payment-link`, { method: 'POST' })
      await Linking.openURL(r.url)
    } catch (e) { setPayError((e as Error).message) }
  }

  // Opens the video room. The hospital's doctor sees you waiting and starts the call when ready.
  const joinCall = async (v: Visit) => {
    setTeleNote((n) => ({ ...n, [v.id]: '' }))
    try {
      const r = await api<{ url: string; doctorPresent: boolean }>(`/patient/appointments/${v.hospital.id}/${v.id}/tele/join`, { method: 'POST' })
      setTeleNote((n) => ({ ...n, [v.id]: r.doctorPresent ? 'Doctor is in the call.' : 'You are in the waiting room. The doctor will start the call shortly.' }))
      await Linking.openURL(r.url)
    } catch (e) { setTeleNote((n) => ({ ...n, [v.id]: (e as Error).message })) }
  }

  const cancel = async (v: Visit) => {
    await api(`/patient/appointments/${v.hospital.id}/${v.id}/cancel`, { method: 'POST' }).catch(() => undefined)
    load()
  }

  const upcoming = (visits ?? []).filter((v) => isLive(v.status))
  const past = (visits ?? []).filter((v) => !isLive(v.status)).reverse()

  const item = (v: Visit) => (
    <Card key={v.id} style={{ gap: 6 }}>
      <Row style={{ justifyContent: 'space-between' }}>
        <Text style={{ fontWeight: '700', color: colors.ink, flex: 1 }}>{v.hospital.name}</Text>
        <StatusBadge status={v.status} />
      </Row>
      <Muted>{fmtDay(v.scheduledAt)}, {fmtTime(v.scheduledAt)} · {v.channel === 'TELE' ? 'Tele' : 'In person'} · Token #{v.tokenNo}</Muted>
      {v.reason ? <Muted>{v.reason}</Muted> : null}
      {v.feeWaived ? <Muted>Covered by health card</Muted> : null}
      {v.channel === 'TELE' && ['SCHEDULED', 'CHECKED_IN', 'IN_PROGRESS'].includes(v.status) && <Button title="Join video visit" onPress={() => joinCall(v)} />}
      {teleNote[v.id] ? <Muted>{teleNote[v.id]}</Muted> : null}
      {v.status === 'SCHEDULED' && <Button title="Cancel appointment" variant="danger" onPress={() => cancel(v)} />}
    </Card>
  )

  return (
    <Screen>
      <Title>My visits</Title>
      <Text style={{ fontWeight: '700', color: colors.ink }}>Upcoming</Text>
      <View style={{ gap: 10 }}>{upcoming.map(item)}{visits && upcoming.length === 0 && <Muted>Nothing upcoming.</Muted>}</View>
      <Text style={{ fontWeight: '700', color: colors.ink }}>Bills</Text>
      {payError ? <Muted>{payError}</Muted> : null}
      <View style={{ gap: 10 }}>
        {(bills ?? []).filter((b) => b.status !== 'VOID').map((b) => {
          const due = b.totalPaise - b.paidPaise
          return (
            <Card key={b.id} style={{ gap: 6 }}>
              <Row style={{ justifyContent: 'space-between' }}>
                <Text style={{ fontWeight: '700', color: colors.ink, flex: 1 }}>{b.hospital.name}</Text>
                <Text style={{ fontWeight: '800', color: due > 0 ? colors.red : colors.brand700 }}>{rupees(b.totalPaise)}</Text>
              </Row>
              <Muted>{b.invoiceNo} · {fmtDay(b.createdAt)}</Muted>
              {b.lines.map((l) => <Muted key={l.id}>{l.description} · {rupees(l.amountPaise)}</Muted>)}
              {b.discountPaise > 0 ? <Muted>{b.note ?? 'Discount'}: -{rupees(b.discountPaise)}</Muted> : null}
              <Text style={{ fontWeight: '700', color: due > 0 ? colors.red : colors.brand700 }}>{due > 0 ? `Balance due ${rupees(due)}` : 'Paid'}</Text>
              {due > 0 && b.status !== 'REFUNDED' && <Button title="Pay online" onPress={() => payOnline(b)} />}
            </Card>
          )
        })}
        {bills && bills.filter((b) => b.status !== 'VOID').length === 0 && <Muted>No bills yet.</Muted>}
      </View>
      <Text style={{ fontWeight: '700', color: colors.ink }}>Past</Text>
      <View style={{ gap: 10 }}>{past.map(item)}{visits && past.length === 0 && <Muted>No past visits in the last 30 days.</Muted>}</View>
    </Screen>
  )
}
