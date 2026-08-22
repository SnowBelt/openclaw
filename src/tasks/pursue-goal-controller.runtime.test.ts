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

  it("emits typed controller evidence instead of trusting aggregate tool names", () => {
    const withoutArtifact = collectObservedWorkerEvidence(
      { meta: { toolSummary: { calls: 1, failures: 0, tools: ["write"] } } },
      [],
    );
    expect(withoutArtifact.trustedEvidence.map((record) => record.kind)).toEqual([
      "runtime_completion",
      "worker_execution",
    ]);
    const failedExecution = collectObservedWorkerEvidence(
      { meta: { toolSummary: { calls: 1, failures: 1, tools: ["write"] } } },
      [],
    );
    expect(failedExecution.trustedEvidence.map((record) => record.kind)).toEqual([
      "runtime_completion",
    ]);
    const withArtifact = collectObservedWorkerEvidence(
      { meta: { toolSummary: { calls: 2, failures: 0, tools: ["write", "test"] } } },
      ["artifact-sha256:" + "a".repeat(64)],
    );
    expect(withArtifact.trustedEvidence.at(-1)).toMatchObject({
      id: "artifact-sha256:" + "a".repeat(64),
      kind: "artifact_digest",
    });
  });

  it("derives source and config evidence from successful controller observations", () => {
    const observed = collectObservedWorkerEvidence(
      {
        meta: {
          toolSummary: {
            calls: 2,
            failures: 0,
            tools: ["read", "config"],
            observations: [
              {
                toolName: "read",
                terminalStatus: "succeeded",
                fileTarget: { path: "src/tasks/pursue-goal-controller.ts" },
                actionFingerprint: "read:src/tasks/pursue-goal-controller.ts",
              },
              {
                toolName: "config",
                terminalStatus: "succeeded",
                actionFingerprint: "config:judge-route",
                meta: "read managed Judge route",
              },
              {
                toolName: "write",
                terminalStatus: "failed",
                fileTarget: { path: "src/unsafe.ts" },
              },
            ],
          },
        },
      },
      [],
    );

    expect(observed.trustedEvidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "source_observation" }),
        expect.objectContaining({ kind: "config_observation" }),
      ]),
    );
    expect(observed.trustedEvidence).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ summary: expect.stringContaining("unsafe") }),
      ]),
    );
  });

  it("only promotes target-bound mutations and verified test commands to outcome evidence", () => {
    const observed = collectObservedWorkerEvidence(
      {
        meta: {
          toolSummary: {
            calls: 5,
            failures: 0,
            observations: [
              {
                toolName: "write",
                terminalStatus: "succeeded",
                fileTarget: { path: "src/tasks/fixed.ts" },
                actionFingerprint: "tool=write|path=src/tasks/fixed.ts",
                resultDigest: "a".repeat(64),
                postStateDigest: "b".repeat(64),
              },
              {
                toolName: "exec",
                terminalStatus: "succeeded",
                actionFingerprint: "tool=exec|meta=pnpm test src/tasks/fixed.test.ts",
                meta: "pnpm test src/tasks/fixed.test.ts",
                resultDigest: "c".repeat(64),
                exitCode: 0,
              },
              {
                toolName: "read",
                terminalStatus: "succeeded",
                fileTarget: { path: "src/tasks/fixed.ts" },
                actionFingerprint: "read:src/tasks/fixed.ts",
              },
              {
                toolName: "exec",
                terminalStatus: "succeeded",
                actionFingerprint: "tool=exec|meta=cat src/tasks/fixed.ts",
                meta: "cat src/tasks/fixed.ts",
              },
            ],
          },
        },
      },
      [],
      "Fix src/tasks/fixed.ts",
    );

    expect(observed.trustedEvidence.map((record) => record.kind)).toEqual(
      expect.arrayContaining(["source_mutation", "test_execution"]),
    );
    expect(observed.trustedEvidence).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "source_mutation",
          summary: expect.stringContaining("cat"),
        }),
      ]),
    );
    expect(observed.trustedEvidence).toEqual(
      expect.arrayContaining([expect.objectContaining({ kind: "source_observation" })]),
    );
  });

  it("rejects unrelated mutations and help-only commands as mission evidence", () => {
    const observed = collectObservedWorkerEvidence(
      {
        meta: {
          toolSummary: {
            calls: 4,
            failures: 0,
            observations: [
              {
                toolName: "apply_patch",
                terminalStatus: "succeeded",
                fileTarget: { paths: ["src/unrelated.ts"] },
                actionFingerprint: "tool=apply_patch|paths=src/unrelated.ts",
                resultDigest: "a".repeat(64),
                postStateDigest: "b".repeat(64),
              },
              {
                toolName: "exec",
                terminalStatus: "succeeded",
                actionFingerprint: "tool=exec|meta=pnpm test --help",
                meta: "pnpm test --help",
                resultDigest: "c".repeat(64),
                exitCode: 0,
              },
            ],
          },
        },
      },
      [],
      "Fix src/authentication.ts login bug",
    );

    expect(observed.trustedEvidence).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "source_mutation" }),
        expect.objectContaining({ kind: "test_execution" }),
      ]),
    );
  });

  it("does not treat a shell echo of a test command as test execution", () => {
    const observed = collectObservedWorkerEvidence(
      {
        meta: {
          toolSummary: {
            calls: 1,
            failures: 0,
            observations: [
              {
                toolName: "exec",
                terminalStatus: "succeeded",
                actionFingerprint: "tool=exec|meta=echo pnpm test authentication",
                meta: "echo pnpm test authentication",
                resultDigest: "c".repeat(64),
                exitCode: 0,
              },
            ],
          },
        },
      },
      [],
      "Fix src/authentication.ts login bug",
    );

    expect(observed.trustedEvidence).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ kind: "test_execution" })]),
    );
  });

  it("does not treat node eval or masked shell commands as verification", () => {
    const observations = [
      "node -e \\\"console.log('test src/authentication.ts')\\\"",
      "pnpm test src/authentication.test.ts || true",
    ].map((meta) => ({
      toolName: "exec",
      terminalStatus: "succeeded" as const,
      actionFingerprint: `tool=exec|meta=${meta}`,
      meta,
      resultDigest: "d".repeat(64),
      exitCode: 0,
    }));
    const observed = collectObservedWorkerEvidence(
      { meta: { toolSummary: { calls: observations.length, failures: 0, observations } } },
      [],
      "Fix src/authentication.ts login bug",
    );
    expect(observed.trustedEvidence).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ kind: "test_execution" })]),
    );
  });

  it("links a background test exec to its terminal process poll", () => {
    const observed = collectObservedWorkerEvidence(
      {
        meta: {
          toolSummary: {
            calls: 2,
            failures: 0,
            observations: [
              {
                toolName: "exec",
                terminalStatus: "running",
                asyncTaskId: "session-1",
                meta: "pnpm test src/tasks/fixed.test.ts",
              },
              {
                toolName: "process",
                terminalStatus: "succeeded",
                asyncTaskId: "session-1",
                meta: "process poll session-1",
                resultDigest: "e".repeat(64),
                exitCode: 0,
              },
            ],
          },
        },
      },
      [],
      "Fix src/tasks/fixed.ts",
    );

    expect(observed.trustedEvidence).toEqual(
      expect.arrayContaining([expect.objectContaining({ kind: "test_execution" })]),
    );
  });

  it("promotes only branded configuration post-state evidence", () => {
    const observed = collectObservedWorkerEvidence(
      {
        meta: {
          toolSummary: {
            calls: 1,
            failures: 0,
            observations: [
              {
                toolName: "gateway",
                terminalStatus: "succeeded",
                actionFingerprint: "gateway:config.patch|path=agents.list[].model",
                meta: "config.patch Judge route",
                resultDigest: "a".repeat(64),
                postStateDigest: "b".repeat(64),
              },
            ],
          },
        },
      },
      [],
      "Configure the Judge route",
    );
    expect(observed.trustedEvidence).toEqual(
      expect.arrayContaining([expect.objectContaining({ kind: "config_mutation" })]),
    );
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
