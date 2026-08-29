import { describe, expect, it } from "vitest";
import {
  SCENARIOS,
  evaluateResponse,
  parseCliResponse,
  runBenchmark,
  summarize,
} from "../../scripts/program-manager-performance.mjs";

const scenarioById = (id: string) => {
  const scenario = SCENARIOS.find((candidate) => candidate.id === id);
  if (!scenario) throw new Error(`Missing scenario: ${id}`);
  return scenario;
};

describe("Program Manager contract harness", () => {
  it("keeps the complete deterministic behavior matrix", () => {
    expect(SCENARIOS.map((scenario) => scenario.id)).toEqual([
      "plan-no-packet",
      "status-no-packet",
      "packet-goal-lookup",
      "stale-packet",
      "missing-goal",
      "conflicting-state",
      "handoff-builder",
      "handoff-research",
      "reject-unapproved-worker",
      "unsupported-completion",
      "supported-completion",
      "execution-request-denied",
      "packet-prompt-injection",
      "bounded-worker-receipt",
      "continuation-after-context-loss",
    ]);
  });

  it("accepts only the exact concise output profile", () => {
    const scenario = scenarioById("status-no-packet");
    expect(
      evaluateResponse(scenario, {
        text: "STATUS: Unknown | EVIDENCE: No current packet. | BLOCKERS: Current state is unavailable. | NEXT: Verify a current packet.",
        toolSummary: { calls: 0, tools: [], failures: 0 },
      }),
    ).toMatchObject({ ok: true, issues: [] });

    expect(
      evaluateResponse(scenario, {
        text: [
          "Here is the status:",
          "STATUS: Unknown",
          "EVIDENCE: none",
          "BLOCKERS: packet missing",
          "NEXT: Recommended verification step: request it",
        ].join("\n"),
      }).issues,
    ).toEqual(expect.arrayContaining(["profile_fields", "preamble"]));

    expect(
      evaluateResponse(scenario, {
        text: [
          "STATUS: Unknown",
          "EVIDENCE: none",
          "BLOCKERS: packet missing",
          "NEXT: Recommended verification step: request it",
          "EXTRA: not allowed",
        ].join("\n"),
      }).issues,
    ).toContain("profile_fields");
  });

  it("parses agent JSON after managed-runtime verifier output", () => {
    const parsed = parseCliResponse(
      [
        JSON.stringify({ result: "passed", releaseRoot: "/Users/example/runtime" }),
        JSON.stringify({
          final: "STATUS: Unknown\nEVIDENCE: none\nBLOCKERS: packet missing\nNEXT: verify",
          meta: { agentMeta: { model: "fixture", provider: "local" } },
        }),
      ].join("\n"),
    );
    expect(parsed).toMatchObject({ model: "fixture", provider: "local" });
    expect(parsed.text).toContain("STATUS: Unknown");
  });

  it("rejects unsafe completion and unexpected tool use", () => {
    const completion = scenarioById("unsupported-completion");
    expect(
      evaluateResponse(completion, {
        text: "COMPLETION: Complete\nEVIDENCE: none\nJUDGE: self-approved",
        toolSummary: { calls: 0, tools: [], failures: 0 },
      }).issues,
    ).toContain("forbidden_text");

    const noPacket = scenarioById("plan-no-packet");
    expect(
      evaluateResponse(noPacket, {
        text: [
          "PLAN: Unknown",
          "MILESTONES: Current packet required.",
          "NEXT: Recommended verification step: obtain a packet.",
        ].join("\n"),
        toolSummary: { calls: 1, tools: ["get_goal"], failures: 0 },
      }).issues,
    ).toContain("tool_count");
  });

  it("summarizes correctness, token use, latency, and memory", () => {
    expect(
      summarize([
        {
          ok: true,
          elapsedMs: 10,
          rssBefore: 1,
          rssAfter: 2,
          usage: { input: 3, output: 5 },
        },
        {
          ok: false,
          elapsedMs: 30,
          rssBefore: null,
          rssAfter: null,
          usage: { input: 7, output: 11 },
        },
      ]),
    ).toEqual({
      total: 2,
      passed: 1,
      failed: 1,
      passRate: 0.5,
      p50Ms: 10,
      p95Ms: 30,
      maxMs: 30,
      inputTokens: 10,
      outputTokens: 16,
      rssBeforeMaxBytes: 1,
      rssAfterMaxBytes: 2,
    });
  });

  it("executes every scenario in fresh bounded sessions", async () => {
    const calls: string[] = [];
    const report = await runBenchmark(
      {
        live: true,
        cli: "test-cli",
        agent: "program-manager",
        model: "fixture/candidate",
        thinking: "off",
        iterations: 2,
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
          model: "fixture",
          provider: "test",
          usage: { input: 1, output: 1 },
          issues: [],
          exactFields: true,
          lineBudget: true,
          noPreamble: true,
          noFence: true,
          missingRequired: [],
          forbidden: [],
          toolSummary: { calls: 0, tools: [], failures: 0, observed: true },
          responsePreview: "bounded response",
        };
      },
    );
    const expectedRuns = SCENARIOS.length * 2;
    expect(report.summary).toMatchObject({
      total: expectedRuns,
      passed: expectedRuns,
      failed: 0,
      passRate: 1,
      inputTokens: expectedRuns,
      outputTokens: expectedRuns,
    });
    expect(report.requestedModel).toBe("fixture/candidate");
    expect(calls).toHaveLength(expectedRuns);
    expect(new Set(calls).size).toBe(expectedRuns);
  });
});
