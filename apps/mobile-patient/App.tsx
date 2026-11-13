import { Ionicons } from '@expo/vector-icons'
import { StatusBar } from 'expo-status-bar'
import { useState } from 'react'
import { ActivityIndicator, Pressable, SafeAreaView, Text, View } from 'react-native'
import { Button, Card, Chip, colors, Muted, Row, Screen, Title } from '@hms/ui-native'
import { api } from './src/api'
import Book from './src/screens/Book'
import Cards from './src/screens/Cards'
import Home from './src/screens/Home'
import Login from './src/screens/Login'
import Records from './src/screens/Records'
import Visits from './src/screens/Visits'
import { SessionProvider, useSession } from './src/session'

type Tab = 'home' | 'book' | 'visits' | 'records' | 'cards' | 'me'
const TABS: { key: Tab; label: string; icon: keyof typeof Ionicons.glyphMap }[] = [
  { key: 'home', label: 'Home', icon: 'home' },
  { key: 'book', label: 'Book', icon: 'calendar' },
  { key: 'visits', label: 'Visits', icon: 'time' },
  { key: 'records', label: 'Records', icon: 'document-text' },
  { key: 'cards', label: 'Cards', icon: 'card' },
  { key: 'me', label: 'Me', icon: 'person' },
]

function Profile() {
  const { me, signOut } = useSession()
  const [lang, setLang] = useState<'en' | 'hi' | null>(null)
  const choose = async (l: 'en' | 'hi') => { setLang(l); await api('/patient/language', { method: 'PATCH', body: JSON.stringify({ language: l }) }).catch(() => setLang(null)) }
  return (
    <Screen>
      <Title>Profile</Title>
      <Card><Text style={{ fontSize: 18, fontWeight: '700', color: colors.ink }}>{me?.identity.name ?? 'Patient'}</Text><Muted>+91 {me?.identity.phone}</Muted></Card>
      <Card style={{ gap: 10 }}>
        <Text style={{ fontWeight: '700', color: colors.ink }}>Message language</Text>
        <Muted>Reminders and alerts from your hospital will use this language.</Muted>
        <Row><Chip label="English" selected={lang === 'en'} onPress={() => choose('en')} /><Chip label="हिन्दी" selected={lang === 'hi'} onPress={() => choose('hi')} /></Row>
      </Card>
      <Button title="Sign out" variant="ghost" onPress={signOut} />
    </Screen>
  )
}

function Shell() {
  const { ready, me } = useSession()
  const [tab, setTab] = useState<Tab>('home')
  if (!ready) return <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}><ActivityIndicator color={colors.brand800} /></View>
  if (!me) return <Login />
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.white }}>
      <View style={{ flex: 1 }}>
        {tab === 'home' && <Home go={setTab} />}
        {tab === 'book' && <Book done={() => setTab('visits')} />}
        {tab === 'visits' && <Visits />}
        {tab === 'records' && <Records />}
        {tab === 'cards' && <Cards />}
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
