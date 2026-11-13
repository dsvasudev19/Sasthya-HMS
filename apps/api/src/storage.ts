import { createCipheriv, createDecipheriv, randomBytes, randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

/** Where document bytes live. The database only keeps the key; swapping in S3 or similar means implementing these two calls. */
export interface FileStore {
  put(tenantId: string, bytes: Buffer): Promise<string>;
  get(key: string): Promise<Buffer>;
}

/**
 * Local disk store with AES-256-GCM encryption at rest. Each file gets its own random IV and an auth tag, so a tampered
 * or swapped file fails to decrypt instead of being served. Keys never contain anything a caller chose.
 */
export class LocalFileStore implements FileStore {
  private key: Buffer | null;
  constructor(private dir: string, hexKey?: string) {
    if (hexKey && !/^[0-9a-f]{64}$/i.test(hexKey)) throw new Error("DOCUMENTS_KEY must be 64 hex characters (openssl rand -hex 32)");
    this.key = hexKey ? Buffer.from(hexKey, "hex") : null;
  }

  async put(tenantId: string, bytes: Buffer): Promise<string> {
    const now = new Date();
    const key = `${tenantId}/${now.getUTCFullYear()}${String(now.getUTCMonth() + 1).padStart(2, "0")}/${randomUUID()}`;
    const file = this.resolve(key);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, this.seal(bytes), { mode: 0o600 });
    return key;
  }

  async get(key: string): Promise<Buffer> {
    return this.open(await readFile(this.resolve(key)));
  }

  private resolve(key: string): string {
    if (!/^[0-9a-f-]{36}\/\d{6}\/[0-9a-f-]{36}$/.test(key)) throw new Error("Bad storage key");
    return path.join(this.dir, key);
  }

  private seal(bytes: Buffer): Buffer {
    if (!this.key) return Buffer.concat([Buffer.from([0]), bytes]);
    const iv = randomBytes(12);
    const c = createCipheriv("aes-256-gcm", this.key, iv);
    const body = Buffer.concat([c.update(bytes), c.final()]);
    return Buffer.concat([Buffer.from([1]), iv, c.getAuthTag(), body]);
  }

  private open(blob: Buffer): Buffer {
    if (blob[0] === 0) return blob.subarray(1);
    if (!this.key) throw new Error("This file is encrypted but DOCUMENTS_KEY is not set");
    const d = createDecipheriv("aes-256-gcm", this.key, blob.subarray(1, 13));
    d.setAuthTag(blob.subarray(13, 29));
    return Buffer.concat([d.update(blob.subarray(29)), d.final()]);
  }
}

export function createFileStore(env: Record<string, string | undefined> = process.env): FileStore {
  const dir = env["DOCUMENTS_DIR"] ?? path.join(process.cwd(), "data", "documents");
  if (env["NODE_ENV"] === "production" && !env["DOCUMENTS_KEY"]) throw new Error("DOCUMENTS_KEY is required in production: patient files must be encrypted at rest");
  return new LocalFileStore(dir, env["DOCUMENTS_KEY"]);
}

/** What a file really is, judged by its first bytes and never by the name or the type the browser claimed. */
export function sniffMime(b: Buffer): "application/pdf" | "image/jpeg" | "image/png" | "image/webp" | null {
  if (b.length >= 5 && b.subarray(0, 5).toString("latin1") === "%PDF-") return "application/pdf";
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (b.length >= 8 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png";
  if (b.length >= 12 && b.subarray(0, 4).toString("latin1") === "RIFF" && b.subarray(8, 12).toString("latin1") === "WEBP") return "image/webp";
  return null;
}
