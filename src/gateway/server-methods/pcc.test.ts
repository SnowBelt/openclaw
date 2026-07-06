import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { pccHandlers, pccTesting } from "./pcc.js";
import type { GatewayRequestHandlerOptions } from "./types.js";

type RespondCall = [boolean, unknown?, unknown?];

let root: string;
let previousStateDir: string | undefined;

function makeOptions(
  method: string,
  params: Record<string, unknown>,
  respond: ReturnType<typeof vi.fn>,
): GatewayRequestHandlerOptions {
  return {
    req: { type: "req", id: `${method}-1`, method, params },
    params,
    client: null,
    isWebchatConnect: () => false,
    respond: respond as unknown as GatewayRequestHandlerOptions["respond"],
    context: {} as GatewayRequestHandlerOptions["context"],
  };
}

async function invoke(
  method: keyof typeof pccHandlers,
  params: Record<string, unknown>,
): Promise<RespondCall> {
  const respond = vi.fn();
  const handler = pccHandlers[method];
  expect(handler).toBeTruthy();
  await handler(makeOptions(method, params, respond));
  expect(respond).toHaveBeenCalledTimes(1);
  return respond.mock.calls[0] as RespondCall;
}

function okPayload<T extends Record<string, unknown>>(call: RespondCall, _shape?: T): T {
  void _shape;
  expect(call[0]).toBe(true);
  expect(call[2]).toBeUndefined();
  return call[1] as T;
}

function errorMessage(call: RespondCall): string {
  expect(call[0]).toBe(false);
  const error = call[2] as { message?: string };
  return error.message ?? "";
}

describe("Project Command Center gateway methods", () => {
  beforeEach(() => {
    previousStateDir = process.env.OPENCLAW_STATE_DIR;
    root = fs.mkdtempSync(path.join(os.tmpdir(), "openclaw-pcc-"));
    process.env.OPENCLAW_STATE_DIR = root;
  });

  afterEach(() => {
    if (previousStateDir === undefined) {
      delete process.env.OPENCLAW_STATE_DIR;
    } else {
      process.env.OPENCLAW_STATE_DIR = previousStateDir;
    }
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("stores projects and milestones with deterministic summaries", async () => {
    const projectPayload = okPayload<{
      project: { id: string };
      summary: { percentComplete: number };
    }>(
      await invoke("pcc.projects.upsert", {
        project: {
          title: "Project Command Center",
          status: "active",
          phases: [{ id: "foundation", title: "Foundation", status: "active" }],
          metadata: { dueDate: "2099-01-15T00:00:00.000Z" },
        },
      }),
    );

    expect(projectPayload.summary.percentComplete).toBe(0);
    const projectId = projectPayload.project.id;

    const milestonePayload = okPayload<{
      milestone: { id: string };
      summary: { percentComplete: number; milestoneCounts: { total: number } };
    }>(
      await invoke("pcc.milestones.upsert", {
        milestone: {
          projectId,
          title: "Durable ledger foundation",
          status: "in_progress",
          phaseId: "foundation",
          implementationPlan: "Add schemas, persistence, summaries, and tests.",
          acceptanceCriteria: ["project API works", "receipt API marks completion"],
        },
      }),
    );

    expect(milestonePayload.summary.percentComplete).toBe(40);
    expect(milestonePayload.summary.milestoneCounts.total).toBe(1);
    expect(fs.existsSync(pccTesting.ledgerPath())).toBe(true);

    const listPayload = okPayload<{ projects: Array<{ id: string; percentComplete: number }> }>(
      await invoke("pcc.projects.list", {}),
    );
    expect(listPayload.projects[0]).toMatchObject({
      health: "On track",
      dueDate: "2099-01-15T00:00:00.000Z",
      recentActivity: expect.stringContaining("Milestone updated: Durable ledger foundation"),
    });
    expect(listPayload.projects).toEqual([
      {
        id: projectId,
        title: "Project Command Center",
        status: "active",
        percentComplete: 40,
        milestoneCounts: expect.any(Object),
        nextActions: expect.any(Array),
        proofGaps: [],
        health: "On track",
        dueDate: "2099-01-15T00:00:00.000Z",
        recentActivity: expect.any(String),
        updatedAt: expect.any(String),
      },
    ]);

    expect(milestonePayload.milestone.id).toMatch(/^milestone-/);
  });

  it("canonicalizes future project work item metadata at gateway write time", async () => {
    const { project } = okPayload<{ project: { id: string } }>(
      await invoke("pcc.projects.upsert", { project: { title: "Future setup project" } }),
    );

    const milestonePayload = okPayload<{
      milestone: {
        id: string;
        implementationPlan?: string;
        acceptanceCriteria?: string[];
        metadata?: Record<string, unknown>;
      };
    }>(
      await invoke("pcc.milestones.upsert", {
        milestone: {
          projectId: project.id,
          title: "Legacy worker milestone",
          status: "not_started",
          metadata: { recommendedWorker: "local model/OpenClaw", proofRequired: "local_test" },
        },
      }),
    );

    expect(milestonePayload.milestone.metadata).toMatchObject({
      recommendedWorker: "local model/OpenClaw",
      pccResponsibility: "local_model",
      pccProofLevel: "local",
      pccCanonicalizedAt: expect.any(String),
    });
    expect(milestonePayload.milestone.implementationPlan).toContain("Legacy worker milestone");
    expect(milestonePayload.milestone.acceptanceCriteria?.length).toBeGreaterThan(0);

    const subPayload = okPayload<{
      subMilestone: {
        implementationPlan?: string;
        acceptanceCriteria?: string[];
        metadata?: Record<string, unknown>;
      };
    }>(
      await invoke("pcc.subMilestones.upsert", {
        subMilestone: {
          projectId: project.id,
          milestoneId: milestonePayload.milestone.id,
          title: "Legacy worker sub-step",
          status: "not_started",
          metadata: { recommendedWorker: "High reasoning Codex", proofRequired: "manual_review" },
        },
      }),
    );

    expect(subPayload.subMilestone.metadata).toMatchObject({
      pccResponsibility: "high_reasoning_codex",
      pccProofLevel: "manual_review",
      pccCanonicalizedAt: expect.any(String),
    });
    expect(subPayload.subMilestone.implementationPlan).toContain("Legacy worker sub-step");
    expect(subPayload.subMilestone.acceptanceCriteria?.length).toBeGreaterThan(0);
  });

  it("includes PCC focus scope metadata in project summaries", async () => {
    const { project } = okPayload<{ project: { id: string } }>(
      await invoke("pcc.projects.upsert", {
        project: {
          title: "Project-specific Work",
          metadata: {
            excludedFromPccProductCompletion: true,
            pccCurrentScope: "active_project_work",
            pccProductScope: "excluded_from_pcc_product_completion",
            pccWorkflowTemplateId: "snes-studio",
          },
        },
      }),
    );

    const listPayload = okPayload<{
      projects: Array<{
        id: string;
        excludedFromPccProductCompletion?: boolean;
        pccCurrentScope?: string;
        pccProductScope?: string;
        workflowTemplateId?: string;
      }>;
    }>(await invoke("pcc.projects.list", {}));

    expect(listPayload.projects.find((item) => item.id === project.id)).toMatchObject({
      excludedFromPccProductCompletion: true,
      pccCurrentScope: "active_project_work",
      pccProductScope: "excluded_from_pcc_product_completion",
      workflowTemplateId: "snes-studio",
    });
  });

  it("repairs legacy active ledger work items without touching archived projects", async () => {
    const { project } = okPayload<{ project: { id: string } }>(
      await invoke("pcc.projects.upsert", {
        project: { title: "Repairable project", status: "on_hold" },
      }),
    );
    const { project: archivedProject } = okPayload<{ project: { id: string } }>(
      await invoke("pcc.projects.upsert", {
        project: { title: "Archived project", status: "archived" },
      }),
    );
    const ledgerPath = pccTesting.ledgerPath();
    const ledger = JSON.parse(fs.readFileSync(ledgerPath, "utf8")) as {
      milestones: Array<Record<string, unknown>>;
      subMilestones: Array<Record<string, unknown>>;
      receipts: Array<Record<string, unknown>>;
    };
    ledger.milestones.push({
      id: "legacy-active-milestone",
      projectId: project.id,
      title: "Legacy active milestone",
      status: "on_hold",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
      metadata: { recommendedWorker: "OpenClaw local agent" },
    });
    ledger.subMilestones.push({
      id: "legacy-active-sub",
      projectId: project.id,
      milestoneId: "legacy-active-milestone",
      title: "Legacy active sub",
      status: "on_hold",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
      metadata: { recommendedWorker: "Codex" },
    });
    ledger.milestones.push({
      id: "legacy-archived-milestone",
      projectId: archivedProject.id,
      title: "Legacy archived milestone",
      status: "not_started",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
      metadata: { recommendedWorker: "Codex" },
    });
    ledger.receipts.push({
      id: "legacy-receipt-without-proof-level",
      projectId: project.id,
      milestoneId: "legacy-active-milestone",
      summary: "Legacy receipt without proof level.",
      proofEvidenceIds: [],
      completedBy: "Project Command Center",
      completedAt: "2026-01-01T00:00:00.000Z",
    } as (typeof ledger.receipts)[number]);
    fs.writeFileSync(ledgerPath, JSON.stringify(ledger, null, 2));

    const repair = okPayload<{
      repairedMilestoneIds: string[];
      repairedSubMilestoneIds: string[];
      repairedReceiptIds: string[];
    }>(await invoke("pcc.ledger.repairCanonicalMetadata", {}));

    expect(repair.repairedMilestoneIds).toEqual(["legacy-active-milestone"]);
    expect(repair.repairedSubMilestoneIds).toEqual(["legacy-active-sub"]);
    expect(repair.repairedReceiptIds).toEqual(["legacy-receipt-without-proof-level"]);

    const repairedLedger = JSON.parse(fs.readFileSync(ledgerPath, "utf8")) as {
      milestones: Array<{ id: string; order?: number; metadata?: Record<string, unknown> }>;
      subMilestones: Array<{ id: string; metadata?: Record<string, unknown> }>;
      receipts: Array<{ id: string; proofLevel?: string }>;
    };
    expect(
      repairedLedger.milestones.find((item) => item.id === "legacy-active-milestone")?.metadata,
    ).toMatchObject({ pccResponsibility: "local_openclaw_agent", pccProofLevel: "local" });
    expect(
      repairedLedger.milestones.find((item) => item.id === "legacy-active-milestone")?.order,
    ).toBeGreaterThanOrEqual(0);
    expect(
      repairedLedger.subMilestones.find((item) => item.id === "legacy-active-sub")?.metadata,
    ).toMatchObject({ pccResponsibility: "codex", pccProofLevel: "local" });
    expect(
      repairedLedger.receipts.find((item) => item.id === "legacy-receipt-without-proof-level")
        ?.proofLevel,
    ).toBe("local");
    expect(
      repairedLedger.milestones.find((item) => item.id === "legacy-archived-milestone")?.metadata,
    ).not.toHaveProperty("pccResponsibility");

    const secondRepair = okPayload<{
      repairedMilestoneIds: string[];
      repairedSubMilestoneIds: string[];
      repairedReceiptIds: string[];
    }>(await invoke("pcc.ledger.repairCanonicalMetadata", {}));
    expect(secondRepair.repairedMilestoneIds).toEqual([]);
    expect(secondRepair.repairedSubMilestoneIds).toEqual([]);
    expect(secondRepair.repairedReceiptIds).toEqual([]);
  });

  it("surfaces imported ledger integrity gaps in project summaries", async () => {
    const { project } = okPayload<{ project: { id: string } }>(
      await invoke("pcc.projects.upsert", { project: { title: "Imported broken project" } }),
    );
    const ledgerPath = pccTesting.ledgerPath();
    const ledger = JSON.parse(fs.readFileSync(ledgerPath, "utf8")) as {
      milestones: Array<Record<string, unknown>>;
      subMilestones: Array<Record<string, unknown>>;
      evidence: Array<Record<string, unknown>>;
      receipts: Array<Record<string, unknown>>;
      decisions: Array<Record<string, unknown>>;
      lastKnownGood: Array<Record<string, unknown>>;
    };
    ledger.milestones.push({
      id: "duplicate-one",
      projectId: project.id,
      title: "Duplicate plan step",
      status: "active",
      order: 10,
      dependsOn: ["missing-dependency"],
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    });
    ledger.milestones.push({
      id: "duplicate-two",
      projectId: project.id,
      title: " duplicate plan step ",
      status: "not_started",
      order: 10,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    });
    ledger.subMilestones.push({
      id: "mismatched-project-sub-step",
      projectId: "other-project",
      milestoneId: "duplicate-one",
      title: "Mismatched imported sub-step",
      status: "not_started",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    });
    ledger.subMilestones.push({
      id: "duplicate-child-order-one",
      projectId: project.id,
      milestoneId: "duplicate-one",
      title: "Duplicate child order one",
      status: "not_started",
      order: 1,
      dependsOn: ["missing-child-dependency"],
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    });
    ledger.subMilestones.push({
      id: "duplicate-child-order-two",
      projectId: project.id,
      milestoneId: "duplicate-one",
      title: "Duplicate child order two",
      status: "not_started",
      order: 1,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    });
    ledger.subMilestones.push({
      id: "duplicate-child-title",
      projectId: project.id,
      milestoneId: "duplicate-one",
      title: "Duplicate child order one",
      status: "not_started",
      order: 2,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    });
    ledger.subMilestones.push({
      id: "orphan-sub-step",
      projectId: project.id,
      milestoneId: "missing-milestone",
      title: "Orphan imported sub-step",
      status: "not_started",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    });
    ledger.evidence.push({
      id: "failed-imported-evidence",
      projectId: project.id,
      kind: "local_test",
      status: "failed",
      createdAt: "2026-01-01T00:00:00.000Z",
    });
    ledger.receipts.push({
      id: "bad-imported-receipt",
      projectId: project.id,
      milestoneId: "missing-milestone",
      summary: "Imported receipt should not be trusted.",
      proofEvidenceIds: ["failed-imported-evidence"],
      proofLevel: "local",
      completedAt: "2026-01-01T00:00:00.000Z",
    });
    ledger.receipts.push({
      id: "legacy-receipt-without-proof",
      projectId: project.id,
      milestoneId: "missing-milestone",
      summary: "Legacy imported receipt omitted proof evidence ids.",
      proofLevel: "local",
      completedAt: "2026-01-01T00:00:00.000Z",
    });
    ledger.receipts.push({
      id: "malformed-proof-receipt",
      projectId: project.id,
      milestoneId: "missing-milestone",
      summary: "Legacy imported receipt stored proof ids as a scalar.",
      proofEvidenceIds: "failed-imported-evidence",
      proofLevel: "local",
      completedAt: "2026-01-01T00:00:00.000Z",
    });
    ledger.decisions.push({
      id: "bad-imported-decision",
      projectId: project.id,
      subMilestoneId: "missing-sub-step",
      title: "Imported decision",
      summary: "Imported decision references a missing sub-step.",
      evidenceIds: "failed-imported-evidence",
      decidedAt: "2026-01-01T00:00:00.000Z",
    });
    ledger.lastKnownGood.push({
      id: "bad-imported-lkg",
      projectId: project.id,
      subsystem: "Imported proof",
      summary: "Imported last-known-good references failed evidence.",
      evidenceIds: "failed-imported-evidence",
      verifiedAt: "2026-01-01T00:00:00.000Z",
    });
    fs.writeFileSync(ledgerPath, JSON.stringify(ledger, null, 2));

    const listPayload = okPayload<{
      projects: Array<{ id: string; proofGaps: string[]; health: string }>;
    }>(await invoke("pcc.projects.list", {}));
    const summary = listPayload.projects.find((item) => item.id === project.id);
    expect(summary?.proofGaps).toEqual(
      expect.arrayContaining([
        "Integrity issue: milestone dependency is missing: Duplicate plan step -> missing-dependency",
        "Integrity issue: duplicate milestone title: duplicate plan step",
        "Integrity issue: duplicate milestone order: 10",
        "Integrity issue: sub-milestone has mismatched project reference: Mismatched imported sub-step",
        "Integrity issue: sub-milestone dependency is missing: Duplicate child order one -> missing-child-dependency",
        "Integrity issue: duplicate sub-milestone title under Duplicate plan step: duplicate child order one",
        "Integrity issue: duplicate sub-milestone order under Duplicate plan step: 1",
        "Integrity issue: sub-milestone has missing parent milestone: Orphan imported sub-step",
        "Integrity issue: receipt references missing milestone: bad-imported-receipt",
        "Integrity issue: receipt references non-passing proof evidence: failed-imported-evidence",
        "Integrity issue: receipt has no proof evidence ids: legacy-receipt-without-proof",
        "Integrity issue: receipt has malformed proof evidence ids: malformed-proof-receipt",
        "Integrity issue: decision references missing sub-milestone: bad-imported-decision",
        "Integrity issue: decision has malformed evidence ids: bad-imported-decision",
        "Integrity issue: last-known-good has malformed evidence ids: bad-imported-lkg",
      ]),
    );
    expect(summary?.health).toBe("At risk");
  });

  it("summarizes legacy rows with missing activity timestamps", async () => {
    const { project } = okPayload<{ project: { id: string } }>(
      await invoke("pcc.projects.upsert", { project: { title: "Legacy timestamp project" } }),
    );
    const ledgerPath = pccTesting.ledgerPath();
    const ledger = JSON.parse(fs.readFileSync(ledgerPath, "utf8")) as {
      permissions: Array<Record<string, unknown>>;
    };
    ledger.permissions.push({
      id: "legacy-permission",
      projectId: project.id,
      type: "remote_proof",
      status: "needed",
      riskLevel: "medium",
      allowedActions: ["run proof"],
      usedCount: 0,
      auditLog: [],
      createdAt: "2026-01-01T00:00:00.000Z",
    });
    fs.writeFileSync(ledgerPath, JSON.stringify(ledger, null, 2));

    const listPayload = okPayload<{ projects: Array<{ id: string; recentActivity?: string }> }>(
      await invoke("pcc.projects.list", {}),
    );
    const summary = listPayload.projects.find((item) => item.id === project.id);
    expect(summary?.recentActivity).toContain("Project updated");
  });

  it("adds default phases and calculates weighted phase completion", async () => {
    const { project } = okPayload<{
      project: { id: string; phases: Array<{ id: string; weight?: number }> };
      summary: { percentComplete: number };
    }>(await invoke("pcc.projects.upsert", { project: { title: "Phase weighted project" } }));
    expect(project.phases.map((phase) => phase.id)).toEqual([
      "setup",
      "tools-skills",
      "mvp",
      "refinement",
      "production-proof",
      "maintenance",
    ]);
    expect(project.phases.reduce((total, phase) => total + (phase.weight ?? 0), 0)).toBe(100);

    await invoke("pcc.milestones.upsert", {
      milestone: {
        projectId: project.id,
        title: "Setup local proof",
        phaseId: "setup",
        status: "local_proof_complete",
      },
    });
    const weighted = okPayload<{ project: { percentComplete: number } }>(
      await invoke("pcc.summary.get", { projectId: project.id }),
    );
    expect(weighted.project.percentComplete).toBe(7);

    await invoke("pcc.milestones.upsert", {
      milestone: {
        projectId: project.id,
        title: "Skipped MVP work",
        phaseId: "mvp",
        status: "skipped",
      },
    });
    const withSkipped = okPayload<{ project: { percentComplete: number } }>(
      await invoke("pcc.summary.get", { projectId: project.id }),
    );
    expect(withSkipped.project.percentComplete).toBe(7);
  });

  it("rejects completion receipts backed by non-passing evidence", async () => {
    const { project } = okPayload<{ project: { id: string } }>(
      await invoke("pcc.projects.upsert", { project: { title: "Failed proof project" } }),
    );
    const { milestone } = okPayload<{ milestone: { id: string } }>(
      await invoke("pcc.milestones.upsert", {
        milestone: {
          projectId: project.id,
          title: "Needs passing proof",
          status: "proof_pending",
        },
      }),
    );
    const { evidence } = okPayload<{ evidence: { id: string } }>(
      await invoke("pcc.evidence.add", {
        evidence: {
          projectId: project.id,
          milestoneId: milestone.id,
          kind: "local_test",
          status: "failed",
          command: "pnpm test failing-proof.test.ts",
          exitCode: 1,
        },
      }),
    );

    expect(
      errorMessage(
        await invoke("pcc.receipts.add", {
          receipt: {
            projectId: project.id,
            milestoneId: milestone.id,
            summary: "This failed proof must not complete the milestone.",
            proofEvidenceIds: [evidence.id],
            proofLevel: "local",
          },
        }),
      ),
    ).toContain(`proof evidence has not passed: ${evidence.id}`);
  });

  it("blocks complete milestone claims until a completion receipt is added", async () => {
    const { project } = okPayload<{ project: { id: string } }>(
      await invoke("pcc.projects.upsert", { project: { title: "Truthful completion" } }),
    );

    const blocked = await invoke("pcc.milestones.upsert", {
      milestone: {
        projectId: project.id,
        title: "Cannot complete from prose",
        status: "complete",
      },
    });
    expect(errorMessage(blocked)).toContain("completion receipt");

    const { milestone } = okPayload<{ milestone: { id: string } }>(
      await invoke("pcc.milestones.upsert", {
        milestone: {
          projectId: project.id,
          title: "Receipt-backed milestone",
          status: "proof_pending",
        },
      }),
    );
    const { evidence } = okPayload<{ evidence: { id: string } }>(
      await invoke("pcc.evidence.add", {
        evidence: {
          projectId: project.id,
          milestoneId: milestone.id,
          kind: "browser_proof",
          status: "passed",
          command: "pnpm test src/gateway/server-methods/pcc.test.ts",
          exitCode: 0,
          path: "/tmp/openclaw-pcc-receipt-proof.png",
          sha: "63216a766d7bc20da500a887ad668951cb0a881e",
        },
      }),
    );
    const receiptPayload = okPayload<{
      milestone: { status: string; percentComplete: number };
      lastKnownGood: {
        subsystem: string;
        summary: string;
        evidenceIds: string[];
        screenshotPath?: string;
        sha?: string;
      };
      summary: { percentComplete: number };
    }>(
      await invoke("pcc.receipts.add", {
        receipt: {
          projectId: project.id,
          milestoneId: milestone.id,
          summary: "Local PCC server-method test passed.",
          proofEvidenceIds: [evidence.id],
          proofLevel: "local",
          doNotRedo: ["Do not claim completion without receipt-backed evidence."],
        },
      }),
    );

    expect(receiptPayload.milestone.status).toBe("complete");
    expect(receiptPayload.milestone.percentComplete).toBe(100);
    expect(receiptPayload.lastKnownGood.subsystem).toBe("Milestone: Receipt-backed milestone");
    expect(receiptPayload.lastKnownGood.summary).toBe("Local PCC server-method test passed.");
    expect(receiptPayload.lastKnownGood.evidenceIds).toEqual([evidence.id]);
    expect(receiptPayload.lastKnownGood.screenshotPath).toBe("/tmp/openclaw-pcc-receipt-proof.png");
    expect(receiptPayload.lastKnownGood.sha).toBe("63216a766d7bc20da500a887ad668951cb0a881e");
    expect(receiptPayload.summary.percentComplete).toBe(100);

    const detail = okPayload<{ lastKnownGood: unknown[] }>(
      await invoke("pcc.projects.get", { projectId: project.id }),
    );
    expect(detail.lastKnownGood).toHaveLength(1);
  });

  it("rejects cross-project milestone links for permissions and evidence", async () => {
    const firstProject = okPayload<{ project: { id: string } }>(
      await invoke("pcc.projects.upsert", { project: { title: "Permission project" } }),
    ).project;
    const secondProject = okPayload<{ project: { id: string } }>(
      await invoke("pcc.projects.upsert", { project: { title: "Other permission project" } }),
    ).project;
    const otherMilestone = okPayload<{ milestone: { id: string } }>(
      await invoke("pcc.milestones.upsert", {
        milestone: { projectId: secondProject.id, title: "Other milestone" },
      }),
    ).milestone;

    expect(
      errorMessage(
        await invoke("pcc.permissions.upsert", {
          permission: {
            projectId: firstProject.id,
            milestoneId: otherMilestone.id,
            type: "remote_proof",
            allowedActions: ["run proof"],
          },
        }),
      ),
    ).toContain(`milestone not found in project: ${otherMilestone.id}`);

    expect(
      errorMessage(
        await invoke("pcc.evidence.add", {
          evidence: {
            projectId: firstProject.id,
            milestoneId: otherMilestone.id,
            kind: "local_test",
            status: "passed",
          },
        }),
      ),
    ).toContain(`milestone not found in project: ${otherMilestone.id}`);
  });

  it("rejects receipt proof evidence attached to another milestone", async () => {
    const { project } = okPayload<{ project: { id: string } }>(
      await invoke("pcc.projects.upsert", { project: { title: "Receipt evidence integrity" } }),
    );
    const firstMilestone = okPayload<{ milestone: { id: string } }>(
      await invoke("pcc.milestones.upsert", {
        milestone: { projectId: project.id, title: "First receipt milestone" },
      }),
    ).milestone;
    const secondMilestone = okPayload<{ milestone: { id: string } }>(
      await invoke("pcc.milestones.upsert", {
        milestone: { projectId: project.id, title: "Second receipt milestone" },
      }),
    ).milestone;
    const { evidence } = okPayload<{ evidence: { id: string } }>(
      await invoke("pcc.evidence.add", {
        evidence: {
          projectId: project.id,
          milestoneId: firstMilestone.id,
          kind: "local_test",
          status: "passed",
          command: "pnpm test src/gateway/server-methods/pcc.test.ts",
        },
      }),
    );

    expect(
      errorMessage(
        await invoke("pcc.receipts.add", {
          receipt: {
            projectId: project.id,
            milestoneId: secondMilestone.id,
            summary: "Wrong milestone proof should not complete this milestone.",
            proofEvidenceIds: [evidence.id],
          },
        }),
      ),
    ).toContain(`proof evidence belongs to another milestone: ${evidence.id}`);
  });

  it("rejects duplicate evidence references in receipts and last-known-good records", async () => {
    const { project } = okPayload<{ project: { id: string } }>(
      await invoke("pcc.projects.upsert", { project: { title: "Duplicate proof references" } }),
    );
    const { milestone } = okPayload<{ milestone: { id: string } }>(
      await invoke("pcc.milestones.upsert", {
        milestone: { projectId: project.id, title: "Receipt proof" },
      }),
    );
    const { evidence } = okPayload<{ evidence: { id: string } }>(
      await invoke("pcc.evidence.add", {
        evidence: {
          projectId: project.id,
          milestoneId: milestone.id,
          kind: "local_test",
          status: "passed",
          command: "pnpm test src/gateway/server-methods/pcc.test.ts",
        },
      }),
    );

    expect(
      errorMessage(
        await invoke("pcc.receipts.add", {
          receipt: {
            projectId: project.id,
            milestoneId: milestone.id,
            summary: "Duplicate proof evidence should be rejected.",
            proofEvidenceIds: [evidence.id, evidence.id],
          },
        }),
      ),
    ).toContain(`duplicate proof evidence id: ${evidence.id}`);

    expect(
      errorMessage(
        await invoke("pcc.lastKnownGood.upsert", {
          entry: {
            projectId: project.id,
            subsystem: "duplicate-proof-subsystem",
            summary: "Duplicate evidence should be rejected.",
            evidenceIds: [evidence.id, evidence.id],
          },
        }),
      ),
    ).toContain(`duplicate evidence id: ${evidence.id}`);
  });

  it("stores decision records and rejects orphaned decision links", async () => {
    const { project } = okPayload<{ project: { id: string } }>(
      await invoke("pcc.projects.upsert", { project: { title: "Decision project" } }),
    );
    const { milestone } = okPayload<{ milestone: { id: string } }>(
      await invoke("pcc.milestones.upsert", {
        milestone: {
          projectId: project.id,
          title: "Choose execution path",
          status: "in_progress",
        },
      }),
    );
    const { subMilestone } = okPayload<{ subMilestone: { id: string } }>(
      await invoke("pcc.subMilestones.upsert", {
        subMilestone: {
          projectId: project.id,
          milestoneId: milestone.id,
          title: "Document decision",
          status: "not_started",
        },
      }),
    );
    const { evidence } = okPayload<{ evidence: { id: string } }>(
      await invoke("pcc.evidence.add", {
        evidence: {
          projectId: project.id,
          milestoneId: milestone.id,
          kind: "manual_review",
          status: "passed",
          summary: "User approved the smaller durable path.",
        },
      }),
    );

    const decisionPayload = okPayload<{
      decision: {
        id: string;
        title: string;
        summary: string;
        milestoneId?: string;
        subMilestoneId?: string;
        evidenceIds?: string[];
      };
      summary: { recentActivity?: string };
    }>(
      await invoke("pcc.decisions.add", {
        decision: {
          projectId: project.id,
          milestoneId: milestone.id,
          subMilestoneId: subMilestone.id,
          title: "Use first-class decision log",
          summary: "Capture project choices as durable PCC records instead of prose-only notes.",
          rationale: "Future agents need to know why a path was chosen before changing it.",
          alternatives: ["Keep decisions in receipts only", "Store decisions in project metadata"],
          impact: "Improves handoff quality and prevents repeated debates.",
          decidedBy: "Codex",
          evidenceIds: [evidence.id],
        },
      }),
    );

    expect(decisionPayload.decision.id).toMatch(/^decision-/);
    expect(decisionPayload.decision.title).toBe("Use first-class decision log");
    expect(decisionPayload.decision.milestoneId).toBe(milestone.id);
    expect(decisionPayload.decision.subMilestoneId).toBe(subMilestone.id);
    expect(decisionPayload.decision.evidenceIds).toEqual([evidence.id]);

    const detail = okPayload<{ decisions: Array<{ id: string; summary: string }> }>(
      await invoke("pcc.projects.get", { projectId: project.id }),
    );
    expect(detail.decisions).toEqual([
      expect.objectContaining({
        id: decisionPayload.decision.id,
        summary: "Capture project choices as durable PCC records instead of prose-only notes.",
      }),
    ]);

    const listPayload = okPayload<{ projects: Array<{ id: string; recentActivity?: string }> }>(
      await invoke("pcc.projects.list", {}),
    );
    expect(listPayload.projects.find((item) => item.id === project.id)?.recentActivity).toContain(
      "Decision: Use first-class decision log",
    );

    const orphan = await invoke("pcc.decisions.add", {
      decision: {
        projectId: project.id,
        milestoneId: "missing-milestone",
        title: "Invalid decision",
        summary: "This must not be stored.",
      },
    });
    expect(errorMessage(orphan)).toContain("milestone not found in project");

    const duplicateEvidence = await invoke("pcc.decisions.add", {
      decision: {
        projectId: project.id,
        title: "Duplicate evidence decision",
        summary: "This must not be stored.",
        evidenceIds: [evidence.id, evidence.id],
      },
    });
    expect(errorMessage(duplicateEvidence)).toContain("duplicate decision evidence id");
  });

  it("stores sub-milestones and gates parent completion on their proof state", async () => {
    const { project } = okPayload<{ project: { id: string } }>(
      await invoke("pcc.projects.upsert", { project: { title: "Sub-milestone project" } }),
    );
    const { milestone } = okPayload<{ milestone: { id: string } }>(
      await invoke("pcc.milestones.upsert", {
        milestone: {
          projectId: project.id,
          title: "Parent milestone",
          status: "in_progress",
          implementationPlan: "Execute the child checklist.",
          acceptanceCriteria: ["Every child step is complete"],
        },
      }),
    );

    const { subMilestone } = okPayload<{
      subMilestone: { id: string; title: string };
      summary: { percentComplete: number };
    }>(
      await invoke("pcc.subMilestones.upsert", {
        subMilestone: {
          projectId: project.id,
          milestoneId: milestone.id,
          title: "Run local test",
          status: "in_progress",
          order: 1,
          owner: "local_openclaw_agent",
          percentComplete: 50,
          implementationPlan: "Run pnpm test for the touched PCC files.",
          acceptanceCriteria: ["Test exits 0"],
          metadata: { proofRequired: "targeted local test" },
        },
      }),
    );

    expect(subMilestone.title).toBe("Run local test");
    const detail = okPayload<{ subMilestones: Array<{ id: string }> }>(
      await invoke("pcc.projects.get", { projectId: project.id }),
    );
    expect(detail.subMilestones.map((item) => item.id)).toEqual([subMilestone.id]);

    const listed = okPayload<{ subMilestones: Array<{ id: string }> }>(
      await invoke("pcc.subMilestones.list", { projectId: project.id, milestoneId: milestone.id }),
    );
    expect(listed.subMilestones).toHaveLength(1);

    const blocked = await invoke("pcc.milestones.upsert", {
      milestone: {
        id: milestone.id,
        projectId: project.id,
        title: "Parent milestone",
        status: "complete",
      },
    });
    expect(errorMessage(blocked)).toContain("sub-milestone");

    await invoke("pcc.subMilestones.upsert", {
      subMilestone: {
        id: subMilestone.id,
        projectId: project.id,
        milestoneId: milestone.id,
        title: "Run local test",
        status: "complete",
        percentComplete: 100,
        receiptIds: ["receipt-child"],
        implementationPlan: "Run pnpm test for the touched PCC files.",
        acceptanceCriteria: ["Test exits 0"],
      },
    });
    const { evidence } = okPayload<{ evidence: { id: string } }>(
      await invoke("pcc.evidence.add", {
        evidence: {
          projectId: project.id,
          milestoneId: milestone.id,
          kind: "local_test",
          status: "passed",
          command: "pnpm test src/gateway/server-methods/pcc.test.ts",
          exitCode: 0,
        },
      }),
    );
    const receiptPayload = okPayload<{
      milestone: { status: string; percentComplete: number };
      summary: { percentComplete: number };
    }>(
      await invoke("pcc.receipts.add", {
        receipt: {
          projectId: project.id,
          milestoneId: milestone.id,
          summary: "Parent milestone completed after child proof.",
          proofEvidenceIds: [evidence.id],
          proofLevel: "local",
        },
      }),
    );
    expect(receiptPayload.milestone.status).toBe("complete");
    expect(receiptPayload.milestone.percentComplete).toBe(100);
    expect(receiptPayload.summary.percentComplete).toBe(100);
  });

  it("records permission grants and last-known-good receipts close to the project", async () => {
    const { project } = okPayload<{ project: { id: string } }>(
      await invoke("pcc.projects.upsert", { project: { title: "Production dashboard" } }),
    );
    const { permission } = okPayload<{ permission: { status: string; auditLog: unknown[] } }>(
      await invoke("pcc.permissions.upsert", {
        permission: {
          projectId: project.id,
          type: "runtime_restart",
          status: "granted",
          riskLevel: "high",
          allowedActions: ["restart local OpenClaw Gateway"],
          forbiddenActions: ["merge upstream openclaw/openclaw"],
          grantedBy: "user",
          note: "Approved for local dashboard proof.",
        },
      }),
    );
    expect(permission.status).toBe("granted");
    expect(permission.auditLog).toHaveLength(1);

    const { evidence } = okPayload<{ evidence: { id: string } }>(
      await invoke("pcc.evidence.add", {
        evidence: {
          projectId: project.id,
          kind: "browser_proof",
          status: "passed",
          path: "/tmp/openclaw-dashboard-proof.png",
        },
      }),
    );
    const { lastKnownGood } = okPayload<{
      lastKnownGood: { subsystem: string; screenshotPath: string };
    }>(
      await invoke("pcc.lastKnownGood.upsert", {
        entry: {
          projectId: project.id,
          subsystem: "dashboard-runtime",
          summary: "Dashboard runtime rendered after restart.",
          evidenceIds: [evidence.id],
          sha: "63216a766d7bc20da500a887ad668951cb0a881e",
          screenshotPath: "/tmp/openclaw-dashboard-proof.png",
        },
      }),
    );
    expect(lastKnownGood.subsystem).toBe("dashboard-runtime");

    const projectDetail = okPayload<{ permissions: unknown[]; lastKnownGood: unknown[] }>(
      await invoke("pcc.projects.get", { projectId: project.id }),
    );
    expect(projectDetail.permissions).toHaveLength(1);
    expect(projectDetail.lastKnownGood).toHaveLength(1);
  });

  it("rejects direct terminal-to-active status transitions", async () => {
    const { project } = okPayload<{ project: { id: string } }>(
      await invoke("pcc.projects.upsert", {
        project: { title: "Transition project", status: "active" },
      }),
    );
    await invoke("pcc.projects.upsert", {
      project: { id: project.id, title: "Transition project", status: "archived" },
    });

    expect(
      errorMessage(
        await invoke("pcc.projects.upsert", {
          project: { id: project.id, title: "Transition project", status: "active" },
        }),
      ),
    ).toContain("project status archived must be reopened before changing to active");

    const reopenedProject = okPayload<{ project: { status: string } }>(
      await invoke("pcc.projects.upsert", {
        project: { id: project.id, title: "Transition project", status: "reopened" },
      }),
    ).project;
    expect(reopenedProject.status).toBe("reopened");

    const archivedMilestone = okPayload<{ milestone: { id: string } }>(
      await invoke("pcc.milestones.upsert", {
        milestone: { projectId: project.id, title: "Archived milestone", status: "archived" },
      }),
    ).milestone;
    expect(
      errorMessage(
        await invoke("pcc.milestones.upsert", {
          milestone: {
            id: archivedMilestone.id,
            projectId: project.id,
            title: "Archived milestone",
            status: "in_progress",
          },
        }),
      ),
    ).toContain("milestone status archived must be reopened before changing to in_progress");

    const resetMilestone = okPayload<{ milestone: { status: string } }>(
      await invoke("pcc.milestones.upsert", {
        milestone: {
          id: archivedMilestone.id,
          projectId: project.id,
          title: "Archived milestone",
          status: "not_started",
        },
      }),
    ).milestone;
    expect(resetMilestone.status).toBe("not_started");

    const archivedSubMilestone = okPayload<{ subMilestone: { id: string } }>(
      await invoke("pcc.subMilestones.upsert", {
        subMilestone: {
          projectId: project.id,
          milestoneId: archivedMilestone.id,
          title: "Archived sub-step",
          status: "skipped",
        },
      }),
    ).subMilestone;
    expect(
      errorMessage(
        await invoke("pcc.subMilestones.upsert", {
          subMilestone: {
            id: archivedSubMilestone.id,
            projectId: project.id,
            milestoneId: archivedMilestone.id,
            title: "Archived sub-step",
            status: "in_progress",
          },
        }),
      ),
    ).toContain("sub-milestone status skipped must be reopened before changing to in_progress");
  });

  it("proof-gates complete sub-milestone status", async () => {
    const { project } = okPayload<{ project: { id: string } }>(
      await invoke("pcc.projects.upsert", { project: { title: "Sub proof project" } }),
    );
    const { milestone } = okPayload<{ milestone: { id: string } }>(
      await invoke("pcc.milestones.upsert", {
        milestone: { projectId: project.id, title: "Parent milestone", status: "not_started" },
      }),
    );

    expect(
      errorMessage(
        await invoke("pcc.subMilestones.upsert", {
          subMilestone: {
            projectId: project.id,
            milestoneId: milestone.id,
            title: "Cannot complete without proof",
            status: "complete",
          },
        }),
      ),
    ).toContain("complete sub-milestone status requires passed evidence");

    const { evidence: failedEvidence } = okPayload<{ evidence: { id: string } }>(
      await invoke("pcc.evidence.add", {
        evidence: {
          projectId: project.id,
          milestoneId: milestone.id,
          kind: "local_test",
          status: "failed",
          command: "pnpm test sub-proof.test.ts",
          exitCode: 1,
        },
      }),
    );

    expect(
      errorMessage(
        await invoke("pcc.subMilestones.upsert", {
          subMilestone: {
            projectId: project.id,
            milestoneId: milestone.id,
            title: "Cannot complete with failed proof",
            status: "complete",
            requiredEvidenceIds: [failedEvidence.id],
          },
        }),
      ),
    ).toContain(`complete sub-milestone status requires passed evidence: ${failedEvidence.id}`);

    const { evidence } = okPayload<{ evidence: { id: string } }>(
      await invoke("pcc.evidence.add", {
        evidence: {
          projectId: project.id,
          milestoneId: milestone.id,
          kind: "local_test",
          status: "passed",
          command: "pnpm test sub-proof.test.ts",
          exitCode: 0,
        },
      }),
    );
    const { subMilestone } = okPayload<{
      subMilestone: { status: string; requiredEvidenceIds: string[] };
    }>(
      await invoke("pcc.subMilestones.upsert", {
        subMilestone: {
          projectId: project.id,
          milestoneId: milestone.id,
          title: "Complete with passed proof",
          status: "complete",
          requiredEvidenceIds: [evidence.id],
        },
      }),
    );
    expect(subMilestone.status).toBe("complete");
    expect(subMilestone.requiredEvidenceIds).toEqual([evidence.id]);
  });

  it("rejects broken milestone and sub-milestone references", async () => {
    const { project } = okPayload<{ project: { id: string } }>(
      await invoke("pcc.projects.upsert", { project: { title: "Integrity project" } }),
    );
    const firstMilestone = okPayload<{ milestone: { id: string } }>(
      await invoke("pcc.milestones.upsert", {
        milestone: { projectId: project.id, title: "First", status: "not_started" },
      }),
    ).milestone;
    const secondMilestone = okPayload<{ milestone: { id: string } }>(
      await invoke("pcc.milestones.upsert", {
        milestone: {
          projectId: project.id,
          title: "Second",
          status: "not_started",
          dependsOn: [firstMilestone.id],
        },
      }),
    ).milestone;

    expect(
      errorMessage(
        await invoke("pcc.milestones.upsert", {
          milestone: {
            id: secondMilestone.id,
            projectId: project.id,
            title: "Second",
            dependsOn: ["missing-milestone"],
          },
        }),
      ),
    ).toContain("milestone dependency not found in project");
    expect(
      errorMessage(
        await invoke("pcc.milestones.upsert", {
          milestone: {
            id: firstMilestone.id,
            projectId: project.id,
            title: "First",
            dependsOn: [firstMilestone.id],
          },
        }),
      ),
    ).toContain("milestone cannot depend on itself");
    expect(
      errorMessage(
        await invoke("pcc.milestones.upsert", {
          milestone: {
            id: firstMilestone.id,
            projectId: project.id,
            title: "First",
            dependsOn: [secondMilestone.id],
          },
        }),
      ),
    ).toContain("milestone dependencies cannot create a cycle");

    const firstSubMilestone = okPayload<{ subMilestone: { id: string } }>(
      await invoke("pcc.subMilestones.upsert", {
        subMilestone: {
          projectId: project.id,
          milestoneId: firstMilestone.id,
          title: "First sub-step",
        },
      }),
    ).subMilestone;
    expect(
      errorMessage(
        await invoke("pcc.subMilestones.upsert", {
          subMilestone: {
            id: firstSubMilestone.id,
            projectId: project.id,
            milestoneId: firstMilestone.id,
            title: "First sub-step",
            dependsOn: [firstSubMilestone.id],
          },
        }),
      ),
    ).toContain("sub-milestone cannot depend on itself");
    const secondSubMilestone = okPayload<{ subMilestone: { id: string } }>(
      await invoke("pcc.subMilestones.upsert", {
        subMilestone: {
          projectId: project.id,
          milestoneId: firstMilestone.id,
          title: "Second sub-step",
          dependsOn: [firstSubMilestone.id],
        },
      }),
    ).subMilestone;
    expect(
      errorMessage(
        await invoke("pcc.subMilestones.upsert", {
          subMilestone: {
            id: firstSubMilestone.id,
            projectId: project.id,
            milestoneId: firstMilestone.id,
            title: "First sub-step",
            dependsOn: [secondSubMilestone.id],
          },
        }),
      ),
    ).toContain("sub-milestone dependencies cannot create a cycle");
    expect(
      errorMessage(
        await invoke("pcc.subMilestones.upsert", {
          subMilestone: {
            projectId: project.id,
            milestoneId: firstMilestone.id,
            title: "Missing dependency sub-step",
            dependsOn: ["missing-submilestone"],
          },
        }),
      ),
    ).toContain("sub-milestone dependency not found under milestone");
  });

  it("rejects duplicate active milestone and sub-milestone titles", async () => {
    const { project } = okPayload<{ project: { id: string } }>(
      await invoke("pcc.projects.upsert", { project: { title: "Named project" } }),
    );
    const firstMilestone = okPayload<{ milestone: { id: string } }>(
      await invoke("pcc.milestones.upsert", {
        milestone: {
          projectId: project.id,
          title: "Gather Requirements",
          status: "not_started",
        },
      }),
    ).milestone;

    expect(
      errorMessage(
        await invoke("pcc.milestones.upsert", {
          milestone: {
            projectId: project.id,
            title: "  gather   requirements  ",
            status: "not_started",
          },
        }),
      ),
    ).toContain(`milestone title already used by ${firstMilestone.id}`);

    const archivedDuplicate = okPayload<{ milestone: { title: string } }>(
      await invoke("pcc.milestones.upsert", {
        milestone: {
          projectId: project.id,
          title: "Gather Requirements",
          status: "archived",
        },
      }),
    ).milestone;
    expect(archivedDuplicate.title).toBe("Gather Requirements");

    const firstSubMilestone = okPayload<{ subMilestone: { id: string } }>(
      await invoke("pcc.subMilestones.upsert", {
        subMilestone: {
          projectId: project.id,
          milestoneId: firstMilestone.id,
          title: "Draft Brief",
          status: "not_started",
        },
      }),
    ).subMilestone;

    expect(
      errorMessage(
        await invoke("pcc.subMilestones.upsert", {
          subMilestone: {
            projectId: project.id,
            milestoneId: firstMilestone.id,
            title: "draft brief",
            status: "not_started",
          },
        }),
      ),
    ).toContain(`sub-milestone title already used by ${firstSubMilestone.id}`);

    const otherMilestone = okPayload<{ milestone: { id: string } }>(
      await invoke("pcc.milestones.upsert", {
        milestone: {
          projectId: project.id,
          title: "Other parent",
        },
      }),
    ).milestone;
    const otherParentDuplicate = okPayload<{ subMilestone: { title: string } }>(
      await invoke("pcc.subMilestones.upsert", {
        subMilestone: {
          projectId: project.id,
          milestoneId: otherMilestone.id,
          title: "Draft Brief",
        },
      }),
    ).subMilestone;
    expect(otherParentDuplicate.title).toBe("Draft Brief");
  });

  it("rejects duplicate active milestone and sub-milestone order values", async () => {
    const { project } = okPayload<{ project: { id: string } }>(
      await invoke("pcc.projects.upsert", { project: { title: "Ordered project" } }),
    );
    const firstMilestone = okPayload<{ milestone: { id: string } }>(
      await invoke("pcc.milestones.upsert", {
        milestone: {
          projectId: project.id,
          title: "First ordered milestone",
          order: 10,
          status: "not_started",
        },
      }),
    ).milestone;

    expect(
      errorMessage(
        await invoke("pcc.milestones.upsert", {
          milestone: {
            projectId: project.id,
            title: "Conflicting ordered milestone",
            order: 10,
            status: "not_started",
          },
        }),
      ),
    ).toContain(`milestone order 10 already used by ${firstMilestone.id}`);

    const archivedDuplicate = okPayload<{ milestone: { id: string; order: number } }>(
      await invoke("pcc.milestones.upsert", {
        milestone: {
          projectId: project.id,
          title: "Archived duplicate order",
          order: 10,
          status: "archived",
        },
      }),
    ).milestone;
    expect(archivedDuplicate.order).toBe(10);

    const firstSubMilestone = okPayload<{ subMilestone: { id: string } }>(
      await invoke("pcc.subMilestones.upsert", {
        subMilestone: {
          projectId: project.id,
          milestoneId: firstMilestone.id,
          title: "First ordered sub-step",
          order: 1,
          status: "not_started",
        },
      }),
    ).subMilestone;

    expect(
      errorMessage(
        await invoke("pcc.subMilestones.upsert", {
          subMilestone: {
            projectId: project.id,
            milestoneId: firstMilestone.id,
            title: "Conflicting ordered sub-step",
            order: 1,
            status: "not_started",
          },
        }),
      ),
    ).toContain(`sub-milestone order 1 already used by ${firstSubMilestone.id}`);

    const otherMilestone = okPayload<{ milestone: { id: string } }>(
      await invoke("pcc.milestones.upsert", {
        milestone: {
          projectId: project.id,
          title: "Other parent milestone",
          order: 20,
        },
      }),
    ).milestone;
    const otherParentDuplicate = okPayload<{ subMilestone: { order: number } }>(
      await invoke("pcc.subMilestones.upsert", {
        subMilestone: {
          projectId: project.id,
          milestoneId: otherMilestone.id,
          title: "Same order under another milestone",
          order: 1,
        },
      }),
    ).subMilestone;
    expect(otherParentDuplicate.order).toBe(1);
  });

  it("rejects moving existing milestones and sub-milestones to another parent", async () => {
    const firstProject = okPayload<{ project: { id: string } }>(
      await invoke("pcc.projects.upsert", { project: { title: "First project" } }),
    ).project;
    const secondProject = okPayload<{ project: { id: string } }>(
      await invoke("pcc.projects.upsert", { project: { title: "Second project" } }),
    ).project;
    const firstMilestone = okPayload<{ milestone: { id: string } }>(
      await invoke("pcc.milestones.upsert", {
        milestone: { projectId: firstProject.id, title: "First milestone" },
      }),
    ).milestone;
    const secondMilestone = okPayload<{ milestone: { id: string } }>(
      await invoke("pcc.milestones.upsert", {
        milestone: { projectId: firstProject.id, title: "Second milestone" },
      }),
    ).milestone;
    const otherProjectMilestone = okPayload<{ milestone: { id: string } }>(
      await invoke("pcc.milestones.upsert", {
        milestone: { projectId: secondProject.id, title: "Other project milestone" },
      }),
    ).milestone;
    const subMilestone = okPayload<{ subMilestone: { id: string } }>(
      await invoke("pcc.subMilestones.upsert", {
        subMilestone: {
          projectId: firstProject.id,
          milestoneId: firstMilestone.id,
          title: "Pinned sub-step",
        },
      }),
    ).subMilestone;

    expect(
      errorMessage(
        await invoke("pcc.milestones.upsert", {
          milestone: {
            id: firstMilestone.id,
            projectId: secondProject.id,
            title: "Moved milestone",
          },
        }),
      ),
    ).toContain(`milestone ${firstMilestone.id} belongs to project ${firstProject.id}`);

    expect(
      errorMessage(
        await invoke("pcc.subMilestones.upsert", {
          subMilestone: {
            id: subMilestone.id,
            projectId: secondProject.id,
            milestoneId: otherProjectMilestone.id,
            title: "Moved sub-step",
          },
        }),
      ),
    ).toContain(`sub-milestone ${subMilestone.id} belongs to project ${firstProject.id}`);

    expect(
      errorMessage(
        await invoke("pcc.subMilestones.upsert", {
          subMilestone: {
            id: subMilestone.id,
            projectId: firstProject.id,
            milestoneId: secondMilestone.id,
            title: "Moved sub-step",
          },
        }),
      ),
    ).toContain(`sub-milestone ${subMilestone.id} belongs to milestone ${firstMilestone.id}`);
  });

  it("summarizes portfolio status without showing archived projects by default", async () => {
    const active = okPayload<{ project: { id: string } }>(
      await invoke("pcc.projects.upsert", {
        project: { title: "Active project", status: "active" },
      }),
    );
    await invoke("pcc.projects.upsert", {
      project: { title: "Archived project", status: "archived" },
    });

    const listDefault = okPayload<{ projects: unknown[] }>(await invoke("pcc.projects.list", {}));
    expect(listDefault.projects).toHaveLength(1);

    const listAll = okPayload<{ projects: unknown[] }>(
      await invoke("pcc.projects.list", { includeArchived: true }),
    );
    expect(listAll.projects).toHaveLength(2);

    const summary = okPayload<{
      project: { id: string };
      portfolio: { projectsTotal: number; active: number; archived: number };
    }>(await invoke("pcc.summary.get", { projectId: active.project.id }));
    expect(summary.project.id).toBe(active.project.id);
    expect(summary.portfolio.projectsTotal).toBe(2);
    expect(summary.portfolio.active).toBe(1);
    expect(summary.portfolio.archived).toBe(1);
  });

  it("summarizes portfolio attention, proof-gap, overdue, and stale counts", async () => {
    await invoke("pcc.projects.upsert", {
      project: { id: "project-active", title: "Active project", status: "active" },
    });
    await invoke("pcc.projects.upsert", {
      project: {
        id: "project-overdue",
        title: "Overdue project",
        status: "active",
        metadata: { dueDate: "2000-01-01T00:00:00.000Z" },
      },
    });
    await invoke("pcc.projects.upsert", {
      project: { id: "project-approval", title: "Approval project", status: "needs_approval" },
    });
    await invoke("pcc.projects.upsert", {
      project: { id: "project-proof-gap", title: "Proof gap project", status: "active" },
    });
    const ledgerPath = pccTesting.ledgerPath();
    const ledger = JSON.parse(fs.readFileSync(ledgerPath, "utf8")) as {
      projects: Array<Record<string, unknown>>;
      milestones: Array<Record<string, unknown>>;
    };
    const staleProject = ledger.projects.find((project) => project.id === "project-active");
    expect(staleProject).toBeTruthy();
    staleProject!.updatedAt = "2000-01-02T00:00:00.000Z";
    ledger.milestones.push({
      id: "milestone-proof-gap",
      projectId: "project-proof-gap",
      title: "Imported completed milestone without receipt",
      status: "complete",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    });
    fs.writeFileSync(ledgerPath, JSON.stringify(ledger, null, 2));

    const summary = okPayload<{
      portfolio: {
        projectsTotal: number;
        needsAttention?: number;
        proofGaps?: number;
        overdue?: number;
        stale?: number;
      };
    }>(await invoke("pcc.summary.get", {}));

    expect(summary.portfolio.projectsTotal).toBe(4);
    expect(summary.portfolio.needsAttention).toBe(4);
    expect(summary.portfolio.proofGaps).toBe(1);
    expect(summary.portfolio.overdue).toBe(1);
    expect(summary.portfolio.stale).toBe(1);
  });
});
