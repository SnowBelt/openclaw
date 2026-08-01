import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { issueControlDirectorModelTrialJudgeReceipt } from "./independent-judge-service.js";
import * as judgeReceiptVerifier from "./judge-receipt-signer.js";

const mocks = vi.hoisted(() => ({
  agentCommand: vi.fn(),
}));

vi.mock("./agent-command.js", () => ({ agentCommand: mocks.agentCommand }));
vi.mock("../config/io.js", () => ({
  getRuntimeConfig: () => ({
    agents: { list: [{ id: "trial-judge", role: "judge" }] },
  }),
}));

const directories: string[] = [];
const originalRuntimeHome = process.env.OPENCLAW_CUSTOM_RUNTIME_HOME;

afterEach(() => {
  if (originalRuntimeHome === undefined) {
    delete process.env.OPENCLAW_CUSTOM_RUNTIME_HOME;
  } else {
    process.env.OPENCLAW_CUSTOM_RUNTIME_HOME = originalRuntimeHome;
  }
  for (const directory of directories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

describe("Judge receipt signer", () => {
  it("verifies receipts without exposing private-key signing custody", () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "openclaw-judge-signing-"));
    directories.push(directory);
    const keyPair = crypto.generateKeyPairSync("ed25519");
    fs.writeFileSync(
      path.join(directory, "judge-receipt-ed25519-public.pem"),
      keyPair.publicKey.export({ type: "spki", format: "pem" }),
    );
    const unsigned = {
      schemaVersion: 1,
      receiptId: "receipt-1",
      missionId: "mission-1",
      claimHash: "a".repeat(64),
      verdict: "APPROVE",
      scope: "bounded test",
      evidenceSummary: "direct test evidence",
      conditions: "none",
      judgeRunId: "judge-run-1",
      judgeAgentId: "independent-judge",
      model: "ollama/judge:latest",
      issuedAt: 100,
    };
    const receipt = {
      ...unsigned,
      signature: crypto
        .sign(null, judgeReceiptVerifier.canonicalJudgeReceiptBytes(unsigned), keyPair.privateKey)
        .toString("base64"),
      publicKeyId: crypto
        .createHash("sha256")
        .update(keyPair.publicKey.export({ type: "spki", format: "der" }))
        .digest("hex"),
    };

    expect(judgeReceiptVerifier.verifyJudgeReceipt(receipt, { directory })).toBe(true);
    expect(
      judgeReceiptVerifier.verifyJudgeReceipt({ ...receipt, claimHash: "changed" }, { directory }),
    ).toBe(false);
    expect(judgeReceiptVerifier).not.toHaveProperty("loadOrCreateJudgeSigningKey");
    expect(() =>
      judgeReceiptVerifier.signJudgeReceipt(
        {
          ...unsigned,
          missionId: "control-director-model-eval:campaign:trial-1",
        },
        { directory },
      ),
    ).toThrow("require the Judge issuance service");
    expect(() =>
      judgeReceiptVerifier.signJudgeReceipt(
        {
          schema: "openclaw.control-director-model-eval-trial.v2",
          judgeReceipt: { trialIssuance: { purpose: "control-director-model-trial" } },
        },
        { directory },
      ),
    ).toThrow("require the Judge issuance service");
    expect(() =>
      judgeReceiptVerifier.signJudgeReceipt(
        {
          ...unsigned,
          missionId: "control-director-m01-m106:campaign",
          campaignIssuance: { purpose: "control-director-m01-m106" },
        },
        { directory },
      ),
    ).toThrow("require the Judge issuance service");
    expect(fs.existsSync(path.join(directory, "judge-receipt-ed25519-private.pem"))).toBe(false);
  });

  it("snapshots accessor-backed inputs once before generic policy checks and signing", () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "openclaw-judge-snapshot-"));
    directories.push(directory);
    let reads = 0;
    const receipt = {
      schemaVersion: 1,
      receiptId: "receipt-accessor",
      missionId: "ordinary-mission",
      claimHash: "a".repeat(64),
      verdict: "APPROVE",
      scope: "bounded test",
      evidenceSummary: "direct test evidence",
      conditions: "none",
      judgeRunId: "judge-run-accessor",
      judgeAgentId: "independent-judge",
      issuedAt: 100,
      get trialIssuance() {
        reads += 1;
        return reads === 1 ? undefined : { purpose: "control-director-model-trial" };
      },
    };
    const signed = judgeReceiptVerifier.signJudgeReceipt(receipt, { directory });
    expect(signed.trialIssuance).toBeUndefined();
    expect(reads).toBe(1);
    expect(judgeReceiptVerifier.verifyJudgeReceipt(signed, { directory })).toBe(true);
  });

  it("issues trial approval only through one real configured Judge invocation", async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "openclaw-trial-judge-"));
    directories.push(directory);
    const runtimeHome = path.join(directory, "runtime");
    fs.mkdirSync(runtimeHome, { mode: 0o700 });
    process.env.OPENCLAW_CUSTOM_RUNTIME_HOME = runtimeHome;
    const sourceSha = "1".repeat(40);
    const rollbackSha = "2".repeat(40);
    const createdAt = new Date(Date.now() - 60_000).toISOString();
    const expiresAt = new Date(Date.now() + 3_600_000).toISOString();
    fs.writeFileSync(
      path.join(runtimeHome, "certification-lease.json"),
      `${JSON.stringify({
        schema: "openclaw.custom-runtime-certification-lease.v2",
        state: "acquired",
        activeSha: sourceSha,
        candidateSha: sourceSha,
        rollbackSha,
        activeReleaseId: "active-release",
        rollbackReleaseId: "rollback-release",
        owner: "lease-owner",
        approvalId: "approval-id",
        operationId: "operation-id",
        invocationId: "invocation-id",
        operationClass: "release-certification",
        createdAt,
        expiresAt,
        heartbeatAt: createdAt,
        heartbeatRequired: true,
        heartbeatSequence: 0,
        pid: process.pid,
        actor: os.userInfo().username,
      })}\n`,
      { mode: 0o600 },
    );
    fs.writeFileSync(
      path.join(runtimeHome, "active-runtime.json"),
      `${JSON.stringify({ sourceSha, releaseId: "active-release" })}\n`,
      { mode: 0o600 },
    );
    const output = [
      "VERDICT: APPROVE",
      "SCOPE: exact model trial",
      "EVIDENCE: direct trial artifacts passed",
      "RISK: low",
      "REASON: measurements and evidence agree",
      "CONDITIONS: none",
    ].join("\n");
    const trialModelIdentity = {
      modelDigest: "3".repeat(64),
      cacheDigest: "4".repeat(64),
    };
    const judgeModelIdentity = {
      modelDigest: "5".repeat(64),
      cacheDigest: "6".repeat(64),
    };
    mocks.agentCommand.mockImplementationOnce(async (options: { message: string }) => ({
      payloads: [{ text: output }],
      meta: {
        finalPromptText: options.message,
        finalAssistantRawText: output,
        stopReason: "stop",
        agentMeta: {
          provider: "judge-runtime",
          model: "judge:latest",
          immutableModelIdentity: judgeModelIdentity,
        },
      },
    }));
    const artifactContent = `${JSON.stringify({ trial: { ackMs: 100 } })}\n`;
    const artifactSha256 = crypto.createHash("sha256").update(artifactContent).digest("hex");
    const request = {
      claim: {
        missionId: "control-director-model-eval:campaign:trial-1",
        requestBody: "Judge the completed exact-runtime model trial.",
        finalText: "The exact-runtime model trial passed with direct evidence.",
        evidenceSummary: "Direct exact-runtime artifacts passed.",
        artifactIds: ["artifact:trial-1"],
      },
      campaignNonce: "a".repeat(64),
      trialId: "trial-1",
      trialModelRef: "ollama/trial-model:latest",
      trialModelIdentity,
      sourceSha,
      rollbackSha,
      activeReleaseId: "active-release",
      rollbackReleaseId: "rollback-release",
      leaseOwner: "lease-owner",
      approvalId: "approval-id",
      operationId: "operation-id",
      invocationId: "invocation-id",
      measurementReceiptSha256: "b".repeat(64),
      measurementSetSha256: "c".repeat(64),
      evidenceSetSha256: "d".repeat(64),
      measurementSources: [
        {
          metric: "ackMs",
          evidenceRef: "artifact:trial-1",
          artifactSha256,
          jsonPointer: "/trial/ackMs",
          valueSha256: "f".repeat(64),
        },
      ],
      evidenceArtifacts: [
        {
          evidenceRef: "artifact:trial-1",
          path: "trial-1.json",
          sha256: artifactSha256,
          content: artifactContent,
        },
      ],
      artifactRoot: directory,
      signingDirectory: directory,
    };
    const receipt = await issueControlDirectorModelTrialJudgeReceipt(request);

    expect(mocks.agentCommand).toHaveBeenCalledOnce();
    expect(receipt.trialIssuance).toMatchObject({
      purpose: "control-director-model-trial",
      trialId: "trial-1",
      trialModelIdentity,
      judgeModelIdentity,
      invocation: {
        judgeAgentId: "trial-judge",
        provider: "judge-runtime",
        model: "judge:latest",
      },
    });
    expect(fs.existsSync(path.join(directory, receipt.trialIssuance!.transcript.path))).toBe(true);
    expect(judgeReceiptVerifier.verifyJudgeReceipt(receipt, { directory })).toBe(true);
    const heartbeatLease = JSON.parse(
      fs.readFileSync(path.join(runtimeHome, "certification-lease.json"), "utf8"),
    ) as Record<string, unknown>;
    heartbeatLease.heartbeatAt = new Date().toISOString();
    heartbeatLease.heartbeatSequence = 1;
    heartbeatLease.heartbeatPid = process.pid;
    fs.writeFileSync(
      path.join(runtimeHome, "certification-lease.json"),
      `${JSON.stringify(heartbeatLease)}\n`,
      { mode: 0o600 },
    );
    expect(judgeReceiptVerifier.verifyJudgeReceipt(receipt, { directory })).toBe(true);

    mocks.agentCommand.mockResolvedValueOnce({
      payloads: [{ text: output }],
      meta: {
        finalPromptText: "prompt",
        finalAssistantRawText: output,
        stopReason: "length",
        agentMeta: {
          provider: "judge-runtime",
          model: "judge:latest",
          immutableModelIdentity: judgeModelIdentity,
        },
      },
    });
    await expect(issueControlDirectorModelTrialJudgeReceipt(request)).rejects.toThrow(
      "valid diverse terminal verdict",
    );

    fs.unlinkSync(path.join(runtimeHome, "certification-lease.json"));
    await expect(issueControlDirectorModelTrialJudgeReceipt(request)).rejects.toThrow();
    expect(mocks.agentCommand).toHaveBeenCalledTimes(2);
  });
});
