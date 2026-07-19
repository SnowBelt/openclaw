import { describe, expect, it } from "vitest";
import type { PccPermissionGrant } from "../../packages/gateway-protocol/src/schema/types.js";
import {
  consumeExecutionApprovalEnvelope,
  createExecutionApprovalEnvelope,
  evaluateExecutionApprovalEnvelope,
  executionApprovalFromPccPermission,
  parseExecutionApprovalEnvelope,
  revokeExecutionApprovalEnvelope,
} from "./execution-approval-envelope.js";

describe("unified execution approval envelope", () => {
  it("binds actor, action, resource, expiry, and every budget fail-closed", () => {
    const envelope = createExecutionApprovalEnvelope({
      approvalId: "approval-1",
      subjectActorId: "program-manager",
      grantedBy: "user",
      action: "use_codex",
      resource: { kind: "project", id: "project-1" },
      risk: "high",
      maxUses: 2,
      maxTokens: 5_000,
      maxCostMilliUsd: 200,
      issuedAt: 100,
      expiresAt: 1_000,
    });
    const request = {
      actorId: "program-manager",
      action: "use_codex" as const,
      resource: { kind: "project" as const, id: "project-1" },
      tokenCount: 2_000,
      costMilliUsd: 50,
      now: 500,
    };

    expect(evaluateExecutionApprovalEnvelope(envelope, request)).toEqual({
      allowed: true,
      code: "approved",
    });
    expect(
      evaluateExecutionApprovalEnvelope(envelope, { ...request, actorId: "other" }),
    ).toMatchObject({ allowed: false, code: "actor_mismatch" });
    expect(evaluateExecutionApprovalEnvelope(envelope, { ...request, now: 1_000 })).toMatchObject({
      allowed: false,
      code: "expired",
    });

    const first = consumeExecutionApprovalEnvelope({ envelope, request });
    const second = consumeExecutionApprovalEnvelope({ envelope: first.envelope, request });
    expect(second.envelope.budget).toMatchObject({
      usedCount: 2,
      usedTokens: 4_000,
      usedCostMilliUsd: 100,
    });
    expect(
      consumeExecutionApprovalEnvelope({ envelope: second.envelope, request }).decision,
    ).toMatchObject({ allowed: false, code: "use_budget_exhausted" });
  });

  it("records sticky revocation and rejects malformed persisted state", () => {
    const envelope = createExecutionApprovalEnvelope({
      subjectActorId: "worker",
      grantedBy: "user",
      action: "mutate_workspace",
      resource: { kind: "workspace", id: "workspace-1" },
      risk: "medium",
      issuedAt: 100,
    });
    const revoked = revokeExecutionApprovalEnvelope({
      envelope,
      revokedBy: "user",
      reason: "Scope changed",
      now: 200,
    });
    expect(parseExecutionApprovalEnvelope(revoked)).toEqual(revoked);
    expect(
      evaluateExecutionApprovalEnvelope(revoked, {
        actorId: "worker",
        action: "mutate_workspace",
        resource: { kind: "workspace", id: "workspace-1" },
        now: 300,
      }),
    ).toMatchObject({ allowed: false, code: "revoked" });
    expect(parseExecutionApprovalEnvelope({ ...revoked, budget: { maxUses: -1 } })).toBeNull();
  });

  it("adapts PCC grants without losing risk, budget, expiry, or audit", () => {
    const permission: PccPermissionGrant = {
      id: "permission-codex",
      projectId: "project-1",
      type: "codex_usage",
      status: "granted",
      riskLevel: "high",
      allowedActions: ["review"],
      usedCount: 0,
      maxUses: 3,
      tokenBudget: 8_000,
      costBudget: 0.25,
      grantedBy: "user",
      grantedAt: "2026-07-18T00:00:00.000Z",
      expiresAt: "2026-07-19T00:00:00.000Z",
      auditLog: [{ at: "2026-07-18T00:00:00.000Z", status: "granted", note: "Approved review" }],
      createdAt: "2026-07-18T00:00:00.000Z",
      updatedAt: "2026-07-18T00:00:00.000Z",
    };
    expect(
      executionApprovalFromPccPermission({ permission, subjectActorId: "director" }),
    ).toMatchObject({
      approvalId: "permission-codex",
      subjectActorId: "director",
      action: "use_codex",
      resource: { kind: "project", id: "project-1" },
      risk: "high",
      budget: { maxUses: 3, maxTokens: 8_000, maxCostMilliUsd: 250 },
      status: "active",
    });
  });
});
