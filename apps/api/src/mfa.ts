import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import type { PrismaClient } from "@hms/db";

const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
export const base32 = (b: Buffer) => { let bits = 0, v = 0, out = ""; for (const x of b) { v = (v << 8) | x; bits += 8; while (bits >= 5) { out += B32[(v >>> (bits - 5)) & 31]; bits -= 5; } } if (bits > 0) out += B32[(v << (5 - bits)) & 31]; return out; };
const fromBase32 = (s: string) => { let bits = 0, v = 0; const out: number[] = []; for (const c of s.replace(/=+$/, "")) { v = (v << 5) | B32.indexOf(c); bits += 5; if (bits >= 8) { out.push((v >>> (bits - 8)) & 255); bits -= 8; } } return Buffer.from(out); };

/** RFC 6238 time-based one-time password: six digits, thirty-second steps. */
export const totp = (secretB32: string, step: number) => {
  const msg = Buffer.alloc(8); msg.writeBigUInt64BE(BigInt(step));
  const h = createHmac("sha1", fromBase32(secretB32)).update(msg).digest();
  const o = h[h.length - 1]! & 15;
  return String(((h.readUInt32BE(o) & 0x7fffffff) % 1_000_000)).padStart(6, "0");
};
export const currentStep = (now = Date.now()) => Math.floor(now / 30_000);
export const newSecret = () => base32(randomBytes(20));
export const otpauthUrl = (secret: string, account: string, issuer = "Swasthya HMS") => `otpauth://totp/${encodeURIComponent(issuer)}:${encodeURIComponent(account)}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&digits=6&period=30`;

const key = (appSecret: string) => createHash("sha256").update(`mfa-secret:${appSecret}`).digest();
export const seal = (appSecret: string, plain: string) => { const iv = randomBytes(12); const c = createCipheriv("aes-256-gcm", key(appSecret), iv); const enc = Buffer.concat([c.update(plain, "utf8"), c.final()]); return Buffer.concat([iv, c.getAuthTag(), enc]).toString("base64"); };
export const unseal = (appSecret: string, blob: string) => { const b = Buffer.from(blob, "base64"); const d = createDecipheriv("aes-256-gcm", key(appSecret), b.subarray(0, 12)); d.setAuthTag(b.subarray(12, 28)); return Buffer.concat([d.update(b.subarray(28)), d.final()]).toString("utf8"); };

const sha = (s: string) => createHash("sha256").update(s).digest("hex");
export const newRecoveryCodes = () => Array.from({ length: 8 }, () => `${randomBytes(3).toString("hex")}-${randomBytes(3).toString("hex")}`);
export const hashRecovery = (c: string) => sha(c.trim().toLowerCase());

// Five wrong codes in ten minutes locks that person's second step for ten minutes. Held in memory, per server process; the rate limit on the route backs it up.
const fails = new Map<string, { n: number; first: number; until: number }>();
export const lockedFor = (id: string) => { const f = fails.get(id); return f && f.until > Date.now() ? Math.ceil((f.until - Date.now()) / 60_000) : 0; };
const noteFail = (id: string) => { const now = Date.now(); const f = fails.get(id); const cur = !f || now - f.first > 600_000 ? { n: 0, first: now, until: 0 } : f; cur.n++; if (cur.n >= 5) cur.until = now + 600_000; fails.set(id, cur); };
export const clearFails = (id: string) => fails.delete(id);

/** Checks an authenticator code (once per time step) or a recovery code (once ever). */
export async function verifySecondFactor(db: PrismaClient, appSecret: string, identityId: string, input: string, pending = false): Promise<boolean> {
  if (lockedFor(identityId)) return false;
  const row = await db.identityMfa.findUnique({ where: { identityId } });
  if (!row || (!row.enabledAt && !pending)) return false;
  const code = input.replace(/\s/g, "");
  if (/^\d{6}$/.test(code)) {
    const secret = unseal(appSecret, row.secretEnc), now = currentStep();
    for (const step of [now, now - 1, now + 1]) {
      const want = Buffer.from(totp(secret, step));
      if (want.length === code.length && timingSafeEqual(want, Buffer.from(code)) && step > (row.lastStep ?? 0)) {
        // updateMany with the step in the filter makes a replayed code lose the race.
        const r = await db.identityMfa.updateMany({ where: { identityId, OR: [{ lastStep: null }, { lastStep: { lt: step } }] }, data: { lastStep: step } });
        if (r.count === 1) { clearFails(identityId); return true; }
      }
    }
  } else if (/^[0-9a-f]{6}-[0-9a-f]{6}$/i.test(code)) {
    const h = hashRecovery(code);
    if (row.recoveryHashes.includes(h)) {
      const r = await db.identityMfa.updateMany({ where: { identityId, recoveryHashes: { has: h } }, data: { recoveryHashes: row.recoveryHashes.filter((x) => x !== h) } });
      if (r.count === 1) { clearFails(identityId); return true; }
    }
  }
  noteFail(identityId);
  return false;
}
