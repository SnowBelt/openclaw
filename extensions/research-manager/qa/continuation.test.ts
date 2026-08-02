import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const qaDir = path.dirname(fileURLToPath(import.meta.url));

type Evidence = {
  artifact?: string;
  proof: string;
};

type Continuation = {
  weightedCompletion: number;
  status: "in_progress" | "complete";
  milestones: Array<{
    id: string;
    weight: number;
    status: "pending" | "in_progress" | "passed";
    evidence: Evidence[];
  }>;
  blockers: string[];
};

describe("Research Manager milestone continuation", () => {
  it("keeps weighted completion and artifact evidence internally consistent", async () => {
    const continuation = JSON.parse(
      await fs.readFile(path.join(qaDir, "continuation.json"), "utf8"),
    ) as Continuation;
    expect(continuation.milestones.map((milestone) => milestone.id)).toEqual(
      Array.from({ length: 13 }, (_, index) => `RM-${String(index).padStart(2, "0")}`),
    );
    expect(continuation.milestones.reduce((sum, milestone) => sum + milestone.weight, 0)).toBe(100);
    const passedWeight = continuation.milestones
      .filter((milestone) => milestone.status === "passed")
      .reduce((sum, milestone) => sum + milestone.weight, 0);
    expect(continuation.weightedCompletion).toBe(passedWeight);

    for (const milestone of continuation.milestones) {
      if (milestone.status === "passed") {
        expect(milestone.evidence.length, milestone.id).toBeGreaterThan(0);
      }
      for (const evidence of milestone.evidence) {
        expect(evidence.proof.trim(), milestone.id).not.toBe("");
        if (evidence.artifact) {
          await expect(fs.access(path.resolve(qaDir, "..", evidence.artifact))).resolves.toBe(
            undefined,
          );
        }
      }
    }

    if (continuation.status === "complete") {
      expect(continuation.weightedCompletion).toBe(100);
      expect(continuation.milestones.every((milestone) => milestone.status === "passed")).toBe(
        true,
      );
      expect(continuation.blockers).toEqual([]);
    }
  });
});
