// Canonical project-action precedence shared by PCC UI and mutation controllers.
import type {
  PccPermissionGrant,
  PccProject,
  PccStatus,
} from "../../packages/gateway-protocol/src/schema/types.js";

export type PccPrimaryActionId =
  | "pause"
  | "resume"
  | "fix_setup"
  | "review_permission"
  | "review_blocker"
  | "work"
  | "view_details"
  | "no_action_required";

export type PccProjectActionResolution = {
  primaryActionId: PccPrimaryActionId;
  primaryLabel: string;
  explanation: string;
  statusLabel: string;
  blockerLines: string[];
  topBlocker?: string;
  hideWorkControls: boolean;
};

export type PccProjectActionInput = {
  project: Pick<PccProject, "status">;
  setupReady: boolean;
  blockerLines?: readonly string[];
  permissions?: readonly Pick<PccPermissionGrant, "status" | "type">[];
  hasBlockedMilestone?: boolean;
  workLoop?: {
    enabled: boolean;
    state: string;
  };
};

const TERMINAL_STATUSES = new Set<PccStatus>([
  "complete",
  "complete_with_maintenance",
  "skipped",
  "archived",
]);

function formatStatus(value: string): string {
  return value
    .split("_")
    .filter(Boolean)
    .map((part) => `${part.slice(0, 1).toUpperCase()}${part.slice(1)}`)
    .join(" ");
}

/**
 * Resolves exactly one project-level action. The action ordering is intentional:
 * explicit holds and terminal states win over setup, then safety gates win over work.
 */
export function resolvePccProjectAction(input: PccProjectActionInput): PccProjectActionResolution {
  const blockers = [...(input.blockerLines ?? [])];
  const permission = input.permissions?.find((item) => item.status === "needed");
  if (input.project.status === "on_hold") {
    const topBlocker =
      blockers[0] ?? "Project is on hold. Resume it before starting supervised work.";
    return {
      primaryActionId: "resume",
      primaryLabel: "Resume Project",
      explanation:
        "Resume the project first. PCC will still stop at missing tools, permissions, proof, or safety gates.",
      statusLabel: "On hold",
      blockerLines: blockers.length ? blockers : [topBlocker],
      topBlocker,
      hideWorkControls: true,
    };
  }
  if (TERMINAL_STATUSES.has(input.project.status)) {
    const maintenance = input.project.status === "complete_with_maintenance";
    return {
      primaryActionId: maintenance ? "no_action_required" : "view_details",
      primaryLabel: maintenance ? "No Action Required" : "View Details",
      explanation: maintenance
        ? "This project is complete. Review history or start a new improvement only when maintenance is needed."
        : "This project is complete and outside the active work path.",
      statusLabel: maintenance ? "Maintenance" : "Complete",
      blockerLines: [],
      hideWorkControls: true,
    };
  }
  if (!input.setupReady) {
    return {
      primaryActionId: "fix_setup",
      primaryLabel: "Fix Setup with AI",
      explanation: "PCC can draft the missing setup, then you approve it before work starts.",
      statusLabel: "Needs setup",
      blockerLines: blockers,
      topBlocker: blockers[0],
      hideWorkControls: true,
    };
  }
  if (permission) {
    const topBlocker =
      blockers[0] ?? `A ${formatStatus(permission.type)} permission must be reviewed.`;
    return {
      primaryActionId: "review_permission",
      primaryLabel: "Review Permission",
      explanation: `A ${formatStatus(permission.type)} permission must be reviewed before work continues.`,
      statusLabel: "Needs permission",
      blockerLines: blockers.length ? blockers : [topBlocker],
      topBlocker,
      hideWorkControls: false,
    };
  }
  if (input.project.status === "blocked" || input.hasBlockedMilestone) {
    const topBlocker = blockers[0] ?? "A blocked milestone needs review.";
    return {
      primaryActionId: "review_blocker",
      primaryLabel: "Review Blocker",
      explanation: "Review the blocker list, fix the first blocker, then continue.",
      statusLabel: "Blocked",
      blockerLines: blockers.length ? blockers : [topBlocker],
      topBlocker,
      hideWorkControls: false,
    };
  }
  if (input.workLoop?.enabled && input.workLoop.state === "working") {
    return {
      primaryActionId: "pause",
      primaryLabel: "Pause",
      explanation: "Pause the active guided work loop after the current safe checkpoint.",
      statusLabel: "Working",
      blockerLines: [],
      hideWorkControls: false,
    };
  }
  return {
    primaryActionId: "work",
    primaryLabel: "Work This Project",
    explanation: "PCC will prepare the next safe milestone or sub-step.",
    statusLabel: "Ready",
    blockerLines: [],
    hideWorkControls: false,
  };
}
