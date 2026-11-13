import PDFDocument from "pdfkit";

const rupees = (paise: number) => `Rs ${(paise / 100).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const date = (d: Date | string) => new Date(d).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric", timeZone: "Asia/Kolkata" });

interface Row { description: string; quantity: number; unitPaise: number; amountPaise: number; gstPercent?: number }
interface Doc {
  title: string;
  number: string;
  issuedAt: Date | string;
  seller: { name: string; lines: string[] };
  buyer: { heading: string; lines: string[] };
  meta: [string, string][];
  rows: Row[];
  totals: [string, number][];
  statusLine?: string;
  footer?: string;
}

/** One layout for every invoice we print, so the patient bill, the pharmacy bill and the hospital's subscription invoice look alike. */
function render(d: Doc): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const pdf = new PDFDocument({ size: "A4", margin: 44, info: { Title: `${d.title} ${d.number}`, Producer: "Swasthya HMS" } });
    const chunks: Buffer[] = [];
    pdf.on("data", (c: Buffer) => chunks.push(c));
    pdf.on("end", () => resolve(Buffer.concat(chunks)));
    pdf.on("error", reject);

    const green = "#14532d";
    pdf.fillColor(green).font("Helvetica-Bold").fontSize(18).text(d.seller.name, 44, 44);
    pdf.fillColor("#444").font("Helvetica").fontSize(9);
    for (const l of d.seller.lines) pdf.text(l);
    pdf.fillColor(green).font("Helvetica-Bold").fontSize(20).text(d.title.toUpperCase(), 330, 44, { width: 220, align: "right" });
    pdf.fillColor("#444").font("Helvetica").fontSize(9).text(`No. ${d.number}`, 330, 70, { width: 220, align: "right" }).text(`Date ${date(d.issuedAt)}`, { width: 220, align: "right" });
    for (const [k, v] of d.meta) pdf.text(`${k}: ${v}`, { width: 220, align: "right" });

    let y = Math.max(pdf.y, 130) + 16;
    pdf.moveTo(44, y).lineTo(551, y).strokeColor("#d1d5db").stroke();
    y += 10;
    pdf.fillColor("#111").font("Helvetica-Bold").fontSize(10).text(d.buyer.heading, 44, y);
    pdf.font("Helvetica").fontSize(9).fillColor("#333");
    for (const l of d.buyer.lines) pdf.text(l, 44);
    y = pdf.y + 14;

    const cols = { desc: 44, qty: 300, unit: 350, gst: 430, amt: 480 };
    pdf.rect(44, y, 507, 20).fill("#ecfccb");
    pdf.fillColor(green).font("Helvetica-Bold").fontSize(9);
    pdf.text("Description", cols.desc + 6, y + 6).text("Qty", cols.qty, y + 6, { width: 40, align: "right" }).text("Rate", cols.unit, y + 6, { width: 70, align: "right" }).text("GST", cols.gst, y + 6, { width: 40, align: "right" }).text("Amount", cols.amt, y + 6, { width: 65, align: "right" });
    y += 26;
    pdf.font("Helvetica").fillColor("#111");
    for (const r of d.rows) {
      if (y > 740) { pdf.addPage(); y = 50; }
      const h = pdf.heightOfString(r.description, { width: 240 });
      pdf.text(r.description, cols.desc + 6, y, { width: 240 });
      pdf.text(String(r.quantity), cols.qty, y, { width: 40, align: "right" }).text(rupees(r.unitPaise), cols.unit, y, { width: 70, align: "right" }).text(r.gstPercent ? `${r.gstPercent}%` : "-", cols.gst, y, { width: 40, align: "right" }).text(rupees(r.amountPaise), cols.amt, y, { width: 65, align: "right" });
      y += Math.max(h, 12) + 6;
      pdf.moveTo(44, y - 3).lineTo(551, y - 3).strokeColor("#f1f5f9").stroke();
    }

    y += 8;
    if (y > 700) { pdf.addPage(); y = 50; }
    for (const [label, amount] of d.totals) {
      const bold = label === d.totals[d.totals.length - 1]![0] || /^total/i.test(label);
      pdf.font(bold ? "Helvetica-Bold" : "Helvetica").fontSize(bold ? 11 : 9).fillColor("#111");
      pdf.text(label, 330, y, { width: 140, align: "right" }).text(rupees(amount), 480, y, { width: 65, align: "right" });
      y += bold ? 18 : 14;
    }
    if (d.statusLine) pdf.font("Helvetica-Bold").fontSize(11).fillColor(green).text(d.statusLine, 44, y + 6);
    if (d.footer) pdf.font("Helvetica").fontSize(8).fillColor("#6b7280").text(d.footer, 44, 790, { width: 507, align: "center" });
    pdf.end();
  });
}

type InvoiceLike = {
  invoiceNo: string; createdAt: Date; status: string; subtotalPaise: number; discountPaise: number; totalPaise: number; taxPaise: number; paidPaise: number; refundedPaise: number;
  customerName: string | null; customerPhone: string | null; note: string | null;
  lines: Row[]; payments: { method: string; amountPaise: number }[]; patient?: { fullName: string; patientNo: string; phone: string } | null;
};

export function patientInvoicePdf(inv: InvoiceLike, hospital: { name: string; branchName?: string; address?: string | null; phone?: string | null; gstin?: string | null }) {
  const buyerLines = inv.patient ? [inv.patient.fullName, `Patient no. ${inv.patient.patientNo}`, inv.patient.phone] : [inv.customerName ?? "Walk-in customer", ...(inv.customerPhone ? [inv.customerPhone] : [])];
  const due = Math.max(0, inv.totalPaise - inv.paidPaise + inv.refundedPaise);
  return render({
    title: "Invoice", number: inv.invoiceNo, issuedAt: inv.createdAt,
    seller: { name: hospital.name, lines: [hospital.branchName ?? "", hospital.address ?? "", hospital.phone ? `Phone ${hospital.phone}` : "", hospital.gstin ? `GSTIN ${hospital.gstin}` : ""].filter(Boolean) },
    buyer: { heading: "Billed to", lines: buyerLines },
    meta: inv.payments.length ? [["Paid by", [...new Set(inv.payments.map((p) => p.method))].join(", ")]] : [],
    rows: inv.lines,
    totals: [
      ["Subtotal", inv.subtotalPaise],
      ...(inv.discountPaise ? ([["Discount", -inv.discountPaise]] as [string, number][]) : []),
      ...(inv.taxPaise ? ([["GST included", inv.taxPaise]] as [string, number][]) : []),
      ["Total", inv.totalPaise],
      ["Paid", inv.paidPaise],
      ...(inv.refundedPaise ? ([["Refunded", inv.refundedPaise]] as [string, number][]) : []),
      ["Balance due", due],
    ],
    statusLine: inv.status === "PAID" ? "PAID" : inv.status === "VOID" ? "VOID" : undefined,
    footer: `${inv.note ? `${inv.note}  ·  ` : ""}Computer generated invoice. Prices are inclusive of GST where shown.`,
  });
}

export function platformInvoicePdf(inv: {
  invoiceNo: string; createdAt: Date; periodStart: Date; periodEnd: Date; dueDate: Date; planCode: string; lines: unknown; subtotalPaise: number; gstPaise: number; totalPaise: number; status: string; paidAt: Date | null; paymentRef: string | null;
}, tenant: { name: string }) {
  const rows = (inv.lines as Row[]) ?? [];
  return render({
    title: "Tax invoice", number: inv.invoiceNo, issuedAt: inv.createdAt,
    seller: { name: "Swasthya HMS", lines: ["Hospital management for every hospital"] },
    buyer: { heading: "Billed to", lines: [tenant.name, `Plan ${inv.planCode}`] },
    meta: [["Period", `${date(inv.periodStart)} to ${date(inv.periodEnd)}`], ["Due", date(inv.dueDate)]],
    rows,
    totals: [["Subtotal", inv.subtotalPaise], ["GST 18%", inv.gstPaise], ["Total", inv.totalPaise]],
    statusLine: inv.status === "PAID" ? `PAID${inv.paidAt ? ` on ${date(inv.paidAt)}` : ""}${inv.paymentRef ? `  (ref ${inv.paymentRef})` : ""}` : inv.status === "VOID" ? "VOID" : `Payment due by ${date(inv.dueDate)}`,
    footer: "Swasthya HMS · This is a computer generated tax invoice.",
  });
}

export interface RxData {
  hospital: { name: string; branch?: string; address?: string | null; phone?: string | null };
  doctor: { name: string; specialty?: string | null; qualification?: string | null; registrationNo?: string | null } | null;
  patient: { fullName: string; patientNo: string; phone?: string | null; gender?: string | null; ageYears?: number | null; allergies: string[]; bloodGroup?: string | null };
  date: Date; rxNo: string | null; signed: boolean; channel: "IN_PERSON" | "TELE";
  vitals: Record<string, number> | null; complaints?: string | null; diagnosis?: string | null; advice?: string | null; followUpOn?: Date | null;
  items: { name: string; dose?: string | null; frequency?: string | null; durationDays?: number | null; instructions?: string | null; quantity: number }[];
  qrPng?: Buffer; verifyCode?: string | null;
}

/** The prescription a patient carries to any pharmacy. Unsigned drafts are stamped as such; signed ones carry a QR anyone can verify. */
export function prescriptionPdf(d: RxData): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const pdf = new PDFDocument({ size: "A4", margins: { top: 44, left: 44, right: 44, bottom: 20 }, info: { Title: `Prescription ${d.rxNo ?? "draft"}`, Producer: "Swasthya HMS" } });
    const chunks: Buffer[] = [];
    pdf.on("data", (c: Buffer) => chunks.push(c)); pdf.on("end", () => resolve(Buffer.concat(chunks))); pdf.on("error", reject);
    const green = "#14532d", mute = "#6b7280";

    pdf.fillColor(green).font("Helvetica-Bold").fontSize(17).text(d.hospital.name, 44, 40);
    pdf.fillColor("#444").font("Helvetica").fontSize(9);
    for (const l of [d.hospital.branch && d.hospital.branch !== d.hospital.name ? d.hospital.branch : "", d.hospital.address, d.hospital.phone ? `Phone ${d.hospital.phone}` : ""].filter(Boolean) as string[]) pdf.text(l);
    if (d.doctor) {
      pdf.fillColor("#111").font("Helvetica-Bold").fontSize(11).text(d.doctor.name, 330, 40, { width: 221, align: "right" });
      pdf.font("Helvetica").fontSize(9).fillColor("#444");
      for (const l of [d.doctor.qualification, d.doctor.specialty, d.doctor.registrationNo ? `Reg. no. ${d.doctor.registrationNo}` : ""].filter(Boolean) as string[]) pdf.text(l, 330, pdf.y, { width: 221, align: "right" });
    }
    let y = Math.max(pdf.y, 100) + 10;
    pdf.moveTo(44, y).lineTo(551, y).lineWidth(1.2).strokeColor(green).stroke();
    y += 10;

    const age = d.patient.ageYears != null ? `${d.patient.ageYears} y` : "";
    pdf.fillColor("#111").font("Helvetica-Bold").fontSize(11).text(d.patient.fullName, 44, y);
    pdf.font("Helvetica").fontSize(9).fillColor("#444").text([d.patient.patientNo, age, d.patient.gender ? d.patient.gender[0] + d.patient.gender.slice(1).toLowerCase() : "", d.patient.phone ?? "", d.patient.bloodGroup ? `Blood group ${d.patient.bloodGroup}` : ""].filter(Boolean).join("  ·  "));
    pdf.text(`${d.date.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric", timeZone: "Asia/Kolkata" })}${d.channel === "TELE" ? "  ·  Video consultation" : ""}${d.rxNo ? `   Rx ${d.rxNo}` : ""}`, 330, y + 2, { width: 221, align: "right" });
    y = Math.max(pdf.y, y + 28) + 4;
    if (d.patient.allergies.length) { pdf.rect(44, y, 507, 20).fill("#fef2f2"); pdf.fillColor("#b91c1c").font("Helvetica-Bold").fontSize(9).text(`ALLERGIES: ${d.patient.allergies.join(", ")}`, 52, y + 6, { width: 490 }); y += 28; }

    const v = d.vitals;
    if (v && Object.keys(v).length) {
      const bits = [v["bpSystolic"] && v["bpDiastolic"] ? `BP ${v["bpSystolic"]}/${v["bpDiastolic"]}` : "", v["pulse"] ? `Pulse ${v["pulse"]}` : "", v["tempC"] ? `Temp ${v["tempC"]}°C` : "", v["spo2"] ? `SpO2 ${v["spo2"]}%` : "", v["weightKg"] ? `Wt ${v["weightKg"]} kg` : ""].filter(Boolean);
      if (bits.length) { pdf.fillColor(mute).font("Helvetica").fontSize(9).text(`Vitals: ${bits.join("   ")}`, 44, y); y = pdf.y + 6; }
    }
    const block = (label: string, text?: string | null) => { if (!text?.trim()) return; pdf.fillColor(green).font("Helvetica-Bold").fontSize(9).text(label.toUpperCase(), 44, y); pdf.fillColor("#111").font("Helvetica").fontSize(10).text(text, 44, pdf.y + 1, { width: 507 }); y = pdf.y + 8; };
    block("Complaints", d.complaints); block("Diagnosis", d.diagnosis);

    pdf.fillColor(green).font("Helvetica-BoldOblique").fontSize(20).text("Rx", 44, y - 2, { continued: false });
    y = pdf.y + 4;
    if (d.items.length) {
      pdf.rect(44, y, 507, 18).fill("#ecfccb"); pdf.fillColor(green).font("Helvetica-Bold").fontSize(8.5);
      pdf.text("#", 50, y + 5).text("Medicine", 68, y + 5).text("Dose", 280, y + 5).text("How often", 340, y + 5).text("Days", 430, y + 5).text("Qty", 470, y + 5);
      y += 22; pdf.font("Helvetica").fillColor("#111").fontSize(9.5);
      d.items.forEach((i, n) => {
        if (y > 700) { pdf.addPage(); y = 50; }
        const h = pdf.heightOfString(i.name, { width: 205 });
        pdf.text(String(n + 1), 50, y).text(i.name, 68, y, { width: 205 }).text(i.dose ?? "-", 280, y, { width: 55 }).text(i.frequency ?? "-", 340, y, { width: 85 }).text(i.durationDays ? String(i.durationDays) : "-", 430, y).text(String(i.quantity), 470, y);
        let rowH = Math.max(h, 12);
        if (i.instructions) { pdf.fillColor(mute).fontSize(8.5).text(i.instructions, 68, y + rowH, { width: 460 }); rowH += pdf.heightOfString(i.instructions, { width: 460 }); pdf.fillColor("#111").fontSize(9.5); }
        y += rowH + 8;
      });
    } else { pdf.fillColor(mute).font("Helvetica").fontSize(9.5).text("No medicines prescribed.", 44, y); y = pdf.y + 8; }

    block("Advice", d.advice);
    if (d.followUpOn) block("Follow-up", d.followUpOn.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" }));

    const foot = 735;
    if (d.signed && d.qrPng) { pdf.image(d.qrPng, 44, foot - 6, { width: 64 }); pdf.fillColor(mute).font("Helvetica").fontSize(7.5).text(`Scan to verify\n${d.verifyCode ?? ""}`, 112, foot + 10); }
    pdf.moveTo(380, foot + 30).lineTo(551, foot + 30).lineWidth(0.6).strokeColor("#9ca3af").stroke();
    pdf.fillColor("#111").font("Helvetica-Bold").fontSize(9).text(d.doctor?.name ?? "", 380, foot + 34, { width: 171, align: "center" });
    pdf.fillColor(mute).font("Helvetica").fontSize(7.5).text(d.signed ? "Digitally signed on Swasthya HMS. Scan the code to confirm this prescription is genuine." : "DRAFT: not yet signed by the doctor", 44, 800, { width: 507, align: "center", lineBreak: false });
    pdf.end();
  });
}

// ───────────── pharmacy: GST tax invoice and thermal receipt ─────────────

const ONES = ["", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen"];
const TENS = ["", "", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety"];
const below100 = (n: number) => (n < 20 ? ONES[n]! : `${TENS[Math.floor(n / 10)]}${n % 10 ? ` ${ONES[n % 10]}` : ""}`);
const below1000 = (n: number) => (n >= 100 ? `${ONES[Math.floor(n / 100)]} hundred${n % 100 ? ` ${below100(n % 100)}` : ""}` : below100(n));

/** "Rupees one thousand two hundred thirty four and fifty paise only", in the Indian lakh/crore system. */
export function rupeesInWords(paise: number): string {
  const rupees = Math.floor(paise / 100), ps = paise % 100;
  if (rupees === 0 && ps === 0) return "Rupees zero only";
  const parts: string[] = [];
  let n = rupees;
  for (const [unit, name] of [[10_000_000, "crore"], [100_000, "lakh"], [1000, "thousand"]] as const) {
    if (n >= unit) { parts.push(`${below1000(Math.floor(n / unit))} ${name}`); n %= unit; }
  }
  if (n > 0) parts.push(below1000(n));
  const text = `${parts.join(" ")}${ps ? `${rupees ? " and " : ""}${below100(ps)} paise` : ""}`;
  return `Rupees ${text} only`.replace(/^Rupees /, "Rupees ").replace(/\s+/g, " ");
}

export interface PharmLine { name: string; maker?: string | null; hsn?: string | null; batchNo: string; expiry: Date; qty: number; mrpPaise: number; gstPercent: number; amountPaise: number }
export interface PharmBill {
  invoiceNo: string; date: Date; cashier?: string | null; prescriber?: string | null;
  customer: { name: string; phone?: string | null; patientNo?: string | null };
  lines: PharmLine[];
  subtotalPaise: number; discountPaise: number; totalPaise: number;
  tax: { gstPercent: number; taxablePaise: number; cgstPaise: number; sgstPaise: number }[];
  payments: { method: string; amountPaise: number }[]; paidPaise: number; refundedPaise: number; status: string;
}
export interface PharmSeller { name: string; branch?: string; address?: string | null; phone?: string | null; gstin?: string | null; drugLicence?: string | null }
const mmyy = (d: Date) => d.toLocaleDateString("en-IN", { month: "2-digit", year: "2-digit", timeZone: "UTC" });

/** The A4 GST tax invoice a pharmacy hands over: HSN, batch, expiry, MRP, the tax split by rate, and the amount in words. */
export function gstInvoicePdf(b: PharmBill, s: PharmSeller): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const pdf = new PDFDocument({ size: "A4", margins: { top: 40, left: 36, right: 36, bottom: 20 }, info: { Title: `Tax invoice ${b.invoiceNo}`, Producer: "Swasthya HMS" } });
    const chunks: Buffer[] = [];
    pdf.on("data", (c: Buffer) => chunks.push(c)); pdf.on("end", () => resolve(Buffer.concat(chunks))); pdf.on("error", reject);
    const green = "#0f5a5b", mute = "#6b7280", L = 36, R = 559;

    pdf.fillColor(green).font("Helvetica-Bold").fontSize(16).text(s.name, L, 40);
    pdf.fillColor("#333").font("Helvetica").fontSize(8.5);
    for (const l of [s.branch && s.branch !== s.name ? s.branch : "", s.address ?? "", [s.phone && `Phone ${s.phone}`, s.gstin && `GSTIN ${s.gstin}`, s.drugLicence && `Drug Licence ${s.drugLicence}`].filter(Boolean).join("   ")].filter(Boolean)) pdf.text(l as string);
    pdf.fillColor(green).font("Helvetica-Bold").fontSize(15).text(s.gstin ? "TAX INVOICE" : "INVOICE", 380, 40, { width: 179, align: "right" });
    pdf.fillColor("#333").font("Helvetica").fontSize(8.5).text(`No. ${b.invoiceNo}`, 380, 60, { width: 179, align: "right" }).text(`Date ${b.date.toLocaleString("en-IN", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Kolkata" })}`, { width: 179, align: "right" });
    let y = Math.max(pdf.y, 100) + 8;
    pdf.moveTo(L, y).lineTo(R, y).lineWidth(1).strokeColor(green).stroke(); y += 8;
    pdf.fillColor("#111").font("Helvetica-Bold").fontSize(9).text("Billed to", L, y);
    pdf.font("Helvetica").fontSize(9).text([b.customer.name, b.customer.patientNo, b.customer.phone].filter(Boolean).join("  ·  "), L, pdf.y);
    if (b.prescriber) pdf.fillColor(mute).text(`Prescriber: ${b.prescriber}`, L, pdf.y);
    if (b.cashier) pdf.fillColor(mute).text(`Billed by ${b.cashier}`, 380, y, { width: 179, align: "right" });
    y = pdf.y + 10;

    const cols = [{ k: "#", x: 36, w: 18 }, { k: "Item", x: 56, w: 160 }, { k: "HSN", x: 218, w: 42 }, { k: "Batch", x: 262, w: 50 }, { k: "Exp", x: 314, w: 32 }, { k: "Qty", x: 348, w: 26, r: true }, { k: "MRP", x: 376, w: 44, r: true }, { k: "GST", x: 422, w: 32, r: true }, { k: "Amount", x: 456, w: 103, r: true }];
    const head = () => { pdf.rect(L, y, R - L, 18).fill("#e6f4f3"); pdf.fillColor(green).font("Helvetica-Bold").fontSize(8); for (const c of cols) pdf.text(c.k, c.x, y + 5, { width: c.w, align: c.r ? "right" : "left" }); y += 22; pdf.font("Helvetica").fillColor("#111").fontSize(8.5); };
    head();
    b.lines.forEach((l, i) => {
      if (y > 690) { pdf.addPage(); y = 44; head(); }
      const h = Math.max(pdf.heightOfString(l.name, { width: 160 }), 11);
      const v: Record<string, string> = { "#": String(i + 1), Item: l.name, HSN: l.hsn ?? "", Batch: l.batchNo, Exp: mmyy(l.expiry), Qty: String(l.qty), MRP: (l.mrpPaise / 100).toFixed(2), GST: l.gstPercent ? `${l.gstPercent}%` : "-", Amount: (l.amountPaise / 100).toFixed(2) };
      for (const c of cols) pdf.text(v[c.k]!, c.x, y, { width: c.w, align: c.r ? "right" : "left" });
      if (l.maker) { pdf.fillColor(mute).fontSize(7.5).text(l.maker, 56, y + h, { width: 160 }); pdf.fillColor("#111").fontSize(8.5); y += 9; }
      y += h + 5;
      pdf.moveTo(L, y - 2).lineTo(R, y - 2).strokeColor("#eef2f7").lineWidth(0.5).stroke();
    });

    y += 6;
    if (y > 650) { pdf.addPage(); y = 44; }
    const top = y;
    if (b.tax.length) {
      pdf.fillColor(green).font("Helvetica-Bold").fontSize(8).text("GST summary", L, y); y += 12;
      pdf.fillColor(mute).text("Rate", L, y, { width: 40 }).text("Taxable", 80, y, { width: 60, align: "right" }).text("CGST", 146, y, { width: 50, align: "right" }).text("SGST", 202, y, { width: 50, align: "right" }); y += 11;
      pdf.font("Helvetica").fillColor("#111").fontSize(8.5);
      for (const t of b.tax) { pdf.text(`${t.gstPercent}%`, L, y, { width: 40 }).text((t.taxablePaise / 100).toFixed(2), 80, y, { width: 60, align: "right" }).text((t.cgstPaise / 100).toFixed(2), 146, y, { width: 50, align: "right" }).text((t.sgstPaise / 100).toFixed(2), 202, y, { width: 50, align: "right" }); y += 12; }
    }
    let ty = top;
    const row = (label: string, v: string, bold = false) => { pdf.font(bold ? "Helvetica-Bold" : "Helvetica").fontSize(bold ? 11 : 9).fillColor("#111").text(label, 340, ty, { width: 120, align: "right" }).text(v, 462, ty, { width: 97, align: "right" }); ty += bold ? 17 : 13; };
    row("Subtotal", (b.subtotalPaise / 100).toFixed(2));
    if (b.discountPaise) row("Discount", `- ${(b.discountPaise / 100).toFixed(2)}`);
    row("Total (incl. GST)", (b.totalPaise / 100).toFixed(2), true);
    for (const p of b.payments) row(`Paid ${p.method.toLowerCase()}`, (p.amountPaise / 100).toFixed(2));
    if (b.totalPaise - b.paidPaise + b.refundedPaise > 0) row("Balance due", ((b.totalPaise - b.paidPaise + b.refundedPaise) / 100).toFixed(2), true);
    y = Math.max(y, ty) + 10;
    pdf.fillColor(mute).font("Helvetica-Oblique").fontSize(8.5).text(rupeesInWords(b.totalPaise).replace(/^./, (c) => c.toUpperCase()), L, y, { width: R - L });
    pdf.fillColor(mute).font("Helvetica").fontSize(7.5).text("Goods once sold can be returned within the shop's return period with this bill. Keep medicines away from children. Schedule H drugs are sold on a doctor's prescription only.", L, 790, { width: R - L, align: "center", lineBreak: false });
    pdf.end();
  });
}

/** An 80 mm roll receipt for a thermal printer: narrow, dense, and as long as it needs to be. */
export function thermalReceiptPdf(b: PharmBill, s: PharmSeller): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const W = 226, M = 8, IW = W - 2 * M;
    const height = 215 + b.lines.length * 30 + b.tax.length * 11 + b.payments.length * 11 + (s.address ? 11 : 0) + (b.discountPaise ? 11 : 0) + (b.prescriber ? 10 : 0);
    const pdf = new PDFDocument({ size: [W, height], margins: { top: M, left: M, right: M, bottom: 0 }, info: { Title: `Receipt ${b.invoiceNo}`, Producer: "Swasthya HMS" } });
    const chunks: Buffer[] = [];
    pdf.on("data", (c: Buffer) => chunks.push(c)); pdf.on("end", () => resolve(Buffer.concat(chunks))); pdf.on("error", reject);
    const line = () => { pdf.moveTo(M, pdf.y + 2).lineTo(W - M, pdf.y + 2).dash(2, { space: 2 }).strokeColor("#000").lineWidth(0.5).stroke().undash(); pdf.x = M; pdf.moveDown(0.45); };
    const two = (l: string, r: string, bold = false) => { const y = pdf.y; pdf.font(bold ? "Helvetica-Bold" : "Helvetica").fontSize(bold ? 10 : 8).fillColor("#000").text(l, M, y, { width: IW - 60 }); pdf.text(r, W - M - 60, y, { width: 60, align: "right" }); pdf.x = M; pdf.y = Math.max(pdf.y, y + (bold ? 13 : 10.5)); };

    pdf.font("Helvetica-Bold").fontSize(11).fillColor("#000").text(s.name, M, M, { width: IW, align: "center" });
    pdf.font("Helvetica").fontSize(7.5);
    for (const l of [s.address, s.phone && `Ph ${s.phone}`, s.gstin && `GSTIN ${s.gstin}`, s.drugLicence && `DL ${s.drugLicence}`].filter(Boolean) as string[]) pdf.text(l, { width: IW, align: "center" });
    pdf.moveDown(0.3); line();
    pdf.font("Helvetica-Bold").fontSize(8.5).text(s.gstin ? "TAX INVOICE" : "CASH MEMO", { width: IW, align: "center" });
    pdf.font("Helvetica").fontSize(7.5);
    two(`Bill ${b.invoiceNo}`, b.date.toLocaleDateString("en-IN", { day: "2-digit", month: "2-digit", year: "2-digit", timeZone: "Asia/Kolkata" }));
    two(b.customer.name, b.date.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Kolkata" }));
    if (b.prescriber) pdf.text(`Dr ${b.prescriber.replace(/^Dr\.?\s+/i, "")}`);
    line();
    for (const l of b.lines) {
      pdf.font("Helvetica-Bold").fontSize(8).text(l.name, M, pdf.y, { width: IW });
      two(`  ${l.qty} x ${(l.mrpPaise / 100).toFixed(2)}   B:${l.batchNo} E:${mmyy(l.expiry)}`, (l.amountPaise / 100).toFixed(2));
    }
    line();
    two("Subtotal", (b.subtotalPaise / 100).toFixed(2));
    if (b.discountPaise) two("Discount", `-${(b.discountPaise / 100).toFixed(2)}`);
    for (const t of b.tax) two(`GST ${t.gstPercent}% (CGST ${(t.cgstPaise / 100).toFixed(2)} + SGST ${(t.sgstPaise / 100).toFixed(2)})`, "");
    two("TOTAL", (b.totalPaise / 100).toFixed(2), true);
    for (const p of b.payments) two(`Paid by ${p.method.toLowerCase()}`, (p.amountPaise / 100).toFixed(2));
    const due = b.totalPaise - b.paidPaise + b.refundedPaise;
    if (due > 0) two("Balance due", (due / 100).toFixed(2), true);
    line();
    pdf.font("Helvetica-Oblique").fontSize(7).text(rupeesInWords(b.totalPaise), { width: IW, align: "center" });
    pdf.moveDown(0.5).font("Helvetica-Bold").fontSize(8).text("Get well soon!", { width: IW, align: "center" });
    pdf.font("Helvetica").fontSize(6.5).text("Please check medicines before leaving the counter.", { width: IW, align: "center" });
    pdf.end();
  });
}

// ───────────── scan-friendly print-outs: token slip, patient card, sample labels ─────────────

export interface SlipData { hospital: string; branch?: string; token: number | null; patient: string; patientNo: string; doctor?: string | null; when: Date; channel: "IN_PERSON" | "TELE"; note?: string | null; barcode: Buffer; code: string }

/** The slip handed over at the desk. Scanning its barcode at reception checks the patient in without typing anything. */
export function tokenSlipPdf(d: SlipData): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const W = 226, M = 10, IW = W - 2 * M;
    const pdf = new PDFDocument({ size: [W, 300], margins: { top: M, left: M, right: M, bottom: 0 }, info: { Title: `Token ${d.token ?? ""}`, Producer: "Swasthya HMS" } });
    const chunks: Buffer[] = [];
    pdf.on("data", (c: Buffer) => chunks.push(c)); pdf.on("end", () => resolve(Buffer.concat(chunks))); pdf.on("error", reject);
    pdf.font("Helvetica-Bold").fontSize(10).fillColor("#000").text(d.hospital, M, M, { width: IW, align: "center" });
    if (d.branch && d.branch !== d.hospital) pdf.font("Helvetica").fontSize(7.5).text(d.branch, { width: IW, align: "center" });
    pdf.moveDown(0.4).font("Helvetica").fontSize(8).text("YOUR TOKEN", { width: IW, align: "center" });
    pdf.font("Helvetica-Bold").fontSize(44).text(d.token === null ? "-" : String(d.token), { width: IW, align: "center", lineGap: -4 });
    pdf.moveDown(0.1).fontSize(10).text(d.patient, { width: IW, align: "center" });
    pdf.font("Helvetica").fontSize(8).text(`${d.patientNo}${d.channel === "TELE" ? "  ·  Video visit" : ""}`, { width: IW, align: "center" });
    pdf.text(`${d.when.toLocaleDateString("en-IN", { day: "2-digit", month: "short", timeZone: "Asia/Kolkata" })}, ${d.when.toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit", timeZone: "Asia/Kolkata" })}${d.doctor ? `  ·  Dr ${d.doctor.replace(/^Dr\.?\s+/i, "")}` : ""}`, { width: IW, align: "center" });
    if (d.note) pdf.fontSize(7.5).text(d.note, { width: IW, align: "center" });
    pdf.moveDown(0.5);
    pdf.image(d.barcode, M + 8, pdf.y, { width: IW - 16, height: 44 });
    pdf.y += 48;
    pdf.font("Helvetica").fontSize(7).text(d.code, M, pdf.y, { width: IW, align: "center" });
    pdf.fontSize(6.5).text("Show this slip at every counter. Scanning it is enough.", { width: IW, align: "center" });
    pdf.end();
  });
}

/** A credit-card sized patient ID. The barcode is the patient number, so any desk can pull the record up with one scan. */
export function patientCardPdf(d: { hospital: string; name: string; patientNo: string; phone?: string | null; bloodGroup?: string | null; barcode: Buffer }): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const pdf = new PDFDocument({ size: [243, 153], margins: { top: 0, left: 0, right: 0, bottom: 0 }, info: { Title: `Patient card ${d.patientNo}`, Producer: "Swasthya HMS" } });
    const chunks: Buffer[] = [];
    pdf.on("data", (c: Buffer) => chunks.push(c)); pdf.on("end", () => resolve(Buffer.concat(chunks))); pdf.on("error", reject);
    pdf.rect(0, 0, 243, 30).fill("#0b1a33");
    pdf.fillColor("#ffffff").font("Helvetica-Bold").fontSize(10).text(d.hospital, 12, 10, { width: 219, lineBreak: false });
    pdf.fillColor("#0b1b33").font("Helvetica-Bold").fontSize(13).text(d.name, 12, 42, { width: 219, lineBreak: false });
    pdf.font("Helvetica").fontSize(8.5).fillColor("#444").text(`${d.patientNo}${d.phone ? `  ·  ${d.phone}` : ""}${d.bloodGroup ? `  ·  ${d.bloodGroup}` : ""}`, 12, 60, { width: 219 });
    pdf.image(d.barcode, 22, 82, { width: 199, height: 44 });
    pdf.fontSize(7).fillColor("#6b7280").text(d.patientNo, 12, 130, { width: 219, align: "center" });
    pdf.end();
  });
}

/** One label per sample tube: patient, order number, tests and a barcode the lab scans to mark the sample collected. */
export function sampleLabelsPdf(labels: { patient: string; age?: string; orderNo: string; tests: string; when: Date; barcode: Buffer; copy: number; of: number }[]): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const pdf = new PDFDocument({ size: [180, 90], margins: { top: 0, left: 0, right: 0, bottom: 0 }, autoFirstPage: false, info: { Title: "Sample labels", Producer: "Swasthya HMS" } });
    const chunks: Buffer[] = [];
    pdf.on("data", (c: Buffer) => chunks.push(c)); pdf.on("end", () => resolve(Buffer.concat(chunks))); pdf.on("error", reject);
    for (const l of labels) {
      pdf.addPage({ size: [180, 90], margin: 0 });
      pdf.fillColor("#000").font("Helvetica-Bold").fontSize(9).text(`${l.patient}${l.age ? `  ${l.age}` : ""}`, 6, 5, { width: 168, lineBreak: false });
      pdf.font("Helvetica").fontSize(7).text(`${l.orderNo}   ${l.when.toLocaleDateString("en-IN", { day: "2-digit", month: "short", timeZone: "Asia/Kolkata" })} ${l.when.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Kolkata" })}   ${l.copy}/${l.of}`, 6, 17, { width: 168, lineBreak: false });
      pdf.fontSize(6.5).fillColor("#333").text(l.tests, 6, 26, { width: 168, height: 14, ellipsis: true });
      pdf.image(l.barcode, 10, 42, { width: 160, height: 38 });
      pdf.fontSize(6).fillColor("#000").text(l.orderNo, 6, 81, { width: 168, align: "center", lineBreak: false });
    }
    pdf.end();
  });
}


const TYPE_LABEL: Record<string, string> = { RECOVERED: "Recovered, discharged", REFERRED: "Referred to another facility", LAMA: "Left against medical advice", ABSCONDED: "Absconded", DEATH: "Death" };

/** The document a patient takes home and the next doctor reads: why they came, what was done, what to do next. */
export function dischargeSummaryPdf(d: {
  hospital: string; admissionNo: string; admittedAt: Date; dischargedAt: Date; type: string; doctor: string; ward: string; reason: string;
  patient: { name: string; patientNo: string; gender?: string | null; dob?: Date | null; phone?: string | null; allergies: string[] };
  summary: { diagnosis: string; course?: string; treatment?: string; condition?: string; advice?: string; medicines?: string; followUpOn?: string };
}): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const pdf = new PDFDocument({ size: "A4", margin: 44, info: { Title: `Discharge summary ${d.admissionNo}`, Producer: "Swasthya HMS" } });
    const chunks: Buffer[] = [];
    pdf.on("data", (c: Buffer) => chunks.push(c));
    pdf.on("end", () => resolve(Buffer.concat(chunks)));
    pdf.on("error", reject);
    const green = "#14532d";
    pdf.fillColor(green).font("Helvetica-Bold").fontSize(18).text(d.hospital, 44, 44);
    pdf.fillColor(green).fontSize(13).text("DISCHARGE SUMMARY", 44, 68);
    pdf.moveTo(44, 90).lineTo(551, 90).strokeColor("#d1d5db").stroke();
    const age = d.patient.dob ? `${Math.floor((Date.now() - d.patient.dob.getTime()) / (365.25 * 86_400_000))} y` : "";
    const grid: [string, string][] = [
      ["Patient", d.patient.name], ["Patient no.", d.patient.patientNo], ["Age / sex", [age, d.patient.gender?.toLowerCase()].filter(Boolean).join(" / ") || "-"], ["Phone", d.patient.phone ?? "-"],
      ["Admission no.", d.admissionNo], ["Admitted", date(d.admittedAt)], ["Discharged", date(d.dischargedAt)], ["Consultant", d.doctor || "-"], ["Ward and bed", d.ward], ["Outcome", TYPE_LABEL[d.type] ?? d.type],
    ];
    let y = 100;
    grid.forEach(([k, v], i) => {
      const x = i % 2 === 0 ? 44 : 310;
      pdf.fillColor("#6b7280").font("Helvetica").fontSize(8).text(k.toUpperCase(), x, y);
      pdf.fillColor("#111").font("Helvetica-Bold").fontSize(10).text(v, x, y + 10, { width: 240 });
      if (i % 2 === 1) y += 34;
    });
    pdf.y = y + 6;
    if (d.patient.allergies.length) pdf.fillColor("#b91c1c").font("Helvetica-Bold").fontSize(10).text(`Allergies: ${d.patient.allergies.join(", ")}`, 44, pdf.y).moveDown(0.6);
    const block = (title: string, body?: string) => {
      if (!body) return;
      pdf.fillColor(green).font("Helvetica-Bold").fontSize(10).text(title.toUpperCase(), 44, pdf.y + 6);
      pdf.fillColor("#111").font("Helvetica").fontSize(10).text(body, 44, pdf.y + 2, { width: 507 });
    };
    block("Reason for admission", d.reason);
    block("Diagnosis", d.summary.diagnosis);
    block("Course in hospital", d.summary.course);
    block("Treatment given", d.summary.treatment);
    block("Condition at discharge", d.summary.condition);
    block("Medicines to take at home", d.summary.medicines);
    block("Advice", d.summary.advice);
    if (d.summary.followUpOn) block("Follow-up", `Please visit on ${date(d.summary.followUpOn)}.`);
    const base = Math.max(pdf.y + 50, 720);
    pdf.moveTo(380, base).lineTo(551, base).strokeColor("#9ca3af").stroke();
    pdf.fillColor("#444").font("Helvetica").fontSize(9).text(d.doctor ? `Dr ${d.doctor.replace(/^Dr\.? /i, "")}` : "Consultant", 380, base + 4, { width: 171, align: "right" });
    pdf.fillColor("#9ca3af").fontSize(8).text("This summary was generated from the hospital record. In an emergency, go to the nearest hospital.", 44, 800, { width: 507, align: "center" });
    pdf.end();
  });
}
