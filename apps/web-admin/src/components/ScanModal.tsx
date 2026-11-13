import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Camera, FileUp, RefreshCw, Trash2, X } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { uploadFile } from '../lib/api'
import { KIND_OPTIONS } from './DocumentViewer'
import Select from './Select'
import { Button, Field, inputCls, Modal } from './ui'

interface Page { id: string; blob: Blob; name: string; preview: string }

const MAX_SIDE = 2200

/** Shrinks big phone photos before upload: still legible for a prescription, a fraction of the size. PDFs are left alone. */
async function prepare(file: File): Promise<Blob> {
  if (!file.type.startsWith('image/') || file.type === 'image/webp') return file
  try {
    const bmp = await createImageBitmap(file)
    const scale = Math.min(1, MAX_SIDE / Math.max(bmp.width, bmp.height))
    if (scale === 1 && file.size < 1_500_000) return file
    const c = document.createElement('canvas')
    c.width = Math.round(bmp.width * scale); c.height = Math.round(bmp.height * scale)
    c.getContext('2d')!.drawImage(bmp, 0, 0, c.width, c.height)
    return await new Promise<Blob>((res) => c.toBlob((b) => res(b ?? file), 'image/jpeg', 0.86))
  } catch { return file }
}

/**
 * Add pages to a patient's record: scan with the device camera (several pages in a row) or pick files and photos.
 * Used by nurses to scan the prescription a patient arrives with; it lands in the record and is shown to the doctor at once.
 */
export default function ScanModal({ patientId, appointmentId, defaultKind = 'PRESCRIPTION_SCAN', onClose }: { patientId: string; appointmentId?: string; defaultKind?: string; onClose: () => void }) {
  const qc = useQueryClient()
  const [pages, setPages] = useState<Page[]>([])
  const [kind, setKind] = useState(defaultKind)
  const [title, setTitle] = useState('')
  const [note, setNote] = useState('')
  const [visible, setVisible] = useState(true)
  const [camera, setCamera] = useState(false)
  const [camError, setCamError] = useState<string | null>(null)
  const [done, setDone] = useState(0)
  const video = useRef<HTMLVideoElement>(null)
  const stream = useRef<MediaStream | null>(null)
  const pick = useRef<HTMLInputElement>(null)

  const stop = useCallback(() => { stream.current?.getTracks().forEach((t) => t.stop()); stream.current = null }, [])
  useEffect(() => stop, [stop])
  useEffect(() => () => pages.forEach((p) => URL.revokeObjectURL(p.preview)), []) // eslint-disable-line react-hooks/exhaustive-deps

  const add = (blob: Blob, name: string) => setPages((ps) => [...ps, { id: crypto.randomUUID(), blob, name, preview: blob.type.startsWith('image/') ? URL.createObjectURL(blob) : '' }])

  const startCamera = async () => {
    setCamError(null)
    try {
      stream.current = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 } }, audio: false })
      setCamera(true)
      requestAnimationFrame(() => { if (video.current && stream.current) { video.current.srcObject = stream.current; void video.current.play() } })
    } catch { setCamError('The camera could not be opened. Allow camera access, or choose a photo instead.') }
  }
  const capture = async () => {
    const v = video.current
    if (!v || !v.videoWidth) return
    const c = document.createElement('canvas')
    const scale = Math.min(1, MAX_SIDE / Math.max(v.videoWidth, v.videoHeight))
    c.width = Math.round(v.videoWidth * scale); c.height = Math.round(v.videoHeight * scale)
    c.getContext('2d')!.drawImage(v, 0, 0, c.width, c.height)
    const blob = await new Promise<Blob | null>((res) => c.toBlob(res, 'image/jpeg', 0.88))
    if (blob) add(blob, `scan-${pages.length + 1}.jpg`)
  }
  const onFiles = async (list: FileList | null) => {
    for (const f of Array.from(list ?? [])) add(await prepare(f), f.name)
    if (pick.current) pick.current.value = ''
  }

  const upload = useMutation({
    mutationFn: async () => {
      let n = 0
      for (const [i, p] of pages.entries()) {
        const f = new FormData()
        f.append('kind', kind)
        f.append('title', pages.length > 1 ? `${title.trim() || 'Scanned prescription'} (page ${i + 1} of ${pages.length})` : title.trim() || '')
        if (note.trim()) f.append('note', note.trim())
        if (appointmentId) f.append('appointmentId', appointmentId)
        f.append('visibleToPatient', String(visible))
        f.append('file', p.blob, p.name)
        await uploadFile(`/patients/${patientId}/documents`, f)
        setDone(++n)
      }
    },
    onSuccess: () => {
      for (const k of ['patient-docs', 'patient-history', 'documents']) qc.invalidateQueries({ queryKey: [k] })
      stop(); onClose()
    },
  })

  return (
    <Modal title="Add to the record" onClose={() => { stop(); onClose() }} size="lg">
      <div className="space-y-4">
        {camera ? (
          <div className="space-y-3">
            <div className="relative overflow-hidden rounded-2xl bg-black">
              <video ref={video} playsInline muted className="aspect-[4/3] w-full object-cover" />
              <div className="pointer-events-none absolute inset-6 rounded-xl border-2 border-dashed border-white/60" />
            </div>
            <div className="flex items-center justify-center gap-3">
              <Button onClick={() => void capture()}><Camera size={18} /> Capture page {pages.length + 1}</Button>
              <Button variant="ghost" onClick={() => { stop(); setCamera(false) }}>Done scanning</Button>
            </div>
            <p className="text-center text-xs text-muted">Lay the paper flat, fill the frame, and capture each page.</p>
          </div>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            <button type="button" onClick={() => void startCamera()} className="flex flex-col items-center gap-2 rounded-2xl border-2 border-dashed border-brand-300 bg-brand-50 p-6 text-sm font-semibold text-brand-800 hover:bg-brand-100"><Camera size={26} />Scan with camera</button>
            <button type="button" onClick={() => pick.current?.click()} className="flex flex-col items-center gap-2 rounded-2xl border-2 border-dashed border-line p-6 text-sm font-semibold text-ink hover:bg-surface"><FileUp size={26} />Choose photos or PDFs</button>
            <input ref={pick} type="file" multiple accept="image/jpeg,image/png,image/webp,application/pdf" capture={undefined} className="hidden" onChange={(e) => void onFiles(e.target.files)} />
          </div>
        )}
        {camError && <p className="text-sm text-red-600">{camError}</p>}

        {pages.length > 0 && (
          <>
            <ul className="flex flex-wrap gap-3">
              {pages.map((p, i) => (
                <li key={p.id} className="group relative">
                  {p.preview ? <img src={p.preview} alt={`Page ${i + 1}`} className="h-24 w-20 rounded-xl object-cover ring-1 ring-line" /> : <span className="grid h-24 w-20 place-items-center rounded-xl bg-surface text-xs font-semibold ring-1 ring-line">PDF</span>}
                  <span className="absolute bottom-1 left-1 rounded bg-black/60 px-1.5 text-[10px] font-bold text-white">{i + 1}</span>
                  <button className="absolute -right-2 -top-2 grid size-6 place-items-center rounded-full bg-white text-muted shadow ring-1 ring-line hover:text-red-600" aria-label={`Remove page ${i + 1}`} onClick={() => { URL.revokeObjectURL(p.preview); setPages(pages.filter((x) => x !== p)) }}><X size={13} /></button>
                </li>
              ))}
            </ul>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="What is it?"><Select value={kind} onChange={setKind} options={KIND_OPTIONS} /></Field>
              <Field label="Title (optional)"><input className={inputCls} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Dr Rao's prescription, 12 Oct" /></Field>
            </div>
            <Field label="Note (optional)"><input className={inputCls} value={note} onChange={(e) => setNote(e.target.value)} /></Field>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={visible} onChange={(e) => setVisible(e.target.checked)} /> Patient can see this in their app</label>
          </>
        )}
        {upload.error && <p className="text-sm text-red-600">{(upload.error as Error).message}</p>}
        <div className="flex items-center gap-3">
          {pages.length > 0 && <button className="inline-flex items-center gap-1 text-xs font-semibold text-muted hover:text-red-600" onClick={() => setPages([])}><Trash2 size={13} /> Clear all</button>}
          <Button className="ml-auto" disabled={pages.length === 0 || upload.isPending || camera} onClick={() => upload.mutate()}>
            {upload.isPending ? <><RefreshCw size={15} className="animate-spin" /> Uploading {done + 1} of {pages.length}</> : `Upload ${pages.length || ''} ${pages.length === 1 ? 'page' : 'pages'}`}
          </Button>
        </div>
      </div>
    </Modal>
  )
}
