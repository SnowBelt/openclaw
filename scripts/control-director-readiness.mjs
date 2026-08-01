#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import {
  resolveAgentIdByOperationalRole,
  resolveJudgeAgentId,
  resolveProgramManagerRoute,
} from "../src/agents/agent-scope-config.ts";
import { buildControlDirectorCacheIdentityEvidence } from "../src/agents/control-director-model-governance-proof.ts";
import { buildControlDirectorModelRegistry } from "../src/agents/control-director-model-registry.ts";
import {
  CONTROL_DIRECTOR_DEFAULT_ALIAS,
  CONTROL_DIRECTOR_DEFAULT_MODEL,
  CONTROL_DIRECTOR_DEFAULT_MODEL_ID,
  CONTROL_DIRECTOR_DEFAULT_UNDERLYING_OLLAMA_TAG,
  isConfiguredControlDirectorAgent,
} from "../src/agents/control-director-role.ts";
import { readPccUpdateSafety } from "../src/pcc/update-safety.ts";
import { auditOperationalRoleCapabilityPolicy } from "./lib/control-director-role-capability-audit.ts";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
export const CONTROL_DIRECTOR_READINESS_REPO_ROOT = path.resolve(SCRIPT_DIR, "..");
const DEFAULT_CONFIG_PATH = path.join(os.homedir(), ".openclaw", "openclaw.director.json");
const DEFAULT_OLLAMA_BASE_URL = "http://127.0.0.1:11434";
const CHAT_SMOKE_TIMEOUT_MS = 180_000;
const MINIMUM_SOAK_MS = 5 * 60 * 1_000;
const REQUIRED_MODEL_EVAL_TASK_CLASSES = Object.freeze([
  "conversation",
  "recall",
  "planning",
  "delegation",
  "steering",
  "verification",
]);

const REQUIRED_OLLAMA_ENV = Object.freeze({
  OLLAMA_FLASH_ATTENTION: "1",
  OLLAMA_KV_CACHE_TYPE: "q8_0",
  OLLAMA_NUM_PARALLEL: "1",
});

function usage() {
  return [
    "Usage: pnpm control-director:readiness -- [--json] [--source-only] [--config <path>]",
    "       [--expected-sha <40-char-sha>] [--expected-config-digest <sha256>]",
    "       [--gate-proof <json>] [--runtime-proof <json>]",
    "",
    "Source readiness requires a clean exact checkout and passing torture/chaos/Chat-stack gate receipts.",
    "Production readiness additionally requires exact Mac Studio lineage, local validation, Dashboard, model, restart, soak, rollback, and live diagnostic proof.",
  ].join("\n");
}

function parseArgs(argv) {
  const args = {
    configPath: process.env.OPENCLAW_CONFIG_PATH ?? DEFAULT_CONFIG_PATH,
    expectedSha: process.env.OPENCLAW_EXPECTED_SOURCE_SHA ?? "",
    gateProofPath: "",
    runtimeProofPath: "",
    expectedConfigDigest: process.env.OPENCLAW_EXPECTED_CONFIG_DIGEST ?? "",
    json: false,
    sourceOnly: false,
    help: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "--") {
      continue;
    }
    if (value === "--json") {
      args.json = true;
    } else if (value === "--source-only") {
      args.sourceOnly = true;
    } else if (value === "--config") {
      args.configPath = argv[++index] ?? "";
    } else if (value === "--expected-sha") {
      args.expectedSha = argv[++index] ?? "";
    } else if (value === "--gate-proof") {
      args.gateProofPath = argv[++index] ?? "";
    } else if (value === "--runtime-proof") {
      args.runtimeProofPath = argv[++index] ?? "";
    } else if (value === "--expected-config-digest") {
      args.expectedConfigDigest = argv[++index] ?? "";
    } else if (value === "--help" || value === "-h") {
      args.help = true;
    } else {
      throw new Error(`Unknown argument: ${value}`);
    }
  }
  return args;
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function run(command, args) {
  try {
    return {
      ok: true,
      stdout: execFileSync(command, args, {
        cwd: CONTROL_DIRECTOR_READINESS_REPO_ROOT,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      }).trim(),
    };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

function immutableSha(value) {
  const normalized = String(value ?? "")
    .trim()
    .toLowerCase();
  return /^[a-f0-9]{40}$/u.test(normalized) ? normalized : "";
}

function findControlDirectorAgent(config) {
  return (config.agents?.list ?? []).find((agent) => agent?.role === "control_director");
}

export function resolveSelectedOllamaModelId(config, agentId) {
  const agent = findControlDirectorAgent(config);
  const registry = buildControlDirectorModelRegistry({
    config,
    agentId: agentId ?? agent?.id ?? "control-director",
  });
  if (registry.selected.status !== "ready") {
    return "";
  }
  const prefix = "ollama/";
  return registry.selected.effective.startsWith(prefix)
    ? registry.selected.effective.slice(prefix.length)
    : "";
}

export function parseOllamaList(output) {
  const models = new Map();
  for (const line of String(output ?? "").split(/\r?\n/u)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("NAME")) {
      continue;
    }
    const [name, digest, size, sizeUnit] = trimmed.split(/\s+/u);
    if (name && digest) {
      models.set(name, {
        name,
        digest,
        ...(size && sizeUnit ? { size: `${size} ${sizeUnit}` } : {}),
      });
    }
  }
  return models;
}

/**
 * Ollama model-list IDs identify the complete manifest, so a tuned alias and
 * its base model legitimately have different IDs. The generated Modelfile
 * names the immutable model blobs and is the correct local lineage boundary.
 */
export function parseOllamaModelfileBaseDigests(output) {
  return [
    ...new Set(
      String(output ?? "")
        .split(/\r?\n/u)
        .map((line) => line.match(/^FROM\s+.*\/sha256-([a-f0-9]{64})\s*$/iu)?.[1]?.toLowerCase())
        .filter(Boolean),
    ),
  ].toSorted((left, right) => left.localeCompare(right));
}

function source(relativePath) {
  return fs.readFileSync(path.join(CONTROL_DIRECTOR_READINESS_REPO_ROOT, relativePath), "utf8");
}

function hasAll(text, fragments) {
  return fragments.every((fragment) => text.includes(fragment));
}

/** Static boundary checks complement executable gates and fail when a contract loses its caller. */
export function collectControlDirectorActiveWiring() {
  const replyRun = source("src/auto-reply/reply/get-reply-run.ts");
  const agentRunner = source("src/auto-reply/reply/agent-runner.ts");
  const agentCommand = source("src/agents/agent-command.ts");
  const goalRuntime = source("src/tasks/pursue-goal-controller.runtime.ts");
  const goalController = source("src/tasks/pursue-goal-controller.ts");
  const pccServer = source("src/gateway/server-methods/pcc.ts");
  const taskServer = source("src/gateway/server-methods/tasks.ts");
  const selfImprovementServer = source("src/gateway/server-methods/self-improvement.ts");
  const chatTurnServer = source("src/gateway/server-methods/chat-turns.ts");
  const chatTurnController = source("src/gateway/chat-turn-inbox-controller.ts");
  const taskStateServer = source("src/gateway/server-methods/tasks.ts");
  const deliveryGuards = source("src/agents/control-director-delivery-guards.ts");
  const chatServer = source("src/gateway/server-methods/chat.ts");
  const recentContext = source("src/auto-reply/reply/control-director-recent-context.ts");
  const chatTurnState = source("src/gateway/chat-turn-inbox-state.ts");
  const sessionTitle = source("src/gateway/dashboard-session-title.ts");
  const journeySignals = source("src/self-improvement/control-director-journeys.ts");
  const layoutHealth = source("ui/src/ui/chat/layout-health.ts");
  const appLifecycle = source("ui/src/ui/app-lifecycle.ts");
  const gatewayMaintenance = source("src/gateway/server-maintenance.ts");
  const resourceRuntime = source("src/agents/control-director-resource-runtime.ts");
  const resourceAdmission = source("src/agents/control-director-resource-admission.ts");
  const modelWarmup = source("src/agents/control-director-model-warmup.ts");
  const ollamaProvider = source("extensions/ollama/index.ts");
  const activeMemory = source("extensions/active-memory/index.ts");
  const postAttachStartup = source("src/gateway/server-startup-post-attach.ts");
  const roleCapabilities = source("src/agents/agent-role-capabilities.ts");
  const roleCapabilityAudit = source("scripts/lib/control-director-role-capability-audit.ts");
  const systemPrompt = source("src/agents/system-prompt-config.ts");
  const gatewayImpl = source("src/gateway/server.impl.ts");
  const gatewayStartup = source("src/gateway/server-startup-early.ts");
  const appMain = source("ui/src/main.ts");
  const appRender = source("ui/src/ui/app-render.ts");
  const pccSync = source("ui/src/ui/pcc-chat-sync.ts");
  const customRuntimePromote = source("scripts/custom-runtime/custom-runtime-promote.sh");
  const customRuntimeUpdater = source("scripts/custom-runtime/custom-runtime-updater.sh");
  const customRuntimeUpdateApprove = source(
    "scripts/custom-runtime/custom-runtime-update-approve.sh",
  );
  const customRuntimeUpdateSurvival = source(
    "scripts/custom-runtime/custom-runtime-update-survival.ts",
  );
  const packageJson = readJson(path.join(CONTROL_DIRECTOR_READINESS_REPO_ROOT, "package.json"));
  const capabilityManifest = readJson(
    path.join(CONTROL_DIRECTOR_READINESS_REPO_ROOT, "config/custom-runtime-capabilities.json"),
  );
  const preservation = capabilityManifest.preservation;
  const updateSafeCapability = Array.isArray(capabilityManifest.capabilities)
    ? capabilityManifest.capabilities.find(
        (capability) => capability?.id === "runtime:update-safe-customizations",
      )
    : undefined;
  return {
    turnPolicyAndPromptBudget: hasAll(replyRun, [
      "compileControlDirectorTurnPolicy",
      "compileControlDirectorPromptBudget",
      "buildControlDirectorRecentContext",
    ]),
    roleScopedDeliveryGuards:
      hasAll(agentRunner, ["isConfiguredControlDirectorAgent", "controlDirectorScope"]) &&
      hasAll(agentCommand, [
        "isConfiguredControlDirectorAgent",
        "applyControlDirectorDeliveryGuards",
      ]),
    governedCodexAdapter: goalRuntime.includes("prepareGovernedControlDirectorCodexEscalation"),
    pursueGoalOrchestrator:
      gatewayStartup.includes("startPursueGoalControllers") &&
      gatewayImpl.includes("stopPursueGoalControllers") &&
      goalController.includes("evaluateControlDirectorSelfHealing"),
    resourceGovernor:
      pccServer.includes("assessControlDirectorResourceAdmission") &&
      resourceAdmission.includes("decideControlDirectorResourceAdmission"),
    resourceResidencyProbe:
      resourceAdmission.includes("collectControlDirectorResidencyObservation") &&
      resourceRuntime.includes("resolveLoadedProviderRuntimePlugin") &&
      ollamaProvider.includes("probeModelResidency: probeOllamaModelResidency"),
    resourceModelWarmup:
      postAttachStartup.includes("warmConfiguredControlDirectorModel") &&
      modelWarmup.includes("assessControlDirectorResourceAdmission") &&
      modelWarmup.includes("requestControlDirectorModelWarmup") &&
      ollamaProvider.includes("warmModel: warmOllamaModel"),
    responsiveMemoryPolicy:
      recentContext.includes("buildControlDirectorRuntimeMemoryState") &&
      activeMemory.includes("shouldRunControlDirectorActiveRecall") &&
      activeMemory.includes("DEFAULT_CONTROL_DIRECTOR_TIMEOUT_MS = 2_000"),
    memoryHealthProjection:
      taskStateServer.includes("buildControlDirectorRuntimeMemoryState") &&
      taskStateServer.includes("memoryHealth"),
    runtimeLineage:
      taskServer.includes("buildControlDirectorRuntimeLineage") &&
      taskServer.includes("readGatewayRuntimeSnapshotProvenance"),
    sigClosureGovernance: selfImprovementServer.includes("evaluateControlDirectorJourneyClosure"),
    sigBackgroundRuntime:
      hasAll(gatewayMaintenance, [
        "isSelfImprovementBackgroundEnabled",
        "startSelfImprovementGovernorBackgroundTask",
      ]) &&
      hasAll(customRuntimePromote, [
        "OPENCLAW_SELF_IMPROVEMENT_BACKGROUND=1",
        "sigBackgroundEnabled",
      ]),
    typedJourneySignals:
      hasAll(journeySignals, [
        "silence_after_ack",
        "activity_gap",
        "stalled_goal",
        "memory_miss",
        "layout_obstruction",
        "title_failure",
        "queue_race",
        "delivery_miss",
        "completion_without_proof",
        "runtime_lineage_mismatch",
      ]) &&
      deliveryGuards.includes("emitControlDirectorJourneySignal") &&
      chatServer.includes('code: "activity_gap"') &&
      chatServer.includes("startControlDirectorActivityWatchdog") &&
      chatTurnController.includes('code: "activity_gap"') &&
      recentContext.includes("emitControlDirectorJourneySignal") &&
      chatTurnState.includes("emitControlDirectorJourneySignal") &&
      sessionTitle.includes("emitControlDirectorJourneySignal") &&
      goalController.includes("emitControlDirectorJourneySignal") &&
      taskStateServer.includes('code: "runtime_lineage_mismatch"') &&
      selfImprovementServer.includes('code: "layout_obstruction"') &&
      layoutHealth.includes('"selfImprovement.controlDirector.layout.report"') &&
      appLifecycle.includes("scheduleControlDirectorLayoutHealthCheck"),
    independentJudge:
      goalRuntime.includes("judgeCompletionIndependently") &&
      goalController.includes("verifyJudgeReceipt"),
    durableMailboxAndEvents:
      goalController.includes("appendDurableWorkerMailboxMessage") &&
      goalController.includes("withPursueGoalEvent"),
    unifiedApprovalEnvelope:
      goalRuntime.includes("prepareGovernedControlDirectorCodexEscalation") &&
      pccServer.includes("assessControlDirectorResourceAdmission") &&
      resourceAdmission.includes("compileControlDirectorExecutionProfile"),
    roleCapabilityCompiler:
      roleCapabilities.includes("compileOperationalRoleCapabilityBudget") &&
      systemPrompt.includes("buildAgentRoleCapabilitySystemPromptSection") &&
      roleCapabilityAudit.includes("auditOperationalRoleCapabilityPolicy"),
    serverOwnedTurnInbox:
      chatTurnServer.includes("createChatTurnFlow") &&
      gatewayImpl.includes("startChatTurnInboxController"),
    singleProductionChat:
      appMain.includes('import "./ui/app.ts";') &&
      !/app-routes|pages\/chat/u.test(appMain) &&
      appRender.includes('import { renderChat } from "./views/chat.ts";'),
    typedPccBoundary:
      !/milestone.*(?:complete|status).*regex/iu.test(pccSync) &&
      pccSync.includes("hasExplicitPlanEnvelope"),
    updateSafeCustomizationLifecycle:
      packageJson.scripts?.["custom-runtime:update-survival"] ===
        "node --import tsx scripts/custom-runtime/custom-runtime-update-survival.ts" &&
      capabilityManifest.schema === "openclaw.custom-runtime-capabilities.v2" &&
      Number(capabilityManifest.version) >= 5 &&
      preservation?.contractVersion === 2 &&
      preservation?.sourceStrategy === "merge_from_active_sha" &&
      preservation?.dashboardChangePolicy === "register_verify_and_block" &&
      preservation?.approvalPolicy === "explicit_exact_candidate" &&
      preservation?.proofCommand === "pnpm custom-runtime:update-survival" &&
      Array.isArray(updateSafeCapability?.requiredPaths) &&
      updateSafeCapability.requiredPaths.includes(
        "scripts/custom-runtime/custom-runtime-update-survival.ts",
      ) &&
      hasAll(customRuntimeUpdater, [
        "custom-runtime:update-survival",
        "preservationProof",
        "executedVerificationCommands",
        "active_sha:config/custom-runtime-capabilities.json",
      ]) &&
      hasAll(customRuntimePromote, [
        "ai.openclaw.custom-runtime.update-weekly.plist",
        "install_update_scheduler",
        "updateBrokerScheduled",
        "ai.openclaw.custom-runtime.guard.plist",
        "install_runtime_guard",
        "runtimeGuardScheduled",
      ]) &&
      hasAll(customRuntimeUpdateApprove, [
        "preservationProof",
        "executedVerificationCommands",
        "runtime:update-safe-customizations",
      ]) &&
      hasAll(customRuntimeUpdateSurvival, [
        "merge_from_active_sha",
        "register_verify_and_block",
        "explicit_exact_candidate",
      ]),
    acceptanceScripts:
      typeof packageJson.scripts?.["control-director:format-check"] === "string" &&
      typeof packageJson.scripts?.["control-director:torture"] === "string" &&
      typeof packageJson.scripts?.["control-director:chaos"] === "string" &&
      typeof packageJson.scripts?.["control-director:readiness"] === "string" &&
      typeof packageJson.scripts?.["control-director:runtime-proof"] === "string" &&
      typeof packageJson.scripts?.["control-director:roadmap-proof"] === "string" &&
      typeof packageJson.scripts?.["control-director:verify"] === "string" &&
      typeof packageJson.scripts?.["custom-runtime:update-survival"] === "string",
  };
}

function fact(id, label, passed, options = {}) {
  return {
    id,
    label,
    passed: Boolean(passed),
    critical: options.critical !== false,
    surface: options.surface ?? "source",
    ...(options.detail ? { detail: options.detail } : {}),
  };
}

function runtimeEvidencePassed(value, sourceSha) {
  return (
    value?.passed === true &&
    value.sourceSha === sourceSha &&
    typeof value.checkedAt === "string" &&
    Number.isFinite(Date.parse(value.checkedAt)) &&
    Array.isArray(value.evidenceRefs) &&
    value.evidenceRefs.some((entry) => typeof entry === "string" && Boolean(entry.trim()))
  );
}

function gatePassed(gates, key) {
  const value = gates?.[key];
  return value === true || value?.passed === true;
}

export function buildControlDirectorReadinessScorecard(params) {
  const config = params.config ?? {};
  const agent = findControlDirectorAgent(config);
  const controlDirectorAgents = (config.agents?.list ?? []).filter(
    (entry) => entry?.role === "control_director",
  );
  const programManagerAgentId = resolveAgentIdByOperationalRole(config, "program_manager");
  const judgeAgentId = resolveJudgeAgentId(config);
  const programManagerCapabilityAudit = programManagerAgentId
    ? auditOperationalRoleCapabilityPolicy({ config, agentId: programManagerAgentId })
    : undefined;
  const judgeCapabilityAudit = judgeAgentId
    ? auditOperationalRoleCapabilityPolicy({ config, agentId: judgeAgentId })
    : undefined;
  const agentId = params.agentId ?? agent?.id ?? "control-director";
  const registry = buildControlDirectorModelRegistry({ config, agentId });
  const selected = registry.selected.status === "ready" ? registry.selected.effective : "";
  const sourceState = params.source ?? {};
  const sourceSha = immutableSha(sourceState.sha);
  const expectedSha = immutableSha(sourceState.expectedSha);
  const wiring = params.wiring ?? {};
  const gates = params.gates ?? {};
  const runtime = params.runtimeProof;
  const facts = [];

  facts.push(
    fact(
      "agent-role",
      "Exactly one configured agent owns role control_director",
      Boolean(agent) && controlDirectorAgents.length === 1,
    ),
  );
  facts.push(
    fact(
      "program-manager-role",
      "A dedicated Program Manager owns delegated execution fan-out",
      Boolean(programManagerAgentId) &&
        resolveProgramManagerRoute(config, agent?.id).source === "dedicated" &&
        programManagerAgentId !== agent?.id,
    ),
  );
  facts.push(
    fact(
      "program-manager-capabilities",
      "Program Manager configured policy admits every required dispatch and fan-in tool",
      programManagerCapabilityAudit?.passed === true,
      {
        detail: programManagerCapabilityAudit?.missingTools.length
          ? `missing: ${programManagerCapabilityAudit.missingTools.join(", ")}`
          : "required role tools admitted",
      },
    ),
  );
  facts.push(
    fact(
      "judge-role",
      "A distinct independent Judge owns read-only completion review",
      Boolean(judgeAgentId) && judgeAgentId !== agent?.id && judgeAgentId !== programManagerAgentId,
    ),
  );
  facts.push(
    fact(
      "judge-capabilities",
      "Judge configured policy admits every required read-only evidence tool",
      judgeCapabilityAudit?.passed === true,
      {
        detail: judgeCapabilityAudit?.missingTools.length
          ? `missing: ${judgeCapabilityAudit.missingTools.join(", ")}`
          : "required role tools admitted",
      },
    ),
  );
  facts.push(
    fact(
      "role-scope",
      "Control Director scope is role-only, never id, name, persona, or model based",
      Boolean(agent) &&
        isConfiguredControlDirectorAgent({ config, agentId }) &&
        !isConfiguredControlDirectorAgent({
          config: {
            ...config,
            agents: {
              ...config.agents,
              list: [
                { id: "main", name: "Control Director", model: CONTROL_DIRECTOR_DEFAULT_MODEL },
              ],
            },
          },
          agentId: "main",
        }),
    ),
  );
  facts.push(
    fact(
      "gemma-default",
      "Gemma 4 31B Q8 is the canonical default",
      registry.defaultModel === CONTROL_DIRECTOR_DEFAULT_MODEL &&
        CONTROL_DIRECTOR_DEFAULT_ALIAS === "openclaw-control-gemma4-31b-q8" &&
        CONTROL_DIRECTOR_DEFAULT_MODEL_ID === "openclaw-control-gemma4-31b-q8:latest" &&
        CONTROL_DIRECTOR_DEFAULT_UNDERLYING_OLLAMA_TAG === "hf.co/unsloth/gemma-4-31B-it-GGUF:Q8_0",
    ),
  );
  facts.push(
    fact(
      "selected-model",
      "Selected Control Director model exists in the safe config-derived registry",
      registry.selected.status === "ready",
      { detail: registry.selected.status === "ready" ? selected : registry.selected.reason },
    ),
  );
  facts.push(
    fact(
      "selectable-alternatives",
      "Config-derived alternatives are selectable without changing role scope",
      registry.entries.length > 1,
      { critical: false, detail: `${registry.entries.length} configured model entries` },
    ),
  );
  facts.push(
    fact("immutable-source", "Source is an immutable 40-character SHA", Boolean(sourceSha)),
  );
  facts.push(
    fact(
      "expected-source",
      "Source SHA matches the explicitly expected SHA",
      Boolean(sourceSha && expectedSha && sourceSha === expectedSha),
      { detail: `source=${sourceSha || "missing"}; expected=${expectedSha || "missing"}` },
    ),
  );
  facts.push(fact("clean-source", "Exact source checkout is clean", sourceState.clean === true));
  facts.push(
    fact(
      "canonical-root",
      "Readiness ran from the script-derived repository root",
      path.resolve(sourceState.root ?? "") === CONTROL_DIRECTOR_READINESS_REPO_ROOT,
    ),
  );

  for (const [key, label] of Object.entries({
    turnPolicyAndPromptBudget:
      "Turn policy, prompt budget, and recent recall have production callers",
    roleScopedDeliveryGuards: "Role-scoped delivery guards run in command and auto-reply paths",
    governedCodexAdapter: "Governed Codex adapter has a production orchestration caller",
    pursueGoalOrchestrator: "Pursue Goal and bounded self-healing are wired to Gateway lifecycle",
    resourceGovernor: "Resource governor participates in runtime admission",
    resourceResidencyProbe: "Provider-owned model residency participates in runtime admission",
    resourceModelWarmup:
      "Post-ready model warmup is resource-governed, cancellable, and provider verified",
    responsiveMemoryPolicy:
      "Hot recent recall stays deterministic while deep recall is explicit and fail-fast",
    memoryHealthProjection: "Memory freshness and provenance are projected by execution state",
    runtimeLineage: "Runtime lineage is projected by the canonical execution-state RPC",
    sigClosureGovernance: "SIG Control Director closure governance has a production caller",
    sigBackgroundRuntime: "Managed SIG background processing has an explicit production path",
    typedJourneySignals: "Every typed Control Director journey signal has a production observer",
    independentJudge: "Independent Judge execution and signed-receipt verification are wired",
    durableMailboxAndEvents: "Durable mailbox and typed execution events have production callers",
    unifiedApprovalEnvelope: "One approval and execution-profile contract reaches Codex and PCC",
    roleCapabilityCompiler: "Role prompts and runtime capability budgets share one compiler",
    serverOwnedTurnInbox: "The server-owned mutable turn inbox is wired to Gateway lifecycle",
    singleProductionChat: "One production Chat stack owns the Dashboard entrypoint",
    typedPccBoundary: "Chat-to-PCC sync accepts explicit plan envelopes only",
    updateSafeCustomizationLifecycle:
      "Update-safe customization lifecycle is manifest-driven and proof-bound",
    acceptanceScripts:
      "Torture, chaos, readiness, runtime, and roadmap gates are repository commands",
  })) {
    facts.push(fact(`wiring-${key}`, label, wiring[key] === true));
  }
  facts.push(fact("gate-torture", "Instruction torture gate passed", gatePassed(gates, "torture")));
  facts.push(fact("gate-chaos", "Chaos and state-hygiene gate passed", gatePassed(gates, "chaos")));
  facts.push(
    fact("gate-chat-stack", "Production Chat-stack gate passed", gatePassed(gates, "chatStack")),
  );
  facts.push(
    fact("gate-typecheck", "Required typecheck gates passed", gatePassed(gates, "typecheck")),
  );
  facts.push(fact("gate-tests", "Required targeted tests passed", gatePassed(gates, "tests")));
  facts.push(fact("gate-build", "Production build passed", gatePassed(gates, "build")));

  const runtimeSurface = { surface: "runtime" };
  facts.push(
    fact("runtime-proof", "Managed runtime proof is present", Boolean(runtime), runtimeSurface),
  );
  facts.push(
    fact(
      "runtime-proof-contract",
      "Managed runtime proof uses the SIG-enabled exact-runtime contract",
      runtime?.schemaVersion === 4 && runtime?.sigBackgroundEnabled === true,
      runtimeSurface,
    ),
  );
  facts.push(
    fact(
      "runtime-lineage",
      "Managed runtime reports ready exact lineage",
      runtime?.lineage?.status === "ready" &&
        runtime.lineage.sourceSha === sourceSha &&
        runtime.lineage.selectedModel === selected &&
        runtime.lineage.canary?.sourceSha === sourceSha &&
        runtime.lineage.canary?.uiBuildId === runtime.lineage.artifactHash &&
        /^[a-f0-9]{64}$/u.test(runtime?.artifacts?.lineage?.sha256 ?? ""),
      runtimeSurface,
    ),
  );
  facts.push(
    fact(
      "runtime-sig-background",
      "Managed SIG background processing is explicitly enabled",
      runtime?.sigBackgroundEnabled === true,
      runtimeSurface,
    ),
  );
  facts.push(
    fact(
      "runtime-update-broker",
      "Prepare-only custom-runtime update broker is installed and scheduled",
      params.updateSafety?.status === "protected" && params.updateSafety?.brokerConfigured === true,
      runtimeSurface,
    ),
  );
  facts.push(
    fact(
      "runtime-recovery-guard",
      "Custom-runtime recovery guard is installed and scheduled",
      params.updateSafety?.status === "protected" &&
        params.updateSafety?.runtimeGuardConfigured === true,
      runtimeSurface,
    ),
  );
  const selectedOllamaModelId = resolveSelectedOllamaModelId(config, agentId);
  const selectedOllamaModel = params.ollamaModels?.get(selectedOllamaModelId);
  const selectedBaseDigests = params.ollamaModelBases?.get(selectedOllamaModelId) ?? [];
  const selectedManifestDigest =
    typeof params.ollamaResidency?.digest === "string" &&
    /^[a-f0-9]{64}$/u.test(params.ollamaResidency.digest)
      ? params.ollamaResidency.digest
      : "";
  const selectedModelDigest =
    selectedManifestDigest && selectedBaseDigests.length > 0
      ? createHash("sha256")
          .update(
            JSON.stringify({
              manifestDigest: selectedManifestDigest,
              baseBlobDigests: [...selectedBaseDigests].toSorted((left, right) =>
                left.localeCompare(right),
              ),
            }),
          )
          .digest("hex")
      : "";
  const selectedIsDefault = selectedOllamaModelId === CONTROL_DIRECTOR_DEFAULT_MODEL_ID;
  const underlying = selectedIsDefault
    ? params.ollamaModels?.get(CONTROL_DIRECTOR_DEFAULT_UNDERLYING_OLLAMA_TAG)
    : undefined;
  const underlyingBaseDigests = selectedIsDefault
    ? (params.ollamaModelBases?.get(CONTROL_DIRECTOR_DEFAULT_UNDERLYING_OLLAMA_TAG) ?? [])
    : [];
  const cacheEvidence = (() => {
    try {
      return buildControlDirectorCacheIdentityEvidence({
        selectedModel: selected,
        modelId: selectedOllamaModelId,
        modelDigest: selectedModelDigest,
        manifestDigest: selectedManifestDigest,
        baseBlobDigests: selectedBaseDigests,
        kvCacheType: params.ollamaEnv?.OLLAMA_KV_CACHE_TYPE ?? "",
        residency: params.ollamaResidency ?? {},
      });
    } catch {
      return null;
    }
  })();
  facts.push(
    fact(
      "runtime-config-digest",
      "Managed configuration bytes match the explicitly authorized digest",
      /^[a-f0-9]{64}$/u.test(params.configDigest ?? "") &&
        params.configDigest === params.expectedConfigDigest,
      {
        ...runtimeSurface,
        detail: `observed=${params.configDigest || "missing"}; expected=${params.expectedConfigDigest || "missing"}`,
      },
    ),
  );
  facts.push(
    fact(
      "runtime-model-digest",
      "Selected config-derived Ollama model exists and is bound to immutable model blobs",
      Boolean(
        selectedOllamaModelId &&
        selectedOllamaModel?.digest &&
        selectedManifestDigest &&
        selectedBaseDigests.length > 0 &&
        (!selectedIsDefault ||
          (underlying?.digest &&
            selectedBaseDigests.length === underlyingBaseDigests.length &&
            selectedBaseDigests.every((digest, index) => digest === underlyingBaseDigests[index]))),
      ),
      { ...runtimeSurface, detail: selectedOllamaModelId || "no selected Ollama model" },
    ),
  );
  facts.push(
    fact(
      "runtime-ollama-env",
      "Ollama uses bounded Flash Attention, Q8 KV cache, and one parallel request",
      Object.entries(REQUIRED_OLLAMA_ENV).every(
        ([key, value]) => params.ollamaEnv?.[key] === value,
      ),
      runtimeSurface,
    ),
  );
  facts.push(
    fact(
      "runtime-model-smoke",
      "Selected config-derived Ollama model answers the deterministic model smoke",
      params.ollamaChatSmoke?.ok === true &&
        params.ollamaChatSmoke?.modelId === selectedOllamaModelId,
      {
        ...runtimeSurface,
        detail: `${selectedOllamaModelId || "no selected Ollama model"}; ${params.ollamaChatSmoke?.detail ?? "no smoke result"}`,
      },
    ),
  );
  facts.push(
    fact(
      "runtime-model-residency",
      "Selected immutable Ollama model is live in the configured KV cache",
      cacheEvidence !== null,
      {
        ...runtimeSurface,
        detail: cacheEvidence
          ? `${cacheEvidence.modelId}; cache=${cacheEvidence.cacheDigest}`
          : "no exact live residency",
      },
    ),
  );
  const modelEvalTrials = Array.isArray(runtime?.modelEval?.results)
    ? runtime.modelEval.results.map((entry) => entry?.trial).filter(Boolean)
    : [];
  const evaluatedTaskClasses = new Set(modelEvalTrials.map((trial) => trial.taskClass));
  facts.push(
    fact(
      "runtime-model-eval",
      "Exact managed-model cold and warm routing trials pass every required task class",
      runtime?.modelEval?.passed === true &&
        runtime.modelEval.exactRuntime === true &&
        runtime.modelEval.sourceSha === sourceSha &&
        runtime.modelEval.passRate === 100 &&
        runtime.modelEval.criticalOmissions === 0 &&
        runtime.modelEval.coveragePassed === true &&
        modelEvalTrials.some((trial) => trial.cold === true) &&
        modelEvalTrials.some((trial) => trial.cold === false) &&
        REQUIRED_MODEL_EVAL_TASK_CLASSES.every((taskClass) => evaluatedTaskClasses.has(taskClass)),
      runtimeSurface,
    ),
  );
  for (const [key, label] of Object.entries({
    macStudioDashboard:
      "Mac Studio Dashboard keeps transcript and composer accessible on the exact managed host",
    localModelRouting: "Local model routing is exact and evidence-backed",
    localModelLatency: "Local model latency meets the accepted runtime threshold",
    memory: "Recent and durable memory retrieval is evidence-backed",
    delegation: "Control Director delegation completes through a real worker",
    judge: "The independent Judge signs an evidence-backed verdict",
    sig: "The Self-Improvement Governor records typed runtime evidence",
    pcc: "PCC state stays consistent with the managed orchestration run",
    queue: "Queued turns are accepted and processed in order",
    steer: "Steering changes the active run without losing work",
    cancel: "Cancellation stops active work and clears stale running state",
    pursueGoal: "Pursue Goal continues, resumes, and stops through live control",
    restartRecovery: "Gateway restart recovers goals and pending turns",
    rollback: "Rollback drill restores the prior verified runtime",
    liveDiagnostic: "A safe live Control Director diagnostic produced a usable final response",
  })) {
    facts.push(
      fact(
        `runtime-${key}`,
        label,
        runtimeEvidencePassed(runtime?.[key], sourceSha),
        runtimeSurface,
      ),
    );
  }
  facts.push(
    fact(
      "runtime-soak",
      `Managed runtime soak passed for at least ${MINIMUM_SOAK_MS}ms`,
      runtimeEvidencePassed(runtime?.soak, sourceSha) &&
        runtime.soak.durationMs >= MINIMUM_SOAK_MS &&
        Date.parse(runtime.soak.endedAt ?? "") - Date.parse(runtime.soak.startedAt ?? "") >=
          runtime.soak.durationMs,
      runtimeSurface,
    ),
  );

  const sourceFacts = facts.filter((entry) => entry.surface !== "runtime");
  const sourceReady = sourceFacts.every((entry) => !entry.critical || entry.passed);
  const productionReady = facts.every((entry) => !entry.critical || entry.passed);
  const failedCritical = facts.filter((entry) => entry.critical && !entry.passed);
  const passed = facts.filter((entry) => entry.passed).length;
  return {
    schemaVersion: 2,
    generatedAt: params.generatedAt ?? new Date().toISOString(),
    sourceSha,
    expectedSha,
    agentId,
    selectedModel: selected || null,
    configurationDigest: params.configDigest || null,
    roleIdentities: {
      controlDirectorAgentId: agent?.id ?? agentId,
      programManagerAgentId: programManagerAgentId ?? null,
      judgeAgentId: judgeAgentId ?? null,
    },
    modelEvidence: {
      modelId: selectedOllamaModelId || null,
      manifestDigest: selectedManifestDigest || null,
      baseBlobDigests: [...selectedBaseDigests].toSorted((left, right) =>
        left.localeCompare(right),
      ),
      modelDigest: selectedModelDigest || null,
      smokeModelId: params.ollamaChatSmoke?.modelId ?? null,
    },
    cacheEvidence,
    defaultModel: CONTROL_DIRECTOR_DEFAULT_MODEL,
    sourceReady,
    productionReady,
    completionGrade: Math.round((passed / Math.max(1, facts.length)) * 10),
    passPercent: Math.round((passed / Math.max(1, facts.length)) * 1_000) / 10,
    facts,
    failedCritical: failedCritical.map((entry) => entry.label),
    nextBuildGap: failedCritical[0]?.label ?? "No critical Control Director readiness gap remains.",
    mode: params.sourceOnly ? "source-only" : "production",
  };
}

function resolveOllamaBaseUrl(config) {
  const provider = config.models?.providers?.ollama ?? {};
  const raw = provider.baseUrl ?? provider.baseURL ?? DEFAULT_OLLAMA_BASE_URL;
  if (typeof raw !== "string") {
    throw new Error("Configured Ollama base URL must be a string.");
  }
  const baseUrl = new URL(raw.trim().replace(/\/+$/u, "").replace(/\/v1$/iu, ""));
  if (
    !["http:", "https:"].includes(baseUrl.protocol) ||
    !["127.0.0.1", "localhost"].includes(baseUrl.hostname) ||
    baseUrl.username ||
    baseUrl.password
  ) {
    throw new Error("Control Director readiness requires the loopback Ollama service.");
  }
  return baseUrl.toString().replace(/\/$/u, "");
}

async function runOllamaChatSmoke(baseUrl, modelId) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), CHAT_SMOKE_TIMEOUT_MS);
  try {
    const response = await fetch(`${baseUrl}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: controller.signal,
      body: JSON.stringify({
        model: modelId,
        messages: [{ role: "user", content: "Reply exactly: OK" }],
        stream: false,
        think: false,
        options: { num_ctx: 2048, num_predict: 4, temperature: 0 },
      }),
    });
    return { ok: response.ok, modelId, detail: `status=${response.status}` };
  } catch (error) {
    return {
      ok: false,
      modelId,
      detail: error instanceof Error ? error.message : String(error),
    };
  } finally {
    clearTimeout(timer);
  }
}

async function readOllamaResidency(baseUrl, modelId) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), CHAT_SMOKE_TIMEOUT_MS);
  try {
    const response = await fetch(`${baseUrl}/api/ps`, { signal: controller.signal });
    if (!response.ok) {
      return {};
    }
    const body = await response.json();
    const model = Array.isArray(body?.models)
      ? body.models.find((entry) => entry?.name === modelId || entry?.model === modelId)
      : undefined;
    return model
      ? {
          modelId,
          digest: typeof model.digest === "string" ? model.digest.trim().toLowerCase() : "",
          sizeBytes: Number(model.size),
          vramBytes: Number(model.size_vram),
        }
      : {};
  } catch {
    return {};
  } finally {
    clearTimeout(timer);
  }
}

function readOllamaEnvironment() {
  const values = Object.fromEntries(
    Object.keys(REQUIRED_OLLAMA_ENV).map((key) => [key, process.env[key]]),
  );
  if (Object.values(values).every(Boolean)) {
    return values;
  }
  const uid = typeof process.getuid === "function" ? process.getuid() : null;
  if (uid === null) {
    return values;
  }
  const launchctl = run("launchctl", ["print", `gui/${uid}/ai.openclaw.ollama`]);
  if (!launchctl.ok) {
    return values;
  }
  for (const key of Object.keys(REQUIRED_OLLAMA_ENV)) {
    const match = launchctl.stdout.match(new RegExp(`${key}\\s*=>\\s*([^\\n]+)`, "u"));
    if (match?.[1]) {
      values[key] = match[1].trim();
    }
  }
  return values;
}

function readSourceState(expectedSha) {
  const head = run("git", ["-C", CONTROL_DIRECTOR_READINESS_REPO_ROOT, "rev-parse", "HEAD"]);
  const status = run("git", [
    "-C",
    CONTROL_DIRECTOR_READINESS_REPO_ROOT,
    "status",
    "--porcelain=v1",
    "--untracked-files=all",
  ]);
  return {
    sha: head.ok ? head.stdout : "",
    expectedSha,
    clean: status.ok && status.stdout === "",
    root: CONTROL_DIRECTOR_READINESS_REPO_ROOT,
  };
}

function printText(scorecard) {
  console.log(`Control Director readiness (${scorecard.mode})`);
  console.log(`Source SHA: ${scorecard.sourceSha || "missing"}`);
  console.log(`Selected model: ${scorecard.selectedModel ?? "unavailable"}`);
  console.log(`Source ready: ${scorecard.sourceReady ? "yes" : "no"}`);
  console.log(`Production ready: ${scorecard.productionReady ? "yes" : "no"}`);
  console.log(`Pass: ${scorecard.passPercent}%`);
  for (const item of scorecard.facts) {
    console.log(`${item.passed ? "PASS" : item.critical ? "FAIL" : "WARN"} ${item.label}`);
  }
  console.log(`Next build gap: ${scorecard.nextBuildGap}`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(usage());
    return;
  }
  if (!args.configPath || !fs.existsSync(args.configPath)) {
    throw new Error(`Control Director config not found: ${args.configPath || "missing"}`);
  }
  if (!args.gateProofPath || !fs.existsSync(args.gateProofPath)) {
    throw new Error("A current --gate-proof JSON file is required.");
  }
  const config = readJson(args.configPath);
  const configDigest = createHash("sha256").update(fs.readFileSync(args.configPath)).digest("hex");
  const sourceState = readSourceState(args.expectedSha);
  const gates = readJson(args.gateProofPath);
  const runtimeProof = args.runtimeProofPath ? readJson(args.runtimeProofPath) : undefined;
  let ollamaModels = new Map();
  let ollamaModelBases = new Map();
  let ollamaEnv = {};
  let ollamaChatSmoke = { ok: false, modelId: "", detail: "source-only mode" };
  let ollamaResidency = {};
  if (!args.sourceOnly) {
    if (!runtimeProof) {
      throw new Error("Production mode requires --runtime-proof JSON.");
    }
    if (!/^[a-f0-9]{64}$/u.test(args.expectedConfigDigest)) {
      throw new Error("Production mode requires --expected-config-digest as lowercase SHA-256.");
    }
    const selectedOllamaModelId = resolveSelectedOllamaModelId(config);
    if (!selectedOllamaModelId) {
      throw new Error("Configured Control Director model is not a ready Ollama route.");
    }
    const list = run("ollama", ["list"]);
    ollamaModels = list.ok ? parseOllamaList(list.stdout) : new Map();
    const inspectedModels = new Set([selectedOllamaModelId]);
    if (selectedOllamaModelId === CONTROL_DIRECTOR_DEFAULT_MODEL_ID) {
      inspectedModels.add(CONTROL_DIRECTOR_DEFAULT_UNDERLYING_OLLAMA_TAG);
    }
    ollamaModelBases = new Map(
      [...inspectedModels].map((modelId) => {
        const shown = run("ollama", ["show", modelId, "--modelfile"]);
        return [modelId, shown.ok ? parseOllamaModelfileBaseDigests(shown.stdout) : []];
      }),
    );
    ollamaEnv = readOllamaEnvironment();
    ollamaChatSmoke = await runOllamaChatSmoke(resolveOllamaBaseUrl(config), selectedOllamaModelId);
    ollamaResidency = await readOllamaResidency(
      resolveOllamaBaseUrl(config),
      selectedOllamaModelId,
    );
  }
  const scorecard = buildControlDirectorReadinessScorecard({
    config,
    source: sourceState,
    wiring: collectControlDirectorActiveWiring(),
    gates,
    runtimeProof,
    ollamaModels,
    ollamaModelBases,
    ollamaEnv,
    ollamaChatSmoke,
    ollamaResidency,
    updateSafety: args.sourceOnly ? undefined : readPccUpdateSafety(),
    configDigest,
    expectedConfigDigest: args.expectedConfigDigest,
    sourceOnly: args.sourceOnly,
  });
  if (args.json) {
    console.log(JSON.stringify(scorecard, null, 2));
  } else {
    printText(scorecard);
  }
  process.exitCode = (args.sourceOnly ? scorecard.sourceReady : scorecard.productionReady) ? 0 : 1;
}

/** @param {unknown} error */
function reportMainFailure(error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}

if (path.resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url)) {
  main().catch(reportMainFailure);
}
