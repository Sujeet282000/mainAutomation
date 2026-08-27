"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.LocalKms = void 0;
exports.sealSync = sealSync;
exports.openSync = openSync;
exports.seal = seal;
exports.open = open;
exports.encodeSealed = encodeSealed;
exports.isEnvelopeBlob = isEnvelopeBlob;
exports.decodeSealed = decodeSealed;
exports.encryptLegacy = encryptLegacy;
exports.decryptLegacy = decryptLegacy;
exports.encryptJson = encryptJson;
exports.decryptJson = decryptJson;
exports.redact = redact;
const node_crypto_1 = require("node:crypto");
const MAGIC = Buffer.from("OCRv2");
function kekFromSecret(secret) {
    return (0, node_crypto_1.createHash)("sha256").update(secret).digest();
}
function wrapDek(kek, orgId, dek) {
    const iv = (0, node_crypto_1.randomBytes)(12);
    const cipher = (0, node_crypto_1.createCipheriv)("aes-256-gcm", kek, iv);
    cipher.setAAD(Buffer.from(orgId));
    const enc = Buffer.concat([cipher.update(dek), cipher.final()]);
    const tag = cipher.getAuthTag();
    return Buffer.concat([iv, tag, enc]);
}
function unwrapDek(kek, orgId, wrapped) {
    const iv = wrapped.subarray(0, 12);
    const tag = wrapped.subarray(12, 28);
    const enc = wrapped.subarray(28);
    const decipher = (0, node_crypto_1.createDecipheriv)("aes-256-gcm", kek, iv);
    decipher.setAAD(Buffer.from(orgId));
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(enc), decipher.final()]);
}
class LocalKms {
    kek;
    constructor(secret) {
        this.kek = kekFromSecret(secret);
    }
    generateDataKeySync(orgId) {
        const plaintext = (0, node_crypto_1.randomBytes)(32);
        const wrapped = wrapDek(this.kek, orgId, plaintext);
        return { plaintext, wrapped };
    }
    unwrapSync(orgId, wrapped) {
        return unwrapDek(this.kek, orgId, wrapped);
    }
    async generateDataKey(orgId) {
        return this.generateDataKeySync(orgId);
    }
    async unwrap(orgId, wrapped) {
        return this.unwrapSync(orgId, wrapped);
    }
}
exports.LocalKms = LocalKms;
function sealSync(kms, orgId, plain) {
    const { plaintext: dek, wrapped } = kms.generateDataKeySync(orgId);
    const iv = (0, node_crypto_1.randomBytes)(12);
    const c = (0, node_crypto_1.createCipheriv)("aes-256-gcm", dek, iv);
    const payload = Buffer.concat([c.update(JSON.stringify(plain), "utf8"), c.final()]);
    const tag = c.getAuthTag();
    dek.fill(0);
    return { payload, iv, tag, dekWrapped: wrapped };
}
function openSync(kms, orgId, s) {
    const dek = kms.unwrapSync(orgId, s.dekWrapped);
    try {
        const d = (0, node_crypto_1.createDecipheriv)("aes-256-gcm", dek, s.iv);
        d.setAuthTag(s.tag);
        const out = Buffer.concat([d.update(s.payload), d.final()]).toString("utf8");
        return JSON.parse(out);
    }
    finally {
        dek.fill(0);
    }
}
async function seal(kms, orgId, plain) {
    const { plaintext: dek, wrapped } = await kms.generateDataKey(orgId);
    const iv = (0, node_crypto_1.randomBytes)(12);
    const c = (0, node_crypto_1.createCipheriv)("aes-256-gcm", dek, iv);
    const payload = Buffer.concat([c.update(JSON.stringify(plain), "utf8"), c.final()]);
    const tag = c.getAuthTag();
    dek.fill(0);
    return { payload, iv, tag, dekWrapped: wrapped };
}
async function open(kms, orgId, s) {
    const dek = await kms.unwrap(orgId, s.dekWrapped);
    try {
        const d = (0, node_crypto_1.createDecipheriv)("aes-256-gcm", dek, s.iv);
        d.setAuthTag(s.tag);
        const out = Buffer.concat([d.update(s.payload), d.final()]).toString("utf8");
        return JSON.parse(out);
    }
    finally {
        dek.fill(0);
    }
}
function encodeSealed(s) {
    const dekLen = Buffer.alloc(2);
    dekLen.writeUInt16BE(s.dekWrapped.length);
    return Buffer.concat([MAGIC, dekLen, s.dekWrapped, s.iv, s.tag, s.payload]);
}
function isEnvelopeBlob(buf) {
    return buf.length > MAGIC.length + 2 + 28 && buf.subarray(0, MAGIC.length).equals(MAGIC);
}
function decodeSealed(buf) {
    if (!isEnvelopeBlob(buf))
        throw new Error("NOT_ENVELOPE");
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
function encryptLegacy(secret, data) {
    const key = kekFromSecret(secret);
    const iv = (0, node_crypto_1.randomBytes)(12);
    const cipher = (0, node_crypto_1.createCipheriv)("aes-256-gcm", key, iv);
    const enc = Buffer.concat([cipher.update(Buffer.from(JSON.stringify(data), "utf8")), cipher.final()]);
    return Buffer.concat([iv, cipher.getAuthTag(), enc]);
}
function decryptLegacy(secret, buffer) {
    const key = kekFromSecret(secret);
    const iv = buffer.subarray(0, 12);
    const tag = buffer.subarray(12, 28);
    const enc = buffer.subarray(28);
    const decipher = (0, node_crypto_1.createDecipheriv)("aes-256-gcm", key, iv);
    decipher.setAuthTag(tag);
    return JSON.parse(Buffer.concat([decipher.update(enc), decipher.final()]).toString("utf8"));
}
async function encryptJson(kms, orgId, data) {
    return encodeSealed(await seal(kms, orgId, data));
}
async function decryptJson(kms, orgId, secret, buf) {
    if (!buf)
        return null;
    const buffer = Buffer.from(buf);
    if (isEnvelopeBlob(buffer)) {
        return open(kms, orgId, decodeSealed(buffer));
    }
    return decryptLegacy(secret, buffer);
}
function redact(obj) {
    if (!obj || typeof obj !== "object")
        return obj;
    const secrets = /token|secret|password|authorization|api[_-]?key|refresh/i;
    if (Array.isArray(obj))
        return obj.map(redact);
    const out = {};
    for (const [k, v] of Object.entries(obj)) {
        out[k] = secrets.test(k) ? "[REDACTED]" : redact(v);
    }
    return out;
}
