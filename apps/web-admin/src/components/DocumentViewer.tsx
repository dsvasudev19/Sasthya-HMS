import { Download, Minus, Plus, RotateCw } from 'lucide-react'
import { useEffect, useState } from 'react'
import { fetchBlobUrl } from '../lib/api'
import { fmtDate } from '../lib/format'
import { Modal } from './ui'

export interface DocRow {
  id: string
  kind: string
  title: string
  fileName: string
  mimeType: string
  sizeBytes: number
  createdAt: string
  note?: string | null
  uploadedByName?: string | null
  appointmentId?: string | null
}

export const KIND_LABEL: Record<string, string> = { PRESCRIPTION_SCAN: 'Scanned prescription', LAB_REPORT: 'Lab report', IMAGING: 'Imaging', DISCHARGE_SUMMARY: 'Discharge summary', ID_PROOF: 'ID proof', CONSENT: 'Consent', INSURANCE: 'Insurance', OTHER: 'Other' }
export const KIND_OPTIONS = Object.entries(KIND_LABEL).map(([value, label]) => ({ value, label }))

/** Opens a stored file inside the app: images can be zoomed and rotated, PDFs use the browser's own viewer. */
export default function DocumentViewer({ doc, onClose }: { doc: DocRow; onClose: () => void }) {
  const [src, setSrc] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [zoom, setZoom] = useState(1)
  const [turn, setTurn] = useState(0)
  useEffect(() => {
    let url: string | null = null
    let dead = false
    fetchBlobUrl(`/documents/${doc.id}/file`).then((r) => { if (dead) URL.revokeObjectURL(r.url); else { url = r.url; setSrc(r.url) } }).catch((e: Error) => setError(e.message))
    return () => { dead = true; if (url) URL.revokeObjectURL(url) }
  }, [doc.id])
  const isPdf = doc.mimeType === 'application/pdf'
  return (
    <Modal title={doc.title} onClose={onClose} size="xl">
      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
          <span className="rounded-full bg-surface px-3 py-1 font-semibold ring-1 ring-line">{KIND_LABEL[doc.kind] ?? doc.kind}</span>
          <span>{fmtDate(doc.createdAt)}{doc.uploadedByName ? ` · added by ${doc.uploadedByName}` : ''} · {(doc.sizeBytes / 1024).toFixed(0)} KB</span>
          <span className="ml-auto inline-flex items-center gap-1">
            {!isPdf && <>
              <button className="rounded-full p-2 hover:bg-surface" aria-label="Zoom out" onClick={() => setZoom((z) => Math.max(0.5, z - 0.25))}><Minus size={15} /></button>
              <button className="rounded-full p-2 hover:bg-surface" aria-label="Zoom in" onClick={() => setZoom((z) => Math.min(4, z + 0.25))}><Plus size={15} /></button>
              <button className="rounded-full p-2 hover:bg-surface" aria-label="Rotate" onClick={() => setTurn((t) => (t + 90) % 360)}><RotateCw size={15} /></button>
            </>}
            {src && <a href={src} download={doc.fileName} className="rounded-full p-2 hover:bg-surface" aria-label="Download"><Download size={15} /></a>}
          </span>
        </div>
        {doc.note && <p className="rounded-xl bg-surface px-4 py-2.5 text-sm">{doc.note}</p>}
        <div className="grid h-[68vh] place-items-center overflow-auto rounded-2xl bg-stone-100 ring-1 ring-line">
          {error ? <p className="text-sm text-red-600">{error}</p> : !src ? <p className="text-sm text-muted">Opening…</p> : isPdf
            ? <iframe src={src} title={doc.title} className="size-full rounded-2xl" />
            : <img src={src} alt={doc.title} className="max-h-none max-w-none origin-center transition-transform" style={{ transform: `rotate(${turn}deg) scale(${zoom})`, maxWidth: zoom === 1 ? '100%' : 'none', maxHeight: zoom === 1 ? '100%' : 'none' }} />}
        </div>
      </div>
    </Modal>
  )
}
