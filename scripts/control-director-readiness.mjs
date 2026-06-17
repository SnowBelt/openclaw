#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";

const FALLBACK_MODEL = "ollama/openclaw-control-qwen25-32b:latest";
const EFFECTIVE_CONTEXT = 64_000;
const DEFAULT_PROFILE_ID = "gemma4-31b-q8";

export const CONTROL_DIRECTOR_READINESS_PROFILES = Object.freeze({
  "gemma4-31b-q8": Object.freeze({
    id: "gemma4-31b-q8",
    label: "Gemma 4 31B IT Dense Q8",
    alias: "openclaw-control-gemma4-31b-q8",
    model: "ollama/openclaw-control-gemma4-31b-q8:latest",
    ollamaName: "openclaw-control-gemma4-31b-q8:latest",
    sourceTag: "hf.co/unsloth/gemma-4-31B-it-GGUF:Q8_0",
    requiredShowPatterns: [/gemma[-_ ]?4/iu, /(?:31|30\.7)\s*b/iu],
    allowedQuantPatterns: [/\bQ8_0\b/iu, /\bQ8_K_XL\b/iu],
  }),
  "qwen36-27b-q8": Object.freeze({
    id: "qwen36-27b-q8",
    label: "Qwen3.6 27B Q8_0",
    alias: "openclaw-control-qwen36-27b",
    model: "ollama/openclaw-control-qwen36-27b:latest",
    ollamaName: "openclaw-control-qwen36-27b:latest",
    sourceTag: "qwen3.6:27b-q8_0",
    requiredShowPatterns: [/qwen3\.6/iu, /27b/iu],
    allowedQuantPatterns: [/\bQ8_0\b/iu],
  }),
});

function resolveReadinessProfile(profileId = DEFAULT_PROFILE_ID) {
  const id = (profileId || DEFAULT_PROFILE_ID).trim();
  const profile = CONTROL_DIRECTOR_READINESS_PROFILES[id];
  if (!profile) {
    throw new Error(
      `Unknown Control Director readiness profile: ${id}. Expected one of: ${Object.keys(
        CONTROL_DIRECTOR_READINESS_PROFILES,
      ).join(", ")}`,
    );
  }
  return profile;
}
const DEFAULT_OLLAMA_BASE_URL = "http://127.0.0.1:11434";
const CHAT_SMOKE_TIMEOUT_MS = 300_000;
const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPT_DIR, "..");
const CONTROL_DIRECTOR_CONTRACT_SOURCE = path.join(
  REPO_ROOT,
  "src",
  "agents",
  "control-director-contract.ts",
);

const REQUIRED_OLLAMA_ENV = Object.freeze({
  OLLAMA_FLASH_ATTENTION: "1",
  OLLAMA_KV_CACHE_TYPE: "q8_0",
  OLLAMA_NUM_PARALLEL: "1",
});

function usage() {
  return [
    "Usage: node scripts/control-director-readiness.mjs [--json] [--config <path>] [--profile <id>] [--skip-runtime] [--skip-chat-smoke]",
    "",
    `Checks Control Director model policy, rollback chain, Ollama runtime env, local model inventory, and ${DEFAULT_PROFILE_ID} model-load smoke.`,
  ].join("\n");
}

function parseArgs(argv) {
  const args = {
    configPath:
      process.env.OPENCLAW_CONFIG_PATH ??
      path.join(os.homedir(), ".openclaw", "openclaw.director.json"),
    json: false,
    profileId: process.env.OPENCLAW_CONTROL_DIRECTOR_READINESS_PROFILE ?? DEFAULT_PROFILE_ID,
    skipRuntime: false,
    skipChatSmoke: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--") {
      continue;
    } else if (arg === "--json") {
      args.json = true;
    } else if (arg === "--skip-runtime") {
      args.skipRuntime = true;
    } else if (arg === "--skip-chat-smoke") {
      args.skipChatSmoke = true;
    } else if (arg === "--config") {
      args.configPath = argv[++index];
    } else if (arg === "--profile") {
      args.profileId = argv[++index];
    } else if (arg === "--help" || arg === "-h") {
      args.help = true;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return args;
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function normalizeModelRef(value) {
  return String(value ?? "").trim();
}

function findControlDirectorAgent(config) {
  return (config.agents?.list ?? []).find(
    (agent) =>
      agent?.id === "main" || String(agent?.name ?? "").toLowerCase() === "control director",
  );
}

function parseOllamaList(output) {
  const models = new Map();
  for (const line of output.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("NAME")) {
      continue;
    }
    const [name, digest, size, sizeUnit] = trimmed.split(/\s+/);
    if (name && digest) {
      models.set(name, {
        name,
        digest,
        size: size && sizeUnit ? `${size} ${sizeUnit}` : undefined,
        line: trimmed,
      });
    }
  }
  return models;
}

function runOptional(command, args) {
  try {
    return { ok: true, stdout: execFileSync(command, args, { encoding: "utf8" }) };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

function detectControlDirectorThinkingEscalationPolicy() {
  try {
    const source = fs.readFileSync(CONTROL_DIRECTOR_CONTRACT_SOURCE, "utf8");
    return (
      source.includes("resolveControlDirectorThinkingEscalation") &&
      source.includes("CONTROL_DIRECTOR_THINKING_TRIGGERS") &&
      source.includes("high-risk failure, rollback, runtime, or production-control task")
    );
  } catch {
    return false;
  }
}

function detectControlDirectorCompletionEvidencePolicy() {
  try {
    const source = fs.readFileSync(CONTROL_DIRECTOR_CONTRACT_SOURCE, "utf8");
    return (
      source.includes("A completion claim must include the concrete evidence") &&
      source.includes('status === "complete"') &&
      source.includes("verified evidence for complete status")
    );
  } catch {
    return false;
  }
}

function detectControlDirectorContinueUntilCompletePolicy() {
  try {
    const source = fs.readFileSync(CONTROL_DIRECTOR_CONTRACT_SOURCE, "utf8");
    return (
      source.includes("Continue until the requested task is complete") &&
      source.includes("Do not stop at advice or a proposed next step") &&
      source.includes("when you can safely continue executing")
    );
  } catch {
    return false;
  }
}

function detectControlDirectorExplicitStatusPolicy() {
  try {
    const source = fs.readFileSync(CONTROL_DIRECTOR_CONTRACT_SOURCE, "utf8");
    return (
      source.includes("parseExplicitControlDirectorFinalStatus") &&
      source.includes("explicit completion status") &&
      source.includes("!explicitStatus")
    );
  } catch {
    return false;
  }
}

function detectControlDirectorRuntimeFinalOutputGuard() {
  try {
    const contractSource = fs.readFileSync(CONTROL_DIRECTOR_CONTRACT_SOURCE, "utf8");
    const deliveryGuardSource = fs.readFileSync(
      path.join(REPO_ROOT, "src/agents/control-director-delivery-guards.ts"),
      "utf8",
    );
    const agentCommandSource = fs.readFileSync(
      path.join(REPO_ROOT, "src/agents/agent-command.ts"),
      "utf8",
    );
    return (
      contractSource.includes("applyControlDirectorFinalOutputGuard") &&
      contractSource.includes("rewrote_unsupported_complete") &&
      deliveryGuardSource.includes("applyControlDirectorFinalOutputGuard") &&
      deliveryGuardSource.includes("controlDirectorGuardAudit") &&
      agentCommandSource.includes("applyControlDirectorDeliveryGuards")
    );
  } catch {
    return false;
  }
}

function detectControlDirectorJudgeCompletionGate() {
  try {
    const contractSource = fs.readFileSync(CONTROL_DIRECTOR_CONTRACT_SOURCE, "utf8");
    const deliveryGuardSource = fs.readFileSync(
      path.join(REPO_ROOT, "src/agents/control-director-delivery-guards.ts"),
      "utf8",
    );
    return (
      contractSource.includes("applyControlDirectorJudgeCompletionGate") &&
      contractSource.includes("buildControlDirectorJudgeClaimHash") &&
      contractSource.includes("blocked_missing_judge_approval") &&
      deliveryGuardSource.includes("applyControlDirectorJudgeCompletionGate") &&
      deliveryGuardSource.includes("judgeCompletionGate")
    );
  } catch {
    return false;
  }
}

function detectControlDirectorTruthGate() {
  try {
    const contractSource = fs.readFileSync(CONTROL_DIRECTOR_CONTRACT_SOURCE, "utf8");
    const deliveryGuardSource = fs.readFileSync(
      path.join(REPO_ROOT, "src/agents/control-director-delivery-guards.ts"),
      "utf8",
    );
    return (
      contractSource.includes("applyControlDirectorTruthGate") &&
      contractSource.includes("ControlDirectorTruthAudit") &&
      contractSource.includes("blocked_unsupported_truth_claim") &&
      deliveryGuardSource.includes("applyControlDirectorTruthGate") &&
      deliveryGuardSource.includes("controlDirectorTruthAudit")
    );
  } catch {
    return false;
  }
}

function detectControlDirectorTruthEvidenceIngestion() {
  try {
    const evidenceSource = fs.readFileSync(
      path.join(REPO_ROOT, "src/agents/control-director-truth-evidence.ts"),
      "utf8",
    );
    const deliveryGuardSource = fs.readFileSync(
      path.join(REPO_ROOT, "src/agents/control-director-delivery-guards.ts"),
      "utf8",
    );
    const agentCommandSource = fs.readFileSync(
      path.join(REPO_ROOT, "src/agents/agent-command.ts"),
      "utf8",
    );
    const autoReplySource = fs.readFileSync(
      path.join(REPO_ROOT, "src/auto-reply/reply/agent-runner.ts"),
      "utf8",
    );
    const chatSource = fs.readFileSync(
      path.join(REPO_ROOT, "src/gateway/server-methods/chat.ts"),
      "utf8",
    );
    return (
      evidenceSource.includes("buildControlDirectorTruthEvidenceFromRecords") &&
      evidenceSource.includes("loadControlDirectorTruthEvidence") &&
      evidenceSource.includes("exitCode === 0") &&
      evidenceSource.includes("github_run") &&
      evidenceSource.includes("ui_smoke") &&
      evidenceSource.includes("repo_change") &&
      evidenceSource.includes("source_citation") &&
      deliveryGuardSource.includes("loadControlDirectorTruthEvidence") &&
      deliveryGuardSource.includes("extraEvidence: params.truthEvidence") &&
      deliveryGuardSource.includes("implementationSha") &&
      agentCommandSource.includes("applyControlDirectorDeliveryGuards") &&
      autoReplySource.includes("applyControlDirectorDeliveryGuards") &&
      chatSource.includes("applyControlDirectorDeliveryGuards")
    );
  } catch {
    return false;
  }
}

function readOllamaEnvFromLaunchctl() {
  const uid = typeof process.getuid === "function" ? process.getuid() : null;
  if (uid === null) {
    return { ok: false, values: {}, error: "process uid unavailable" };
  }
  const result = runOptional("launchctl", ["print", `gui/${uid}/ai.openclaw.ollama`]);
  if (!result.ok) {
    return { ok: false, values: {}, error: result.error };
  }
  const values = {};
  for (const [key] of Object.entries(REQUIRED_OLLAMA_ENV)) {
    const match = result.stdout.match(new RegExp(`${key}\\s*=>\\s*([^\\n]+)`));
    if (match?.[1]) {
      values[key] = match[1].trim();
    }
  }
  return { ok: true, values };
}

function resolveOllamaBaseUrl(config) {
  const provider = config.models?.providers?.ollama ?? {};
  const raw =
    typeof provider.baseUrl === "string" && provider.baseUrl.trim()
      ? provider.baseUrl
      : typeof provider.baseURL === "string" && provider.baseURL.trim()
        ? provider.baseURL
        : DEFAULT_OLLAMA_BASE_URL;
  const trimmed = raw.trim().replace(/\/+$/, "");
  return trimmed.replace(/\/v1$/i, "") || DEFAULT_OLLAMA_BASE_URL;
}

async function runOllamaChatSmoke(params) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), CHAT_SMOKE_TIMEOUT_MS);
  try {
    const response = await fetch(`${params.baseUrl}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: controller.signal,
      body: JSON.stringify({
        model: params.model,
        messages: [{ role: "user", content: "Reply exactly: OK" }],
        stream: false,
        think: false,
        options: {
          num_ctx: 2048,
          num_predict: 4,
          temperature: 0,
        },
      }),
    });
    const body = await response.text();
    return {
      ok: response.ok,
      status: response.status,
      detail: response.ok
        ? `status=${response.status}`
        : `status=${response.status} ${body.slice(0, 240)}`,
    };
  } catch (error) {
    return {
      ok: false,
      detail: error instanceof Error ? error.message : String(error),
    };
  } finally {
    clearTimeout(timeout);
  }
}

function fact(id, label, passed, critical, detail) {
  return {
    id,
    label,
    passed: Boolean(passed),
    critical: Boolean(critical),
    ...(detail ? { detail } : {}),
  };
}

export function buildControlDirectorReadinessScorecard(params) {
  const profile = resolveReadinessProfile(params.profileId);
  const config = params.config;
  const agent = findControlDirectorAgent(config);
  const defaultsModels = config.agents?.defaults?.models ?? {};
  const providerModels = config.models?.providers?.ollama?.models ?? [];
  const primary = normalizeModelRef(agent?.model?.primary ?? agent?.model);
  const fallbacks = Array.isArray(agent?.model?.fallbacks) ? agent.model.fallbacks : [];
  const controlAliasDefaults = defaultsModels[profile.model];
  const providerAlias = providerModels.find((entry) => entry?.id === profile.ollamaName);
  const facts = [];

  facts.push(fact("agent-present", "Control Director agent configured", Boolean(agent), true));
  facts.push(
    fact(
      "primary",
      `Primary model is canonical ${profile.label} Control ref`,
      primary === profile.model,
      true,
      `resolved=${primary || "missing"}`,
    ),
  );
  facts.push(
    fact(
      "fallback",
      "Qwen2.5 rollback is first fallback",
      fallbacks[0] === FALLBACK_MODEL,
      true,
      `first=${fallbacks[0] ?? "missing"}`,
    ),
  );
  facts.push(
    fact(
      "thinking-default",
      "Control Director thinking default is off",
      agent?.thinkingDefault === "off",
      true,
      `thinkingDefault=${agent?.thinkingDefault ?? "missing"}`,
    ),
  );
  facts.push(
    fact(
      "thinking-escalation-policy",
      "Control Director thinking-as-needed escalation policy is present",
      params.thinkingEscalationPolicy === true,
      true,
    ),
  );
  facts.push(
    fact(
      "continue-until-complete-policy",
      "Control Director continue-until-complete policy is present",
      params.continueUntilCompletePolicy === true,
      true,
    ),
  );
  facts.push(
    fact(
      "complete-evidence-policy",
      "Control Director complete-status evidence gate is present",
      params.completionEvidencePolicy === true,
      true,
    ),
  );
  facts.push(
    fact(
      "explicit-status-policy",
      "Control Director explicit final status gate is present",
      params.explicitStatusPolicy === true,
      true,
    ),
  );
  facts.push(
    fact(
      "runtime-final-output-guard",
      "Control Director runtime final-output guard is wired",
      params.runtimeFinalOutputGuard === true,
      true,
    ),
  );
  facts.push(
    fact(
      "runtime-judge-completion-gate",
      "Control Director runtime Judge-approved completion gate is wired",
      params.runtimeJudgeCompletionGate === true,
      true,
    ),
  );
  facts.push(
    fact(
      "runtime-truth-gate",
      "Control Director runtime truthfulness gate is wired",
      params.runtimeTruthGate === true,
      true,
    ),
  );
  facts.push(
    fact(
      "runtime-truth-evidence-ingestion",
      "Control Director runtime truth evidence ingestion is wired",
      params.runtimeTruthEvidenceIngestion === true,
      true,
    ),
  );
  facts.push(
    fact(
      "context",
      "Control Director effective context is 64000",
      agent?.contextTokens === EFFECTIVE_CONTEXT &&
        controlAliasDefaults?.params?.num_ctx === EFFECTIVE_CONTEXT &&
        providerAlias?.contextTokens === EFFECTIVE_CONTEXT,
      true,
    ),
  );
  facts.push(
    fact(
      "think-false",
      "Control Director alias enforces think=false",
      controlAliasDefaults?.params?.think === false && providerAlias?.params?.think === false,
      true,
    ),
  );
  facts.push(
    fact(
      "temperature",
      "Control Director temperature is conservative",
      Number(controlAliasDefaults?.params?.temperature) <= 0.2 &&
        Number(providerAlias?.params?.temperature) <= 0.2,
      false,
    ),
  );

  if (params.ollamaModels) {
    const primaryModel = params.ollamaModels.get(profile.ollamaName);
    const underlying = params.ollamaModels.get(profile.sourceTag);
    const fallback = params.ollamaModels.get(FALLBACK_MODEL.replace(/^ollama\//, ""));
    facts.push(
      fact(
        "ollama-primary",
        `Ollama ${profile.label} Control alias is installed`,
        Boolean(primaryModel),
        true,
      ),
    );
    if (profile.id !== "gemma4-31b-q8") {
      facts.push(
        fact(
          "ollama-underlying",
          `Underlying ${profile.sourceTag} tag is installed`,
          Boolean(underlying),
          true,
        ),
      );
    }
    if (profile.id === "gemma4-31b-q8") {
      const showText = params.ollamaPrimaryShow?.stdout ?? "";
      const provenanceOk = profile.requiredShowPatterns.every((pattern) => pattern.test(showText));
      const quantOk = profile.allowedQuantPatterns.some((pattern) => pattern.test(showText));
      facts.push(
        fact(
          "ollama-provenance",
          "Control alias provenance identifies Gemma 4 31B",
          provenanceOk,
          true,
          params.ollamaPrimaryShow?.ok === false
            ? params.ollamaPrimaryShow.error
            : provenanceOk
              ? "ollama show provenance matched"
              : "ollama show missing Gemma 4 31B provenance",
        ),
      );
      facts.push(
        fact(
          "ollama-quant",
          "Control alias quantization is Q8",
          quantOk,
          true,
          quantOk ? "Q8 provenance matched" : "ollama show missing Q8_0 or Q8_K_XL",
        ),
      );
    } else {
      facts.push(
        fact(
          "ollama-digest",
          `Control alias digest matches ${profile.sourceTag} tag`,
          Boolean(
            primaryModel?.digest && underlying?.digest && primaryModel.digest === underlying.digest,
          ),
          true,
          `alias=${primaryModel?.digest ?? "missing"} tag=${underlying?.digest ?? "missing"}`,
        ),
      );
    }
    facts.push(
      fact("ollama-fallback", "Rollback Ollama alias is installed", Boolean(fallback), true),
    );
    const primaryChatSmoke = params.ollamaPrimaryChatSmoke;
    facts.push(
      fact(
        "ollama-primary-chat-smoke",
        `${profile.label} Control alias answers Ollama /api/chat smoke`,
        primaryChatSmoke?.ok === true,
        true,
        primaryChatSmoke?.detail ?? "not checked",
      ),
    );
  } else {
    facts.push(
      fact(
        "ollama-runtime",
        "Ollama runtime inventory checked",
        false,
        true,
        params.ollamaError ?? "skipped",
      ),
    );
  }

  if (params.ollamaEnv) {
    for (const [key, expected] of Object.entries(REQUIRED_OLLAMA_ENV)) {
      facts.push(
        fact(
          `env-${key}`,
          `${key}=${expected}`,
          params.ollamaEnv[key] === expected,
          true,
          `actual=${params.ollamaEnv[key] ?? "missing"}`,
        ),
      );
    }
  } else {
    for (const key of Object.keys(REQUIRED_OLLAMA_ENV)) {
      facts.push(
        fact(
          `env-${key}`,
          `${key} runtime env present`,
          false,
          true,
          params.ollamaEnvError ?? "skipped",
        ),
      );
    }
  }

  const critical = facts.filter((entry) => entry.critical);
  const failedCritical = critical.filter((entry) => !entry.passed);
  const passedCritical = critical.length - failedCritical.length;
  const passed = facts.filter((entry) => entry.passed).length;
  const criticalRatio = critical.length > 0 ? passedCritical / critical.length : 1;
  const overallRatio = facts.length > 0 ? passed / facts.length : 0;
  const completionGrade = Math.round((criticalRatio * 0.75 + overallRatio * 0.25) * 100) / 10;
  const nextFailed = failedCritical[0] ?? facts.find((entry) => !entry.passed);

  return {
    checkedAt: new Date().toISOString(),
    completionGrade,
    criticality: 10,
    productionReady: completionGrade >= 9.5 && failedCritical.length === 0,
    profile: profile.id,
    primaryAlias: profile.alias,
    primaryModel: profile.model,
    underlyingOllamaTag: profile.sourceTag,
    firstFallback: FALLBACK_MODEL,
    facts,
    failedCritical: failedCritical.map((entry) => entry.label),
    nextBuildGap: nextFailed
      ? `${nextFailed.label}${nextFailed.detail ? `: ${nextFailed.detail}` : ""}`
      : "No critical Control Director build gap detected by readiness scorecard.",
  };
}

function printText(scorecard) {
  console.log(
    `Control Director readiness: ${scorecard.productionReady ? "production-ready" : "not production-ready"}`,
  );
  console.log(`Completion Grade: ${scorecard.completionGrade}/10`);
  console.log(`Criticality: ${scorecard.criticality}/10`);
  console.log(`Primary: ${scorecard.primaryAlias} -> ${scorecard.primaryModel}`);
  console.log(`Fallback: ${scorecard.firstFallback}`);
  console.log(`Next build gap: ${scorecard.nextBuildGap}`);
  console.log("");
  for (const entry of scorecard.facts) {
    console.log(
      `${entry.passed ? "PASS" : "FAIL"} ${entry.critical ? "[critical]" : "[info]"} ${entry.label}${entry.detail ? ` (${entry.detail})` : ""}`,
    );
  }
}

export async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  const profile = resolveReadinessProfile(args.profileId);
  if (args.help) {
    console.log(usage());
    return 0;
  }
  const config = readJson(args.configPath);
  let ollamaModels;
  let ollamaError;
  let ollamaEnv;
  let ollamaEnvError;
  let ollamaPrimaryChatSmoke;
  let ollamaPrimaryShow;
  if (!args.skipRuntime) {
    const ollama = runOptional("ollama", ["list"]);
    if (ollama.ok) {
      ollamaModels = parseOllamaList(ollama.stdout);
    } else {
      ollamaError = ollama.error;
    }
    const env = readOllamaEnvFromLaunchctl();
    if (env.ok) {
      ollamaEnv = env.values;
    } else {
      ollamaEnvError = env.error;
    }
    if (ollamaModels) {
      ollamaPrimaryShow = runOptional("ollama", ["show", profile.ollamaName]);
    }
    if (!args.skipChatSmoke && ollamaModels) {
      ollamaPrimaryChatSmoke = await runOllamaChatSmoke({
        baseUrl: resolveOllamaBaseUrl(config),
        model: profile.ollamaName,
      });
    } else if (ollamaModels) {
      ollamaPrimaryChatSmoke = { ok: false, detail: "skipped" };
    }
  }
  const scorecard = buildControlDirectorReadinessScorecard({
    config,
    profileId: profile.id,
    ollamaModels,
    ollamaError,
    ollamaEnv,
    ollamaEnvError,
    ollamaPrimaryChatSmoke,
    ollamaPrimaryShow,
    thinkingEscalationPolicy: detectControlDirectorThinkingEscalationPolicy(),
    continueUntilCompletePolicy: detectControlDirectorContinueUntilCompletePolicy(),
    completionEvidencePolicy: detectControlDirectorCompletionEvidencePolicy(),
    explicitStatusPolicy: detectControlDirectorExplicitStatusPolicy(),
    runtimeFinalOutputGuard: detectControlDirectorRuntimeFinalOutputGuard(),
    runtimeJudgeCompletionGate: detectControlDirectorJudgeCompletionGate(),
    runtimeTruthGate: detectControlDirectorTruthGate(),
    runtimeTruthEvidenceIngestion: detectControlDirectorTruthEvidenceIngestion(),
  });
  if (args.json) {
    console.log(JSON.stringify(scorecard, null, 2));
  } else {
    printText(scorecard);
  }
  return scorecard.productionReady ? 0 : 1;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  try {
    process.exitCode = await main(process.argv.slice(2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
