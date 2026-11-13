import { Ionicons } from '@expo/vector-icons'
import { useState } from 'react'
import { Text, View } from 'react-native'
import { Button, Card, colors, ErrorText, Muted, Screen, TextField } from '@hms/ui-native'
import { useSession } from '../session'
import type { HospitalChoice } from '../types'

export default function Login() {
  const { signIn } = useSession()
  const [phone, setPhone] = useState('')
  const [password, setPassword] = useState('')
  const [choices, setChoices] = useState<HospitalChoice[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const go = async (tenantId?: string) => {
    setBusy(true); setError(null)
    try { setChoices(await signIn(phone, password, tenantId)) } catch (e) { setError((e as Error).message) } finally { setBusy(false) }
  }
  return (
    <Screen bg={colors.lime}>
      <View style={{ alignItems: 'center', marginTop: 56, marginBottom: 12, gap: 8 }}>
        <Ionicons name="medkit" size={56} color={colors.brand800} />
        <Text style={{ fontSize: 30, fontWeight: '800', fontStyle: 'italic', color: colors.brand900 }}>Swasthya Staff</Text>
        <Muted>Queue and health cards for your hospital</Muted>
      </View>
      <Card highlight style={{ gap: 14 }}>
        {choices ? (
          <>
            <Text style={{ fontSize: 18, fontWeight: '700', color: colors.ink }}>Choose a hospital</Text>
            {choices.map((c) => <Button key={c.tenantId} variant="ghost" title={c.name} onPress={() => go(c.tenantId)} loading={busy} />)}
            <Button variant="ghost" title="Back" onPress={() => setChoices(null)} />
          </>
        ) : (
          <>
            <TextField label="Mobile number" keyboardType="number-pad" maxLength={10} value={phone} onChangeText={(t) => setPhone(t.replace(/\D/g, ''))} />
            <TextField label="Password" secureTextEntry value={password} onChangeText={setPassword} />
            <ErrorText>{error}</ErrorText>
            <Button title="Sign in" onPress={() => go()} loading={busy} disabled={phone.length !== 10 || password.length < 8} />
          </>
        )}
      </Card>
    </Screen>
  )
}
