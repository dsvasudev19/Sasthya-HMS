import { useEffect, useState } from 'react'
import { Text, View } from 'react-native'
import QRCode from 'react-native-qrcode-svg'
import { Card, colors, Muted, Row, Screen, Title } from '@hms/ui-native'
import { api } from '../api'
import { fmtDate } from '../format'
import type { PatientCard } from '../types'

export default function Cards() {
  const [cards, setCards] = useState<PatientCard[] | null>(null)
  useEffect(() => { api<PatientCard[]>('/patient/cards').then(setCards).catch(() => setCards([])) }, [])
  return (
    <Screen>
      <Title>Health cards</Title>
      {cards?.map((c) => {
        const cov = c.coverage
        const active = !!cov?.subscriptionId
        return (
          <Card key={c.cardNo} highlight style={{ backgroundColor: colors.brand100, gap: 12 }}>
            <Muted>{c.hospital.name}</Muted>
            <Text style={{ fontSize: 18, fontWeight: '700', color: colors.ink }}>{c.planName}</Text>
            <Row style={{ gap: 16, alignItems: 'center' }}>
              <View style={{ backgroundColor: colors.white, padding: 8, borderRadius: 14 }}><QRCode value={c.cardNo} size={96} /></View>
              <View style={{ flex: 1, gap: 4 }}>
                <Text style={{ fontSize: 18, fontWeight: '800', letterSpacing: 1, color: colors.ink }}>{c.cardNo}</Text>
                <Muted>{active ? `Plan valid till ${fmtDate(cov!.endsAt)}` : 'Plan expired. Renew at the hospital.'}</Muted>
                {c.type === 'FAMILY' && <Muted>Members: {c.members.join(', ')}</Muted>}
              </View>
            </Row>
            {active && (
              <View style={{ flexDirection: 'row', gap: 10 }}>
                <View style={{ flex: 1, backgroundColor: colors.white, borderRadius: 16, padding: 12, alignItems: 'center' }}>
                  <Muted>In-person left</Muted>
                  <Text style={{ fontSize: 26, fontWeight: '800', color: colors.brand700 }}>{cov!.remaining.inPerson}<Text style={{ fontSize: 14, color: colors.muted }}>/{cov!.limits.inPerson}</Text></Text>
                </View>
                <View style={{ flex: 1, backgroundColor: colors.white, borderRadius: 16, padding: 12, alignItems: 'center' }}>
                  <Muted>Tele left</Muted>
                  <Text style={{ fontSize: 26, fontWeight: '800', color: colors.brand700 }}>{cov!.remaining.tele}<Text style={{ fontSize: 14, color: colors.muted }}>/{cov!.limits.tele}</Text></Text>
                </View>
              </View>
            )}
            <Muted>Show this QR at the front desk to check in.</Muted>
          </Card>
        )
      })}
      {cards && cards.length === 0 && (
        <Card><Text style={{ fontWeight: '700', color: colors.ink }}>No health card yet</Text><Muted>Ask your hospital's front desk about the individual and family health cards.</Muted></Card>
      )}
    </Screen>
  )
}
