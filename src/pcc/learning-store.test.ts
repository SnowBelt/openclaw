import { describe, expect, it } from "vitest";
import {
  createPccLearningCandidate,
  type PccLearningCandidateInput,
} from "./learning-candidates.js";
import {
  PCC_LEARNING_CANDIDATES_METADATA_KEY,
  readPccLearningCandidates,
  storePccLearningCandidate,
} from "./learning-store.js";

function input(id: number): PccLearningCandidateInput {
  const revision = String(id);
  return {
    projectId: "project-1",
    revision,
    currentRevision: revision,
    receipt: {
      id: `receipt-${id}`,
      projectId: "project-1",
      revision,
      finalized: true,
      sanitized: true,
      evidenceIds: [`evidence-${id}`],
    },
    evidence: [
      {
        id: `evidence-${id}`,
        projectId: "project-1",
        revision,
        finalized: true,
        sanitized: true,
        status: "passed",
      },
    ],
    decision: {
      id: `decision-${id}`,
      projectId: "project-1",
      revision,
      finalized: true,
      sanitized: true,
      evidenceIds: [`evidence-${id}`],
    },
    contentSummary: `Recommendation ${id}`,
    createdAt: new Date(Date.UTC(2026, 6, 1, 0, 0, id)).toISOString(),
    expiresAt: new Date(Date.UTC(2026, 7, 1, 0, 0, id)).toISOString(),
  };
}

describe("PCC learning candidate store", () => {
  it("ignores malformed metadata and returns immutable clones", () => {
    const value = createPccLearningCandidate(input(1)).candidate;
    const metadata = storePccLearningCandidate(
      { [PCC_LEARNING_CANDIDATES_METADATA_KEY]: [{ invalid: true }] },
      value,
    );
    const first = readPccLearningCandidates(metadata);
    expect(Reflect.set(first[0].evidenceIds, first[0].evidenceIds.length, "mutated")).toBe(true);

    expect(readPccLearningCandidates(metadata)).toEqual([value]);
  });

  it("deduplicates by fingerprint and keeps the newest record", () => {
    const value = createPccLearningCandidate(input(2)).candidate;
    const newer = { ...value, updatedAt: "2026-07-20T00:00:00.000Z", statusReason: "newer" };
    const metadata = storePccLearningCandidate(storePccLearningCandidate({}, value), newer);

    expect(readPccLearningCandidates(metadata)).toEqual([newer]);
  });

  it("sorts newest first and enforces a bounded maximum", () => {
    let metadata: Record<string, unknown> = {};
    for (let index = 1; index <= 105; index += 1) {
      metadata = storePccLearningCandidate(
        metadata,
        createPccLearningCandidate(input(index)).candidate,
      );
    }

    const candidates = readPccLearningCandidates(metadata);
    expect(candidates).toHaveLength(100);
    expect(candidates[0]?.revision).toBe("105");
    expect(candidates.at(-1)?.revision).toBe("6");
  });

  it("preserves unrelated metadata and rejects malformed writes", () => {
    const value = createPccLearningCandidate(input(3)).candidate;
    const metadata = storePccLearningCandidate({ owner: "pcc" }, value, 1);

    expect(metadata.owner).toBe("pcc");
    expect(() => storePccLearningCandidate({}, { ...value, updatedAt: "invalid" })).toThrow(
      /malformed/,
    );
  });
});
