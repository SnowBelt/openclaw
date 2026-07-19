import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { judgeCompletionIndependently } from "./independent-judge-service.js";
import { verifyJudgeReceipt } from "./judge-receipt-signer.js";

const directories: string[] = [];

afterEach(() => {
  for (const directory of directories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

describe("independent Judge service", () => {
  it("requires a separate Judge and signs its claim-bound approval", async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "openclaw-independent-judge-"));
    directories.push(directory);
    const runModel = vi.fn(async () => ({
      text: [
        "VERDICT: APPROVE",
        "SCOPE: direct answer",
        "EVIDENCE: test passed and command exited 0",
        "RISK: low",
        "REASON: The request and evidence match.",
        "CONDITIONS: none",
      ].join("\n"),
      runId: "judge-run-1",
      agentId: "judge",
      model: "local-judge",
    }));

    const result = await judgeCompletionIndependently({
      missionId: "mission-1",
      requestBody: "Explain the verified result",
      finalText: "Complete. The result is verified by the passing test.",
      evidenceSummary: "direct test passed and command exited 0",
      runModel,
      signingDirectory: directory,
      now: 100,
    });

    expect(result.approved).toBe(true);
    expect(runModel).toHaveBeenCalledOnce();
    expect(result.receipt.judgeRunId).toBe("judge-run-1");
    expect(verifyJudgeReceipt(result.receipt, { directory })).toBe(true);
  });

  it("fails closed when no independent Judge is configured", async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "openclaw-independent-judge-"));
    directories.push(directory);
    const result = await judgeCompletionIndependently({
      missionId: "mission-1",
      requestBody: "Explain the result",
      finalText: "Complete. Direct test passed.",
      evidenceSummary: "direct test passed and command exited 0",
      signingDirectory: directory,
      now: 100,
    });

    expect(result.approved).toBe(false);
    expect(result.receipt.conditions).toContain("configure an independent Judge");
  });
});
