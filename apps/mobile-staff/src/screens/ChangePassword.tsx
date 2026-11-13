import { useState } from 'react'
import { Text } from 'react-native'
import { Button, Card, colors, ErrorText, Muted, Screen, TextField } from '@hms/ui-native'
import { useSession } from '../session'

/** Shown when the password was set by someone else (a new account or a reset). */
export default function ChangePassword() {
  const { changePassword, signOut } = useSession()
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const save = async () => { setBusy(true); setError(null); try { await changePassword(current, next) } catch (e) { setError((e as Error).message); setBusy(false) } }
  return (
    <Screen bg={colors.lime}>
      <Card highlight style={{ gap: 14, marginTop: 56 }}>
        <Text style={{ fontSize: 20, fontWeight: '700', color: colors.ink }}>Set your own password</Text>
        <Muted>Your password was set by someone else. Choose one only you know: 8 or more characters with letters and numbers.</Muted>
        <TextField label="Current password" secureTextEntry value={current} onChangeText={setCurrent} />
        <TextField label="New password" secureTextEntry value={next} onChangeText={setNext} />
        <ErrorText>{error}</ErrorText>
        <Button title="Save password" onPress={save} loading={busy} disabled={!current || next.length < 8} />
        <Button title="Sign out" variant="ghost" onPress={signOut} />
      </Card>
    </Screen>
  )
}
