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
    id: "project.open",
    label: "Open Project",
    selector: "[data-pcc-project-open]",
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
    { label: "Setup ready", passed: setup.runnable },
    { label: "No active blockers", passed: blockers.length === 0 },
    { label: "Permissions clear", passed: !permissionBlocked },
    { label: "Milestones executable", passed: milestoneMissing.length === 0 },
    { label: "Proof path known", passed: proofKnown },
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
