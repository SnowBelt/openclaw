// SAFETY-RATCHET: template-aware
// SAFETY-RATCHET: template-aware
import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import fs from "node:fs/promises";
import type { RingerCallerAuth } from "./types.js";

export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  }
  // SAFETY: The array/null/primitive guards above leave only a JSON object.
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .toSorted()
    .map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`)
    .join(",")}}`;
}

export function sha256Bytes(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

export async function sha256File(filePath: string): Promise<string> {
  return sha256Bytes(await fs.readFile(filePath));
}

export function payloadWithoutAuth(value: Record<string, unknown>): Record<string, unknown> {
  const { auth: _auth, ...payload } = value;
  return payload;
}

function signatureInput(auth: Pick<RingerCallerAuth, "nonce" | "expiresAt" | "digest">): string {
  return `${auth.nonce}\n${auth.expiresAt}\n${auth.digest}`;
}

export function createCallerAuth(
  payload: Record<string, unknown>,
  secret: string,
  now = new Date(),
): RingerCallerAuth {
  const nonce = randomBytes(24).toString("hex");
  const expiresAt = new Date(now.getTime() + 60_000).toISOString();
  const digest = sha256Bytes(stableStringify(payload));
  const signature = createHmac("sha256", secret)
    .update(signatureInput({ nonce, expiresAt, digest }))
    .digest("hex");
  return { nonce, expiresAt, digest, signature };
}

function safeHexEqual(left: string, right: string): boolean {
  if (!/^[a-f0-9]{64}$/u.test(left) || !/^[a-f0-9]{64}$/u.test(right)) {
    return false;
  }
  return timingSafeEqual(Buffer.from(left, "hex"), Buffer.from(right, "hex"));
}

export function verifyCallerAuth(params: {
  payload: Record<string, unknown>;
  auth: RingerCallerAuth;
  secret: string;
  now?: Date;
}): void {
  const now = params.now ?? new Date();
  const expiresAt = Date.parse(params.auth.expiresAt);
  if (!/^[a-f0-9]{48}$/u.test(params.auth.nonce)) {
    throw new Error("Invalid caller nonce.");
  }
  if (
    !Number.isFinite(expiresAt) ||
    expiresAt < now.getTime() ||
    expiresAt > now.getTime() + 65_000
  ) {
    throw new Error("Caller proof is expired or outside the allowed window.");
  }
  const digest = sha256Bytes(stableStringify(params.payload));
  if (!safeHexEqual(params.auth.digest, digest)) {
    throw new Error("Caller request digest does not match the request payload.");
  }
  const expected = createHmac("sha256", params.secret)
    .update(signatureInput(params.auth))
    .digest("hex");
  if (!safeHexEqual(params.auth.signature, expected)) {
    throw new Error("Caller signature is invalid.");
  }
}
