import type { PccAttachmentsClarifyParams, PccAttachmentsClarifyResult } from "./types.js";

/** The original attachment-clarification wire shape predates project-scoped receipts. */
export const PCC_ATTACHMENTS_CLARIFY_LEGACY_VERSION = 1 as const;
/** The project-scoped shape adds projectId on input and runId on output. */
export const PCC_ATTACHMENTS_CLARIFY_PROJECT_SCOPED_VERSION = 2 as const;

export type PccAttachmentsClarifyContractVersion =
  | typeof PCC_ATTACHMENTS_CLARIFY_LEGACY_VERSION
  | typeof PCC_ATTACHMENTS_CLARIFY_PROJECT_SCOPED_VERSION;

export type MigratedPccAttachmentsClarifyParams =
  | (PccAttachmentsClarifyParams & {
      version: typeof PCC_ATTACHMENTS_CLARIFY_LEGACY_VERSION;
      projectId: undefined;
    })
  | (PccAttachmentsClarifyParams & {
      version: typeof PCC_ATTACHMENTS_CLARIFY_PROJECT_SCOPED_VERSION;
      projectId: string;
    });

/**
 * Classifies the two wire shapes without guessing a missing project identity.
 * Validation runs before this adapter, so a present-but-invalid projectId cannot
 * silently downgrade to the legacy path.
 */
export function migratePccAttachmentsClarifyParams(
  params: PccAttachmentsClarifyParams,
): MigratedPccAttachmentsClarifyParams {
  const projectId: unknown = params.projectId;
  if (projectId === undefined) {
    return {
      ...params,
      projectId: undefined,
      version: PCC_ATTACHMENTS_CLARIFY_LEGACY_VERSION,
    };
  }
  if (typeof projectId !== "string" || projectId.trim().length === 0) {
    throw new Error("project-scoped attachment clarification requires a non-empty projectId");
  }
  return {
    ...params,
    projectId,
    version: PCC_ATTACHMENTS_CLARIFY_PROJECT_SCOPED_VERSION,
  };
}

/**
 * Emits the response shape understood by each client generation. Legacy clients
 * must not be forced to decode project-scoped receipt fields they never requested.
 */
export function migratePccAttachmentsClarifyResult(
  result: PccAttachmentsClarifyResult,
  version: PccAttachmentsClarifyContractVersion,
): PccAttachmentsClarifyResult {
  if (version === PCC_ATTACHMENTS_CLARIFY_LEGACY_VERSION) {
    return {
      clarifiedInstructions: result.clarifiedInstructions,
      provenance: result.provenance,
    };
  }
  if (!result.runId) {
    throw new Error("project-scoped attachment clarification must include runId");
  }
  return result;
}
