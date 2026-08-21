// Ed25519 integrity receipts for independent Judge completion decisions.
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { resolveStateDir } from "../config/paths.js";

const PRIVATE_KEY_FILENAME = "judge-receipt-ed25519-private.pem";
const PUBLIC_KEY_FILENAME = "judge-receipt-ed25519-public.pem";

export type SignedJudgeReceipt<T extends Record<string, unknown>> = T & {
  signature: string;
  publicKeyId: string;
};

type JudgeSigningKey = {
  privateKey: crypto.KeyObject;
  publicKey: crypto.KeyObject;
  publicKeyId: string;
};

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(canonicalize);
  }
  if (!value || typeof value !== "object") {
    return value;
  }
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([key]) => key !== "signature" && key !== "publicKeyId")
      .toSorted(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => [key, canonicalize(entry)]),
  );
}

export function canonicalJudgeReceiptBytes(receipt: Record<string, unknown>): Buffer {
  return Buffer.from(JSON.stringify(canonicalize(receipt)), "utf8");
}

function keyPaths(directory: string) {
  return {
    privatePath: path.join(directory, PRIVATE_KEY_FILENAME),
    publicPath: path.join(directory, PUBLIC_KEY_FILENAME),
  };
}

function publicKeyId(publicKey: crypto.KeyObject): string {
  const der = publicKey.export({ type: "spki", format: "der" });
  return crypto.createHash("sha256").update(der).digest("hex");
}

function writePrivateKeyExclusive(filePath: string, pem: string): boolean {
  try {
    fs.writeFileSync(filePath, pem, { encoding: "utf8", flag: "wx", mode: 0o600 });
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") {
      return false;
    }
    throw error;
  }
}

/** Read the existing signing identity without creating or repairing files. */
export function loadJudgeSigningKey(directory?: string): JudgeSigningKey | undefined {
  const keyDirectory = directory ?? path.join(resolveStateDir(), "credentials");
  const paths = keyPaths(keyDirectory);
  if (!fs.existsSync(paths.privatePath)) {
    return undefined;
  }
  try {
    const privatePem = fs.readFileSync(paths.privatePath, "utf8");
    const privateKey = crypto.createPrivateKey(privatePem);
    const publicKey = crypto.createPublicKey(privatePem);
    return { privateKey, publicKey, publicKeyId: publicKeyId(publicKey) };
  } catch {
    return undefined;
  }
}

/** Load or atomically establish the process-independent Judge signing identity. */
export function loadOrCreateJudgeSigningKey(directory?: string): JudgeSigningKey {
  const keyDirectory = directory ?? path.join(resolveStateDir(), "credentials");
  fs.mkdirSync(keyDirectory, { recursive: true, mode: 0o700 });
  const paths = keyPaths(keyDirectory);
  let privatePem: string;
  if (fs.existsSync(paths.privatePath)) {
    privatePem = fs.readFileSync(paths.privatePath, "utf8");
  } else {
    const generated = crypto.generateKeyPairSync("ed25519");
    const candidatePem = generated.privateKey.export({ type: "pkcs8", format: "pem" });
    if (writePrivateKeyExclusive(paths.privatePath, candidatePem)) {
      privatePem = candidatePem;
    } else {
      privatePem = fs.readFileSync(paths.privatePath, "utf8");
    }
  }
  const privateKey = crypto.createPrivateKey(privatePem);
  const publicKey = crypto.createPublicKey(privatePem);
  const publicPem = publicKey.export({ type: "spki", format: "pem" });
  fs.writeFileSync(paths.publicPath, publicPem, { encoding: "utf8", mode: 0o644 });
  fs.chmodSync(paths.privatePath, 0o600);
  return { privateKey, publicKey, publicKeyId: publicKeyId(publicKey) };
}

export function signJudgeReceipt<T extends Record<string, unknown>>(
  receipt: T,
  options?: { directory?: string },
): SignedJudgeReceipt<T> {
  const key = loadOrCreateJudgeSigningKey(options?.directory);
  const signature = crypto.sign(null, canonicalJudgeReceiptBytes(receipt), key.privateKey);
  return {
    ...receipt,
    signature: signature.toString("base64"),
    publicKeyId: key.publicKeyId,
  };
}

export function verifyJudgeReceipt(
  receipt: Record<string, unknown> & { signature?: unknown; publicKeyId?: unknown },
  options?: { directory?: string; publicKeyPem?: string },
): boolean {
  if (typeof receipt.signature !== "string" || typeof receipt.publicKeyId !== "string") {
    return false;
  }
  try {
    const publicKey = options?.publicKeyPem
      ? crypto.createPublicKey(options.publicKeyPem)
      : loadJudgeSigningKey(options?.directory)?.publicKey;
    if (!publicKey) {
      return false;
    }
    if (publicKeyId(publicKey) !== receipt.publicKeyId) {
      return false;
    }
    const verifyKey = publicKey.export({ type: "spki", format: "pem" });
    return crypto.verify(
      null,
      canonicalJudgeReceiptBytes(receipt),
      verifyKey,
      Buffer.from(receipt.signature, "base64"),
    );
  } catch {
    return false;
  }
}
