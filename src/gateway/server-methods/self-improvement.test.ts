import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildControlDirectorJudgeClaimHash } from "../../agents/control-director-contract.js";
import { signJudgeReceipt } from "../../agents/judge-receipt-signer.js";
import { onInternalDiagnosticEvent } from "../../infra/diagnostic-events.js";
import {
  appendSelfImprovementAuditEvent,
  listSelfImprovementAuditEvents,
} from "../../self-improvement/audit-events.js";
import { upsertSelfImprovementProposals } from "../../self-improvement/proposals.js";
import { upsertSelfImprovementRecommendations } from "../../self-improvement/store.js";
import type {
  SelfImprovementCurationReview,
  SelfImprovementProposal,
  SelfImprovementRecommendation,
} from "../../self-improvement/types.js";
import { selfImprovementHandlers } from "./self-improvement.js";
import type { GatewayRequestHandler } from "./types.js";

const now = Date.parse("2026-06-06T12:00:00.000Z");
const originalStateDir = process.env.OPENCLAW_STATE_DIR;
let tmpDir: string;

function recommendation(
  overrides: Partial<SelfImprovementRecommendation> = {},
): SelfImprovementRecommendation {
  return {
    id: overrides.id ?? "sir_gateway",
    fingerprint: overrides.fingerprint ?? "fingerprint",
    createdAt: now - 60_000,
    updatedAt: now - 30_000,
    lastSeenAt: now,
    status: "open",
    title: "Dashboard smoke needs proof",
    summary: "The dashboard smoke failed.",
    category: "smoke_failure",
    severity: "high",
    criticality: "high",
    priority: "high",
    impact: "high",
    effort: "medium",
    confidence: 0.8,
    groupKey: "smoke_failure:task_group:dashboard",
    groupTitle: "Dashboard smoke failures",
    recurrenceCount: 1,
    source: { kind: "task", label: "dashboard smoke", taskId: "task-1" },
    route: {
      role: "qa",
      targetAgentId: "qa-test-agent",
      targetAgentLabel: "QA Test Agent",
      reason: "Verification gap.",
    },
    recommendedAction: "Rerun the dashboard smoke.",
    requiredEvidence: ["Rerun the dashboard smoke."],
    safety: {
      mode: "recommendation_only",
      mutationAllowed: false,
      requiresApproval: true,
      requiresTests: true,
      blockedActions: ["no direct merge, push, or release"],
    },
    analysis: {
      mode: "deterministic",
      summary: "Evidence-bound recommendation analysis.",
      generatedAt: now,
      confidence: 0.8,
      promptVersion: "self-improvement-deterministic-v1",
      evidenceCount: 1,
      safetyNotes: ["Recommendation-only."],
    },
    evidence: ["Task task-1 status: failed"],
    ...overrides,
  };
}

function proposal(overrides: Partial<SelfImprovementProposal> = {}): SelfImprovementProposal {
  return {
    id: "sip_memory",
    createdAt: now - 60_000,
    updatedAt: now - 60_000,
    status: "pending",
    kind: "memory_skill",
    groupId: "sig_memory",
    groupKey: "knowledge_hygiene:knowledge:memory",
    title: "Pending memory/skill proposal",
    summary: "Capture a repeated correction as a pending skill proposal.",
    route: {
      role: "memory_curator",
      targetAgentId: "memory-knowledge-curator",
      targetAgentLabel: "Memory/Knowledge Curator",
      reason: "Memory and skill curation.",
    },
    sourceRecommendationIds: ["sir_gateway"],
    recommendedAction: "Draft a pending Skill Workshop proposal.",
    requiredEvidence: ["Show the repeated correction source and workshop pending record."],
    safetyNotes: ["No uncontrolled memory or skill writes."],
    approvalRequired: true,
    testsRequired: false,
    analysisMode: "deterministic",
    ...overrides,
  };
}

function curationReview(
  overrides: Partial<SelfImprovementCurationReview> = {},
): SelfImprovementCurationReview {
  return {
    evidence: [{ sourceClass: "instruction", sourceRef: "test-source" }],
    confidence: "high",
    freshness: "current",
    privacy: "shared_safe",
    contradiction: false,
    reason: "Evidence is current and bounded.",
    nextAction: "Keep the workshop draft pending operator approval.",
    reviewedAt: now,
    ...overrides,
  };
}

async function callSelfImprovementHandler(
  method: string,
  params: Record<string, unknown>,
  config: Record<string, unknown> = {},
) {
  const handler = selfImprovementHandlers[method] as GatewayRequestHandler | undefined;
  if (!handler) {
    throw new Error(`missing handler ${method}`);
  }
  let response:
    | {
        ok: boolean;
        payload?: unknown;
        error?: { message?: string };
      }
    | undefined;
  await handler({
    req: { type: "req", id: "test", method, params },
    params,
    client: null,
    isWebchatConnect: () => false,
    respond: (ok, payload, error) => {
      response = { ok, payload, error };
    },
    context: { getRuntimeConfig: () => config } as never,
  });
  if (!response) {
    throw new Error(`handler ${method} did not respond`);
  }
  return response;
}

describe("selfImprovement server methods", () => {
  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-self-improvement-gateway-"));
    process.env.OPENCLAW_STATE_DIR = tmpDir;
  });

  afterEach(async () => {
    if (originalStateDir === undefined) {
      delete process.env.OPENCLAW_STATE_DIR;
    } else {
      process.env.OPENCLAW_STATE_DIR = originalStateDir;
    }
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("records only explicit dashboard interventions as proof-bound prevention work", async () => {
    const response = await callSelfImprovementHandler(
      "selfImprovement.dashboardInterventions.record",
      {
        title: "Stale dashboard indicator",
        issue: "An operator observed stale dashboard status.",
        correctiveIntervention: "The operator refreshed the dashboard and checked the live status.",
        evidence: ["Operator session evidence."],
      },
    );

    expect(response.ok).toBe(true);
    expect(response.payload).toMatchObject({ created: true, reopened: false });
    const events = await listSelfImprovementAuditEvents({ stateDir: tmpDir });
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ kind: "dashboard_intervention_recorded" });
  });

  it("converts only coherent Control Director layout measurements into trusted SIG evidence", async () => {
    const events: Array<{ errorCode?: string; observed?: string }> = [];
    const stop = onInternalDiagnosticEvent((event, metadata) => {
      if (
        metadata.trusted &&
        event.type === "improvement.signal" &&
        event.errorCode === "layout_obstruction"
      ) {
        events.push(event);
      }
    });
    const params = {
      schemaVersion: 1,
      sessionKey: "agent:director:dashboard:layout",
      observationId: "layout-server-1",
      observedAt: Date.now(),
      viewport: { width: 390, height: 844 },
      transcript: {
        visible: true,
        rect: { top: 48, right: 390, bottom: 700, left: 0, width: 390, height: 652 },
      },
      composer: {
        visible: true,
        rect: { top: 620, right: 390, bottom: 844, left: 0, width: 390, height: 224 },
      },
      truthCompletionPresent: false,
      pccProjectionPresent: false,
      reason: "transcript_composer_overlap",
    };
    const config = {
      agents: { list: [{ id: "director", role: "control_director" }] },
    };
    try {
      const accepted = await callSelfImprovementHandler(
        "selfImprovement.controlDirector.layout.report",
        params,
        config,
      );
      expect(accepted).toMatchObject({
        ok: true,
        payload: { accepted: true, signalCode: "layout_obstruction" },
      });
      await vi.waitFor(() => expect(events).toHaveLength(1));
      expect(events[0]).toMatchObject({
        errorCode: "layout_obstruction",
      });
      expect(events[0]?.observed).toContain("transcriptBottom=700");

      const rejected = await callSelfImprovementHandler(
        "selfImprovement.controlDirector.layout.report",
        { ...params, observationId: "layout-server-2", reason: "composer_hidden" },
        config,
      );
      expect(rejected.ok).toBe(false);
      expect(rejected.error?.message).toContain("does not match");
      expect(events).toHaveLength(1);
    } finally {
      stop();
    }
  });

  it("blocks proof-required recommendation resolution without proof", async () => {
    await upsertSelfImprovementRecommendations({
      stateDir: tmpDir,
      recommendations: [recommendation()],
    });

    const response = await callSelfImprovementHandler("selfImprovement.recommendations.update", {
      id: "sir_gateway",
      status: "resolved",
    });

    expect(response.ok).toBe(false);
    expect(response.error?.message).toContain("resolution proof is required");
  });

  it("records and lists outcome proof receipts through proof-gated RPC methods", async () => {
    await upsertSelfImprovementRecommendations({
      stateDir: tmpDir,
      recommendations: [
        recommendation({
          source: { kind: "workflow", label: "signal", runId: "signal:sis_gateway" },
          outcomeProofRequired: true,
          assignedTargetAgentId: "qa-test-agent",
        }),
      ],
    });

    const recorded = await callSelfImprovementHandler("selfImprovement.proofReceipts.record", {
      recommendationId: "sir_gateway",
      signalId: "sis_gateway",
      diagnosis: "The dashboard smoke failed before the correction.",
      action: "Apply the correction and run a bounded holdout.",
      metric: {
        name: "dashboard smoke pass rate",
        baseline: "0",
        target: "1",
        observed: "1",
        unit: "ratio",
        passed: true,
      },
      observation: { startedAt: now, endedAt: now + 60_000, minimumDurationMs: 60_000 },
      holdout: { required: true, passed: true },
      evidenceRefs: ["work/self-improvement/dashboard-smoke.json"],
    });

    expect(recorded.ok).toBe(true);
    expect(recorded.payload).toMatchObject({
      receipt: { outcomeConfirmed: true, status: "passed" },
      recommendation: {
        proofOutcomeState: "confirmed",
        actionability: { proofState: "attached", closureState: "ready_to_resolve" },
      },
    });
    const listed = await callSelfImprovementHandler("selfImprovement.proofReceipts.list", {
      recommendationId: "sir_gateway",
    });
    expect(listed).toMatchObject({
      ok: true,
      payload: { total: 1, receipts: [{ recommendationId: "sir_gateway" }] },
    });
  });

  it("fails closed and then resolves a Control Director journey with exact proof and Judge binding", async () => {
    await upsertSelfImprovementRecommendations({
      stateDir: tmpDir,
      recommendations: [
        recommendation({
          source: {
            kind: "workflow",
            label: "Control Director delivery signal",
            runId: "signal:sis_control_director_delivery",
            signalCode: "delivery_miss",
          },
          outcomeProofRequired: true,
          assignedTargetAgentId: "qa-test-agent",
          recurrenceCount: 1,
        }),
      ],
    });

    const recorded = await callSelfImprovementHandler("selfImprovement.proofReceipts.record", {
      recommendationId: "sir_gateway",
      signalId: "sis_control_director_delivery",
      diagnosis: "The terminal update was not delivered.",
      action: "Repair bounded terminal delivery and observe the exact journey.",
      metric: {
        name: "delivery misses",
        target: "0",
        observed: "0",
        passed: true,
      },
      observation: { startedAt: now, endedAt: now + 60_000, minimumDurationMs: 60_000 },
      evidenceRefs: ["flow:delivery-proof"],
    });
    expect(recorded.ok).toBe(true);
    const proofReceipt = (recorded.payload as { receipt: { id: string } }).receipt;

    const missingClosure = await callSelfImprovementHandler(
      "selfImprovement.recommendations.update",
      { id: "sir_gateway", status: "resolved" },
    );
    expect(missingClosure.ok).toBe(false);
    expect(missingClosure.error?.message).toContain("typed closure evidence");

    const missionId = "sig:sir_gateway";
    const requestBody = "delivery_miss must remain at or below 0 recurrences.";
    const finalText = "Observed 0 recurrences for qa-test-agent.";
    const evidenceSummary = `Proof receipt ${proofReceipt.id}; observation ${now}-${now + 60_000}.`;
    const judgeReceipt = signJudgeReceipt(
      {
        schemaVersion: 1 as const,
        receiptId: "judge-control-director-closure",
        missionId,
        claimHash: buildControlDirectorJudgeClaimHash({
          missionId,
          requestBody,
          finalText,
          evidenceSummary,
          artifactIds: [proofReceipt.id],
        }),
        verdict: "APPROVE" as const,
        scope: "exact Control Director journey closure",
        evidenceSummary,
        conditions: "none",
        judgeRunId: "judge-run-control-director-closure",
        judgeAgentId: "independent-judge",
        issuedAt: now + 60_000,
      },
      { directory: path.join(tmpDir, "credentials") },
    );
    const resolved = await callSelfImprovementHandler("selfImprovement.recommendations.update", {
      id: "sir_gateway",
      status: "resolved",
      controlDirectorClosure: {
        signalCode: "delivery_miss",
        owner: "qa-test-agent",
        slaAt: now + 120_000,
        observation: { startedAt: now, endedAt: now + 60_000, minimumDurationMs: 60_000 },
        recurrenceCount: 0,
        targetRecurrenceCount: 0,
        proofReceiptId: proofReceipt.id,
        judgeReceipt,
      },
    });

    expect(resolved.ok).toBe(true);
    expect(resolved.payload).toMatchObject({
      recommendation: {
        status: "resolved",
        controlDirectorClosure: {
          status: "closed",
          signalCode: "delivery_miss",
          proofReceiptId: proofReceipt.id,
        },
      },
      controlDirectorClosure: { judgeReceiptId: "judge-control-director-closure" },
    });
  });

  it("requires dismissal reasons for recommendation closure", async () => {
    await upsertSelfImprovementRecommendations({
      stateDir: tmpDir,
      recommendations: [recommendation()],
    });

    const response = await callSelfImprovementHandler("selfImprovement.recommendations.update", {
      id: "sir_gateway",
      status: "dismissed",
    });

    expect(response.ok).toBe(false);
    expect(response.error?.message).toContain("dismissal reason is required");
  });

  it("returns actionability and sanitized audit metadata after proof updates", async () => {
    const proof = "pnpm test src/self-improvement/actionability.test.ts passed";
    await upsertSelfImprovementRecommendations({
      stateDir: tmpDir,
      recommendations: [recommendation()],
    });

    const response = await callSelfImprovementHandler("selfImprovement.recommendations.update", {
      id: "sir_gateway",
      status: "resolved",
      assignedTargetAgentId: "qa-test-agent",
      resolutionProof: proof,
    });

    expect(response.ok).toBe(true);
    expect(response.payload).toMatchObject({
      recommendation: {
        id: "sir_gateway",
        status: "resolved",
        actionability: {
          proofState: "attached",
          closureState: "closed",
        },
      },
    });
    const [audit] = await listSelfImprovementAuditEvents({
      stateDir: tmpDir,
      kind: "recommendation_status_updated",
    });
    expect(audit?.metadata).toMatchObject({
      status: "resolved",
      route: "qa",
      assignedTargetAgentId: "qa-test-agent",
      proofPresent: true,
    });
    expect(JSON.stringify(audit)).not.toContain(proof);
  });

  it("allows group resolution when existing proof is already attached", async () => {
    await upsertSelfImprovementRecommendations({
      stateDir: tmpDir,
      recommendations: [
        recommendation({
          status: "assigned",
          assignedTargetAgentId: "qa-test-agent",
          resolutionProof: "pnpm test src/self-improvement/summary.test.ts passed",
        }),
      ],
    });

    const response = await callSelfImprovementHandler("selfImprovement.groups.update", {
      id: "smoke_failure:task_group:dashboard",
      status: "resolved",
    });

    expect(response.ok).toBe(true);
    expect(response.payload).toMatchObject({
      group: {
        status: "resolved",
        actionability: {
          closureState: "closed",
        },
      },
    });
  });

  it("lists memory/skill curator proposals by curator status", async () => {
    await upsertSelfImprovementProposals({
      stateDir: tmpDir,
      proposals: [
        proposal(),
        proposal({
          id: "sip_builder",
          kind: "implementation",
          route: {
            role: "builder",
            targetAgentId: "builder-agent",
            targetAgentLabel: "Builder Agent",
            reason: "Implementation proposal.",
          },
        }),
      ],
    });

    const response = await callSelfImprovementHandler("selfImprovement.curator.list", {
      status: "pending_review",
    });

    expect(response.ok).toBe(true);
    expect(response.payload).toMatchObject({
      proposals: [{ id: "sip_memory", curatorStatus: "pending_review", kind: "memory_skill" }],
      total: 1,
    });
  });

  it("requires proof before accepting memory/skill curator proposals", async () => {
    await upsertSelfImprovementProposals({
      stateDir: tmpDir,
      proposals: [proposal()],
    });

    const response = await callSelfImprovementHandler("selfImprovement.curator.update", {
      id: "sip_memory",
      curatorStatus: "accepted_for_workshop",
    });

    expect(response.ok).toBe(false);
    expect(response.error?.message).toContain("curator proof is required");
  });

  it("requires structured review after proof before workshop acceptance", async () => {
    await upsertSelfImprovementProposals({
      stateDir: tmpDir,
      proposals: [proposal()],
    });

    const response = await callSelfImprovementHandler("selfImprovement.curator.update", {
      id: "sip_memory",
      curatorStatus: "accepted_for_workshop",
      proof: "Proof without structured review.",
    });

    expect(response.ok).toBe(false);
    expect(response.error?.message).toContain("structured provenance");
  });

  it("updates curator status with workshop linkage and sanitized audit metadata", async () => {
    const proof = "Reviewed against Skill Workshop pending-mode rules.";
    await upsertSelfImprovementProposals({
      stateDir: tmpDir,
      proposals: [proposal()],
    });

    const response = await callSelfImprovementHandler("selfImprovement.curator.update", {
      id: "sip_memory",
      curatorStatus: "accepted_for_workshop",
      proof,
      curationReview: curationReview(),
      workshopProposalId: "swp_memory_1",
      workshopProposalStatus: "pending",
    });

    expect(response.ok).toBe(true);
    expect(response.payload).toMatchObject({
      proposal: {
        id: "sip_memory",
        curatorStatus: "accepted_for_workshop",
        curatorProof: proof,
        curationReview: curationReview(),
        workshopProposalId: "swp_memory_1",
      },
    });
    const [audit] = await listSelfImprovementAuditEvents({
      stateDir: tmpDir,
      kind: "curator_status_updated",
    });
    expect(audit?.metadata).toMatchObject({
      curatorStatus: "accepted_for_workshop",
      proposalKind: "memory_skill",
      route: "memory_curator",
      proofPresent: true,
      workshopProposalId: "swp_memory_1",
      workshopProposalStatus: "pending",
    });
    expect(JSON.stringify(audit)).not.toContain(proof);
  });

  it("blocks promotion through quarantined workshop proposals", async () => {
    await upsertSelfImprovementProposals({
      stateDir: tmpDir,
      proposals: [
        proposal({
          curatorStatus: "accepted_for_workshop",
          curatorProof: "Accepted after review.",
          curationReview: curationReview(),
          workshopProposalId: "swp_memory_1",
          workshopProposalStatus: "quarantined",
        }),
      ],
    });

    const response = await callSelfImprovementHandler("selfImprovement.curator.update", {
      id: "sip_memory",
      curatorStatus: "promoted",
      proof: "Promotion evidence.",
    });

    expect(response.ok).toBe(false);
    expect(response.error?.message).toContain("applied Skill Workshop proposal link");
  });

  it("rejects stale or privacy-blocked structured reviews before workshop acceptance", async () => {
    await upsertSelfImprovementProposals({
      stateDir: tmpDir,
      proposals: [proposal()],
    });

    const stale = await callSelfImprovementHandler("selfImprovement.curator.update", {
      id: "sip_memory",
      curatorStatus: "accepted_for_workshop",
      proof: "Stale review proof.",
      curationReview: curationReview({ freshness: "stale_risk" }),
    });
    expect(stale.ok).toBe(false);
    expect(stale.error?.message).toContain("stale-risk");

    const blocked = await callSelfImprovementHandler("selfImprovement.curator.update", {
      id: "sip_memory",
      curatorStatus: "accepted_for_workshop",
      proof: "Sensitive review proof.",
      curationReview: curationReview({ privacy: "blocked_sensitive" }),
    });
    expect(blocked.ok).toBe(false);
    expect(blocked.error?.message).toContain("sensitive evidence");
  });

  it("requires an applied workshop proposal before promotion", async () => {
    await upsertSelfImprovementProposals({
      stateDir: tmpDir,
      proposals: [
        proposal({
          curatorStatus: "accepted_for_workshop",
          curatorProof: "Accepted after review.",
          curationReview: curationReview(),
          workshopProposalId: "swp_memory_1",
          workshopProposalStatus: "pending",
        }),
      ],
    });

    const response = await callSelfImprovementHandler("selfImprovement.curator.update", {
      id: "sip_memory",
      curatorStatus: "promoted",
      proof: "Promotion evidence.",
    });

    expect(response.ok).toBe(false);
    expect(response.error?.message).toContain("applied Skill Workshop proposal link");
  });

  it("returns production-check readiness without mutating recommendations", async () => {
    await appendSelfImprovementAuditEvent({
      stateDir: tmpDir,
      event: {
        createdAt: now,
        actor: "governor",
        kind: "background_cycle",
        targetId: "self-improvement-background",
        summary: "Completed Self-Improvement background cycle.",
        metadata: { success: true },
      },
    });

    const response = await callSelfImprovementHandler("selfImprovement.productionCheck", {
      requireModelReady: true,
    });

    expect(response.ok).toBe(true);
    expect(response.payload).toMatchObject({
      status: "blocked",
      ready: false,
      requireModelReady: true,
      blockers: expect.arrayContaining([
        "Model readiness proof is required, but no model preflight event exists.",
      ]),
    });
  });

  it("runs retention maintenance apply through sanitized Gateway metadata", async () => {
    await upsertSelfImprovementRecommendations({
      stateDir: tmpDir,
      recommendations: [
        recommendation({
          id: "sir_old_closed",
          fingerprint: "old-closed",
          status: "resolved",
          updatedAt: now - 120 * 24 * 60 * 60_000,
          lastSeenAt: now - 120 * 24 * 60 * 60_000,
          resolutionProof: "token=secret-value",
        }),
      ],
    });

    const response = await callSelfImprovementHandler("selfImprovement.maintenance.run", {
      apply: true,
    });

    expect(response.ok).toBe(true);
    expect(response.payload).toMatchObject({
      applied: true,
      dryRun: false,
      stores: expect.arrayContaining([
        expect.objectContaining({
          store: "recommendations",
          pruned: 1,
        }),
      ]),
    });
    const [audit] = await listSelfImprovementAuditEvents({
      stateDir: tmpDir,
      kind: "retention_maintenance",
    });
    expect(audit?.metadata).toMatchObject({
      totalPruned: expect.any(Number),
    });
    expect(JSON.stringify(audit)).not.toContain("secret-value");
    expect(JSON.stringify(audit)).not.toContain("token=");
  });
});
