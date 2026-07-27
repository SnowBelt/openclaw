#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const AUDITED_MILESTONE_IDS = Array.from(
  { length: 68 },
  (_, index) => `M${String(index + 1).padStart(2, "0")}`,
);
const AUDITED_MILESTONE_ID_SET = new Set(AUDITED_MILESTONE_IDS);
const DEFAULT_ROADMAP_PATH = "work/control-director/reliability-v1/roadmap.json";

function evidenceContract(id, implementationPaths, corroborationPaths) {
  return Object.freeze({
    id,
    implementationPaths: Object.freeze(implementationPaths),
    corroborationPaths: Object.freeze(corroborationPaths),
  });
}

export const MILESTONE_EVIDENCE_CONTRACTS = Object.freeze([
  evidenceContract(
    "M01",
    ["scripts/control-director-readiness.mjs"],
    ["test/scripts/control-director-readiness.test.ts"],
  ),
  evidenceContract(
    "M02",
    ["src/agents/control-director-quality-rubric.ts"],
    ["src/agents/control-director-quality-rubric.test.ts"],
  ),
  evidenceContract(
    "M03",
    ["src/agents/agent-role-capabilities.ts"],
    ["src/agents/agent-role-capabilities.test.ts"],
  ),
  evidenceContract(
    "M04",
    ["src/agents/control-director-model-registry.ts"],
    ["src/agents/control-director-model-registry.test.ts"],
  ),
  evidenceContract("M05", ["src/tasks/execution-event.ts"], ["src/tasks/execution-event.test.ts"]),
  evidenceContract(
    "M06",
    ["src/pcc/execution-state-projection.ts"],
    ["src/pcc/execution-state-projection.test.ts"],
  ),
  evidenceContract(
    "M07",
    ["src/agents/control-director-turn-policy.ts"],
    ["src/agents/control-director-turn-policy.test.ts"],
  ),
  evidenceContract(
    "M08",
    ["src/auto-reply/reply/reply-turn-admission.ts"],
    ["src/auto-reply/reply/reply-turn-admission.test.ts"],
  ),
  evidenceContract(
    "M09",
    ["src/agents/control-director-activity-watchdog.ts"],
    ["src/agents/control-director-activity-watchdog.test.ts"],
  ),
  evidenceContract(
    "M10",
    ["src/tasks/task-executor-policy.ts"],
    ["src/tasks/task-executor-policy.test.ts"],
  ),
  evidenceContract(
    "M11",
    ["src/tasks/durable-worker-mailbox.ts"],
    ["src/tasks/durable-worker-mailbox.test.ts"],
  ),
  evidenceContract(
    "M12",
    ["src/gateway/live-chat-projector.ts"],
    ["src/gateway/server-chat.agent-events.test.ts"],
  ),
  evidenceContract(
    "M13",
    ["src/tasks/task-cancellation-state.ts"],
    ["src/tasks/cron-task-cancel.test.ts"],
  ),
  evidenceContract(
    "M14",
    ["src/tasks/pursue-goal-controller.runtime.ts"],
    ["src/tasks/pursue-goal-controller.runtime.test.ts"],
  ),
  evidenceContract(
    "M15",
    ["src/tasks/pursue-goal-controller.ts"],
    ["src/tasks/pursue-goal-controller.test.ts"],
  ),
  evidenceContract(
    "M16",
    ["src/tasks/task-registry.reconcile.ts"],
    ["src/tasks/task-registry.process-state.test.ts"],
  ),
  evidenceContract(
    "M17",
    ["src/gateway/chat-queued-turns.ts"],
    ["src/gateway/chat-queued-turns.test.ts"],
  ),
  evidenceContract(
    "M18",
    ["src/gateway/chat-turn-inbox-controller.ts"],
    ["src/gateway/chat-turn-inbox-controller.test.ts"],
  ),
  evidenceContract(
    "M19",
    ["ui/src/ui/chat/control-director-diagnostics.ts"],
    ["ui/src/ui/chat/control-director-diagnostics.test.ts"],
  ),
  evidenceContract(
    "M20",
    ["ui/src/pages/chat/chat-pane.ts"],
    ["ui/src/pages/chat/chat-view.test.ts"],
  ),
  evidenceContract(
    "M21",
    ["src/pcc/execution-state-projection.ts"],
    ["src/pcc/architecture.guardrail.test.ts"],
  ),
  evidenceContract(
    "M22",
    ["src/pcc/execution-state-projection.ts"],
    ["src/pcc/execution-state-projection.test.ts"],
  ),
  evidenceContract(
    "M23",
    ["src/gateway/dashboard-session-title.ts", "ui/src/ui/sidebar-recents.ts"],
    ["src/gateway/dashboard-session-title.test.ts", "ui/src/ui/sidebar-recents.test.ts"],
  ),
  evidenceContract(
    "M24",
    ["ui/src/pages/chat/chat-pane.ts"],
    ["ui/src/pages/chat/chat-responsive.browser.test.ts"],
  ),
  evidenceContract(
    "M25",
    ["src/agents/control-director-execution-profile.ts"],
    ["src/agents/control-director-execution-profile.test.ts"],
  ),
  evidenceContract(
    "M26",
    ["src/agents/model-routing-policy.ts"],
    ["src/agents/model-routing-policy.test.ts"],
  ),
  evidenceContract(
    "M27",
    ["src/agents/control-director-codex-adapter.ts"],
    ["src/agents/control-director-codex-adapter.test.ts"],
  ),
  evidenceContract(
    "M28",
    ["src/agents/control-director-codex-adapter.ts"],
    ["src/agents/control-director-codex-adapter.test.ts"],
  ),
  evidenceContract(
    "M29",
    ["src/agents/control-director-model-eval.ts"],
    ["src/agents/control-director-model-eval.test.ts"],
  ),
  evidenceContract(
    "M30",
    ["src/agents/control-director-resource-governor.ts"],
    ["src/agents/control-director-resource-governor.test.ts"],
  ),
  evidenceContract(
    "M31",
    ["src/agents/control-director-model-warmup.ts"],
    ["src/agents/control-director-model-warmup.test.ts"],
  ),
  evidenceContract(
    "M32",
    ["src/agents/control-director-memory-runtime.ts"],
    ["src/agents/control-director-memory-index.test.ts"],
  ),
  evidenceContract(
    "M33",
    ["src/auto-reply/reply/control-director-recent-context.ts"],
    ["src/auto-reply/reply/control-director-recent-context.test.ts"],
  ),
  evidenceContract(
    "M34",
    ["src/agents/control-director-context-budget.ts"],
    ["src/agents/control-director-context-budget.test.ts"],
  ),
  evidenceContract(
    "M35",
    ["src/agents/control-director-memory-index.ts"],
    ["docs/concepts/memory.md"],
  ),
  evidenceContract(
    "M36",
    ["src/self-improvement/safety.ts"],
    ["src/self-improvement/autonomy.test.ts"],
  ),
  evidenceContract(
    "M37",
    ["src/self-improvement/signals.ts"],
    ["src/self-improvement/signals.test.ts"],
  ),
  evidenceContract(
    "M38",
    ["src/agents/control-director-runtime-canary.ts"],
    ["src/agents/control-director-runtime-canary.test.ts"],
  ),
  evidenceContract(
    "M39",
    ["ui/src/ui/chat/control-director-diagnostics.ts"],
    ["ui/src/ui/chat/control-director-diagnostics.test.ts"],
  ),
  evidenceContract(
    "M40",
    ["src/self-improvement/control-director-self-healing.ts"],
    ["src/self-improvement/control-director-self-healing.test.ts"],
  ),
  evidenceContract(
    "M41",
    ["src/agents/independent-judge-service.ts"],
    ["src/agents/independent-judge-service.test.ts"],
  ),
  evidenceContract(
    "M42",
    ["scripts/custom-runtime/control-director-role-config.py"],
    ["test/scripts/control-director-role-config.test.ts"],
  ),
  evidenceContract(
    "M43",
    ["src/agents/control-director-instruction-torture.ts"],
    ["src/agents/control-director-instruction-torture.test.ts"],
  ),
  evidenceContract(
    "M44",
    ["scripts/control-director-runtime-proof.ts"],
    ["test/scripts/control-director-runtime-proof.test.ts"],
  ),
  evidenceContract(
    "M45",
    ["scripts/control-director-verify.mjs"],
    ["test/scripts/control-director-verify.test.ts"],
  ),
  evidenceContract(
    "M46",
    ["src/agents/control-director-turn-policy.ts"],
    ["src/agents/control-director-turn-policy.test.ts"],
  ),
  evidenceContract(
    "M47",
    ["src/tasks/detached-task-runtime-contract.ts"],
    ["src/tasks/detached-task-runtime.test.ts"],
  ),
  evidenceContract(
    "M48",
    ["src/tasks/task-flow-registry.ts"],
    ["src/tasks/task-flow-registry.test.ts"],
  ),
  evidenceContract(
    "M49",
    ["src/gateway/chat-turn-inbox-state.ts"],
    ["src/gateway/chat-turn-inbox-state.test.ts"],
  ),
  evidenceContract(
    "M50",
    ["ui/src/pages/chat/chat-view.ts"],
    ["ui/src/pages/chat/chat-view.test.ts"],
  ),
  evidenceContract(
    "M51",
    ["src/tasks/task-registry.reconcile.ts"],
    ["src/tasks/task-registry.audit.test.ts"],
  ),
  evidenceContract(
    "M52",
    ["src/agents/control-director-context-budget.ts"],
    ["src/agents/control-director-context-budget.test.ts"],
  ),
  evidenceContract(
    "M53",
    ["src/agents/agent-role-capabilities.ts"],
    ["src/agents/agent-role-capabilities.test.ts"],
  ),
  evidenceContract(
    "M54",
    ["src/agents/execution-approval-envelope.ts"],
    ["src/agents/execution-approval-envelope.test.ts"],
  ),
  evidenceContract(
    "M55",
    ["src/agents/control-director-memory-index.ts"],
    ["src/agents/control-director-memory-index.test.ts"],
  ),
  evidenceContract(
    "M56",
    ["src/agents/control-director-runtime-lineage.ts"],
    ["src/agents/control-director-runtime-lineage.test.ts"],
  ),
  evidenceContract(
    "M57",
    ["src/self-improvement/control-director-journeys.ts"],
    ["src/self-improvement/control-director-journeys.test.ts"],
  ),
  evidenceContract(
    "M58",
    ["src/self-improvement/control-director-closure.ts"],
    ["src/self-improvement/control-director-closure.test.ts"],
  ),
  evidenceContract(
    "M59",
    ["scripts/control-director-torture.ts"],
    ["src/agents/control-director-chaos-acceptance.test.ts"],
  ),
  evidenceContract(
    "M60",
    ["src/agents/control-director-quality-rubric.ts"],
    ["src/agents/control-director-quality-rubric.test.ts"],
  ),
  evidenceContract(
    "M61",
    ["scripts/custom-runtime/custom-runtime-update-survival.ts"],
    ["test/scripts/custom-runtime-update-survival.test.ts"],
  ),
  evidenceContract(
    "M62",
    ["scripts/lib/control-director-subagent-incident-audit.ts"],
    ["test/scripts/control-director-subagent-incident-audit.test.ts"],
  ),
  evidenceContract(
    "M63",
    ["src/agents/subagent-task-root.ts"],
    ["src/agents/subagent-task-root.test.ts"],
  ),
  evidenceContract(
    "M64",
    ["src/agents/subagent-spawn-recovery.ts"],
    ["src/agents/subagent-spawn-recovery.test.ts"],
  ),
  evidenceContract(
    "M65",
    ["src/agents/agent-role-capabilities.ts"],
    ["src/agents/agent-role-capabilities.test.ts"],
  ),
  evidenceContract(
    "M66",
    ["scripts/control-director-deployment-consistency.ts"],
    ["test/scripts/control-director-deployment-consistency.test.ts"],
  ),
  evidenceContract(
    "M67",
    ["src/agents/control-director-truth-evidence.ts"],
    ["src/agents/control-director-truth-evidence.test.ts"],
  ),
  evidenceContract(
    "M68",
    ["scripts/control-director-roadmap-proof.mjs"],
    ["test/scripts/control-director-roadmap-proof.test.ts"],
  ),
]);

function isRepositoryRelativePath(value) {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    !path.isAbsolute(value) &&
    !value.split(/[\\/]/u).includes("..")
  );
}

function isCorroborationPath(value) {
  return (
    value.startsWith("docs/") ||
    value.startsWith("test/") ||
    /(?:^|\/)[^/]+(?:\.browser|\.e2e)?\.test\.[cm]?[jt]sx?$/u.test(value)
  );
}

export function validateMilestoneEvidenceContracts(contracts = MILESTONE_EVIDENCE_CONTRACTS) {
  if (!Array.isArray(contracts)) {
    throw new TypeError("Milestone evidence contracts must be an array.");
  }

  const errors = [];
  const seen = new Set();
  for (const [index, contract] of contracts.entries()) {
    const label = `contracts[${index}]`;
    if (!contract || typeof contract !== "object" || Array.isArray(contract)) {
      errors.push(`${label} must be an object`);
      continue;
    }
    if (!AUDITED_MILESTONE_ID_SET.has(contract.id)) {
      errors.push(`${label}.id is unknown: ${String(contract.id)}`);
    } else if (seen.has(contract.id)) {
      errors.push(`${label}.id is duplicated: ${contract.id}`);
    } else {
      seen.add(contract.id);
    }

    for (const [field, pathValidator] of [
      ["implementationPaths", isRepositoryRelativePath],
      [
        "corroborationPaths",
        (value) => isRepositoryRelativePath(value) && isCorroborationPath(value),
      ],
    ]) {
      const paths = contract[field];
      if (!Array.isArray(paths) || paths.length === 0) {
        errors.push(`${label}.${String(field)} must contain at least one path`);
        continue;
      }
      const pathSet = new Set();
      for (const contractPath of paths) {
        if (!pathValidator(contractPath)) {
          errors.push(
            `${label}.${String(field)} contains an invalid path: ${String(contractPath)}`,
          );
        } else if (pathSet.has(contractPath)) {
          errors.push(
            `${label}.${String(field)} contains a duplicate path: ${String(contractPath)}`,
          );
        } else {
          pathSet.add(contractPath);
        }
      }
    }
  }

  for (const id of AUDITED_MILESTONE_IDS) {
    if (!seen.has(id)) {
      errors.push(`missing evidence contract for ${id}`);
    }
  }
  if (errors.length > 0) {
    throw new Error(
      `Invalid Control Director milestone evidence contracts:\n- ${errors.join("\n- ")}`,
    );
  }
  return contracts.toSorted(
    (left, right) =>
      AUDITED_MILESTONE_IDS.indexOf(left.id) - AUDITED_MILESTONE_IDS.indexOf(right.id),
  );
}

function readRoadmap(rootDir, roadmapPath) {
  const absolutePath = path.resolve(rootDir, roadmapPath);
  const parsed = JSON.parse(fs.readFileSync(absolutePath, "utf8"));
  if (!parsed || typeof parsed !== "object" || !Array.isArray(parsed.milestones)) {
    throw new Error(`${roadmapPath} must contain a milestones array.`);
  }

  const milestoneById = new Map();
  const errors = [];
  for (const milestone of parsed.milestones) {
    const id = milestone?.id;
    if (typeof id !== "string" || !/^M\d{2}$/u.test(id)) {
      errors.push(`roadmap contains an unknown milestone ID: ${String(id)}`);
      continue;
    }
    if (milestoneById.has(id)) {
      errors.push(`roadmap contains a duplicate milestone ID: ${id}`);
      continue;
    }
    milestoneById.set(id, milestone);
  }
  for (const id of AUDITED_MILESTONE_IDS) {
    if (!milestoneById.has(id)) {
      errors.push(`roadmap is missing audited milestone ${id}`);
    }
  }
  if (errors.length > 0) {
    throw new Error(`Invalid Control Director roadmap:\n- ${errors.join("\n- ")}`);
  }
  return milestoneById;
}

function inspectPath(rootDir, contractPath, kind) {
  const absolutePath = path.resolve(rootDir, contractPath);
  let exists;
  try {
    exists = fs.statSync(absolutePath).isFile();
  } catch {
    exists = false;
  }
  return { kind, path: contractPath, exists };
}

function readSourceSha(rootDir) {
  const result = spawnSync("git", ["rev-parse", "--verify", "HEAD"], {
    cwd: rootDir,
    encoding: "utf8",
  });
  const value = result.status === 0 ? result.stdout.trim().toLowerCase() : "";
  return /^[a-f0-9]{40}$/u.test(value) ? value : null;
}

export function auditControlDirectorMilestones({
  rootDir,
  roadmapPath = DEFAULT_ROADMAP_PATH,
  contracts = MILESTONE_EVIDENCE_CONTRACTS,
} = {}) {
  if (typeof rootDir !== "string" || rootDir.length === 0) {
    throw new TypeError("rootDir is required.");
  }
  const resolvedRoot = path.resolve(rootDir);
  const orderedContracts = validateMilestoneEvidenceContracts(contracts);
  const milestoneById = readRoadmap(resolvedRoot, roadmapPath);

  const milestones = orderedContracts.map((contract) => {
    const implementationEvidence = contract.implementationPaths.map((contractPath) =>
      inspectPath(resolvedRoot, contractPath, "implementation"),
    );
    const corroborationEvidence = contract.corroborationPaths.map((contractPath) =>
      inspectPath(resolvedRoot, contractPath, "corroboration"),
    );
    const missingImplementation = implementationEvidence.filter((entry) => !entry.exists);
    const missingCorroboration = corroborationEvidence.filter((entry) => !entry.exists);
    const implementationStatus =
      missingImplementation.length > 0
        ? "blocked"
        : missingCorroboration.length > 0
          ? "unassessed"
          : "implemented";
    const roadmapMilestone = milestoneById.get(contract.id);

    return {
      id: contract.id,
      title: typeof roadmapMilestone.title === "string" ? roadmapMilestone.title : "",
      implementation: {
        status: implementationStatus,
        requiresHumanValidation: true,
        evidence: [...implementationEvidence, ...corroborationEvidence],
      },
      certification: {
        status: "pending",
        requiresExactShaEvidence: true,
        pathPresenceIsCertification: false,
      },
      missingEvidence: [
        ...missingImplementation,
        ...missingCorroboration,
        {
          kind: "certification",
          requirement: "human-validated exact-SHA certification receipts",
        },
      ],
      roadmapUpdateCandidate: {
        implementationStatus,
        requiresHumanValidation: true,
      },
    };
  });

  const countStatus = (status) =>
    milestones.filter((milestone) => milestone.implementation.status === status).length;

  return {
    schema: "openclaw.control-director-milestone-audit.v1",
    auditScope: {
      firstMilestone: AUDITED_MILESTONE_IDS[0],
      lastMilestone: AUDITED_MILESTONE_IDS.at(-1),
      milestoneCount: AUDITED_MILESTONE_IDS.length,
    },
    source: {
      sha: readSourceSha(resolvedRoot),
      certificationInferred: false,
    },
    summary: {
      implemented: countStatus("implemented"),
      unassessed: countStatus("unassessed"),
      blocked: countStatus("blocked"),
      certificationPending: AUDITED_MILESTONE_IDS.length,
      certificationPassed: 0,
    },
    milestones,
  };
}

function parseArguments(argv) {
  let rootDir = process.cwd();
  let roadmapPath = DEFAULT_ROADMAP_PATH;
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--root") {
      rootDir = argv[index + 1];
      index += 1;
    } else if (argument === "--roadmap") {
      roadmapPath = argv[index + 1];
      index += 1;
    } else {
      throw new Error(`Unknown argument: ${argument}`);
    }
  }
  if (typeof rootDir !== "string" || rootDir.length === 0) {
    throw new Error("--root requires a path.");
  }
  if (typeof roadmapPath !== "string" || roadmapPath.length === 0) {
    throw new Error("--roadmap requires a repository-relative path.");
  }
  return { rootDir, roadmapPath };
}

const isDirectExecution =
  typeof process.argv[1] === "string" &&
  path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));

if (isDirectExecution) {
  try {
    const options = parseArguments(process.argv.slice(2));
    process.stdout.write(`${JSON.stringify(auditControlDirectorMilestones(options), null, 2)}\n`);
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
