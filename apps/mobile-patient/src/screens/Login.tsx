import { Ionicons } from '@expo/vector-icons'
import { useState } from 'react'
import { Text, View } from 'react-native'
import { Button, Card, colors, ErrorText, Muted, Screen, TextField } from '@hms/ui-native'
import { api } from '../api'
import { useSession } from '../session'

export default function Login() {
  const { signIn } = useSession()
  const [phone, setPhone] = useState('')
  const [code, setCode] = useState('')
  const [sent, setSent] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const request = async () => {
    setBusy(true); setError(null)
    try {
      const r = await api<{ devCode?: string }>('/patient/otp/request', { method: 'POST', body: JSON.stringify({ phone }) })
      setSent(true)
      if (r.devCode) setCode(r.devCode) // development only: the server returns the code instead of sending an SMS
    } catch (e) { setError((e as Error).message) } finally { setBusy(false) }
  }
  const verify = async () => {
    setBusy(true); setError(null)
    try {
      const r = await api<{ token: string }>('/patient/otp/verify', { method: 'POST', body: JSON.stringify({ phone, code }) })
      await signIn(r.token)
    } catch (e) { setError((e as Error).message); setBusy(false) }
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.lime }}>
      <Screen bg={colors.lime}>
        <View style={{ alignItems: 'center', marginTop: 56, marginBottom: 12, gap: 8 }}>
          <Ionicons name="heart-circle" size={64} color={colors.brand800} />
          <Text style={{ fontSize: 32, fontWeight: '800', fontStyle: 'italic', color: colors.brand900 }}>Swasthya</Text>
          <Muted>Your hospital, in your pocket</Muted>
        </View>
        <Card highlight style={{ gap: 14 }}>
          <Text style={{ fontSize: 18, fontWeight: '700', color: colors.ink }}>{sent ? 'Enter the code' : 'Sign in with your mobile number'}</Text>
          <TextField label="Mobile number" keyboardType="number-pad" maxLength={10} value={phone} editable={!sent} onChangeText={(t) => setPhone(t.replace(/\D/g, ''))} placeholder="10-digit number" />
          {sent && <TextField label="6-digit code" keyboardType="number-pad" maxLength={6} value={code} onChangeText={(t) => setCode(t.replace(/\D/g, ''))} />}
          <ErrorText>{error}</ErrorText>
          {sent
            ? <><Button title="Verify and continue" onPress={verify} loading={busy} disabled={code.length !== 6} /><Button title="Use a different number" variant="ghost" onPress={() => { setSent(false); setCode('') }} /></>
            : <Button title="Send code" onPress={request} loading={busy} disabled={phone.length !== 10} />}
        </Card>
      </Screen>
    </View>
  )
}
