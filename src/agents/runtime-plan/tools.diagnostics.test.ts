// Runtime plan tool-diagnostics tests cover the legacy provider diagnostic path
// used when no runtime plan owns tool schema diagnostics.
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  inspectProviderToolSchemaDiagnostics: vi.fn(),
  logProviderToolSchemaDiagnostics: vi.fn(),
  normalizeProviderToolSchemas: vi.fn((params: { tools: unknown[] }) => params.tools),
}));

vi.mock("../embedded-agent-runner/tool-schema-runtime.js", () => ({
  inspectProviderToolSchemaDiagnostics: mocks.inspectProviderToolSchemaDiagnostics,
  logProviderToolSchemaDiagnostics: mocks.logProviderToolSchemaDiagnostics,
  normalizeProviderToolSchemas: mocks.normalizeProviderToolSchemas,
}));

const { inspectAgentRuntimeToolDiagnostics, logAgentRuntimeToolDiagnostics } =
  await import("./tools.js");

describe("AgentRuntimePlan tool diagnostics legacy fallback", () => {
  beforeEach(() => {
    mocks.inspectProviderToolSchemaDiagnostics.mockReset();
    mocks.logProviderToolSchemaDiagnostics.mockReset();
    mocks.normalizeProviderToolSchemas.mockClear();
  });

  it("falls back to provider diagnostics when no RuntimePlan is available", () => {
    const tools = [{ name: "alpha" }] as never;

    logAgentRuntimeToolDiagnostics({
      tools,
      provider: "openai",
      modelId: "gpt-5.4",
      modelApi: "openai-responses",
      workspaceDir: "/tmp/openclaw-runtime-plan-tools",
    });

    expect(mocks.logProviderToolSchemaDiagnostics).toHaveBeenCalledTimes(1);
    expect(mocks.logProviderToolSchemaDiagnostics.mock.calls.at(0)?.[0]).toEqual({
      tools,
      provider: "openai",
      config: undefined,
      workspaceDir: "/tmp/openclaw-runtime-plan-tools",
      env: process.env,
      modelId: "gpt-5.4",
      modelApi: "openai-responses",
      model: undefined,
    });
  });

  it("returns provider diagnostics for final request preflight", () => {
    const tools = [{ name: "alpha" }] as never;
    mocks.inspectProviderToolSchemaDiagnostics.mockReturnValueOnce([
      { toolName: "alpha", toolIndex: 0, violations: ["unsupported anyOf"] },
    ]);

    expect(
      inspectAgentRuntimeToolDiagnostics({
        tools,
        provider: "openai",
        modelId: "gpt-5.4",
        modelApi: "openai-responses",
        workspaceDir: "/tmp/openclaw-runtime-plan-tools",
      }),
    ).toEqual([{ toolName: "alpha", toolIndex: 0, violations: ["unsupported anyOf"] }]);

    expect(mocks.inspectProviderToolSchemaDiagnostics).toHaveBeenCalledWith({
      tools,
      provider: "openai",
      config: undefined,
      workspaceDir: "/tmp/openclaw-runtime-plan-tools",
      env: process.env,
      modelId: "gpt-5.4",
      modelApi: "openai-responses",
      model: undefined,
    });
  });

  it("does not provider-preflight runtime-plan-owned tool diagnostics twice", () => {
    const runtimePlan = {
      tools: {
        normalize: vi.fn(),
        logDiagnostics: vi.fn(),
      },
    } as never;

    expect(
      inspectAgentRuntimeToolDiagnostics({
        runtimePlan,
        tools: [{ name: "alpha" }] as never,
        provider: "openai",
      }),
    ).toEqual([]);
    expect(mocks.inspectProviderToolSchemaDiagnostics).not.toHaveBeenCalled();
  });
});
