#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
export const CONTROL_DIRECTOR_VERIFY_REPO_ROOT = path.resolve(SCRIPT_DIR, "..");
const DEFAULT_ARTIFACT_DIR = path.join(
  CONTROL_DIRECTOR_VERIFY_REPO_ROOT,
  ".artifacts",
  "control-director",
);
const IMMUTABLE_SHA_PATTERN = /^[a-f0-9]{40}$/u;

const CONTROL_DIRECTOR_TARGETED_TESTS = Object.freeze([
  "test/scripts/control-director-format-check.test.ts",
  "test/scripts/control-director-deployment-consistency.test.ts",
  "test/scripts/control-director-milestone-audit.test.ts",
  "test/scripts/control-director-preflight.test.ts",
  "test/scripts/control-director-readiness.test.ts",
  "test/scripts/control-director-role-config.test.ts",
  "test/scripts/control-director-roadmap-proof.test.ts",
  "test/scripts/control-director-runtime-proof.test.ts",
  "test/scripts/control-director-source-handoff.test.ts",
  "test/scripts/control-director-verify.test.ts",
  "test/scripts/custom-runtime-lifecycle.test.ts",
  "test/scripts/custom-runtime-lifecycle-arbitration.test.ts",
  "test/scripts/custom-runtime-stage-promote.test.ts",
  "test/scripts/custom-runtime-update-survival.test.ts",
  "test/scripts/control-ui-i18n.test.ts",
  "test/scripts/control-ui-control-director-no-response-smoke.test.ts",
  "test/scripts/control-ui-production-chat-stack.test.ts",
  "packages/gateway-protocol/src/index.test.ts",
  "packages/gateway-protocol/src/schema/tasks.test.ts",
  "src/agents/agent-operational-role.test.ts",
  "src/agents/agent-role-capabilities.test.ts",
  "src/agents/control-director-activity-watchdog.test.ts",
  "src/agents/control-director-codex-adapter.test.ts",
  "src/agents/control-director-contract.test.ts",
  "src/agents/control-director-context-budget.test.ts",
  "src/agents/control-director-delivery-guards.test.ts",
  "src/agents/control-director-diagnostic-evidence.test.ts",
  "src/agents/control-director-execution-profile.test.ts",
  "src/agents/control-director-instruction-torture.test.ts",
  "src/agents/control-director-memory-index.test.ts",
  "src/agents/control-director-model-eval.test.ts",
  "src/agents/control-director-model-registry.test.ts",
  "src/agents/control-director-model-warmup.test.ts",
  "src/agents/control-director-quality-rubric.test.ts",
  "src/agents/control-director-resource-governor.test.ts",
  "src/agents/control-director-resource-admission.test.ts",
  "src/agents/control-director-resource-runtime.test.ts",
  "src/agents/control-director-role.test.ts",
  "src/agents/control-director-runtime-canary.test.ts",
  "src/agents/control-director-runtime-lineage.test.ts",
  "src/agents/control-director-turn-policy.test.ts",
  "src/agents/execution-approval-envelope.test.ts",
  "src/agents/independent-judge-service.test.ts",
  "src/agents/judge-receipt-signer.test.ts",
  "src/agents/tools/sessions-spawn-tool.test.ts",
  "src/auto-reply/reply/control-director-recent-context.test.ts",
  "src/gateway/chat-turn-inbox-controller.test.ts",
  "src/gateway/chat-turn-inbox-state.test.ts",
  "src/gateway/dashboard-session-title.test.ts",
  "src/gateway/server-maintenance.test.ts",
  "src/gateway/server-methods/execution-state.test.ts",
  "src/gateway/server-methods/pcc.test.ts",
  "src/gateway/server-methods/self-improvement.test.ts",
  "src/gateway/server-methods/tasks.test.ts",
  "src/gateway/server-startup-early.test.ts",
  "src/gateway/server-startup-post-attach.test.ts",
  "src/pcc/execution-capacity.test.ts",
  "src/pcc/execution-plan.test.ts",
  "src/pcc/execution-state-projection.test.ts",
  "src/pcc/portfolio-scheduler.test.ts",
  "src/self-improvement/control-director-closure.test.ts",
  "src/self-improvement/control-director-layout-observation.test.ts",
  "src/self-improvement/control-director-journeys.test.ts",
  "src/self-improvement/control-director-self-healing.test.ts",
  "src/self-improvement/background.test.ts",
  "src/self-improvement/store.test.ts",
  "src/tasks/durable-worker-mailbox.test.ts",
  "src/tasks/execution-event.test.ts",
  "src/tasks/pursue-goal-controller-state.test.ts",
  "src/tasks/pursue-goal-blocker.test.ts",
  "src/tasks/pursue-goal-controller.runtime.test.ts",
  "src/tasks/pursue-goal-controller.test.ts",
]);

const CONTROL_DIRECTOR_UI_TESTS = Object.freeze([
  "ui/src/ui/app-chat.test.ts",
  "ui/src/ui/controllers/chat.test.ts",
  "ui/src/ui/controllers/pcc.test.ts",
  "ui/src/ui/pcc-chat-sync.test.ts",
  "ui/src/ui/sidebar-recents.test.ts",
  "ui/src/ui/views/agents.test.ts",
  "ui/src/ui/views/chat.test.ts",
  "ui/src/ui/views/pcc.test.ts",
  "ui/src/ui/chat/run-controls.test.ts",
  "ui/src/ui/chat/layout-health.test.ts",
]);

const CONTROL_DIRECTOR_EXTENSION_TESTS = Object.freeze([
  "extensions/active-memory/config.test.ts",
  "extensions/active-memory/index.test.ts",
  "extensions/ollama/src/model-residency.test.ts",
  "extensions/ollama/src/model-warmup.test.ts",
]);

function pnpmCommand() {
  return process.platform === "win32" ? "pnpm.cmd" : "pnpm";
}

function parseArgs(argv) {
  const args = {
    artifactDir: DEFAULT_ARTIFACT_DIR,
    expectedSha: process.env.OPENCLAW_EXPECTED_SOURCE_SHA?.trim().toLowerCase() ?? "",
    planOnly: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "--") {
      continue;
    }
    if (value === "--artifact-dir") {
      args.artifactDir = path.resolve(argv[++index] ?? "");
    } else if (value === "--expected-sha") {
      args.expectedSha = String(argv[++index] ?? "")
        .trim()
        .toLowerCase();
    } else if (value === "--plan") {
      args.planOnly = true;
    } else if (value === "--help" || value === "-h") {
      console.log(
        "Usage: pnpm control-director:verify -- [--expected-sha <sha>] [--artifact-dir <path>] [--plan]",
      );
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${value}`);
    }
  }
  return args;
}

function runGit(args) {
  const result = spawnSync("git", args, {
    cwd: CONTROL_DIRECTOR_VERIFY_REPO_ROOT,
    encoding: "utf8",
  });
  if (result.status !== 0) {
    throw new Error(
      `git ${args.join(" ")} failed: ${(result.stderr || result.stdout || "unknown error").trim()}`,
    );
  }
  return result.stdout.trim();
}

export function validateControlDirectorSourceIdentity({ head, expectedSha, status }) {
  const normalizedHead = String(head ?? "")
    .trim()
    .toLowerCase();
  const normalizedExpected = String(expectedSha ?? "")
    .trim()
    .toLowerCase();
  if (!IMMUTABLE_SHA_PATTERN.test(normalizedHead)) {
    return { ok: false, reason: "HEAD is not an immutable 40-character SHA." };
  }
  if (!IMMUTABLE_SHA_PATTERN.test(normalizedExpected)) {
    return { ok: false, reason: "--expected-sha must be an immutable 40-character SHA." };
  }
  if (normalizedHead !== normalizedExpected) {
    return {
      ok: false,
      reason: `Source SHA mismatch: HEAD=${normalizedHead}; expected=${normalizedExpected}.`,
    };
  }
  if (String(status ?? "").trim()) {
    return { ok: false, reason: "Source checkout is not clean." };
  }
  return { ok: true, head: normalizedHead };
}

export function buildControlDirectorSourceConfig() {
  return {
    models: {
      providers: {
        ollama: {
          models: [
            { id: "openclaw-control-gemma4-31b-q8:latest", name: "Gemma 4 31B Q8" },
            { id: "qwen3.6:27b-q8_0", name: "Qwen 3.6 27B Q8" },
          ],
        },
      },
    },
    agents: {
      defaults: {
        models: {
          "ollama/openclaw-control-gemma4-31b-q8:latest": {
            alias: "openclaw-control-gemma4-31b-q8",
          },
          "ollama/qwen3.6:27b-q8_0": { alias: "qwen-control-alternative" },
        },
      },
      list: [
        {
          id: "control-director",
          role: "control_director",
          model: {
            primary: "ollama/openclaw-control-gemma4-31b-q8:latest",
            fallbacks: ["ollama/qwen3.6:27b-q8_0"],
          },
        },
        { id: "program-manager", role: "program_manager" },
        { id: "independent-judge", role: "judge" },
      ],
    },
  };
}

export function buildControlDirectorSourceGatePlan() {
  return [
    { id: "protocol-coverage", args: ["check:protocol-coverage"] },
    { id: "protocol-generated", args: ["protocol:check"] },
    { id: "torture", args: ["control-director:torture"] },
    { id: "chaos", args: ["control-director:chaos"] },
    { id: "tests", args: ["test", ...CONTROL_DIRECTOR_TARGETED_TESTS] },
    { id: "ui-tests", args: ["test", ...CONTROL_DIRECTOR_UI_TESTS] },
    { id: "extension-tests", args: ["test", ...CONTROL_DIRECTOR_EXTENSION_TESTS] },
    { id: "ui-i18n", args: ["ui:i18n:check"] },
    {
      id: "deployment-consistency",
      args: ["control-director:deployment-consistency", "--", "--source-only"],
    },
    { id: "custom-runtime-contracts", args: ["check:custom-runtime-capabilities"] },
    { id: "update-survival", args: ["custom-runtime:update-survival"] },
    { id: "pcc-contracts", args: ["check:pcc-capabilities"] },
    { id: "plugin-sdk-api", args: ["plugin-sdk:api:check"] },
    { id: "docs-mdx", args: ["docs:check-mdx"] },
    { id: "docs-links", args: ["docs:check-links"] },
    { id: "lint-scripts", args: ["lint:scripts"] },
    { id: "format-check", args: ["control-director:format-check"] },
    { id: "typecheck-core", args: ["tsgo:core"] },
    { id: "typecheck-ui", args: ["tsgo:test:ui"] },
    { id: "typecheck-extensions", args: ["tsgo:extensions"] },
    { id: "build", args: ["build"] },
  ];
}

function commandLabel(command, args) {
  return [command, ...args].join(" ");
}

function commandDigest(command, args) {
  return createHash("sha256").update(commandLabel(command, args)).digest("hex");
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
}

export function buildControlDirectorSourceGateReceipt(
  sourceSha,
  plan,
  sourceRoot = CONTROL_DIRECTOR_VERIFY_REPO_ROOT,
) {
  return {
    schemaVersion: 2,
    sourceSha,
    expectedSha: sourceSha,
    sourceRoot,
    sourceClean: true,
    identityVerified: true,
    passed: false,
    generatedAt: new Date().toISOString(),
    torture: { passed: false },
    chaos: { passed: false },
    chatStack: { passed: false },
    typecheck: { passed: false },
    tests: { passed: false },
    build: { passed: false },
    commands: plan.map((entry) => ({
      id: entry.id,
      command: commandLabel(pnpmCommand(), entry.args),
      commandSha256: commandDigest(pnpmCommand(), entry.args),
      status: "pending",
    })),
  };
}

function runPlan({ plan, receipt, receiptPath }) {
  for (const entry of plan) {
    const record = receipt.commands.find((candidate) => candidate.id === entry.id);
    const startedAt = Date.now();
    record.status = "running";
    record.startedAt = new Date(startedAt).toISOString();
    writeJson(receiptPath, receipt);
    console.log(`\n==> ${record.command}`);
    const result = spawnSync(pnpmCommand(), entry.args, {
      cwd: CONTROL_DIRECTOR_VERIFY_REPO_ROOT,
      env: {
        ...process.env,
        NODE_OPTIONS: process.env.NODE_OPTIONS || "--max-old-space-size=6144",
        OPENCLAW_VITEST_MAX_WORKERS: process.env.OPENCLAW_VITEST_MAX_WORKERS || "1",
      },
      stdio: "inherit",
    });
    record.durationMs = Date.now() - startedAt;
    record.status = result.status === 0 ? "passed" : "failed";
    record.exitCode = result.status;
    writeJson(receiptPath, receipt);
    if (result.status !== 0) {
      throw new Error(`${record.command} failed with status ${String(result.status)}.`);
    }
  }
}

function finalizeGateFacts(receipt) {
  const passed = new Set(
    receipt.commands.filter((entry) => entry.status === "passed").map((entry) => entry.id),
  );
  receipt.torture.passed = passed.has("torture");
  receipt.chaos.passed = passed.has("chaos");
  receipt.chatStack.passed = passed.has("tests") && passed.has("ui-tests");
  receipt.tests.passed =
    passed.has("tests") && passed.has("ui-tests") && passed.has("extension-tests");
  receipt.typecheck.passed =
    passed.has("typecheck-core") &&
    passed.has("typecheck-ui") &&
    passed.has("typecheck-extensions");
  receipt.build.passed = passed.has("build");
}

function runReadiness({ configPath, expectedSha, receiptPath }) {
  const args = [
    "control-director:readiness",
    "--",
    "--source-only",
    "--json",
    "--config",
    configPath,
    "--expected-sha",
    expectedSha,
    "--gate-proof",
    receiptPath,
  ];
  console.log(`\n==> ${commandLabel(pnpmCommand(), args)}`);
  const result = spawnSync(pnpmCommand(), args, {
    cwd: CONTROL_DIRECTOR_VERIFY_REPO_ROOT,
    encoding: "utf8",
    env: process.env,
  });
  if (result.stdout) {
    process.stdout.write(result.stdout);
  }
  if (result.stderr) {
    process.stderr.write(result.stderr);
  }
  if (result.status !== 0) {
    throw new Error(
      `Control Director source readiness failed with status ${String(result.status)}.`,
    );
  }
  const scorecard = JSON.parse(result.stdout);
  if (scorecard.sourceReady !== true || scorecard.sourceSha !== expectedSha) {
    throw new Error("Control Director readiness did not return exact-SHA sourceReady=true.");
  }
  return scorecard;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const plan = buildControlDirectorSourceGatePlan();
  if (args.planOnly) {
    console.log(plan.map((entry) => commandLabel(pnpmCommand(), entry.args)).join("\n"));
    return;
  }
  const head = runGit(["rev-parse", "HEAD"]).toLowerCase();
  const expectedSha = args.expectedSha || head;
  const status = runGit(["status", "--porcelain=v1", "--untracked-files=all"]);
  const identity = validateControlDirectorSourceIdentity({ head, expectedSha, status });
  if (!identity.ok) {
    throw new Error(identity.reason);
  }

  const receiptPath = path.join(args.artifactDir, `source-gates-${expectedSha}.json`);
  const configPath = path.join(args.artifactDir, `source-config-${expectedSha}.json`);
  const receipt = buildControlDirectorSourceGateReceipt(expectedSha, plan);
  writeJson(configPath, buildControlDirectorSourceConfig());
  writeJson(receiptPath, receipt);

  try {
    runPlan({ plan, receipt, receiptPath });
    finalizeGateFacts(receipt);
    writeJson(receiptPath, receipt);
    const scorecard = runReadiness({ configPath, expectedSha, receiptPath });
    const finalIdentity = validateControlDirectorSourceIdentity({
      head: runGit(["rev-parse", "HEAD"]).toLowerCase(),
      expectedSha,
      status: runGit(["status", "--porcelain=v1", "--untracked-files=all"]),
    });
    if (!finalIdentity.ok) {
      throw new Error(`Source identity changed during verification: ${finalIdentity.reason}`);
    }
    receipt.passed = true;
    receipt.completedAt = new Date().toISOString();
    receipt.readiness = {
      sourceReady: scorecard.sourceReady,
      passPercent: scorecard.passPercent,
      selectedModel: scorecard.selectedModel,
      nextBuildGap: scorecard.nextBuildGap,
    };
    writeJson(receiptPath, receipt);
    console.log(`control-director-verify: PASS ${expectedSha}`);
    console.log(`gate-proof=${receiptPath}`);
  } catch (error) {
    finalizeGateFacts(receipt);
    receipt.failedAt = new Date().toISOString();
    receipt.failure = error instanceof Error ? error.message : String(error);
    writeJson(receiptPath, receipt);
    throw error;
  }
}

/** @param {unknown} error */
function reportMainFailure(error) {
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exitCode = 1;
}

if (path.resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url)) {
  main().catch(reportMainFailure);
}
