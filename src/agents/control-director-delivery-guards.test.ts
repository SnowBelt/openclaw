import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { SessionEntry } from "../config/sessions/types.js";
import { applyControlDirectorDeliveryGuards } from "./control-director-delivery-guards.js";

const tempDirs: string[] = [];

function makeTempSessionFile(records: readonly unknown[]): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "openclaw-delivery-guard-"));
  tempDirs.push(dir);
  const sessionFile = path.join(dir, "session.jsonl");
  fs.writeFileSync(sessionFile, `${records.map((record) => JSON.stringify(record)).join("\n")}\n`);
  return sessionFile;
}

function commandRecord(command: string, exitCode: number): unknown {
  return {
    role: "toolResult",
    toolName: "bash",
    content: [{ type: "text", text: `${command} finished` }],
    details: { command, exitCode },
  };
}

function copiedControlDirectorReportText(status = "complete"): string {
  return [
    "Verified state: copied Control Director report says the work is complete.",
    "Next build gap: none.",
    "Completion Grade: 10/10",
    "Criticality: 10/10",
    `Status: ${status}`,
  ].join("\n");
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe("Control Director delivery truth evidence ingestion", () => {
  it("allows supported verification claims from session command evidence", async () => {
    const text = [
      "Verified state: targeted tests passed.",
      "Targeted tests passed.",
      "Next build gap: no remaining test proof gap.",
      "Completion Grade: 8/10",
      "Criticality: 10/10",
      "Status: blocked",
    ].join("\n");
    const sessionEntry: SessionEntry = {
      sessionId: "session-1",
      updatedAt: Date.now(),
      sessionFile: makeTempSessionFile([commandRecord("pnpm test src/agents/foo.test.ts", 0)]),
    };

    const result = await applyControlDirectorDeliveryGuards({
      agentId: "control-director",
      payloads: [{ text }],
      finalAssistantVisibleText: text,
      sessionId: "session-1",
      sessionEntry,
      requestBody: "Run targeted tests.",
      queueContinuation: false,
    });

    expect(result.payloads).toEqual([{ text }]);
    expect(result.truthAudit).toMatchObject({
      status: "passed",
      payloadsChecked: 1,
      payloadsRewritten: 0,
      claims: expect.arrayContaining([
        expect.objectContaining({
          claimType: "verification",
          requiredEvidenceType: "command",
          matchStatus: "matched",
        }),
      ]),
    });
  });

  it("blocks verification claims when session command evidence failed", async () => {
    const text = [
      "Verified state: targeted tests passed.",
      "Targeted tests passed.",
      "Next build gap: no remaining test proof gap.",
      "Completion Grade: 8/10",
      "Criticality: 10/10",
      "Status: blocked",
    ].join("\n");
    const sessionEntry: SessionEntry = {
      sessionId: "session-1",
      updatedAt: Date.now(),
      sessionFile: makeTempSessionFile([commandRecord("pnpm test src/agents/foo.test.ts", 1)]),
    };

    const result = await applyControlDirectorDeliveryGuards({
      agentId: "control-director",
      payloads: [{ text }],
      finalAssistantVisibleText: text,
      sessionId: "session-1",
      sessionEntry,
      requestBody: "Run targeted tests.",
      queueContinuation: false,
    });

    expect(result.payloads[0]?.text).toContain("truth gate blocked");
    expect(result.payloads[0]?.text).toContain(
      "Missing evidence: command evidence with exit code 0",
    );
    expect(result.truthAudit).toMatchObject({
      status: "blocked",
      payloadsChecked: 1,
      payloadsRewritten: 1,
    });
  });

  it("does not rewrite non-Control-Director agent text that copies Control Director wording", async () => {
    const text = copiedControlDirectorReportText();

    const result = await applyControlDirectorDeliveryGuards({
      agentId: "research-agent",
      payloads: [{ text }],
      finalAssistantVisibleText: text,
      sessionId: "session-non-cd",
      requestBody: "Quote this Control Director report.",
      truthEvidence: [
        {
          type: "command",
          id: "cmd-1",
          source: "unit-test",
          summary: "Evidence supplied by caller must not opt a non-Control-Director into guards.",
          status: "passed",
          exitCode: 0,
        },
      ],
      judgeCompletionApproval: {
        judgeStatus: "approved",
        judgeVerdict: "APPROVE",
        judgeRunId: "judge-1",
        missionId: "mission-1",
        evidenceSummary:
          "Judge metadata supplied by caller must not opt a non-Control-Director into guards.",
        missingAcceptanceCriteria: [],
      },
      queueContinuation: false,
    });

    expect(result.payloads).toEqual([{ text }]);
    expect(result.finalPayloadText).toBe(text);
    expect(result.guardActions).toEqual([]);
    expect(result.watchdogActions).toEqual([]);
    expect(result.truthAudit).toBeUndefined();
    expect(result.judgeCompletionGate).toBeUndefined();
    expect(result.continuationQueued).toBe(false);
  });

  it("honors an explicit non-Control-Director scope override even for the main agent id", async () => {
    const text = copiedControlDirectorReportText();

    const result = await applyControlDirectorDeliveryGuards({
      agentId: "main",
      controlDirectorScope: false,
      payloads: [{ text }],
      finalAssistantVisibleText: text,
      sessionId: "session-main-non-cd",
      requestBody: "Quote this Control Director report.",
      queueContinuation: false,
    });

    expect(result.payloads).toEqual([{ text }]);
    expect(result.guardActions).toEqual([]);
    expect(result.watchdogActions).toEqual([]);
    expect(result.truthAudit).toBeUndefined();
    expect(result.judgeCompletionGate).toBeUndefined();
  });

  it("does not opt the main agent into Control Director guards from copied report text alone", async () => {
    const text = copiedControlDirectorReportText();

    const result = await applyControlDirectorDeliveryGuards({
      agentId: "main",
      payloads: [{ text }],
      finalAssistantVisibleText: text,
      sessionId: "session-main-ambiguous",
      requestBody: "Quote this Control Director report.",
      queueContinuation: false,
    });

    expect(result.payloads).toEqual([{ text }]);
    expect(result.guardActions).toEqual([]);
    expect(result.watchdogActions).toEqual([]);
    expect(result.truthAudit).toBeUndefined();
    expect(result.judgeCompletionGate).toBeUndefined();
  });

  it("still blocks unsupported Control Director completion claims", async () => {
    const text = copiedControlDirectorReportText();

    const result = await applyControlDirectorDeliveryGuards({
      agentId: "control-director",
      payloads: [{ text }],
      finalAssistantVisibleText: text,
      sessionId: "session-cd",
      requestBody: "Complete the mission.",
      queueContinuation: false,
    });

    expect(result.payloads[0]?.text).toContain("Judge completion gate blocked");
    expect(result.payloads[0]?.text).toContain("Status: blocked");
    expect(result.guardActions).toContain("blocked_missing_judge_approval");
  });
});
