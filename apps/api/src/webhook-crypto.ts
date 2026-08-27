import crypto from "crypto";
import { env } from "./config";

export function timingSafeEqualHex(expectedHex: string, provided: string) {
  const a = Buffer.from(expectedHex, "hex");
  const b = Buffer.from(provided.replace(/^sha256=/i, "").trim(), "hex");
  if (a.length !== b.length || a.length === 0) return false;
  return crypto.timingSafeEqual(a, b);
}

export function hmacSha256Hex(secret: string, payload: string | Buffer) {
  return crypto.createHmac("sha256", secret).update(payload).digest("hex");
}

/** Stripe-style `t=...,v1=...` signature when STRIPE_WEBHOOK_SECRET is set. */
export function verifyStripeSignature(rawBody: string | Buffer, header: string | undefined, secret: string) {
  if (!secret) return true;
  if (!header) return false;
  const parts = Object.fromEntries(
    header.split(",").map((p) => {
      const [k, ...rest] = p.split("=");
      return [k.trim(), rest.join("=")];
    })
  );
  const timestamp = parts.t;
  const v1 = parts.v1;
  if (!timestamp || !v1) return false;
  const signed = `${timestamp}.${typeof rawBody === "string" ? rawBody : rawBody.toString("utf8")}`;
  const expected = crypto.createHmac("sha256", secret).update(signed).digest("hex");
  return timingSafeEqualHex(expected, v1);
}

export function verifyMetaSignature(rawBody: string | Buffer, header: string | undefined, appSecret: string) {
  if (!appSecret) return true;
  if (!header) return false;
  const expected = hmacSha256Hex(appSecret, rawBody);
  return timingSafeEqualHex(expected, header);
}

export function catchHookUrl(publicId: string) {
  return `${env.apiUrl.replace(/\/$/, "")}/api/v1/hooks/${publicId}`;
}
