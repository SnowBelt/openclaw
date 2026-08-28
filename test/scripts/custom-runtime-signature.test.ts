import { spawnSync } from "node:child_process";
import { createHash, generateKeyPairSync } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const helper = path.resolve("scripts/custom-runtime/custom-runtime-signature.mjs");
const temporaryDirectories: string[] = [];

function runHelper(args: string[]) {
  const result = spawnSync(process.execPath, [helper, ...args], { encoding: "utf8" });
  return {
    status: result.status,
    stdout: result.stdout,
    stderr: result.stderr,
  };
}

function writePrivateJson(filePath: string, value: unknown): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true, mode: 0o700 });
  fs.writeFileSync(filePath, `${JSON.stringify(value)}\n`, { mode: 0o600 });
  fs.chmodSync(filePath, 0o600);
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    fs.chmodSync(directory, 0o700);
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

describe("custom runtime signed policy receipts", () => {
  it("signs and verifies an exact operation and candidate binding", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "openclaw-signature-test-"));
    temporaryDirectories.push(root);
    const { publicKey, privateKey } = generateKeyPairSync("ed25519");
    const publicKeyPem = publicKey.export({ type: "spki", format: "pem" }).toString();
    const privateKeyPem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
    const publicKeyDer = publicKey.export({ type: "spki", format: "der" });
    const deviceId = createHash("sha256").update(publicKeyDer.subarray(12)).digest("hex");
    const identity = path.join(root, "identity", "device.json");
    const record = path.join(root, "receipts", "policy-migration.json");
    const candidateSha = "a".repeat(40);
    writePrivateJson(identity, { deviceId, publicKeyPem, privateKeyPem });
    writePrivateJson(record, {
      schema: "openclaw.release-governance-policy-migration.v1",
      operation: "stage",
      candidateSha,
      createdAt: "2026-08-28T14:00:00.000Z",
      expiresAt: "2026-08-29T14:00:00.000Z",
    });

    const signed = runHelper(["sign", "--record", record, "--identity", identity]);
    expect(signed.status, signed.stderr).toBe(0);
    expect(JSON.parse(fs.readFileSync(record, "utf8"))).toHaveProperty(
      "signature.schema",
      "openclaw.custom-runtime-signature.v1",
    );

    const verified = runHelper([
      "verify",
      "--record",
      record,
      "--identity",
      identity,
      "--operation",
      "stage",
      "--candidate-sha",
      candidateSha,
    ]);
    expect(verified.status, verified.stderr).toBe(0);

    const tampered = JSON.parse(fs.readFileSync(record, "utf8")) as Record<string, unknown>;
    tampered.operation = "promotion";
    writePrivateJson(record, tampered);
    const rejected = runHelper([
      "verify",
      "--record",
      record,
      "--identity",
      identity,
      "--operation",
      "stage",
      "--candidate-sha",
      candidateSha,
    ]);
    expect(rejected.status).not.toBe(0);
    expect(rejected.stderr).toContain("payload hash does not match");
  });
});
