import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  issueControlDirectorCampaignJudgeReceipt,
  issueControlDirectorModelTrialJudgeReceipt,
  judgeCompletionIndependently,
} from "./independent-judge-service.js";
import { verifyJudgeReceipt } from "./judge-receipt-signer.js";

const mocks = vi.hoisted(() => ({
  agentCommand: vi.fn(),
}));

vi.mock("./agent-command.js", () => ({ agentCommand: mocks.agentCommand }));
vi.mock("../config/io.js", () => ({
  getRuntimeConfig: () => ({
    agents: { list: [{ id: "campaign-judge", role: "judge" }] },
  }),
}));

const directories: string[] = [];
const originalRuntimeHome = process.env.OPENCLAW_CUSTOM_RUNTIME_HOME;

afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
  if (originalRuntimeHome === undefined) {
    delete process.env.OPENCLAW_CUSTOM_RUNTIME_HOME;
  } else {
    process.env.OPENCLAW_CUSTOM_RUNTIME_HOME = originalRuntimeHome;
  }
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

  it("issues M01-M106 approval only from one live transcript-bound Judge run", async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "openclaw-campaign-judge-"));
    directories.push(directory);
    const runtimeHome = path.join(directory, "runtime");
    const artifactRoot = path.join(directory, "artifacts");
    fs.mkdirSync(runtimeHome, { mode: 0o700 });
    fs.mkdirSync(artifactRoot, { mode: 0o700 });
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
    const evidenceContent = `${JSON.stringify({ passed: true, sourceSha })}\n`;
    const evidenceSha256 = crypto.createHash("sha256").update(evidenceContent).digest("hex");
    const selectedModelIdentity = {
      modelDigest: "4".repeat(64),
      cacheDigest: "5".repeat(64),
    };
    const judgeModelIdentity = {
      modelDigest: "6".repeat(64),
      cacheDigest: "7".repeat(64),
    };
    fs.writeFileSync(path.join(artifactRoot, "runtime-proof.json"), evidenceContent, {
      mode: 0o600,
    });
    const output = [
      "VERDICT: APPROVE",
      "SCOPE: exact M01-M106 campaign",
      "EVIDENCE: exact runtime proof passed",
      "RISK: low",
      "REASON: the claim and evidence agree",
      "CONDITIONS: none",
    ].join("\n");
    mocks.agentCommand.mockImplementationOnce(async (options: { message: string }) => ({
      payloads: [{ text: output }],
      meta: {
        finalPromptText: options.message,
        finalAssistantRawText: output,
        stopReason: "stop",
        agentMeta: {
          provider: "judge-runtime",
          model: "campaign-judge:latest",
          immutableModelIdentity: judgeModelIdentity,
        },
      },
    }));

    const request = {
      claim: {
        missionId: "control-director-m01-m106:campaign",
        requestBody: "Certify the exact M01-M106 campaign.",
        finalText: "The exact M01-M106 campaign passed.",
        evidenceSummary: "Exact runtime proof passed.",
        artifactIds: ["sha256:runtime-proof"],
      },
      sourceSha,
      rollbackSha,
      activeReleaseId: "active-release",
      rollbackReleaseId: "rollback-release",
      configurationDigest: "3".repeat(64),
      selectedModel: "ollama/control-director:latest",
      selectedModelIdentity,
      runtimeHome,
      leaseOwner: "lease-owner",
      approvalId: "approval-id",
      operationId: "operation-id",
      invocationId: "invocation-id",
      evidenceArtifacts: [
        {
          artifactId: "sha256:runtime-proof",
          path: "runtime-proof.json",
          sha256: evidenceSha256,
        },
      ],
      artifactRoot,
      signingDirectory: directory,
    };
    const receipt = await issueControlDirectorCampaignJudgeReceipt(request);

    expect(mocks.agentCommand).toHaveBeenCalledOnce();
    expect(receipt.campaignIssuance).toMatchObject({
      purpose: "control-director-m01-m106",
      sourceSha,
      invocation: {
        judgeAgentId: "campaign-judge",
        provider: "judge-runtime",
        model: "campaign-judge:latest",
      },
      selectedModelIdentity,
      judgeModelIdentity,
    });
    const campaignPublicKeyPem = fs.readFileSync(
      path.join(directory, "judge-campaign-receipt-ed25519-public.pem"),
      "utf8",
    );
    expect(verifyJudgeReceipt(receipt, { directory })).toBe(false);
    expect(verifyJudgeReceipt(receipt, { publicKeyPem: campaignPublicKeyPem })).toBe(true);
    expect(
      verifyJudgeReceipt(
        {
          ...receipt,
          campaignIssuance: {
            ...receipt.campaignIssuance!,
            selectedModelIdentity: {
              ...receipt.campaignIssuance!.selectedModelIdentity,
              modelDigest: "0".repeat(64),
            },
          },
        },
        { publicKeyPem: campaignPublicKeyPem },
      ),
    ).toBe(false);
    expect(
      verifyJudgeReceipt(
        {
          ...receipt,
          campaignIssuance: {
            ...receipt.campaignIssuance!,
            judgeModelIdentity: {
              ...receipt.campaignIssuance!.judgeModelIdentity,
              cacheDigest: "0".repeat(64),
            },
          },
        },
        { publicKeyPem: campaignPublicKeyPem },
      ),
    ).toBe(false);
    expect(
      verifyJudgeReceipt(
        {
          ...receipt,
          campaignIssuance: {
            ...receipt.campaignIssuance!,
            configurationDigest: "4".repeat(64),
          },
        },
        { publicKeyPem: campaignPublicKeyPem },
      ),
    ).toBe(false);
    expect(fs.existsSync(path.join(artifactRoot, receipt.campaignIssuance!.transcript.path))).toBe(
      true,
    );

    mocks.agentCommand.mockResolvedValueOnce({
      payloads: [{ text: output }],
      meta: {
        finalPromptText: "prompt",
        finalAssistantRawText: output,
        stopReason: "stop",
        agentMeta: {
          provider: "ollama",
          model: "control-director:latest",
          immutableModelIdentity: judgeModelIdentity,
        },
      },
    });
    await expect(issueControlDirectorCampaignJudgeReceipt(request)).rejects.toThrow(
      "valid diverse terminal verdict",
    );

    const { selectedModelIdentity: _selectedModelIdentity, ...missingIdentityRequest } = request;
    await expect(issueControlDirectorCampaignJudgeReceipt(missingIdentityRequest)).rejects.toThrow(
      "Selected Control Director model requires immutable model and cache SHA-256 identities",
    );

    mocks.agentCommand.mockResolvedValueOnce({
      payloads: [{ text: output }],
      meta: {
        finalPromptText: "prompt",
        finalAssistantRawText: output,
        stopReason: "stop",
        agentMeta: {
          provider: "judge-runtime",
          model: "different-alias:latest",
          immutableModelIdentity: {
            modelDigest: selectedModelIdentity.modelDigest,
            cacheDigest: "8".repeat(64),
          },
        },
      },
    });
    await expect(issueControlDirectorCampaignJudgeReceipt(request)).rejects.toThrow(
      "distinct immutable model and cache identities",
    );

    mocks.agentCommand.mockResolvedValueOnce({
      payloads: [{ text: output }],
      meta: {
        finalPromptText: "prompt",
        finalAssistantRawText: output,
        stopReason: "stop",
        agentMeta: {
          provider: "judge-runtime",
          model: "different-model:latest",
          immutableModelIdentity: {
            modelDigest: "9".repeat(64),
            cacheDigest: selectedModelIdentity.cacheDigest,
          },
        },
      },
    });
    await expect(issueControlDirectorCampaignJudgeReceipt(request)).rejects.toThrow(
      "distinct immutable model and cache identities",
    );

    mocks.agentCommand.mockResolvedValueOnce({
      payloads: [{ text: output }],
      meta: {
        finalPromptText: "prompt",
        finalAssistantRawText: output,
        stopReason: "stop",
        agentMeta: {
          provider: "ollama",
          model: "independent-judge:latest",
        },
      },
    });
    const judgeManifestDigest = "a".repeat(64);
    const judgeBaseBlobDigest = "b".repeat(64);
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request) => {
        const url =
          typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
        if (url.endsWith("/api/show")) {
          return new Response(
            JSON.stringify({
              modelfile: `FROM /Users/openclaw/.ollama/models/blobs/sha256-${judgeBaseBlobDigest}`,
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          );
        }
        if (url.endsWith("/api/ps")) {
          return new Response(
            JSON.stringify({
              models: [
                {
                  name: "independent-judge:latest",
                  digest: judgeManifestDigest,
                  size: 20_000_000_000,
                  size_vram: 18_000_000_000,
                  expires_at: new Date(Date.now() + 300_000).toISOString(),
                },
              ],
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          );
        }
        return new Response("not found", { status: 404 });
      }),
    );
    const locallyAttestedReceipt = await issueControlDirectorCampaignJudgeReceipt(request);
    expect(locallyAttestedReceipt.campaignIssuance?.judgeModelIdentity).toMatchObject({
      modelDigest: expect.stringMatching(/^[a-f0-9]{64}$/u),
      cacheDigest: expect.stringMatching(/^[a-f0-9]{64}$/u),
    });
    expect(verifyJudgeReceipt(locallyAttestedReceipt, { publicKeyPem: campaignPublicKeyPem })).toBe(
      true,
    );
  });

  it("requires distinct immutable model and cache identities for trial issuance", async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "openclaw-trial-judge-"));
    directories.push(directory);
    const runtimeHome = path.join(directory, "runtime");
    const artifactRoot = path.join(directory, "artifacts");
    fs.mkdirSync(runtimeHome, { mode: 0o700 });
    fs.mkdirSync(artifactRoot, { mode: 0o700 });
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
      "EVIDENCE: exact trial evidence passed",
      "RISK: low",
      "REASON: the claim and evidence agree",
      "CONDITIONS: none",
    ].join("\n");
    const trialModelIdentity = {
      modelDigest: "a".repeat(64),
      cacheDigest: "b".repeat(64),
    };
    const judgeModelIdentity = {
      modelDigest: "c".repeat(64),
      cacheDigest: "d".repeat(64),
    };
    const evidenceContent = `${JSON.stringify({ passed: true, sourceSha })}\n`;
    const evidenceSha256 = crypto.createHash("sha256").update(evidenceContent).digest("hex");
    const request = {
      claim: {
        missionId: "control-director:model-trial-1",
        requestBody: "Judge the exact Control Director model trial.",
        finalText: "The exact model trial passed.",
        evidenceSummary: "Exact trial evidence passed.",
        artifactIds: ["trial-evidence"],
      },
      campaignNonce: "3".repeat(64),
      trialId: "trial-1",
      trialModelRef: "ollama/control-director:latest",
      trialModelIdentity,
      sourceSha,
      rollbackSha,
      activeReleaseId: "active-release",
      rollbackReleaseId: "rollback-release",
      leaseOwner: "lease-owner",
      approvalId: "approval-id",
      operationId: "operation-id",
      invocationId: "invocation-id",
      measurementReceiptSha256: "4".repeat(64),
      measurementSetSha256: "5".repeat(64),
      evidenceSetSha256: "6".repeat(64),
      measurementSources: [
        {
          metric: "quality",
          evidenceRef: "trial-evidence",
          artifactSha256: evidenceSha256,
          jsonPointer: "/passed",
          valueSha256: "7".repeat(64),
        },
      ],
      evidenceArtifacts: [
        {
          evidenceRef: "trial-evidence",
          path: "trial-evidence.json",
          sha256: evidenceSha256,
          content: evidenceContent,
        },
      ],
      artifactRoot,
      signingDirectory: directory,
    };
    const resultWithIdentity = (identity: { modelDigest: string; cacheDigest: string } | null) => ({
      payloads: [{ text: output }],
      meta: {
        finalPromptText: "prompt",
        finalAssistantRawText: output,
        stopReason: "stop",
        agentMeta: {
          provider: "judge-runtime",
          model: "trial-judge:latest",
          ...(identity ? { immutableModelIdentity: identity } : {}),
        },
      },
    });

    mocks.agentCommand.mockResolvedValueOnce(resultWithIdentity(judgeModelIdentity));
    const receipt = await issueControlDirectorModelTrialJudgeReceipt(request);
    expect(receipt.trialIssuance).toMatchObject({
      trialModelRef: request.trialModelRef,
      trialModelIdentity,
      judgeModelIdentity,
    });

    const { trialModelIdentity: _trialModelIdentity, ...missingSelectedIdentityRequest } = request;
    await expect(
      issueControlDirectorModelTrialJudgeReceipt(missingSelectedIdentityRequest),
    ).rejects.toThrow(
      "Selected Control Director trial model requires immutable model and cache SHA-256 identities",
    );

    mocks.agentCommand.mockResolvedValueOnce(resultWithIdentity(null));
    await expect(issueControlDirectorModelTrialJudgeReceipt(request)).rejects.toThrow(
      "Independent trial Judge requires immutable model and cache SHA-256 identities",
    );

    mocks.agentCommand.mockResolvedValueOnce(
      resultWithIdentity({
        modelDigest: trialModelIdentity.modelDigest,
        cacheDigest: "e".repeat(64),
      }),
    );
    await expect(issueControlDirectorModelTrialJudgeReceipt(request)).rejects.toThrow(
      "distinct immutable model and cache identities",
    );

    mocks.agentCommand.mockResolvedValueOnce(
      resultWithIdentity({
        modelDigest: "f".repeat(64),
        cacheDigest: trialModelIdentity.cacheDigest,
      }),
    );
    await expect(issueControlDirectorModelTrialJudgeReceipt(request)).rejects.toThrow(
      "distinct immutable model and cache identities",
    );
  });
});
