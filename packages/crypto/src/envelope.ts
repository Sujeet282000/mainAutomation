import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

export interface Kms {
  generateDataKey(orgId: string): Promise<{ plaintext: Buffer; wrapped: Buffer }>;
  unwrap(orgId: string, wrapped: Buffer): Promise<Buffer>;
}

export interface Sealed {
  payload: Buffer;
  iv: Buffer;
  tag: Buffer;
  dekWrapped: Buffer;
}

const MAGIC = Buffer.from("OCRv2");

function kekFromSecret(secret: string) {
  return createHash("sha256").update(secret).digest();
}

function wrapDek(kek: Buffer, orgId: string, dek: Buffer) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", kek, iv);
  cipher.setAAD(Buffer.from(orgId));
  const enc = Buffer.concat([cipher.update(dek), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, enc]);
}

function unwrapDek(kek: Buffer, orgId: string, wrapped: Buffer) {
  const iv = wrapped.subarray(0, 12);
  const tag = wrapped.subarray(12, 28);
  const enc = wrapped.subarray(28);
  const decipher = createDecipheriv("aes-256-gcm", kek, iv);
  decipher.setAAD(Buffer.from(orgId));
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(enc), decipher.final()]);
}

export class LocalKms implements Kms {
  private kek: Buffer;
  constructor(secret: string) {
    this.kek = kekFromSecret(secret);
  }
  generateDataKeySync(orgId: string) {
    const plaintext = randomBytes(32);
    const wrapped = wrapDek(this.kek, orgId, plaintext);
    return { plaintext, wrapped };
  }
  unwrapSync(orgId: string, wrapped: Buffer) {
    return unwrapDek(this.kek, orgId, wrapped);
  }
  async generateDataKey(orgId: string) {
    return this.generateDataKeySync(orgId);
  }
  async unwrap(orgId: string, wrapped: Buffer) {
    return this.unwrapSync(orgId, wrapped);
  }
}

export function sealSync(kms: LocalKms, orgId: string, plain: unknown): Sealed {
  const { plaintext: dek, wrapped } = kms.generateDataKeySync(orgId);
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", dek, iv);
  const payload = Buffer.concat([c.update(JSON.stringify(plain), "utf8"), c.final()]);
  const tag = c.getAuthTag();
  dek.fill(0);
  return { payload, iv, tag, dekWrapped: wrapped };
}

export function openSync<T>(kms: LocalKms, orgId: string, s: Sealed): T {
  const dek = kms.unwrapSync(orgId, s.dekWrapped);
  try {
    const d = createDecipheriv("aes-256-gcm", dek, s.iv);
    d.setAuthTag(s.tag);
    const out = Buffer.concat([d.update(s.payload), d.final()]).toString("utf8");
    return JSON.parse(out) as T;
  } finally {
    dek.fill(0);
  }
}

export async function seal(kms: Kms, orgId: string, plain: unknown): Promise<Sealed> {
  const { plaintext: dek, wrapped } = await kms.generateDataKey(orgId);
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", dek, iv);
  const payload = Buffer.concat([c.update(JSON.stringify(plain), "utf8"), c.final()]);
  const tag = c.getAuthTag();
  dek.fill(0);
  return { payload, iv, tag, dekWrapped: wrapped };
}

export async function open<T>(kms: Kms, orgId: string, s: Sealed): Promise<T> {
  const dek = await kms.unwrap(orgId, s.dekWrapped);
  try {
    const d = createDecipheriv("aes-256-gcm", dek, s.iv);
    d.setAuthTag(s.tag);
    const out = Buffer.concat([d.update(s.payload), d.final()]).toString("utf8");
    return JSON.parse(out) as T;
  } finally {
    dek.fill(0);
  }
}

export function encodeSealed(s: Sealed) {
  const dekLen = Buffer.alloc(2);
  dekLen.writeUInt16BE(s.dekWrapped.length);
  return Buffer.concat([MAGIC, dekLen, s.dekWrapped, s.iv, s.tag, s.payload]);
}

export function isEnvelopeBlob(buf: Buffer) {
  return buf.length > MAGIC.length + 2 + 28 && buf.subarray(0, MAGIC.length).equals(MAGIC);
}

export function decodeSealed(buf: Buffer): Sealed {
  if (!isEnvelopeBlob(buf)) throw new Error("NOT_ENVELOPE");
  const dekLen = buf.readUInt16BE(MAGIC.length);
  let o = MAGIC.length + 2;
  const dekWrapped = buf.subarray(o, o + dekLen);
  o += dekLen;
  const iv = buf.subarray(o, o + 12);
  o += 12;
  const tag = buf.subarray(o, o + 16);
  o += 16;
  const payload = buf.subarray(o);
  return { payload, iv, tag, dekWrapped };
}

/** Legacy AES-GCM: iv(12) + tag(16) + ciphertext */
export function encryptLegacy(secret: string, data: unknown): Buffer {
  const key = kekFromSecret(secret);
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const enc = Buffer.concat([cipher.update(Buffer.from(JSON.stringify(data), "utf8")), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), enc]);
}

export function decryptLegacy<T>(secret: string, buffer: Buffer): T {
  const key = kekFromSecret(secret);
  const iv = buffer.subarray(0, 12);
  const tag = buffer.subarray(12, 28);
  const enc = buffer.subarray(28);
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  return JSON.parse(Buffer.concat([decipher.update(enc), decipher.final()]).toString("utf8")) as T;
}

export async function encryptJson(kms: Kms, orgId: string, data: unknown) {
  return encodeSealed(await seal(kms, orgId, data));
}

export async function decryptJson<T>(kms: Kms, orgId: string, secret: string, buf: Buffer | Uint8Array | null): Promise<T | null> {
  if (!buf) return null;
  const buffer = Buffer.from(buf);
  if (isEnvelopeBlob(buffer)) {
    return open<T>(kms, orgId, decodeSealed(buffer));
  }
  return decryptLegacy<T>(secret, buffer);
}

export function redact(obj: unknown): unknown {
  if (!obj || typeof obj !== "object") return obj;
  const secrets = /token|secret|password|authorization|api[_-]?key|refresh/i;
  if (Array.isArray(obj)) return obj.map(redact);
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    out[k] = secrets.test(k) ? "[REDACTED]" : redact(v);
  }
  return out;
}
