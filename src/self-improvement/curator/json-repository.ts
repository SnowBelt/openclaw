import {
  getSelfImprovementProposal,
  listSelfImprovementProposals,
  updateSelfImprovementCuratorDispatch,
  updateSelfImprovementCuratorStatus,
} from "../proposals.js";
import type { CuratorProposalRepository } from "./ports.js";

export function createJsonCuratorProposalRepository(params?: {
  stateDir?: string;
  storePath?: string;
}): CuratorProposalRepository {
  return {
    list: async (query) => {
      const statuses = query?.status
        ? new Set(Array.isArray(query.status) ? query.status : [query.status])
        : undefined;
      const proposals = await listSelfImprovementProposals({
        stateDir: params?.stateDir,
        storePath: params?.storePath,
        kind: ["memory_skill"],
      });
      return statuses
        ? proposals.filter((proposal) => statuses.has(proposal.curatorStatus ?? "pending_review"))
        : proposals;
    },
    get: async (id) => {
      const proposal = await getSelfImprovementProposal({
        id,
        stateDir: params?.stateDir,
        storePath: params?.storePath,
      });
      return proposal?.kind === "memory_skill" ? proposal : null;
    },
    updateStatus: async (command) =>
      await updateSelfImprovementCuratorStatus({
        ...command,
        stateDir: params?.stateDir,
        storePath: params?.storePath,
      }),
    updateDispatch: async (command) =>
      await updateSelfImprovementCuratorDispatch({
        ...command,
        stateDir: params?.stateDir,
        storePath: params?.storePath,
      }),
  };
}
