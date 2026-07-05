import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pccHandlers } from "../../src/gateway/server-methods/pcc.js";
import type { GatewayRequestHandlerOptions } from "../../src/gateway/server-methods/types.js";
import { evaluatePccProjectSetup } from "../../src/pcc/intake-quality.js";
import { pccResponsibilityForItem } from "../../src/pcc/metadata.js";
import { buildPccWorkflowDraft } from "../../src/pcc/project-workflows.js";
import { getPccWorkLoopNext } from "../../src/pcc/work-loop.js";
import { buildPccWorkStartBlockers } from "../../src/pcc/work-start.js";
import type { PccMilestone, PccProject, PccSubMilestone } from "../../ui/src/ui/types.js";

type RespondCall = [boolean, unknown?, unknown?];

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

async function invoke(method: keyof typeof pccHandlers, params: Record<string, unknown>) {
  const calls: RespondCall[] = [];
  const handler = pccHandlers[method];
  assert(handler, `missing handler: ${method}`);
  await handler({
    req: { type: "req", id: `${method}-1`, method, params },
    params,
    client: null,
    isWebchatConnect: () => false,
    respond: ((ok: boolean, payload?: unknown, error?: unknown) => {
      calls.push([ok, payload, error]);
    }) as GatewayRequestHandlerOptions["respond"],
    context: {} as GatewayRequestHandlerOptions["context"],
  });
  assert(calls.length === 1, `${method} should respond exactly once`);
  const [ok, payload, error] = calls[0];
  assert(ok, `${method} failed: ${JSON.stringify(error)}`);
  return payload as Record<string, unknown>;
}

function intakeMetadata(templateId: string) {
  return {
    pccWorkflowTemplateId: templateId,
    pccIntake: {
      approved: true,
      answers: {
        goal: "Prove future project setup gates are canonical.",
        firstDeliverable: "A temporary workflow project that can start safely.",
        doneProof: "Setup evaluation and work-loop proof pass.",
        constraints: "No project-specific deliverables or external side effects.",
        owner: "local_openclaw_agent",
        blockers: "None.",
      },
    },
  };
}

async function main() {
  const previousStateDir = process.env.OPENCLAW_STATE_DIR;
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "openclaw-pcc-future-contract-"));
  process.env.OPENCLAW_STATE_DIR = root;
  try {
    const draft = buildPccWorkflowDraft({
      title: "Future Project Setup Contract",
      goal: "Prove future project setup gates are canonical.",
      templateId: "software-product",
      planningMode: "local_project_manager",
    });
    const projectResult = await invoke("pcc.projects.upsert", {
      project: {
        ...draft.project,
        metadata: {
          ...draft.project.metadata,
          ...intakeMetadata("software-product"),
        },
      },
    });
    const project = projectResult.project as PccProject;
    const milestones: PccMilestone[] = [];
    const subMilestones: PccSubMilestone[] = [];

    for (const milestoneDraft of draft.milestones.slice(0, 2)) {
      const milestoneResult = await invoke("pcc.milestones.upsert", {
        milestone: { ...milestoneDraft, projectId: project.id },
      });
      const milestone = milestoneResult.milestone as PccMilestone;
      milestones.push(milestone);
      assert(
        pccResponsibilityForItem(milestone),
        `new milestone lacks canonical responsibility: ${milestone.title}`,
      );
      assert(
        milestone.metadata?.pccProofLevel,
        `new milestone lacks proof level: ${milestone.title}`,
      );
      assert(
        milestone.implementationPlan,
        `new milestone lacks implementation plan: ${milestone.title}`,
      );
      assert(
        milestone.acceptanceCriteria?.length,
        `new milestone lacks acceptance criteria: ${milestone.title}`,
      );
      for (const subDraft of draft.subMilestonesByMilestoneTitle[milestone.title] ?? []) {
        const subResult = await invoke("pcc.subMilestones.upsert", {
          subMilestone: { ...subDraft, projectId: project.id, milestoneId: milestone.id },
        });
        const subMilestone = subResult.subMilestone as PccSubMilestone;
        subMilestones.push(subMilestone);
        assert(
          pccResponsibilityForItem(subMilestone),
          `new sub-milestone lacks canonical responsibility: ${subMilestone.title}`,
        );
      }
    }

    const setup = evaluatePccProjectSetup({ project, milestones, subMilestones });
    assert(setup.runnable, `future project should be runnable: ${JSON.stringify(setup)}`);
    const next = getPccWorkLoopNext({
      project,
      milestones,
      subMilestones,
      permissions: [],
      receipts: [],
    });
    assert(
      next.state === "ready" || next.state === "working",
      `unexpected next state: ${next.state}`,
    );
    assert(next.milestone, "future project should have a next safe milestone");

    const heldProject = {
      ...project,
      status: "on_hold" as const,
      metadata: { ...project.metadata, pccCurrentScope: "excluded_project_specific_work" },
    };
    const heldBlockers = buildPccWorkStartBlockers({
      project: heldProject,
      milestones,
      subMilestones,
      permissions: [],
      receipts: [],
    });
    assert(
      heldBlockers.some((blocker) => blocker.includes("Project is on hold")),
      `held project should show resume blocker: ${JSON.stringify(heldBlockers)}`,
    );
    assert(
      !heldBlockers.some((blocker) => blocker.includes("Project setup quality gate is missing")),
      "held project should not show old generic setup failure",
    );

    const legacyResult = await invoke("pcc.milestones.upsert", {
      milestone: {
        projectId: project.id,
        title: "Legacy caller milestone",
        status: "not_started",
        metadata: { recommendedWorker: "OpenClaw local agent" },
      },
    });
    const legacyMilestone = legacyResult.milestone as PccMilestone;
    assert(
      legacyMilestone.metadata?.pccResponsibility === "local_openclaw_agent",
      "gateway should canonicalize legacy caller metadata on write",
    );

    console.log("PCC_FUTURE_PROJECT_SETUP_CONTRACT_SMOKE_OK");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    if (previousStateDir === undefined) {
      delete process.env.OPENCLAW_STATE_DIR;
    } else {
      process.env.OPENCLAW_STATE_DIR = previousStateDir;
    }
  }
}

await main();
