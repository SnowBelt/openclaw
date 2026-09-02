import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { signRecord } from "../../scripts/custom-runtime/custom-runtime-signature.mjs";
import {
  APPROVAL_ENVELOPE_SCHEMA,
  ingestReleaseApproval,
  verifyReleaseApprovalReceipt,
} from "../../scripts/custom-runtime/release-approval-ingestion.mjs";

const roots: string[] = [];
const candidateSha = "a".repeat(40);

function setup() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "release-approval-ingestion-"));
  roots.push(root);
  const { publicKey, privateKey } = crypto.generateKeyPairSync("ed25519");
  const publicKeyDer = publicKey.export({ type: "spki", format: "der" });
  const deviceId = crypto.createHash("sha256").update(publicKeyDer.subarray(-32)).digest("hex");
  const identityPath = path.join(root, "device.json");
  fs.writeFileSync(
    identityPath,
    `${JSON.stringify({
      deviceId,
      publicKeyPem: publicKey.export({ type: "spki", format: "pem" }),
      privateKeyPem: privateKey.export({ type: "pkcs8", format: "pem" }),
    })}\n`,
    { mode: 0o600 },
  );
  const expected = {
    operation: "promotion",
    candidateSha,
    approvalId: "owner:patternlab:promotion",
    sourceThreadId: "thread-owner",
    destinationThreadId: "thread-runtime",
    destinationHost: "local",
    repository: "local/openclaw",
    branch: "codex/patternlab-reliability",
    destination: "local-only",
  };
  return {
    root,
    identityPath,
    expected,
    envelopePath: path.join(root, "envelope.json"),
    receiptPath: path.join(root, "receipt.json"),
    ledgerPath: path.join(root, "ledger.json"),
  };
}

function writeEnvelope(params: ReturnType<typeof setup>, overrides: Record<string, unknown> = {}) {
  const grantedAt = new Date("2026-09-02T10:00:00.000Z");
  const signed = signRecord({
    identityPath: params.identityPath,
    record: {
      schema: APPROVAL_ENVELOPE_SCHEMA,
      ...params.expected,
      nonce: crypto.randomUUID(),
      authorizationMaterialSha256: "b".repeat(64),
      grantedAt: grantedAt.toISOString(),
      expiresAt: new Date(grantedAt.getTime() + 60 * 60_000).toISOString(),
      ...overrides,
    },
  });
  fs.writeFileSync(params.envelopePath, `${JSON.stringify(signed, null, 2)}\n`, { mode: 0o600 });
}

afterEach(() => {
  for (const root of roots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

describe("release approval ingestion", () => {
  it("ingests and verifies a destination-bound signed approval", () => {
    const state = setup();
    writeEnvelope(state);
    ingestReleaseApproval({
      ...state,
      now: new Date("2026-09-02T10:15:00.000Z"),
    });

    expect(
      verifyReleaseApprovalReceipt({
        receiptPath: state.receiptPath,
        identityPath: state.identityPath,
        expected: state.expected,
        now: new Date("2026-09-02T10:20:00.000Z"),
      }),
    ).toMatchObject({ deviceId: expect.stringMatching(/^[a-f0-9]{64}$/) });
  });

  it("rejects replay, wrong destination, tampering, and expiry", () => {
    const state = setup();
    writeEnvelope(state);
    const params = { ...state, now: new Date("2026-09-02T10:15:00.000Z") };
    ingestReleaseApproval(params);
    expect(() =>
      ingestReleaseApproval({ ...params, receiptPath: path.join(state.root, "replay.json") }),
    ).toThrow(/already consumed/);
    expect(() =>
      verifyReleaseApprovalReceipt({
        receiptPath: state.receiptPath,
        identityPath: state.identityPath,
        expected: { ...state.expected, destinationThreadId: "other-thread" },
        now: new Date("2026-09-02T10:20:00.000Z"),
      }),
    ).toThrow(/destinationThreadId/);

    const receipt = JSON.parse(fs.readFileSync(state.receiptPath, "utf8"));
    receipt.destinationHost = "remote";
    fs.writeFileSync(state.receiptPath, `${JSON.stringify(receipt)}\n`, { mode: 0o600 });
    expect(() =>
      verifyReleaseApprovalReceipt({
        receiptPath: state.receiptPath,
        identityPath: state.identityPath,
        expected: state.expected,
        now: new Date("2026-09-02T10:20:00.000Z"),
      }),
    ).toThrow(/signature/);

    const expired = setup();
    writeEnvelope(expired, { expiresAt: "2026-09-02T10:10:00.000Z" });
    expect(() =>
      ingestReleaseApproval({ ...expired, now: new Date("2026-09-02T10:15:00.000Z") }),
    ).toThrow(/expired/);
  });
});
