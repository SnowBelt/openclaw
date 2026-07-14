import { describe, expect, it } from "vitest";
import {
  createPccLearningCandidate,
  fingerprintPccLearningCandidate,
  transitionPccLearningCandidate,
  type PccLearningCandidateInput,
  type PccLearningMetrics,
} from "./learning-candidates.js";

const metrics = (value: number): PccLearningMetrics => ({
  speed: value,
  accuracy: value,
  efficiency: value,
  first_pass_quality: value,
  qa: value,
  overall_quality: value,
});

function input(patch: Partial<PccLearningCandidateInput> = {}): PccLearningCandidateInput {
  return {
    projectId: "project-1",
    revision: "42",
    currentRevision: "42",
    receipt: {
      id: "receipt-1",
      projectId: "project-1",
      revision: "42",
      finalized: true,
      sanitized: true,
      evidenceIds: ["evidence-1"],
    },
    evidence: [
      {
        id: "evidence-1",
        projectId: "project-1",
        revision: "42",
        finalized: true,
        sanitized: true,
        status: "passed",
      },
    ],
    decision: {
      id: "decision-1",
      projectId: "project-1",
      revision: "42",
      finalized: true,
      sanitized: true,
      evidenceIds: ["evidence-1"],
    },
    contentSummary: "A bounded, evidence-backed recommendation.",
    createdAt: "2026-07-13T00:00:00.000Z",
    expiresAt: "2026-07-20T00:00:00.000Z",
    ...patch,
  };
}

describe("PCC learning candidates", () => {
  it("uses a deterministic fingerprint and returns an existing candidate for a duplicate", () => {
    const first = createPccLearningCandidate(input());
    const second = createPccLearningCandidate(input(), [first.candidate]);

    expect(fingerprintPccLearningCandidate(input())).toBe(first.candidate.fingerprint);
    expect(second).toEqual({ candidate: first.candidate, deduplicated: true });
  });

  it("rejects secret-like, raw, and stale inputs", () => {
    expect(() =>
      createPccLearningCandidate(input({ contentSummary: "token=super-secret-value" })),
    ).toThrow(/secret-like/);
    expect(() =>
      createPccLearningCandidate({
        ...input(),
        rawOutput: "untrusted model transcript",
      } as unknown as PccLearningCandidateInput),
    ).toThrow(/raw output/);
    expect(() => createPccLearningCandidate(input({ currentRevision: "43" }))).toThrow(/stale/);
  });

  it("enforces lifecycle order and expires active candidates", () => {
    const candidate = createPccLearningCandidate(input()).candidate;
    const approved = transitionPccLearningCandidate(candidate, {
      status: "approved",
      updatedAt: "2026-07-14T00:00:00.000Z",
    });
    expect(approved.status).toBe("approved");
    expect(() =>
      transitionPccLearningCandidate(candidate, {
        status: "trial",
        updatedAt: "2026-07-14T00:00:00.000Z",
      }),
    ).toThrow(/cannot transition/);
    expect(() =>
      transitionPccLearningCandidate(approved, {
        status: "trial",
        updatedAt: "2026-07-21T00:00:00.000Z",
      }),
    ).toThrow(/expired/);
    expect(
      transitionPccLearningCandidate(approved, {
        status: "expired",
        updatedAt: "2026-07-21T00:00:00.000Z",
      }).status,
    ).toBe("expired");
  });

  it("requires complete non-regressing metrics at the 93 promotion threshold", () => {
    const candidate = createPccLearningCandidate(input()).candidate;
    const approved = transitionPccLearningCandidate(candidate, {
      status: "approved",
      updatedAt: "2026-07-14T00:00:00.000Z",
    });
    const trial = transitionPccLearningCandidate(approved, {
      status: "trial",
      updatedAt: "2026-07-15T00:00:00.000Z",
    });
    expect(() =>
      transitionPccLearningCandidate(trial, {
        status: "promoted",
        updatedAt: "2026-07-16T00:00:00.000Z",
        baselineMetrics: metrics(94),
        afterMetrics: metrics(92),
      }),
    ).toThrow(/promotion requires/);
    expect(
      transitionPccLearningCandidate(trial, {
        status: "promoted",
        updatedAt: "2026-07-16T00:00:00.000Z",
        baselineMetrics: metrics(93),
        afterMetrics: metrics(93),
      }).status,
    ).toBe("promoted");
  });

  it("does not mutate source inputs or prior candidates", () => {
    const source = input();
    const sourceCopy = structuredClone(source);
    const candidate = createPccLearningCandidate(source).candidate;
    const approved = transitionPccLearningCandidate(candidate, {
      status: "approved",
      updatedAt: "2026-07-14T00:00:00.000Z",
      baselineMetrics: metrics(93),
    });

    expect(source).toEqual(sourceCopy);
    expect(candidate.status).toBe("proposed");
    expect(candidate.baselineMetrics).toBeUndefined();
    expect(approved).not.toBe(candidate);
  });
});
