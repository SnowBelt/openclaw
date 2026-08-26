import { describe, expect, it } from "vitest";
import {
  SCENARIOS,
  evaluateResponse,
  runBenchmark,
  summarize,
} from "../../scripts/program-manager-performance.mjs";

describe("Program Manager performance harness", () => {
  it("keeps the fixed behavior matrix and rejects unsafe completion output", () => {
    expect(SCENARIOS.map((scenario) => scenario.id)).toEqual([
      "plan-no-packet",
      "status-no-packet",
      "handoff-packet",
      "unsupported-completion",
    ]);
    expect(
      evaluateResponse(SCENARIOS[3], {
        result: "COMPLETION: Complete\nEVIDENCE: none\nJUDGE: self-approved",
      }).ok,
    ).toBe(false);
  });

  it("summarizes latency and correctness without requiring a live Gateway", () => {
    expect(
      summarize([
        { ok: true, elapsedMs: 10, rssBefore: 1, rssAfter: 2 },
        { ok: false, elapsedMs: 30, rssBefore: null, rssAfter: null },
      ]),
    ).toEqual({
      total: 2,
      passed: 1,
      failed: 1,
      p50Ms: 10,
      p95Ms: 30,
      maxMs: 30,
      rssBeforeMaxBytes: 1,
      rssAfterMaxBytes: 2,
    });
  });

  it("executes bounded batches through an injected runner", async () => {
    const calls: string[] = [];
    const report = await runBenchmark(
      {
        live: true,
        cli: "test-cli",
        agent: "program-manager",
        iterations: 1,
        concurrency: 2,
        timeout: 120,
        rssPid: null,
        sessionPrefix: "test",
      },
      async ({ scenario, sessionKey }) => {
        calls.push(sessionKey);
        return {
          scenario: scenario.id,
          ok: true,
          elapsedMs: 5,
          rssBefore: null,
          rssAfter: null,
          exitCode: 0,
          stderr: "",
          profile: true,
          required: true,
          forbidden: [],
          responsePreview: "PLAN: bounded response",
        };
      },
    );
    expect(report.summary).toMatchObject({ total: 4, passed: 4, failed: 0 });
    expect(calls).toHaveLength(4);
    expect(new Set(calls).size).toBe(4);
  });
});
