import { useQuery } from '@tanstack/react-query'
import { CheckCircle2, FileDown, Printer, ReceiptText } from 'lucide-react'
import { api, openFile, printPdf } from '../lib/api'
import { fmtDate, rupees } from '../lib/format'
import { Button, Modal } from './ui'

interface Sale {
  id: string
  invoice: { invoiceNo: string; totalPaise: number; paidPaise: number; discountPaise: number; subtotalPaise: number; status: string; customerName: string | null; createdAt: string; patient: { fullName: string } | null; payments: { id: string; method: string; amountPaise: number }[]; lines: { id: string; description: string; quantity: number; unitPaise: number; amountPaise: number }[] } | null
  lines: { id: string; qty: number; batch: { batchNo: string; expiryDate: string } }[]
}

/** What the cashier sees the moment a sale is done: the totals, any change to hand back, and the printed bill in one tap. */
export default function SaleReceipt({ saleId, changePaise = 0, onClose }: { saleId: string; changePaise?: number; onClose: () => void }) {
  const { data: s } = useQuery({ queryKey: ['pos-sale', saleId], queryFn: () => api<Sale>(`/pos/sales/${saleId}`) })
  const inv = s?.invoice
  if (!s || !inv) return null
  const due = inv.totalPaise - inv.paidPaise
  return (
    <Modal title="Sale complete" onClose={onClose}>
      <div className="space-y-4 text-sm">
        <div className="flex items-center gap-3 rounded-2xl bg-brand-50 p-4 ring-1 ring-brand-100">
          <CheckCircle2 className="text-brand-700" size={26} />
          <div className="min-w-0 flex-1"><p className="font-semibold">{inv.invoiceNo}</p><p className="truncate text-xs text-muted">{inv.patient?.fullName ?? inv.customerName ?? 'Walk-in customer'} · {fmtDate(inv.createdAt)}</p></div>
          <p className="text-xl font-bold">{rupees(inv.totalPaise)}</p>
        </div>
        {changePaise > 0 && <p className="rounded-xl bg-amber-50 px-4 py-3 text-center text-base font-bold text-amber-800 ring-1 ring-amber-200">Give back {rupees(changePaise)} change</p>}
        <ul className="divide-y divide-line rounded-xl ring-1 ring-line">
          {inv.lines.map((l) => <li key={l.id} className="flex items-start justify-between gap-3 px-4 py-2.5"><span className="min-w-0"><span className="block truncate font-medium">{l.description}</span><span className="text-xs text-muted">{l.quantity} × {rupees(l.unitPaise)}</span></span><b>{rupees(l.amountPaise)}</b></li>)}
        </ul>
        <div className="space-y-1 px-1">
          {inv.discountPaise > 0 && <div className="flex justify-between text-muted"><span>Discount</span><span>− {rupees(inv.discountPaise)}</span></div>}
          {inv.payments.map((p) => <div key={p.id} className="flex justify-between text-muted"><span>Paid by {p.method.toLowerCase()}</span><span>{rupees(p.amountPaise)}</span></div>)}
          {due > 0 && <div className="flex justify-between font-semibold text-red-600"><span>Balance on the bill</span><span>{rupees(due)}</span></div>}
        </div>
        <div className="grid grid-cols-2 gap-2">
          <Button onClick={() => void printPdf(`/pos/sales/${saleId}/receipt.pdf?format=thermal`)}><Printer size={16} /> Print receipt</Button>
          <Button variant="ghost" onClick={() => void openFile(`/pos/sales/${saleId}/receipt.pdf?format=a4`)}><FileDown size={16} /> GST invoice (A4)</Button>
        </div>
        <Button variant="ghost" className="w-full" onClick={onClose}><ReceiptText size={16} /> Next customer</Button>
      </div>
    </Modal>
  )
}
