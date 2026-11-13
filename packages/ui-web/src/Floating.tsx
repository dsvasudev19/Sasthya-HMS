import { useEffect, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from 'react'
import { createPortal } from 'react-dom'

interface Pos { top?: number; bottom?: number; left: number; width: number; maxHeight: number }

/**
 * A popover rendered in a portal with fixed positioning, so it is never clipped by a modal or a scrolling container.
 * It opens below the anchor, or above when there is more room there, and closes on outside click, Escape, resize or scroll.
 */
export default function Floating({ anchor, open, onClose, children, maxHeight = 288, minWidth }: {
  anchor: RefObject<HTMLElement | null>
  open: boolean
  onClose: () => void
  children: ReactNode
  maxHeight?: number
  minWidth?: number
}) {
  const [pos, setPos] = useState<Pos | null>(null)
  const box = useRef<HTMLDivElement>(null)

  useLayoutEffect(() => {
    if (!open || !anchor.current) return
    const place = () => {
      const r = anchor.current!.getBoundingClientRect()
      const below = window.innerHeight - r.bottom - 12
      const above = r.top - 12
      const flip = below < 180 && above > below
      const room = Math.min(maxHeight, flip ? above : below)
      const width = Math.max(r.width, minWidth ?? 0)
      const left = Math.min(r.left, window.innerWidth - width - 8)
      setPos(flip ? { bottom: window.innerHeight - r.top + 6, left, width, maxHeight: room } : { top: r.bottom + 6, left, width, maxHeight: room })
    }
    place()
    window.addEventListener('resize', place)
    window.addEventListener('scroll', place, true)
    return () => { window.removeEventListener('resize', place); window.removeEventListener('scroll', place, true) }
  }, [open, anchor, maxHeight, minWidth])

  useEffect(() => {
    if (!open) return
    const down = (e: MouseEvent) => {
      const t = e.target as Node
      if (box.current?.contains(t) || anchor.current?.contains(t)) return
      onClose()
    }
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); onClose() } }
    document.addEventListener('mousedown', down)
    document.addEventListener('keydown', key, true)
    return () => { document.removeEventListener('mousedown', down); document.removeEventListener('keydown', key, true) }
  }, [open, onClose, anchor])

  if (!open || !pos) return null
  return createPortal(
    <div
      ref={box}
      style={{ position: 'fixed', top: pos.top, bottom: pos.bottom, left: pos.left, width: pos.width, maxHeight: pos.maxHeight }}
      className="z-[70] overflow-y-auto rounded-2xl bg-white p-1.5 shadow-xl ring-1 ring-line"
    >
      {children}
    </div>,
    document.body,
  )
}
