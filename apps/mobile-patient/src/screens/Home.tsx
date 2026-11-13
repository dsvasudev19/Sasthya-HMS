import { useCallback, useEffect, useState } from 'react'
import { RefreshControl, ScrollView, Text, View } from 'react-native'
import { Button, Card, colors, Muted, Row, StatusBadge, Title } from '@hms/ui-native'
import { api } from '../api'
import { fmtDay, fmtTime, isLive } from '../format'
import { useSession } from '../session'
import type { Visit } from '../types'

export default function Home({ go }: { go: (tab: 'book' | 'visits' | 'cards') => void }) {
  const { me } = useSession()
  const [visits, setVisits] = useState<Visit[] | null>(null)
  const [refreshing, setRefreshing] = useState(false)

  const load = useCallback(async () => {
    setVisits(await api<Visit[]>('/patient/appointments').catch(() => []))
  }, [])
  useEffect(() => {
    load()
    const t = setInterval(load, 20_000) // keeps the live queue position fresh
    return () => clearInterval(t)
  }, [load])

  const next = visits?.find((v) => isLive(v.status) && new Date(v.scheduledAt).getTime() > Date.now() - 4 * 3600_000)
  const first = (me?.identity.name ?? '').split(' ')[0]

  return (
    <ScrollView style={{ flex: 1, backgroundColor: colors.surface }} contentContainerStyle={{ padding: 20, gap: 16 }}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false) }} />}>
      <View>
        <Muted>Welcome back</Muted>
        <Title>{first ? `Hello, ${first}` : 'Hello'}</Title>
      </View>

      {next ? (
        <Card highlight style={{ backgroundColor: colors.brand100, gap: 10 }}>
          <Row style={{ justifyContent: 'space-between' }}>
            <Text style={{ fontSize: 12, fontWeight: '700', color: colors.white, backgroundColor: colors.brand800, borderRadius: 99, paddingHorizontal: 10, paddingVertical: 3, overflow: 'hidden' }}>UP NEXT</Text>
            <StatusBadge status={next.status} />
          </Row>
          <Text style={{ fontSize: 20, fontWeight: '700', color: colors.ink }}>{next.hospital.name}</Text>
          <Muted>{next.doctor?.fullName ?? 'Any doctor'} · {fmtDay(next.scheduledAt)}, {fmtTime(next.scheduledAt)} · {next.channel === 'TELE' ? 'Tele-consultation' : 'In person'}</Muted>
          <View style={{ backgroundColor: colors.white, borderRadius: 18, padding: 14, flexDirection: 'row', justifyContent: 'space-around' }}>
            <View style={{ alignItems: 'center' }}>
              <Muted>Your token</Muted>
              <Text style={{ fontSize: 32, fontWeight: '800', color: colors.brand700 }}>#{next.tokenNo}</Text>
            </View>
            {next.ahead !== null && (
              <View style={{ alignItems: 'center' }}>
                <Muted>Ahead of you</Muted>
                <Text style={{ fontSize: 32, fontWeight: '800', color: colors.ink }}>{next.ahead}</Text>
              </View>
            )}
          </View>
          {next.feeWaived && <Muted>Consultation covered by your health card</Muted>}
        </Card>
      ) : (
        <Card style={{ gap: 10 }}>
          <Text style={{ fontSize: 16, fontWeight: '700', color: colors.ink }}>No upcoming visits</Text>
          <Muted>Book an appointment at your hospital and skip the queue.</Muted>
        </Card>
      )}

      <Button title="Book an appointment" onPress={() => go('book')} />
      <Row>
        <View style={{ flex: 1 }}><Button title="My visits" variant="ghost" onPress={() => go('visits')} /></View>
        <View style={{ flex: 1 }}><Button title="Health cards" variant="ghost" onPress={() => go('cards')} /></View>
      </Row>

      {(me?.hospitals.length ?? 0) > 0 && (
        <View style={{ gap: 8 }}>
          <Text style={{ fontWeight: '700', color: colors.ink }}>My hospitals</Text>
          {me!.hospitals.map((h) => <Card key={h.tenantId}><Text style={{ fontWeight: '600', color: colors.ink }}>{h.name}</Text></Card>)}
        </View>
      )}
    </ScrollView>
  )
}
