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
          summary: "Local PCC server-method test passed.",
          proofEvidenceIds: [evidence.id],
          proofLevel: "local",
          doNotRedo: ["Do not claim completion without receipt-backed evidence."],
        },
      }),
    );

    expect(receiptPayload.milestone.status).toBe("complete");
    expect(receiptPayload.milestone.percentComplete).toBe(100);
    expect(receiptPayload.summary.percentComplete).toBe(100);
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
});
