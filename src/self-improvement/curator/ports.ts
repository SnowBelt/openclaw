import type {
  SelfImprovementCurationReview,
  SelfImprovementCuratorStatus,
  SelfImprovementProposal,
} from "../types.js";

export type CuratorProposalQuery = {
  status?: SelfImprovementCuratorStatus | readonly SelfImprovementCuratorStatus[];
};

export type CuratorStatusUpdate = {
  id: string;
  curatorStatus: SelfImprovementCuratorStatus;
  expectedUpdatedAt?: number;
  expectedCuratorStatus?: SelfImprovementCuratorStatus;
  proof?: string;
  reason?: string;
  workshopProposalId?: string;
  workshopProposalStatus?: SelfImprovementProposal["workshopProposalStatus"];
  review?: SelfImprovementCurationReview;
  note?: string;
  now?: number;
};

export type CuratorDispatchUpdate = {
  id: string;
  status: NonNullable<SelfImprovementProposal["curatorDispatch"]>["status"];
  attempts?: number;
  lastAttemptAt?: number;
  nextAttemptAt?: number;
  error?: string;
  now?: number;
};

export type CuratorProposalRepository = {
  list: (query?: CuratorProposalQuery) => Promise<SelfImprovementProposal[]>;
  get: (id: string) => Promise<SelfImprovementProposal | null>;
  updateStatus: (command: CuratorStatusUpdate) => Promise<SelfImprovementProposal | null>;
  updateDispatch: (command: CuratorDispatchUpdate) => Promise<SelfImprovementProposal | null>;
};
