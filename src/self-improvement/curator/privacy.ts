import type { SelfImprovementProposal } from "../types.js";
import { CURATOR_MAX_EVIDENCE_REFERENCES, CURATOR_PROMPT_BUDGET_CHARS } from "./contract.js";
import { proposalContainsSensitiveMarker } from "./policy.js";

const PRIVATE_VALUE_PATTERN =
  /(?:-----BEGIN [A-Z ]+PRIVATE KEY-----|\bBearer\s+[A-Za-z0-9._~+/=-]+|\b(?:gh[pousr]_|sk-)[A-Za-z0-9_-]{12,}|\b(?:api[_-]?key|token|secret|password)\s*[:=]\s*[^\s,;]+)/i;
const LOCAL_PATH_PATTERN = /(?:\/Users\/[^\s]+|~\/[^\s]+|[A-Za-z]:\\[^\s]+)/g;

function bounded(value: string, max: number): string {
  const normalized = value.replaceAll(/\s+/g, " ").trim();
  return normalized.length <= max ? normalized : `${normalized.slice(0, max - 1)}…`;
}

function privacyFilter(value: string): string {
  return bounded(value.replaceAll(LOCAL_PATH_PATTERN, "[local-path]"), 360);
}

export type CuratorReviewPacket = {
  proposalId: string;
  revision: number;
  title: string;
  summary: string;
  sourceRecommendationIds: string[];
  requiredEvidence: string[];
  safetyNotes: string[];
  approvalRequired: boolean;
  testsRequired: boolean;
};

export function proposalContainsPrivateContent(proposal: SelfImprovementProposal): boolean {
  const fields = [
    proposal.title,
    proposal.summary,
    proposal.recommendedAction,
    ...proposal.requiredEvidence,
    ...proposal.safetyNotes,
  ];
  return (
    proposalContainsSensitiveMarker(proposal) ||
    fields.some((value) => PRIVATE_VALUE_PATTERN.test(value))
  );
}

export function createCuratorReviewPacket(proposal: SelfImprovementProposal): CuratorReviewPacket {
  const packet: CuratorReviewPacket = {
    proposalId: bounded(proposal.id, 160),
    revision: proposal.updatedAt,
    title: privacyFilter(proposal.title),
    summary: privacyFilter(proposal.summary),
    sourceRecommendationIds: proposal.sourceRecommendationIds
      .slice(0, CURATOR_MAX_EVIDENCE_REFERENCES)
      .map((value) => bounded(value, 160)),
    requiredEvidence: proposal.requiredEvidence
      .slice(0, CURATOR_MAX_EVIDENCE_REFERENCES)
      .map(privacyFilter),
    safetyNotes: proposal.safetyNotes.slice(0, CURATOR_MAX_EVIDENCE_REFERENCES).map(privacyFilter),
    approvalRequired: proposal.approvalRequired,
    testsRequired: proposal.testsRequired,
  };
  const serialized = JSON.stringify(packet);
  if (serialized.length > CURATOR_PROMPT_BUDGET_CHARS) {
    packet.summary = bounded(packet.summary, 160);
    packet.requiredEvidence = packet.requiredEvidence.map((value) => bounded(value, 120));
    packet.safetyNotes = packet.safetyNotes.map((value) => bounded(value, 120));
  }
  return packet;
}
