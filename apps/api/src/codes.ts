import bwipjs from "bwip-js/node";

/** What a printed slip, wristband or sample label carries, so a scan can say what it is without any lookup table. */
export const slipCode = (appointmentId: string) => `A-${appointmentId.replace(/-/g, "").slice(-12)}`;

/** A Code 128 barcode as PNG: the symbology nearly every handheld and desk scanner reads, including cheap 1D ones. */
export function barcodePng(text: string, o: { height?: number; scale?: number; label?: boolean } = {}): Promise<Buffer> {
  return bwipjs.toBuffer({ bcid: "code128", text, scale: o.scale ?? 3, height: o.height ?? 12, includetext: o.label ?? false, textxalign: "center", paddingwidth: 4, paddingheight: 2 });
}
