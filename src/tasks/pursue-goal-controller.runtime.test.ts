import { describe, expect, it, vi } from "vitest";
import type { loadWebMediaRaw } from "../media/web-media.js";
import { createPursueGoalControllerState } from "./pursue-goal-controller-state.js";
import {
  buildPursueGoalWorkerPrompt,
  collectObservedWorkerEvidence,
  collectResultArtifactIds,
  resolvePursueGoalCodexRoute,
} from "./pursue-goal-controller.runtime.js";

describe("Pursue Goal governed model route", () => {
  it("stays local and never silently spends Codex without a project approval", () => {
    const state = createPursueGoalControllerState({
      flowId: "flow-local-route",
      goal: "Complete the durable goal.",
      workerAgentId: "program-manager",
      now: 100,
    });
    expect(
      resolvePursueGoalCodexRoute({
        flowId: "flow-local-route",
        goal: "Complete the durable goal.",
        state,
        runId: "run-local-route",
        abortSignal: new AbortController().signal,
      }),
    ).toMatchObject({
      route: "local",
      reason: expect.stringContaining("local route"),
    });
  });

  it("assigns Judge execution to the controller and makes blocker confirmation explicit", () => {
    const state = {
      ...createPursueGoalControllerState({
        flowId: "flow-prompt-contract",
        goal: "Return verified evidence.",
        workerAgentId: "program-manager",
        now: 100,
      }),
      consecutiveBlockers: 1,
    };
    const prompt = buildPursueGoalWorkerPrompt(
      {
        flowId: "flow-prompt-contract",
        goal: "Return verified evidence.",
        state,
        runId: "run-prompt-contract",
        abortSignal: new AbortController().signal,
      },
      "local route",
    );

    expect(prompt).toContain("controller owns independent Judge execution");
    expect(prompt).toContain("Never request, fabricate, or wait for a Judge receipt");
    expect(prompt).toContain("call update_goal status=complete");
    expect(prompt).toContain("blocker confirmation is 1/3");
    expect(prompt).toContain("An unrun Judge is not a blocker");
  });

  it("does not treat aggregate tool names as claim-bound evidence", () => {
    expect(
      collectObservedWorkerEvidence(
        { meta: { toolSummary: { calls: 1, failures: 1, tools: ["write"] } } },
        [],
      ).observed,
    ).toBe(false);
    expect(
      collectObservedWorkerEvidence(
        {
          meta: {
            toolSummary: { calls: 2, failures: 1, tools: ["write", "update_goal"] },
          },
        },
        [],
      ).observed,
    ).toBe(false);
    expect(
      collectObservedWorkerEvidence(
        { meta: { toolSummary: { calls: 1, failures: 0, tools: ["functions.update_goal"] } } },
        [],
      ).observed,
    ).toBe(false);
    expect(
      collectObservedWorkerEvidence(
        { meta: { toolSummary: { calls: 2, failures: 0, tools: ["read", "update_goal"] } } },
        [],
      ).observed,
    ).toBe(false);
    expect(
      collectObservedWorkerEvidence(
        { meta: { toolSummary: { calls: 2, failures: 0, tools: ["write", "test"] } } },
        ["artifact-sha256:" + "a".repeat(64)],
      ).observed,
    ).toBe(true);
  });

  it("binds artifacts to guarded loaded bytes and omits unsafe references", async () => {
    const loadMedia = async (reference: string) => {
      if (reference.includes("unsafe")) {
        throw new Error("blocked by media policy");
      }
      return {
        buffer: Buffer.from(reference.includes("/a.png") ? "image-a" : "image-b"),
        contentType: "image/png",
        kind: "image" as const,
      };
    };
    const ids = await collectResultArtifactIds(
      {
        payloads: [
          {
            mediaUrls: [
              "https://signed.example/a.png?token=secret",
              "https://signed.example/b.png?token=secret",
              "https://signed.example/unsafe.png?token=secret",
            ],
          },
        ],
      },
      loadMedia,
    );

    expect(ids).toHaveLength(2);
    expect(ids.every((id) => /^artifact-sha256:[a-f0-9]{64}$/u.test(id))).toBe(true);
    expect(ids.join(" ")).not.toContain("signed.example");
    expect(ids.join(" ")).not.toContain("token");
  });

  it("bounds artifact count and aggregate bytes", async () => {
    const loadMedia = vi.fn<typeof loadWebMediaRaw>(async (reference) => ({
      buffer: Buffer.from(reference),
      contentType: "text/plain",
      kind: undefined,
    }));
    const ids = await collectResultArtifactIds(
      {
        payloads: [{ mediaUrls: ["media://a", "media://b", "media://c", "media://d"] }],
      },
      loadMedia,
      undefined,
      {
        maxCount: 4,
        maxBytes: 64,
        maxTotalBytes: 18,
        deadlineMs: 100,
        readIdleTimeoutMs: 50,
      },
    );

    expect(loadMedia).toHaveBeenCalledTimes(2);
    expect(ids).toHaveLength(2);
    expect(loadMedia.mock.calls[0]?.[1]).toMatchObject({ maxBytes: 18 });
    expect(loadMedia.mock.calls[1]?.[1]).toMatchObject({ maxBytes: 9 });
  });

  it("stops artifact collection on cancellation or deadline", async () => {
    const cancelled = new AbortController();
    cancelled.abort();
    const cancelledLoader = vi.fn(async () => ({
      buffer: Buffer.from("unused"),
      kind: undefined,
    }));
    await expect(collectResultArtifactIds({}, cancelledLoader, cancelled.signal)).resolves.toEqual(
      [],
    );
    expect(cancelledLoader).not.toHaveBeenCalled();

    const stalledLoader = vi.fn(async (_reference: string) => {
      return await new Promise<never>(() => {
        // Deliberately unresolved so the collection deadline must release the controller.
      });
    });
    const startedAt = Date.now();
    await expect(
      collectResultArtifactIds(
        { payloads: [{ mediaUrl: "media://stalled" }] },
        stalledLoader,
        undefined,
        {
          maxCount: 1,
          maxBytes: 64,
          maxTotalBytes: 64,
          deadlineMs: 10,
          readIdleTimeoutMs: 5,
        },
      ),
    ).resolves.toEqual([]);
    expect(Date.now() - startedAt).toBeLessThan(1_000);
  });
});
