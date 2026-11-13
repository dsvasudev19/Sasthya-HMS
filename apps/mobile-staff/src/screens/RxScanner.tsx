import { CameraView, useCameraPermissions } from 'expo-camera'
import { useRef, useState } from 'react'
import { Image, Platform, ScrollView, Text, View } from 'react-native'
import { Button, colors, ErrorText, Muted } from '@hms/ui-native'
import { api } from '../api'

/**
 * A nurse photographs the paper prescription a patient brings. Each page is uploaded into the patient's record, linked to
 * today's visit, so the doctor sees it beside the consultation straight away.
 */
export default function RxScanner({ patientId, appointmentId, onDone }: { patientId: string; appointmentId: string; onDone: (msg: string) => void }) {
  const [perm, ask] = useCameraPermissions()
  const cam = useRef<CameraView>(null)
  const [pages, setPages] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (Platform.OS === 'web') return <Muted>Scanning needs the phone camera. Use the web app on a computer.</Muted>
  if (!perm?.granted) return <Button title="Allow camera to scan" onPress={() => ask()} />

  const capture = async () => {
    const shot = await cam.current?.takePictureAsync({ quality: 0.6, skipProcessing: false })
    if (shot?.uri) setPages((p) => [...p, shot.uri])
  }
  const upload = async () => {
    setBusy(true); setError(null)
    try {
      for (const [i, uri] of pages.entries()) {
        const f = new FormData()
        f.append('kind', 'PRESCRIPTION_SCAN')
        f.append('title', pages.length > 1 ? `Scanned prescription (page ${i + 1} of ${pages.length})` : 'Scanned prescription')
        f.append('appointmentId', appointmentId)
        // React Native sends a file as { uri, name, type }.
        f.append('file', { uri, name: `rx-${Date.now()}-${i + 1}.jpg`, type: 'image/jpeg' } as unknown as Blob)
        await api(`/patients/${patientId}/documents`, { method: 'POST', body: f })
      }
      onDone(`${pages.length} ${pages.length === 1 ? 'page' : 'pages'} added to the record`)
    } catch (e) { setError((e as Error).message) } finally { setBusy(false) }
  }

  return (
    <View style={{ gap: 10, marginTop: 6 }}>
      <View style={{ height: 320, borderRadius: 20, overflow: 'hidden', backgroundColor: '#000' }}>
        <CameraView ref={cam} style={{ flex: 1 }} facing="back" />
      </View>
      <Button title={`Capture page ${pages.length + 1}`} onPress={capture} />
      {pages.length > 0 && (
        <ScrollView horizontal contentContainerStyle={{ gap: 8 }}>
          {pages.map((u, i) => <Image key={u} source={{ uri: u }} style={{ width: 70, height: 92, borderRadius: 10, borderWidth: 1, borderColor: colors.line }} accessibilityLabel={`Page ${i + 1}`} />)}
        </ScrollView>
      )}
      <ErrorText>{error}</ErrorText>
      {pages.length > 0 && <Text style={{ color: colors.muted, fontSize: 12 }}>Lay the paper flat and fill the frame.</Text>}
      <Button title={busy ? 'Uploading…' : `Upload ${pages.length || ''} ${pages.length === 1 ? 'page' : 'pages'}`} onPress={upload} loading={busy} disabled={pages.length === 0} />
    </View>
  )
}
