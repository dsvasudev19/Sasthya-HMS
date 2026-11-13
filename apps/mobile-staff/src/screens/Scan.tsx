import { CameraView, useCameraPermissions } from 'expo-camera'
import { useRef, useState } from 'react'
import { Platform, Text, Vibration, View } from 'react-native'
import { Button, Card, colors, ErrorText, Muted, Screen, TextField, Title } from '@hms/ui-native'
import { api } from '../api'

interface Outcome {
  kind: string
  outcome: 'DONE' | 'INFO' | 'CHOOSE' | 'NEEDS_BOOKING' | 'DENIED' | 'NOT_FOUND'
  tone: 'success' | 'info' | 'warning' | 'error'
  title: string
  message: string
  patient?: { id: string; fullName: string; patientNo: string }
  choices?: { id: string; label: string; sub?: string }[]
  facts?: { label: string; value: string }[]
}

const TONE = { success: '#dcfce7', info: '#e0f2fe', warning: '#fef3c7', error: '#fee2e2' } as const

/**
 * Point the camera at anything the hospital prints (a token slip, a wristband, a sample label, a bill, a health card, a prescription
 * QR) and it does the obvious thing: checks the patient in, marks the sample collected, opens the bill. The phone buzzes when it worked.
 */
export default function Scan() {
  const [perm, ask] = useCameraPermissions()
  const [scanning, setScanning] = useState(false)
  const [typed, setTyped] = useState('')
  const [result, setResult] = useState<(Outcome & { code: string }) | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const lastRef = useRef<{ code: string; at: number }>({ code: '', at: 0 })

  const run = async (code: string, extra?: object) => {
    const c = code.trim()
    if (!c || busy) return
    setBusy(true); setError(null)
    try {
      const r = await api<Outcome>('/scan', { method: 'POST', body: JSON.stringify({ code: c, ...extra }) })
      setResult({ ...r, code: c })
      Vibration.vibrate(r.tone === 'success' ? 40 : [0, 60, 40, 60])
      if (r.outcome === 'DONE') setScanning(true) // ready for the next one straight away
    } catch (e) { setError((e as Error).message) } finally { setBusy(false) }
  }
  const onCode = (code: string) => {
    const now = Date.now()
    if (lastRef.current.code === code && now - lastRef.current.at < 3500) return // the same code held in view
    lastRef.current = { code, at: now }
    void run(code)
  }

  return (
    <Screen>
      <Title>Scan</Title>
      {scanning && perm?.granted ? (
        <View style={{ height: 300, borderRadius: 24, overflow: 'hidden' }}>
          <CameraView style={{ flex: 1 }} barcodeScannerSettings={{ barcodeTypes: ['qr', 'code128', 'code39', 'ean13', 'ean8', 'upc_a'] }} onBarcodeScanned={({ data }) => onCode(data)} />
        </View>
      ) : Platform.OS !== 'web' ? (
        <Button title="Start scanning" onPress={async () => { if (!perm?.granted) await ask(); setScanning(true) }} />
      ) : null}
      {scanning && <Button title="Stop scanning" variant="ghost" onPress={() => setScanning(false)} />}
      <TextField label="Or type a phone, patient, card or bill number" autoCapitalize="characters" value={typed} onChangeText={setTyped} placeholder="e.g. 9876543210 or SRH-000123" />
      <Button title="Look up" variant="ghost" onPress={() => run(typed)} disabled={typed.trim().length < 4} loading={busy} />
      <ErrorText>{error}</ErrorText>
      {result && (
        <Card style={{ gap: 8, backgroundColor: TONE[result.tone] }}>
          <Text style={{ fontSize: 18, fontWeight: '800', color: colors.ink }}>{result.title}</Text>
          <Text style={{ color: colors.ink }}>{result.message}</Text>
          {result.facts?.map((f) => <Muted key={f.label}>{f.label}: {f.value}</Muted>)}
          {result.choices?.map((c) => (
            <Button key={c.id} title={`${c.label}${c.sub ? ` · ${c.sub}` : ''}`} variant="ghost" onPress={() => run(result.code, result.kind === 'HEALTH_CARD' ? { patientId: c.id, action: 'checkin' } : { appointmentId: c.id })} />
          ))}
          {result.outcome === 'NEEDS_BOOKING' && result.patient && <Button title="Check in as walk-in" onPress={() => run(result.code, { action: 'walkin', patientId: result.patient!.id })} />}
        </Card>
      )}
    </Screen>
  )
}
