import crypto from "crypto";
import { decodeSealed, decryptLegacy, encodeSealed, isEnvelopeBlob, LocalKms, openSync, redact, sealSync } from "@algoverge/crypto";
import { env } from "./config";

const kms = new LocalKms(env.encryptionKey);

export function encryptJson(data: unknown, orgId = "platform"): Buffer {
  return encodeSealed(sealSync(kms, orgId, data));
}

export function decryptJson<T = Record<string, unknown>>(
  buf: Buffer | Uint8Array | null,
  orgId = "platform"
): T | null {
  if (!buf) return null;
  const buffer = Buffer.from(buf);
  if (isEnvelopeBlob(buffer)) {
    return openSync<T>(kms, orgId, decodeSealed(buffer));
  }
  return decryptLegacy<T>(env.encryptionKey, buffer);
}

export function hashToken(token: string) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

export function randomToken(bytes = 32) {
  return crypto.randomBytes(bytes).toString("hex");
}

export { redact };
