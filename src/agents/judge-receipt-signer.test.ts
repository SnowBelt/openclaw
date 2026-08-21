import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  loadJudgeSigningKey,
  signJudgeReceipt,
  verifyJudgeReceipt,
} from "./judge-receipt-signer.js";

const directories: string[] = [];

afterEach(() => {
  for (const directory of directories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

describe("Judge receipt signer", () => {
  it("signs, verifies, and rejects tampered claim-bound receipts", () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "openclaw-judge-signing-"));
    directories.push(directory);
    const receipt = signJudgeReceipt(
      {
        schemaVersion: 1,
        missionId: "mission-1",
        claimHash: "claim-1",
        verdict: "APPROVE",
      },
      { directory },
    );

    expect(verifyJudgeReceipt(receipt, { directory })).toBe(true);
    expect(verifyJudgeReceipt({ ...receipt, claimHash: "changed" }, { directory })).toBe(false);
    expect(
      fs.statSync(path.join(directory, "judge-receipt-ed25519-private.pem")).mode & 0o777,
    ).toBe(0o600);
  });

  it("does not create signing state during read-only verification", () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "openclaw-judge-verify-only-"));
    directories.push(directory);
    const receipt = {
      schemaVersion: 2,
      missionId: "mission-1",
      claimHash: "claim-1",
      verdict: "APPROVE",
      signature: "not-a-signature",
      publicKeyId: "missing-key",
    };
    expect(loadJudgeSigningKey(directory)).toBeUndefined();
    expect(verifyJudgeReceipt(receipt, { directory })).toBe(false);
    expect(fs.readdirSync(directory)).toEqual([]);
  });
});
