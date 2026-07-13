import { evaluatePccProjectSetup } from "../../../../src/pcc/intake-quality.js";
import { pccResponsibilityForItem } from "../../../../src/pcc/metadata.js";
import { buildPccWorkStartBlockers } from "../../../../src/pcc/work-start.js";
import type { PccProjectDetail } from "../controllers/pcc.ts";
import type { PccMilestone, PccPermissionGrant } from "../types.ts";

export type PccInteractionContract = {
  id: string;
  label: string;
  selector: string;
  surface: "project" | "milestone" | "work" | "setup" | "autopilot" | "mobile" | "proof";
  mutates: boolean;
  reversible: boolean;
  requiresPreflight: boolean;
};

export const PCC_INTERACTION_CONTRACTS: readonly PccInteractionContract[] = [
  {
    id: "project.filter",
    label: "Project Filters",
    selector: "[data-pcc-project-tabs] button",
    surface: "project",
    mutates: false,
    reversible: false,
    requiresPreflight: false,
  },
  {
    id: "project.search",
    label: "Project Search",
    selector: "[data-pcc-project-search] input",
    surface: "project",
    mutates: false,
    reversible: false,
    requiresPreflight: false,
  },
  {
    id: "project.scope",
    label: "PCC Product or Project Work",
    selector: "[data-pcc-focus-mode-option]",
    surface: "project",
    mutates: false,
    reversible: false,
    requiresPreflight: false,
  },
  {
    id: "project.open",
    label: "Open Project",
    selector: "[data-pcc-project-open]",
    surface: "project",
    mutates: false,
    reversible: false,
    requiresPreflight: false,
  },
  {
    id: "project.create",
    label: "New Project",
    selector: "[data-pcc-new-project]",
    surface: "project",
    mutates: true,
    reversible: false,
    requiresPreflight: true,
  },
  {
    id: "project.view",
    label: "Simple Detailed Agent View",
    selector: "[data-pcc-view-mode-option]",
    surface: "project",
    mutates: false,
    reversible: false,
    requiresPreflight: false,
  },
  {
    id: "project.primary",
    label: "Primary Project Action",
    selector: "[data-pcc-primary-action] button",
    surface: "project",
    mutates: true,
    reversible: false,
    requiresPreflight: true,
  },
  {
    id: "project.edit",
    label: "Edit Project",
    selector: "[data-pcc-edit-project]",
    surface: "project",
    mutates: true,
    reversible: true,
    requiresPreflight: false,
  },
  {
    id: "setup.repair",
    label: "Fix Setup with AI",
    selector: "[data-pcc-setup-repair-ai-fill]",
    surface: "setup",
    mutates: false,
    reversible: false,
    requiresPreflight: true,
  },
  {
    id: "setup.apply",
    label: "Apply Setup Preview",
    selector: "[data-pcc-autofill-apply]",
    surface: "setup",
    mutates: true,
    reversible: true,
    requiresPreflight: true,
  },
  {
    id: "blocker.action",
    label: "Resolve First Blocker",
    selector: "[data-pcc-blocker-center] button",
    surface: "project",
    mutates: true,
    reversible: false,
    requiresPreflight: true,
  },
  {
    id: "milestone.menu",
    label: "Milestone Actions",
    selector: "[data-pcc-action-menu-trigger]",
    surface: "milestone",
    mutates: true,
    reversible: true,
    requiresPreflight: false,
  },
  {
    id: "milestone.reorder",
    label: "Reorder Milestones",
    selector: "[data-pcc-reorder-mode-toggle]",
    surface: "milestone",
    mutates: true,
    reversible: true,
    requiresPreflight: false,
  },
  {
    id: "milestone.keyboard-reorder",
    label: "Move Milestone Up or Down",
    selector: "[data-pcc-milestone-reorder]",
    surface: "milestone",
    mutates: true,
    reversible: true,
    requiresPreflight: false,
  },
  {
    id: "milestone.drag-reorder",
    label: "Drag Milestone",
    selector: "[data-pcc-drag-handle='milestone']",
    surface: "milestone",
    mutates: true,
    reversible: true,
    requiresPreflight: false,
  },
  {
    id: "submilestone.menu",
    label: "Sub-step Actions",
    selector: "[data-pcc-submilestone-action-menu]",
    surface: "milestone",
    mutates: true,
    reversible: true,
    requiresPreflight: false,
  },
  {
    id: "work.prepare",
    label: "Work This Project",
    selector: "[data-pcc-work-loop] button",
    surface: "work",
    mutates: true,
    reversible: false,
    requiresPreflight: true,
  },
  {
    id: "autopilot.start",
    label: "Start Autopilot",
    selector: "[data-pcc-autopilot-start]",
    surface: "autopilot",
    mutates: true,
    reversible: false,
    requiresPreflight: true,
  },
  {
    id: "autopilot.generate",
    label: "Generate Autopilot Prompts",
    selector: "[data-pcc-autopilot-generate-prompts]",
    surface: "autopilot",
    mutates: true,
    reversible: true,
    requiresPreflight: true,
  },
  {
    id: "autopilot.pause-resume-stop",
    label: "Pause Resume or Stop Autopilot",
    selector: "[data-pcc-autopilot-pause], [data-pcc-autopilot-resume], [data-pcc-autopilot-stop]",
    surface: "autopilot",
    mutates: true,
    reversible: false,
    requiresPreflight: true,
  },
  {
    id: "autopilot.permission",
    label: "Autopilot Permission Decision",
    selector:
      "[data-pcc-autopilot-allow-low], [data-pcc-autopilot-allow-medium], [data-pcc-autopilot-deny-permission]",
    surface: "autopilot",
    mutates: true,
    reversible: true,
    requiresPreflight: true,
  },
  {
    id: "details.tabs",
    label: "Project Detail Tabs",
    selector: "[data-pcc-detail-tab]",
    surface: "proof",
    mutates: false,
    reversible: false,
    requiresPreflight: false,
  },
  {
    id: "context.copy",
    label: "Copy Context Package",
    selector: "[data-pcc-copy-context]",
    surface: "project",
    mutates: false,
    reversible: false,
    requiresPreflight: false,
  },
  {
    id: "decision.create",
    label: "Add Decision",
    selector: "[data-pcc-open-decision-form]",
    surface: "project",
    mutates: true,
    reversible: false,
    requiresPreflight: false,
  },
  {
    id: "recovery.refresh",
    label: "Refresh After Failure",
    selector: "[data-pcc-recovery-center] button",
    surface: "project",
    mutates: false,
    reversible: false,
    requiresPreflight: false,
  },
  {
    id: "empty.navigate",
    label: "Leave Empty Project View",
    selector: "[data-pcc-empty-actions] button",
    surface: "project",
    mutates: false,
    reversible: false,
    requiresPreflight: false,
  },
  {
    id: "mobile.primary",
    label: "Mobile Primary Action",
    selector: "[data-pcc-mobile-primary-action]",
    surface: "mobile",
    mutates: true,
    reversible: false,
    requiresPreflight: true,
  },
];

export type PccExecutionReadiness = {
  score: number;
  label: "Ready" | "Needs review" | "Blocked";
  missing: string[];
  checks: Array<{ label: string; passed: boolean }>;
};

function missingMilestoneInputs(milestones: readonly PccMilestone[]): string[] {
  const missing: string[] = [];
  for (const milestone of milestones.filter((item) => item.status !== "archived")) {
    if (!pccResponsibilityForItem(milestone)) {
      missing.push(`Owner missing: ${milestone.title}`);
    }
    if (!milestone.implementationPlan?.trim()) {
      missing.push(`Plan missing: ${milestone.title}`);
    }
    if ((milestone.acceptanceCriteria ?? []).length === 0) {
      missing.push(`Acceptance criteria missing: ${milestone.title}`);
    }
  }
  return missing;
}

export function buildPccExecutionReadiness(detail: PccProjectDetail): PccExecutionReadiness {
  const setup = evaluatePccProjectSetup({
    project: detail.project,
    milestones: detail.milestones,
    subMilestones: detail.subMilestones ?? [],
  });
  const blockers = buildPccWorkStartBlockers({
    project: detail.project,
    milestones: detail.milestones,
    subMilestones: detail.subMilestones ?? [],
    permissions: detail.permissions,
    receipts: detail.receipts,
  });
  const milestoneMissing = missingMilestoneInputs(detail.milestones);
  const permissionBlocked = detail.permissions.some((permission) => permission.status === "needed");
  const proofKnown =
    detail.evidence.length > 0 ||
    detail.receipts.length > 0 ||
    detail.summary.proofGaps.length === 0;
  const checks = [
    {
      label: setup.runnable ? "Setup ready" : "Setup needs attention",
      passed: setup.runnable,
    },
    {
      label:
        blockers.length === 0
          ? "No active blockers"
          : `${blockers.length} active blocker${blockers.length === 1 ? "" : "s"}`,
      passed: blockers.length === 0,
    },
    {
      label: permissionBlocked ? "Permission needed" : "Permissions clear",
      passed: !permissionBlocked,
    },
    {
      label:
        milestoneMissing.length === 0
          ? "Milestones executable"
          : "Milestone details need attention",
      passed: milestoneMissing.length === 0,
    },
    {
      label: proofKnown ? "Proof path known" : "Proof path missing",
      passed: proofKnown,
    },
  ];
  const passed = checks.filter((check) => check.passed).length;
  const score = Math.round((passed / checks.length) * 100);
  const missing = [
    ...setup.missing,
    ...setup.violations,
    ...setup.needsReview,
    ...blockers,
    ...milestoneMissing,
    ...(permissionBlocked ? ["A permission is waiting for review."] : []),
    ...(proofKnown ? [] : ["Proof path is not recorded yet."]),
  ];
  return {
    score,
    label: score >= 90 ? "Ready" : score >= 60 ? "Needs review" : "Blocked",
    missing: [...new Set(missing)].slice(0, 6),
    checks,
  };
}

export type PccPreflightResult = {
  status: "pass" | "blocked";
  summary: string;
  blockers: string[];
};

export function buildPccUniversalPreflight(detail: PccProjectDetail): PccPreflightResult {
  const readiness = buildPccExecutionReadiness(detail);
  if (readiness.score >= 90 && readiness.missing.length === 0) {
    return {
      status: "pass",
      summary: "Preflight passed. PCC can prepare the next safe step.",
      blockers: [],
    };
  }
  return {
    status: "blocked",
    summary: "Preflight blocked. Fix the listed items before starting work.",
    blockers: readiness.missing,
  };
}

export function pccInteractionContractCoverage(): {
  total: number;
  mutating: number;
  preflighted: number;
  reversible: number;
} {
  return {
    total: PCC_INTERACTION_CONTRACTS.length,
    mutating: PCC_INTERACTION_CONTRACTS.filter((contract) => contract.mutates).length,
    preflighted: PCC_INTERACTION_CONTRACTS.filter((contract) => contract.requiresPreflight).length,
    reversible: PCC_INTERACTION_CONTRACTS.filter((contract) => contract.reversible).length,
  };
}

export function permissionSummary(permissions: readonly PccPermissionGrant[]): string {
  const needed = permissions.filter((permission) => permission.status === "needed").length;
  if (needed === 0) {
    return "No permissions are waiting.";
  }
  return `${needed} permission${needed === 1 ? "" : "s"} waiting.`;
}
