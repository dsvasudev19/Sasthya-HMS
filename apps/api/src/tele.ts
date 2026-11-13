import { createHmac, randomBytes } from "node:crypto";

const b64 = (b: Buffer | string) => Buffer.from(b).toString("base64url");

export const newRoom = () => `swasthya-${randomBytes(12).toString("hex")}`;

/** Earliest and latest a video visit can be joined: 15 minutes before the slot up to 3 hours after. */
export const joinWindow = (scheduledAt: Date) => ({ from: new Date(scheduledAt.getTime() - 15 * 60_000), to: new Date(scheduledAt.getTime() + 3 * 3600_000) });

/**
 * A join link for the video room. With a self-hosted Jitsi and TELE_JWT_* set, the link carries a signed token that names the
 * person and makes only the doctor a moderator, so strangers cannot open or hijack the room. Without them it falls back to the
 * public service, which is fine for trying things out; the room name is random but anyone holding the link can enter.
 */
export function teleJoinUrl(o: { room: string; name: string; moderator: boolean; env?: Record<string, string | undefined>; now?: Date }): string {
  const env = o.env ?? process.env;
  const base = (env["TELE_BASE_URL"] ?? "https://meet.jit.si").replace(/\/$/, "");
  const cfg = `#config.prejoinPageEnabled=false&config.disableDeepLinking=true&userInfo.displayName=${encodeURIComponent(o.name)}`;
  const appId = env["TELE_JWT_APP_ID"], secret = env["TELE_JWT_SECRET"];
  if (!appId || !secret) return `${base}/${o.room}${cfg}`;
  const exp = Math.floor((o.now ?? new Date()).getTime() / 1000) + 4 * 3600;
  const head = b64(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const body = b64(JSON.stringify({ aud: "jitsi", iss: appId, sub: new URL(base).hostname, room: o.room, exp, context: { user: { name: o.name, moderator: o.moderator } } }));
  const sig = createHmac("sha256", secret).update(`${head}.${body}`).digest("base64url");
  return `${base}/${o.room}?jwt=${head}.${body}.${sig}${cfg}`;
}
