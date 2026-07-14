import { describe, expect, it } from "vitest";
import {
  createPccLearningCandidate,
  type PccLearningCandidateInput,
} from "./learning-candidates.js";
import {
  PCC_LEARNING_CANDIDATES_METADATA_KEY,
  readPccLearningCandidates,
  repairPccLearningCandidatesMetadata,
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

  it("repairs legacy five-metric promotions for QA retrial exactly once", () => {
    const value = createPccLearningCandidate(input(4)).candidate;
    const legacyMetrics = {
      speed: 95,
      accuracy: 95,
      efficiency: 95,
      first_pass_quality: 95,
      overall_quality: 95,
    };
    const metadata = {
      owner: "pcc",
      [PCC_LEARNING_CANDIDATES_METADATA_KEY]: [
        {
          ...value,
          status: "promoted",
          baselineMetrics: legacyMetrics,
          afterMetrics: legacyMetrics,
        },
      ],
    };
    const now = "2026-07-13T12:00:00.000Z";

    const repaired = repairPccLearningCandidatesMetadata(metadata, now);
    expect(repaired.repairedCount).toBe(1);
    expect(repaired.metadata.owner).toBe("pcc");
    expect(readPccLearningCandidates(repaired.metadata)).toEqual([
      expect.objectContaining({
        status: "trial",
        statusReason:
          "Legacy promotion requires QA revalidation under the 93/100 quality contract.",
        baselineMetrics: expect.objectContaining({ qa: 0 }),
        afterMetrics: expect.objectContaining({ qa: 0 }),
      }),
    ]);

    const repeated = repairPccLearningCandidatesMetadata(repaired.metadata, now);
    expect(repeated.repairedCount).toBe(0);
    expect(repeated.metadata).toEqual(repaired.metadata);
  });
});
