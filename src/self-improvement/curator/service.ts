import type { SelfImprovementCurationReview } from "../types.js";
import type { SelfImprovementProposal } from "../types.js";
import { validateCuratorDecision, type CuratorDecisionPolicyInput } from "./policy.js";
import type { CuratorProposalRepository, CuratorStatusUpdate } from "./ports.js";

export class CuratorProposalNotFoundError extends Error {
  constructor(proposalId: string) {
    super(`curator proposal not found: ${proposalId}`);
    this.name = "CuratorProposalNotFoundError";
  }
}

export class CuratorPolicyError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "CuratorPolicyError";
    this.code = code;
  }
}

export class CuratorDecisionConflictError extends Error {
  constructor(proposalId: string) {
    super(`curator proposal changed while it was being reviewed: ${proposalId}`);
    this.name = "CuratorDecisionConflictError";
  }
}

export type CuratorDecisionCommand = Omit<CuratorStatusUpdate, "review"> & {
  curationReview?: SelfImprovementCurationReview;
};

export type CuratorService = {
  list: CuratorProposalRepository["list"];
  get: (id: string) => ReturnType<CuratorProposalRepository["get"]>;
  decide: (
    command: CuratorDecisionCommand,
  ) => ReturnType<CuratorProposalRepository["updateStatus"]>;
  decidePrepared: (
    existing: SelfImprovementProposal,
    command: CuratorDecisionCommand,
  ) => ReturnType<CuratorProposalRepository["updateStatus"]>;
};

async function decidePrepared(params: {
  repository: CuratorProposalRepository;
  existing: SelfImprovementProposal;
  command: CuratorDecisionCommand;
}) {
  const { existing, command } = params;
  if (existing.id !== command.id) {
    throw new CuratorPolicyError("proposal_mismatch", "prepared proposal does not match decision");
  }

  const policyInput: CuratorDecisionPolicyInput = {
    existing,
    nextStatus: command.curatorStatus,
    review: command.curationReview ?? existing.curationReview,
    proof: command.proof,
    reason: command.reason,
    workshopProposalId: command.workshopProposalId,
    workshopProposalStatus: command.workshopProposalStatus,
  };
  const validation = validateCuratorDecision(policyInput);
  if (!validation.ok) {
    throw new CuratorPolicyError(validation.failure.code, validation.failure.message);
  }

  const update: CuratorStatusUpdate = {
    id: command.id,
    curatorStatus: command.curatorStatus,
    expectedUpdatedAt: existing.updatedAt,
    expectedCuratorStatus: existing.curatorStatus ?? "pending_review",
    ...(command.proof !== undefined ? { proof: command.proof } : {}),
    ...(command.reason !== undefined ? { reason: command.reason } : {}),
    ...(command.workshopProposalId !== undefined
      ? { workshopProposalId: command.workshopProposalId }
      : {}),
    ...(command.workshopProposalStatus !== undefined
      ? { workshopProposalStatus: command.workshopProposalStatus }
      : {}),
    ...(validation.review ? { review: validation.review } : {}),
    ...(command.note !== undefined ? { note: command.note } : {}),
    ...(command.now !== undefined ? { now: command.now } : {}),
  };
  const updated = await params.repository.updateStatus(update);
  if (!updated) {
    throw new CuratorDecisionConflictError(command.id);
  }
  return updated;
}

export function createCuratorService(params: {
  repository: CuratorProposalRepository;
}): CuratorService {
  const service: CuratorService = {
    list: async (query) => await params.repository.list(query),
    get: async (id) => await params.repository.get(id),
    decide: async (command) => {
      const existing = await params.repository.get(command.id);
      if (!existing) {
        throw new CuratorProposalNotFoundError(command.id);
      }
      return await service.decidePrepared(existing, command);
    },
    decidePrepared: async (existing, command) =>
      await decidePrepared({ repository: params.repository, existing, command }),
  };
  return service;
}
