import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  agentCommand: vi.fn(),
  assessJudgeLocalCapacity: vi.fn(),
  completeSimple: vi.fn(),
  getRuntimeConfig: vi.fn(),
  judgeCompletionIndependently: vi.fn(),
  prepareSimpleCompletionModelForAgent: vi.fn(),
  resolveJudgeAgentId: vi.fn(),
  resolveSimpleCompletionSelectionForAgent: vi.fn(),
}));

vi.mock("../agents/agent-command.js", () => ({
  agentCommand: mocks.agentCommand,
}));

vi.mock("../agents/agent-scope-config.js", async () => ({
  ...(await vi.importActual<typeof import("../agents/agent-scope-config.js")>(
    "../agents/agent-scope-config.js",
  )),
  resolveJudgeAgentId: mocks.resolveJudgeAgentId,
}));

vi.mock("../agents/independent-judge-service.js", async () => ({
  ...(await vi.importActual<typeof import("../agents/independent-judge-service.js")>(
    "../agents/independent-judge-service.js",
  )),
  judgeCompletionIndependently: mocks.judgeCompletionIndependently,
}));

vi.mock("../agents/judge-local-admission.js", async () => ({
  ...(await vi.importActual<typeof import("../agents/judge-local-admission.js")>(
    "../agents/judge-local-admission.js",
  )),
  assessJudgeLocalCapacity: mocks.assessJudgeLocalCapacity,
}));

vi.mock("../agents/simple-completion-runtime.js", async () => ({
  ...(await vi.importActual<typeof import("../agents/simple-completion-runtime.js")>(
    "../agents/simple-completion-runtime.js",
  )),
  prepareSimpleCompletionModelForAgent: mocks.prepareSimpleCompletionModelForAgent,
  resolveSimpleCompletionSelectionForAgent: mocks.resolveSimpleCompletionSelectionForAgent,
}));

vi.mock("../config/io.js", async () => ({
  ...(await vi.importActual<typeof import("../config/io.js")>("../config/io.js")),
  getRuntimeConfig: mocks.getRuntimeConfig,
}));

vi.mock("../llm/stream.js", async () => ({
  ...(await vi.importActual<typeof import("../llm/stream.js")>("../llm/stream.js")),
  completeSimple: mocks.completeSimple,
}));

import {
  getJudgeLocalAdmissionSnapshotForTests,
  resetJudgeLocalAdmissionForTests,
} from "../agents/judge-local-admission.js";
import { runIndependentJudge } from "./pursue-goal-controller.runtime.js";

describe("Pursue Goal Judge local route integration", () => {
  afterEach(() => {
    resetJudgeLocalAdmissionForTests();
    vi.restoreAllMocks();
  });

  it("checks capacity, takes the local lease, and invokes a deployment-named OMLX Judge once", async () => {
    mocks.getRuntimeConfig.mockReturnValue({
      agents: {
        list: [
          {
            id: "judge",
            model: {
              primary: "omlx-qwen38-judge/openclaw-qwen38-judge-standard-q8",
              fallbacks: ["openai/gpt-5.6"],
            },
          },
        ],
      },
      models: {
        providers: {
          "omlx-qwen38-judge": {
            baseUrl: "http://127.0.0.1:18182/v1",
            api: "openai-completions",
            apiKey: "local",
            localService: {
              command: "/Users/openclaw/.venvs/omlx/bin/omlx",
              cwd: "/Users/openclaw/.openclaw/qwen38-mvp",
              args: ["--port", "18182"],
            },
            route: { location: "local", billing: "included" },
            models: [],
          },
        },
      },
    });
    mocks.resolveJudgeAgentId.mockReturnValue("judge");
    mocks.assessJudgeLocalCapacity.mockResolvedValue({ decision: "admit" });
    mocks.resolveSimpleCompletionSelectionForAgent.mockReturnValue({
      provider: "omlx-qwen38-judge",
      modelId: "openclaw-qwen38-judge-standard-q8",
      agentDir: "/tmp/judge-agent",
    });
    mocks.prepareSimpleCompletionModelForAgent.mockResolvedValue({
      model: {
        provider: "omlx-qwen38-judge",
        id: "openclaw-qwen38-judge-standard-q8",
        api: "openai-completions",
        baseUrl: "http://127.0.0.1:18182/v1",
        name: "Qwen 3.8 Judge",
        contextWindow: 262_144,
        maxTokens: 8_192,
      },
      auth: { apiKey: "local", mode: "api-key" },
    });
    mocks.completeSimple.mockResolvedValue({
      role: "assistant",
      api: "openai-completions",
      provider: "omlx-qwen38-judge",
      model: "openclaw-qwen38-judge-standard-q8",
      stopReason: "stop",
      content: [{ type: "text", text: '{"verdict":"APPROVE"}' }],
      usage: {
        input: 1,
        output: 1,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: 2,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
      },
      timestamp: Date.now(),
    });
    mocks.judgeCompletionIndependently.mockImplementation(async (params) => ({
      approved: true,
      receipt: { verdict: "APPROVE" },
      deterministicVerdict: { verdict: "APPROVE" },
      modelResult: await params.runModel("judge prompt"),
    }));

    const result = await runIndependentJudge({
      input: {
        flowId: "flow-omlx",
        goal: "Complete the technical mission.",
        abortSignal: new AbortController().signal,
        reserveJudgeExecution: () => true,
        state: { missionId: "mission-omlx" },
      } as never,
      finalText: "Completed with direct evidence.",
      evidenceSummary: "direct evidence",
      artifactIds: [],
      trustedEvidence: [
        {
          id: "runtime.completion",
          kind: "runtime_completion",
          summary: "controller observed worker goal status=complete and a returned result",
        },
        {
          id: "worker.execution",
          kind: "worker_execution",
          summary: "controller observed runtime=embedded, toolCalls=1, toolFailures=0",
        },
      ],
    });

    expect(result.approved).toBe(true);
    expect(mocks.assessJudgeLocalCapacity).toHaveBeenCalledTimes(2);
    expect(mocks.completeSimple).toHaveBeenCalledOnce();
    expect(mocks.judgeCompletionIndependently).toHaveBeenCalledOnce();
    expect(mocks.agentCommand).not.toHaveBeenCalled();
    expect(getJudgeLocalAdmissionSnapshotForTests()).toEqual({
      active: false,
      queued: 0,
      owners: 0,
    });
  });
});
