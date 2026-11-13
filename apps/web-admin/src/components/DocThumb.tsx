import { FileText } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { fetchBlobUrl } from '../lib/api'

/**
 * A small preview of a stored image, loaded only when it scrolls into view. PDFs and anything that fails to load show a
 * document icon. The file is fetched with the session (never from a public address) and released when the tile goes away.
 */
export default function DocThumb({ id, mimeType, className = 'size-12' }: { id: string; mimeType: string; className?: string }) {
  const box = useRef<HTMLSpanElement>(null)
  const [src, setSrc] = useState<string | null>(null)
  useEffect(() => {
    if (!mimeType.startsWith('image/') || !box.current) return
    let url: string | null = null
    let dead = false
    const io = new IntersectionObserver((entries) => {
      if (!entries.some((e) => e.isIntersecting)) return
      io.disconnect()
      fetchBlobUrl(`/documents/${id}/file`).then((r) => { if (dead) URL.revokeObjectURL(r.url); else { url = r.url; setSrc(r.url) } }).catch(() => undefined)
    }, { rootMargin: '120px' })
    io.observe(box.current)
    return () => { dead = true; io.disconnect(); if (url) URL.revokeObjectURL(url) }
  }, [id, mimeType])
  return (
    <span ref={box} className={`grid shrink-0 place-items-center overflow-hidden rounded-xl bg-amber-50 text-amber-700 ring-1 ring-line ${className}`}>
      {src ? <img src={src} alt="" className="size-full object-cover" /> : <FileText size={20} />}
    </span>
  )
}
