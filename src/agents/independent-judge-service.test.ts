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

  it("repairs one malformed model verdict without weakening the approval gate", async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "openclaw-independent-judge-"));
    directories.push(directory);
    const runModel = vi
      .fn()
      .mockResolvedValueOnce({
        text: "APPROVE",
        runId: "judge-run-invalid",
        agentId: "judge",
        model: "local-judge",
      })
      .mockResolvedValueOnce({
        text: [
          "VERDICT: APPROVE",
          "SCOPE: exact diagnostic response",
          "EVIDENCE: direct response equals GOAL_DIAGNOSTIC_OK",
          "RISK: low",
          "REASON: The exact response and evidence match the mission.",
          "CONDITIONS: none",
        ].join("\n"),
        runId: "judge-run-repaired",
        agentId: "judge",
        model: "local-judge",
      });

    const result = await judgeCompletionIndependently({
      missionId: "mission-repair",
      requestBody: "Reply exactly GOAL_DIAGNOSTIC_OK",
      finalText: "GOAL_DIAGNOSTIC_OK",
      evidenceSummary: "direct response equals GOAL_DIAGNOSTIC_OK",
      runModel,
      signingDirectory: directory,
      now: 100,
    });

    expect(result.approved).toBe(true);
    expect(runModel).toHaveBeenCalledTimes(2);
    expect(runModel.mock.calls[0]?.[0]).toContain("VERDICT: <allowed verdict>");
    expect(runModel.mock.calls[1]?.[0]).toContain("previous Judge response was invalid");
    expect(result.receipt.judgeRunId).toBe("judge-run-repaired");
    expect(verifyJudgeReceipt(result.receipt, { directory })).toBe(true);
  });

  it("remains fail-closed when the repaired verdict is still malformed", async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "openclaw-independent-judge-"));
    directories.push(directory);
    const runModel = vi.fn(async () => ({
      text: "APPROVE",
      runId: "judge-run-invalid",
      agentId: "judge",
      model: "local-judge",
    }));

    const result = await judgeCompletionIndependently({
      missionId: "mission-invalid-repair",
      requestBody: "Reply exactly GOAL_DIAGNOSTIC_OK",
      finalText: "GOAL_DIAGNOSTIC_OK",
      evidenceSummary: "direct response equals GOAL_DIAGNOSTIC_OK",
      runModel,
      signingDirectory: directory,
      now: 100,
    });

    expect(result.approved).toBe(false);
    expect(runModel).toHaveBeenCalledTimes(2);
    expect(result.receipt.verdict).toBe("REQUEST_MORE_EVIDENCE");
    expect(result.receipt.conditions).toContain("expected 6 non-empty lines");
    expect(verifyJudgeReceipt(result.receipt, { directory })).toBe(true);
  });
});
