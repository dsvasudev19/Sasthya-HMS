import { Ionicons } from '@expo/vector-icons'
import { StatusBar } from 'expo-status-bar'
import { useState } from 'react'
import { ActivityIndicator, Pressable, SafeAreaView, Text, View } from 'react-native'
import { Button, Card, colors, Muted, Screen, Title } from '@hms/ui-native'
import ChangePassword from './src/screens/ChangePassword'
import Login from './src/screens/Login'
import Queue from './src/screens/Queue'
import Scan from './src/screens/Scan'
import { SessionProvider, useSession } from './src/session'

type Tab = 'queue' | 'scan' | 'me'
const TABS: { key: Tab; label: string; icon: keyof typeof Ionicons.glyphMap }[] = [
  { key: 'queue', label: 'Queue', icon: 'people' },
  { key: 'scan', label: 'Scan', icon: 'qr-code' },
  { key: 'me', label: 'Me', icon: 'person' },
]

function Profile() {
  const { me, signOut } = useSession()
  return (
    <Screen>
      <Title>Profile</Title>
      <Card>
        <Text style={{ fontSize: 18, fontWeight: '700', color: colors.ink }}>{me?.user.name}</Text>
        <Muted>{me?.user.roles.map((r) => r.toLowerCase().replace('_', ' ')).join(', ')} · {me?.tenant.name}</Muted>
      </Card>
      <Button title="Sign out" variant="ghost" onPress={signOut} />
    </Screen>
  )
}

function Shell() {
  const { ready, me } = useSession()
  const [tab, setTab] = useState<Tab>('queue')
  if (!ready) return <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}><ActivityIndicator color={colors.brand800} /></View>
  if (!me) return <Login />
  if (me.mustChangePassword) return <ChangePassword />
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.white }}>
      <View style={{ flex: 1 }}>
        {tab === 'queue' && <Queue />}
        {tab === 'scan' && <Scan />}
        {tab === 'me' && <Profile />}
      </View>
      <View style={{ flexDirection: 'row', borderTopWidth: 1, borderTopColor: colors.line, backgroundColor: colors.white, paddingBottom: 6 }}>
        {TABS.map((t) => {
          const on = tab === t.key
          return (
            <Pressable key={t.key} onPress={() => setTab(t.key)} style={{ flex: 1, alignItems: 'center', paddingVertical: 10, gap: 2 }}>
              <Ionicons name={t.icon} size={22} color={on ? colors.brand800 : colors.muted} />
              <Text style={{ fontSize: 11, fontWeight: '600', color: on ? colors.brand800 : colors.muted }}>{t.label}</Text>
            </Pressable>
          )
        })}
      </View>
    </SafeAreaView>
  )
}

export default function App() {
  return (
    <SessionProvider>
      <StatusBar style="dark" />
      <Shell />
    </SessionProvider>
  )
}
