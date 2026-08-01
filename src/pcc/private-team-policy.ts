import type { PccAttachment, PccProject } from "../../packages/gateway-protocol/src/index.js";

type PccProjectLedgerView = {
  projects: readonly PccProject[];
};

/**
 * PCC's intended operating envelope for a private Mac Studio team.
 *
 * This is deliberately a bounded policy, not a multi-tenant authorization
 * system. Gateway authentication remains the access boundary; every
 * authenticated operator can see the shared PCC ledger. The limits keep a
 * small team responsive and make failure/recovery behavior predictable.
 */
export const PCC_PRIVATE_TEAM_POLICY_SCHEMA_VERSION = 1 as const;
export const PCC_PRIVATE_TEAM_MAX_MEMBERS = 5 as const;
export const PCC_PRIVATE_TEAM_MAX_PROJECTS = 100 as const;
export const PCC_PRIVATE_TEAM_MAX_CONCURRENT_PLANNING_RUNS = 2 as const;
export const PCC_PRIVATE_TEAM_MAX_ATTACHMENTS_PER_PROJECT = 200 as const;
export const PCC_PRIVATE_TEAM_MAX_ATTACHMENT_BYTES_PER_PROJECT = 1_073_741_824 as const;

export type PccPrivateTeamPolicy = {
  schemaVersion: typeof PCC_PRIVATE_TEAM_POLICY_SCHEMA_VERSION;
  accessMode: "authenticated_gateway_operators";
  memberLimit: typeof PCC_PRIVATE_TEAM_MAX_MEMBERS;
  maxProjects: typeof PCC_PRIVATE_TEAM_MAX_PROJECTS;
  maxConcurrentPlanningRuns: typeof PCC_PRIVATE_TEAM_MAX_CONCURRENT_PLANNING_RUNS;
  maxAttachmentsPerProject: typeof PCC_PRIVATE_TEAM_MAX_ATTACHMENTS_PER_PROJECT;
  maxAttachmentBytesPerProject: typeof PCC_PRIVATE_TEAM_MAX_ATTACHMENT_BYTES_PER_PROJECT;
  backupMode: "transactional_sqlite_plus_last_known_good";
  localAiPreferred: true;
};

export const DEFAULT_PCC_PRIVATE_TEAM_POLICY: PccPrivateTeamPolicy = {
  schemaVersion: PCC_PRIVATE_TEAM_POLICY_SCHEMA_VERSION,
  accessMode: "authenticated_gateway_operators",
  memberLimit: PCC_PRIVATE_TEAM_MAX_MEMBERS,
  maxProjects: PCC_PRIVATE_TEAM_MAX_PROJECTS,
  maxConcurrentPlanningRuns: PCC_PRIVATE_TEAM_MAX_CONCURRENT_PLANNING_RUNS,
  maxAttachmentsPerProject: PCC_PRIVATE_TEAM_MAX_ATTACHMENTS_PER_PROJECT,
  maxAttachmentBytesPerProject: PCC_PRIVATE_TEAM_MAX_ATTACHMENT_BYTES_PER_PROJECT,
  backupMode: "transactional_sqlite_plus_last_known_good",
  localAiPreferred: true,
};

export function normalizePccPrivateTeamPolicy(value: unknown): PccPrivateTeamPolicy {
  // The first MVP intentionally has no user-configurable knobs. Returning a
  // complete canonical policy here prevents partially written settings from
  // silently weakening the small-team guardrails after a restart.
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return DEFAULT_PCC_PRIVATE_TEAM_POLICY;
  }
  const source = value as Record<string, unknown>;
  if (
    source.schemaVersion !== PCC_PRIVATE_TEAM_POLICY_SCHEMA_VERSION ||
    source.accessMode !== DEFAULT_PCC_PRIVATE_TEAM_POLICY.accessMode ||
    source.backupMode !== DEFAULT_PCC_PRIVATE_TEAM_POLICY.backupMode ||
    source.memberLimit !== PCC_PRIVATE_TEAM_MAX_MEMBERS ||
    source.maxProjects !== PCC_PRIVATE_TEAM_MAX_PROJECTS ||
    source.maxConcurrentPlanningRuns !== PCC_PRIVATE_TEAM_MAX_CONCURRENT_PLANNING_RUNS ||
    source.maxAttachmentsPerProject !== PCC_PRIVATE_TEAM_MAX_ATTACHMENTS_PER_PROJECT ||
    source.maxAttachmentBytesPerProject !== PCC_PRIVATE_TEAM_MAX_ATTACHMENT_BYTES_PER_PROJECT ||
    source.localAiPreferred !== true
  ) {
    return DEFAULT_PCC_PRIVATE_TEAM_POLICY;
  }
  return DEFAULT_PCC_PRIVATE_TEAM_POLICY;
}

export function activePccProjectCount(ledger: PccProjectLedgerView): number {
  return ledger.projects.filter((project) => project.status !== "archived").length;
}

export function projectCapacityError(
  ledger: PccProjectLedgerView,
  project: PccProject | undefined,
  policy: PccPrivateTeamPolicy = DEFAULT_PCC_PRIVATE_TEAM_POLICY,
): string | null {
  if (project && project.status !== "archived") {
    return null;
  }
  if (activePccProjectCount(ledger) >= policy.maxProjects) {
    return `This private PCC workspace is limited to ${policy.maxProjects} active projects. Archive an old project before creating another.`;
  }
  return null;
}

export function projectAttachmentUsage(
  attachments: readonly PccAttachment[],
  projectId: string,
): { count: number; bytes: number } {
  return attachments.reduce(
    (usage, attachment) => {
      if (attachment.projectId === projectId && attachment.status !== "tombstoned") {
        usage.count += 1;
        usage.bytes += attachment.sizeBytes;
      }
      return usage;
    },
    { count: 0, bytes: 0 },
  );
}

export function attachmentCapacityError(
  attachments: readonly PccAttachment[],
  projectId: string,
  incomingBytes: number,
  policy: PccPrivateTeamPolicy = DEFAULT_PCC_PRIVATE_TEAM_POLICY,
  replacingAttachmentId?: string,
): string | null {
  const usage = projectAttachmentUsage(
    attachments.filter((attachment) => attachment.id !== replacingAttachmentId),
    projectId,
  );
  if (usage.count >= policy.maxAttachmentsPerProject) {
    return `This project is limited to ${policy.maxAttachmentsPerProject} attached files. Remove an unused file before adding another.`;
  }
  if (usage.bytes + incomingBytes > policy.maxAttachmentBytesPerProject) {
    return "This project's attachment storage limit is 1 GiB. Remove an unused file or attach a smaller file.";
  }
  return null;
}
