import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  preflightModel,
  parseOllamaShow,
  parseOllamaList,
  qualifyModel,
  readModelRoute,
  resolveProgramManagerEntry,
  rollbackModel,
  statusModel,
  switchModel,
  updateModelRoute,
} from "../../scripts/program-manager-model.mjs";

const temporaryRoots: string[] = [];

async function temporaryRoot() {
  const root = await mkdtemp(path.join(os.tmpdir(), "program-manager-model-test-"));
  temporaryRoots.push(root);
  return root;
}

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

function configValue(shape: "entries" | "list" = "entries") {
  const entry = {
    id: "program-manager",
    model: {
      primary: "ollama/last-known-good",
      fallbacks: ["ollama/fallback"],
    },
    params: { retained: true },
    tools: { alsoAllow: ["get_goal"] },
  };
  return shape === "list"
    ? { agents: { list: [entry] } }
    : { agents: { entries: { "program-manager": { ...entry, id: undefined } } } };
}

async function fixture(shape: "entries" | "list" = "entries") {
  const root = await temporaryRoot();
  const configPath = path.join(root, "openclaw.json");
  const stateDir = path.join(root, "state");
  await writeFile(configPath, `${JSON.stringify(configValue(shape), null, 2)}\n`);
  return {
    root,
    configPath,
    stateDir,
    command: "qualify",
    model: "ollama/candidate",
    cli: "openclaw",
    agent: "program-manager",
    iterations: 3,
    timeout: 120,
    allowHosted: false,
    json: true,
  };
}

function modelInspect(model = "ollama/candidate") {
  return JSON.stringify({
    id: model,
    provider: model.split("/")[0],
    contextWindow: 32_768,
    maxTokens: 4_096,
    input: ["text"],
    compat: { supportsTools: true },
    digest: "sha256:fixture",
  });
}

function benchmark(ok: boolean, model = "ollama/candidate") {
  return {
    schemaVersion: 2,
    generatedAt: "2026-08-29T12:00:00.000Z",
    requestedModel: model,
    thinking: "off",
    iterations: 1,
    results: [
      {
        scenario: "plan-no-packet",
        ok,
        issues: ok ? [] : ["profile_fields"],
        elapsedMs: 10,
        exitCode: 0,
        model,
        provider: model.split("/")[0],
        usage: { input: 10, output: 4 },
      },
    ],
    expectedTotal: 1,
    stoppedEarly: false,
    summary: {
      total: 1,
      passed: ok ? 1 : 0,
      failed: ok ? 0 : 1,
      passRate: ok ? 1 : 0,
    },
  };
}

function commandRunner(restarts: string[] = []) {
  return async (_file: string, args: string[]) => {
    if (args[0] === "infer") return { code: 0, stdout: modelInspect(), stderr: "" };
    if (args[0] === "--version") return { code: 0, stdout: "OpenClaw fixture\n", stderr: "" };
    if (args[0] === "gateway") {
      restarts.push(args.join(" "));
      return { code: 0, stdout: "restarted", stderr: "" };
    }
    throw new Error(`Unexpected command: ${args.join(" ")}`);
  };
}

describe("Program Manager model policy", () => {
  it("fails closed on hosted, tool-incompatible, and undersized candidates", () => {
    expect(
      preflightModel("hosted/model", {
        provider: "hosted",
        contextWindow: 32_768,
        compat: { supportsTools: true },
      }).issues,
    ).toContain("hosted_approval_required");
    expect(
      preflightModel("ollama/model", {
        provider: "ollama",
        contextWindow: 32_768,
        compat: { supportsTools: false },
      }).issues,
    ).toContain("tool_calling_unsupported");
    expect(
      preflightModel("ollama/model", {
        provider: "ollama",
        contextWindow: 4_096,
        maxTokens: 256,
      }).issues,
    ).toEqual(expect.arrayContaining(["context_too_small", "output_too_small"]));
  });

  it("parses installed Ollama capability metadata when the catalog omits a model", () => {
    const parsed = parseOllamaShow(
      "qwen3.5:9b-q4_K_M",
      "Model\n  context length  262144\nCapabilities\n  completion\n  tools\n",
    );
    expect(preflightModel("ollama/qwen3.5:9b-q4_K_M", parsed)).toMatchObject({
      ok: true,
      provider: "ollama",
      contextTokens: 262144,
      supportsTools: true,
    });
    expect(
      parseOllamaList("qwen3.5:9b-q4_K_M", "NAME ID SIZE\nqwen3.5:9b-q4_K_M 6488c96fa5fa 6.6 GB\n"),
    ).toBe("6488c96fa5fa");
  });

  it("updates either registry shape while preserving operator model parameters", () => {
    for (const shape of ["entries", "list"] as const) {
      const config = configValue(shape);
      const route = updateModelRoute(config, "ollama/candidate");
      const entry = resolveProgramManagerEntry(config);
      expect(route.before.primary).toBe("ollama/last-known-good");
      expect(readModelRoute(entry)).toEqual({
        primary: "ollama/candidate",
        fallbacks: ["ollama/last-known-good", "ollama/fallback"],
      });
      expect(entry.params).toEqual({ retained: true });
    }
  });

  it("records a failed isolated qualification without modifying active config", async () => {
    const options = await fixture();
    const before = await readFile(options.configPath, "utf8");
    const result = await qualifyModel(options, {
      runCommand: commandRunner(),
      runBenchmark: async () => benchmark(false),
      now: () => "2026-08-29T12:00:00.000Z",
    });
    expect(result).toMatchObject({ ok: false, changed: false, phase: "qualification" });
    expect(await readFile(options.configPath, "utf8")).toBe(before);
    expect(JSON.parse(await readFile(result.receiptPath!, "utf8"))).toMatchObject({
      qualified: false,
      candidate: "ollama/candidate",
    });
  });

  it("qualifies, promotes atomically, and keeps the last-known-good fallback", async () => {
    const options = { ...(await fixture("list")), command: "switch" };
    const restarts: string[] = [];
    let benchmarkCalls = 0;
    const result = await switchModel(options, {
      runCommand: commandRunner(restarts),
      runBenchmark: async () => {
        benchmarkCalls += 1;
        return benchmark(true);
      },
    });
    expect(result).toMatchObject({ ok: true, changed: true, phase: "active" });
    expect(benchmarkCalls).toBe(2);
    expect(restarts).toEqual(["gateway restart"]);
    const active = JSON.parse(await readFile(options.configPath, "utf8"));
    expect(readModelRoute(resolveProgramManagerEntry(active))).toEqual({
      primary: "ollama/candidate",
      fallbacks: ["ollama/last-known-good", "ollama/fallback"],
    });
    expect(resolveProgramManagerEntry(active).params).toEqual({
      cacheRetention: "short",
      maxTokens: 1024,
      temperature: 0,
    });
  });

  it("restores the byte-identical config when post-activation verification fails", async () => {
    const options = { ...(await fixture()), command: "switch" };
    const before = await readFile(options.configPath, "utf8");
    const restarts: string[] = [];
    let benchmarkCalls = 0;
    const result = await switchModel(options, {
      runCommand: commandRunner(restarts),
      runBenchmark: async () => {
        benchmarkCalls += 1;
        return benchmark(benchmarkCalls === 1);
      },
    });
    expect(result).toMatchObject({ ok: false, changed: false, phase: "post_activation" });
    expect(restarts).toEqual(["gateway restart", "gateway restart"]);
    expect(await readFile(options.configPath, "utf8")).toBe(before);
  });

  it("reports drift and supports an explicit rollback", async () => {
    const base = await fixture();
    const switchOptions = { ...base, command: "switch" };
    const restarts: string[] = [];
    await switchModel(switchOptions, {
      runCommand: commandRunner(restarts),
      runBenchmark: async () => benchmark(true),
    });
    const status = await statusModel(
      { ...base, command: "status", model: null },
      { runCommand: commandRunner(restarts) },
    );
    expect(status).toMatchObject({ ok: true, qualified: true, drift: false });

    const rolledBack = await rollbackModel(
      { ...base, command: "rollback", model: null },
      { runCommand: commandRunner(restarts) },
    );
    expect(rolledBack).toMatchObject({ ok: true, changed: true, phase: "rollback" });
    const active = JSON.parse(await readFile(base.configPath, "utf8"));
    expect(readModelRoute(resolveProgramManagerEntry(active)).primary).toBe(
      "ollama/last-known-good",
    );
  });
});
