import type { SessionControlDirectorMissionLedgerEntry } from "../config/sessions/types.js";
import type { OpenClawConfig } from "../config/types.openclaw.js";
import {
  buildAgentRoleCapabilitySystemPromptSection,
  compileOperationalRoleCapabilityBudget,
  resolveAgentRoleCapabilityContract,
  validateAgentRoleHandoff,
} from "./agent-role-capabilities.js";
import {
  buildControlDirectorMissionContinuityContext,
  compileControlDirectorPromptBudget,
} from "./control-director-context-budget.js";
import {
  buildControlDirectorMissionEnvelope,
  classifyControlDirectorResponseMode,
  evaluateControlDirectorResponse,
  parseControlDirectorFinalStatus,
  parseControlDirectorMissionEnvelope,
  type ControlDirectorResponseMode,
} from "./control-director-contract.js";
import { compileControlDirectorTurnPolicy } from "./control-director-turn-policy.js";

export type ControlDirectorTortureDomain =
  | "intent"
  | "multi_turn"
  | "compaction"
  | "steering"
  | "delegation"
  | "blocker"
  | "completion"
  | "role_boundary";

export type ControlDirectorTortureCase = {
  id: string;
  domain: ControlDirectorTortureDomain;
  critical: boolean;
  run: () => boolean;
};

export type ControlDirectorTortureCaseResult = {
  id: string;
  domain: ControlDirectorTortureDomain;
  critical: boolean;
  passed: boolean;
  error?: string;
};

export type ControlDirectorTortureReport = {
  schemaVersion: 1;
  total: number;
  passed: number;
  passRate: number;
  criticalOmissions: number;
  accepted: boolean;
  minimumPassRate: 98;
  results: ControlDirectorTortureCaseResult[];
};

const TORTURE_CONFIG: OpenClawConfig = {
  agents: {
    list: [
      { id: "director", role: "control_director" },
      { id: "pm", role: "program_manager" },
      { id: "judge", role: "judge" },
      { id: "worker", role: "worker" },
      { id: "chat", role: "general" },
    ],
  },
};

function equals<T>(actual: T, expected: T): boolean {
  return Object.is(actual, expected);
}

function intentCases(): ControlDirectorTortureCase[] {
  const rows: Array<[string, string, ControlDirectorResponseMode]> = [
    ["empty-conversation", "", "conversation"],
    ["thanks-conversation", "Thanks for the update", "conversation"],
    ["greeting-conversation", "Hello there", "conversation"],
    ["ack-conversation", "That makes sense", "conversation"],
    ["why-answer", "Why is the first response slow?", "answer"],
    ["should-answer", "Should Codex be the default?", "answer"],
    ["can-answer", "Can you explain recent memory?", "answer"],
    ["what-answer", "What is PCC?", "answer"],
    ["plan-only", "Plan only; do not implement.", "plan"],
    ["plan-no-change", "Do not change anything; create a plan.", "plan"],
    ["plan-without-implementation", "List milestones without implementing.", "plan"],
    ["plan-dont-implement", "Don't implement yet.", "plan"],
    ["steer-explicit", "Steer this task toward accessibility.", "steer"],
    ["steer-interrupt", "Interrupt and focus on latency.", "steer"],
    ["steer-instead", "Instead, do mobile first.", "steer"],
    ["steer-direction", "Change direction to memory.", "steer"],
    ["queue-explicit", "Queue this after that.", "queue"],
    ["queue-next-task", "Next task: run tests.", "queue"],
    ["queue-when-finished", "When this finishes, audit mobile.", "queue"],
    ["queue-after", "After this, document it.", "queue"],
    ["goal-explicit", "Pursue Goal: finish reliability.", "goal"],
    ["goal-keep-working", "Keep working until it is complete.", "goal"],
    ["goal-pursue", "Pursue goal to fix chat.", "goal"],
    ["goal-keep-going", "Keep going until complete.", "goal"],
    ["status-update", "Give me an update.", "status"],
    ["status-progress", "What is the progress?", "status"],
    ["status-report", "Report the status.", "status"],
    ["status-done", "What has been done?", "status"],
    ["execute-implement", "Implement the approved plan.", "execute"],
    ["execute-fix", "Fix the stalled goal.", "execute"],
    ["execute-debug", "Debug the missing reply.", "execute"],
    ["execute-build", "Build the typed queue.", "execute"],
    ["execute-test", "Run the targeted tests.", "execute"],
    ["execute-audit", "Audit the production wiring.", "execute"],
    ["execute-search", "Search recent task history.", "execute"],
    ["execute-repair", "Repair the memory index.", "execute"],
  ];
  return rows.map(([id, prompt, expected]) => ({
    id: `intent-${id}`,
    domain: "intent",
    critical: true,
    run: () => equals(classifyControlDirectorResponseMode(prompt), expected),
  }));
}

function policyCases(): ControlDirectorTortureCase[] {
  const compile = (params: Parameters<typeof compileControlDirectorTurnPolicy>[0]) =>
    compileControlDirectorTurnPolicy(params);
  const modeCase = (
    mode: ControlDirectorResponseMode,
    expectedRoute: "local_direct" | "local_orchestrator",
  ): ControlDirectorTortureCase => ({
    id: `policy-mode-${mode}`,
    domain: mode === "steer" || mode === "queue" ? "steering" : "delegation",
    critical: true,
    run: () => {
      const policy = compile({
        config: TORTURE_CONFIG,
        agentId: "director",
        requestText: "ignored",
        explicitMode: mode,
      });
      return (
        policy?.mode === mode &&
        policy.modelRoute === expectedRoute &&
        !policy.toolsAllow.some((tool) => ["exec", "write", "apply_patch"].includes(tool))
      );
    },
  });
  const cases = (
    [
      ["conversation", "local_direct"],
      ["answer", "local_direct"],
      ["plan", "local_direct"],
      ["status", "local_direct"],
      ["steer", "local_direct"],
      ["queue", "local_direct"],
      ["execute", "local_orchestrator"],
      ["goal", "local_orchestrator"],
    ] as const
  ).map(([mode, route]) => modeCase(mode, route));
  cases.push(
    {
      id: "policy-execute-delegates",
      domain: "delegation",
      critical: true,
      run: () => {
        const policy = compile({
          config: TORTURE_CONFIG,
          agentId: "director",
          requestText: "Implement it",
        });
        return (
          policy?.programManagerAgentId === "pm" &&
          policy.toolsAllow.includes("sessions_spawn") &&
          policy.requiresIndependentJudge
        );
      },
    },
    {
      id: "policy-queue-mode-steer",
      domain: "steering",
      critical: true,
      run: () =>
        compile({
          config: TORTURE_CONFIG,
          agentId: "director",
          requestText: "do this",
          queueMode: "interrupt",
        })?.mode === "steer",
    },
    {
      id: "policy-queue-mode-followup",
      domain: "steering",
      critical: true,
      run: () =>
        compile({
          config: TORTURE_CONFIG,
          agentId: "director",
          requestText: "do this",
          queueMode: "followup",
        })?.mode === "queue",
    },
    {
      id: "policy-upstream-intersection",
      domain: "role_boundary",
      critical: true,
      run: () => {
        const policy = compile({
          config: TORTURE_CONFIG,
          agentId: "director",
          requestText: "Implement it",
          upstreamToolsAllow: ["sessions_send", "exec"],
        });
        return JSON.stringify(policy?.toolsAllow) === JSON.stringify(["sessions_send"]);
      },
    },
    {
      id: "policy-general-agent-not-admitted",
      domain: "role_boundary",
      critical: true,
      run: () =>
        compile({ config: TORTURE_CONFIG, agentId: "chat", requestText: "Implement it" }) ===
        undefined,
    },
  );
  return cases;
}

function missionCases(): ControlDirectorTortureCase[] {
  const mission = buildControlDirectorMissionEnvelope({
    missionId: "mission-1",
    idempotencyKey: "idempotency-1",
    requestBody: "Implement every approved milestone without publishing.",
    acceptanceCriteria: ["Tests pass", "Tests pass", "Runtime verified"],
    scope: ["source", "no publish"],
    approvals: ["restart gateway"],
    provenance: ["chat.turns.create"],
    artifactIds: ["flow-1"],
  });
  const ledger: SessionControlDirectorMissionLedgerEntry = {
    schemaVersion: 1,
    missionId: mission.missionId,
    requestSummary: mission.requestBody,
    requestBody: mission.requestBody,
    requestHash: mission.requestHash,
    responseMode: mission.responseMode,
    idempotencyKey: mission.idempotencyKey,
    acceptanceCriteria: mission.acceptanceCriteria,
    scope: mission.scope,
    approvals: mission.approvals,
    provenance: mission.provenance,
    artifactIds: mission.artifactIds,
    status: "continuing",
    startedAt: 1,
    updatedAt: 2,
    continuationCount: 0,
    verifiedEvidenceSummary: "Targeted tests passed.",
    nextBuildGap: "Run managed-runtime proof.",
  };
  const continuity = buildControlDirectorMissionContinuityContext(ledger) ?? "";
  return [
    {
      id: "mission-round-trip",
      domain: "multi_turn",
      critical: true,
      run: () => parseControlDirectorMissionEnvelope(mission)?.requestHash === mission.requestHash,
    },
    {
      id: "mission-tamper-detected",
      domain: "multi_turn",
      critical: true,
      run: () =>
        parseControlDirectorMissionEnvelope({ ...mission, requestBody: "mutated" }) === null,
    },
    {
      id: "mission-idempotency-preserved",
      domain: "multi_turn",
      critical: true,
      run: () => mission.idempotencyKey === "idempotency-1",
    },
    {
      id: "mission-criteria-deduplicated",
      domain: "multi_turn",
      critical: true,
      run: () =>
        JSON.stringify(mission.acceptanceCriteria) ===
        JSON.stringify(["Runtime verified", "Tests pass"]),
    },
    {
      id: "compaction-request-preserved",
      domain: "compaction",
      critical: true,
      run: () => continuity.includes(mission.requestBody),
    },
    {
      id: "compaction-criteria-preserved",
      domain: "compaction",
      critical: true,
      run: () => continuity.includes("Runtime verified"),
    },
    {
      id: "compaction-scope-preserved",
      domain: "compaction",
      critical: true,
      run: () => continuity.includes("no publish"),
    },
    {
      id: "compaction-approval-preserved",
      domain: "compaction",
      critical: true,
      run: () => continuity.includes("restart gateway"),
    },
    {
      id: "compaction-evidence-preserved",
      domain: "compaction",
      critical: true,
      run: () => continuity.includes("Targeted tests passed"),
    },
    {
      id: "compaction-next-action-preserved",
      domain: "compaction",
      critical: true,
      run: () => continuity.includes("Run managed-runtime proof"),
    },
    {
      id: "prompt-budget-bounded",
      domain: "compaction",
      critical: true,
      run: () =>
        compileControlDirectorPromptBudget({
          mode: "execute",
          policyPrompt: "P".repeat(5_000),
          missionContext: "M".repeat(10_000),
          recentContext: "R".repeat(10_000),
        }).chars.total <= 12_400,
    },
    {
      id: "prompt-budget-deterministic",
      domain: "compaction",
      critical: true,
      run: () => {
        const input = {
          mode: "execute" as const,
          policyPrompt: "policy",
          missionContext: continuity,
          recentContext: "recent",
        };
        const first = compileControlDirectorPromptBudget(input).prompt;
        const second = compileControlDirectorPromptBudget(structuredClone(input)).prompt;
        return first === second;
      },
    },
  ];
}

function responseCases(): ControlDirectorTortureCase[] {
  const report = (status: string, evidence: string) =>
    [
      "Verified state: inspected current state.",
      evidence,
      "Next build gap: none.",
      "Completion Grade: 10/10",
      "Criticality: 10/10",
      `Status: ${status}`,
    ].join("\n");
  return [
    {
      id: "completion-evidence-pass",
      domain: "completion",
      critical: true,
      run: () =>
        evaluateControlDirectorResponse({ text: report("complete", "Tests passed.") }).passed,
    },
    {
      id: "completion-no-evidence-fails",
      domain: "completion",
      critical: true,
      run: () =>
        !evaluateControlDirectorResponse({
          text: "Next build gap: none. Completion Grade: 10/10 Criticality: 10/10 Status: complete",
        }).passed,
    },
    {
      id: "completion-explicit-status-required",
      domain: "completion",
      critical: true,
      run: () =>
        evaluateControlDirectorResponse({ text: "Verified tests passed." }).missing.includes(
          "explicit completion status",
        ),
    },
    {
      id: "blocked-parses",
      domain: "blocker",
      critical: true,
      run: () =>
        parseControlDirectorFinalStatus(report("blocked", "Evidence unavailable.")) === "blocked",
    },
    {
      id: "needs-input-parses",
      domain: "blocker",
      critical: true,
      run: () =>
        parseControlDirectorFinalStatus(report("needs_user_input", "Verified blocker.")) ===
        "needs_user_input",
    },
    {
      id: "continuing-parses",
      domain: "multi_turn",
      critical: true,
      run: () =>
        parseControlDirectorFinalStatus(report("continuing", "Verified queue.")) === "continuing",
    },
    {
      id: "last-status-wins",
      domain: "completion",
      critical: true,
      run: () =>
        parseControlDirectorFinalStatus("Status: blocked\nStatus: complete") === "complete",
    },
    {
      id: "blocked-not-misreported-complete",
      domain: "blocker",
      critical: true,
      run: () =>
        parseControlDirectorFinalStatus("The task is blocked. Status: blocked") !== "complete",
    },
  ];
}

function roleCases(): ControlDirectorTortureCase[] {
  const pm = resolveAgentRoleCapabilityContract({ config: TORTURE_CONFIG, agentId: "pm" });
  const judge = resolveAgentRoleCapabilityContract({ config: TORTURE_CONFIG, agentId: "judge" });
  return [
    {
      id: "role-pm-dispatch",
      domain: "delegation",
      critical: true,
      run: () => Boolean(pm?.toolsAllow.includes("sessions_spawn")),
    },
    {
      id: "role-pm-worker-discovery",
      domain: "delegation",
      critical: true,
      run: () => Boolean(pm?.toolsAllow.includes("agents_list")),
    },
    {
      id: "role-pm-no-mutation",
      domain: "role_boundary",
      critical: true,
      run: () => !pm?.toolsAllow.some((tool) => ["exec", "write", "apply_patch"].includes(tool)),
    },
    {
      id: "role-judge-read-evidence",
      domain: "role_boundary",
      critical: true,
      run: () =>
        Boolean(
          judge?.toolsAllow.includes("read") && judge.toolsAllow.includes("sessions_history"),
        ),
    },
    {
      id: "role-judge-no-delegation",
      domain: "role_boundary",
      critical: true,
      run: () => !judge?.toolsAllow.includes("sessions_spawn"),
    },
    {
      id: "role-upstream-intersection",
      domain: "role_boundary",
      critical: true,
      run: () =>
        JSON.stringify(
          compileOperationalRoleCapabilityBudget({
            config: TORTURE_CONFIG,
            agentId: "pm",
            upstreamToolsAllow: ["sessions_spawn", "sessions_send", "exec"],
          })?.toolsAllow,
        ) === JSON.stringify(["sessions_spawn"]),
    },
    {
      id: "role-prompt-denies-name-authority",
      domain: "role_boundary",
      critical: true,
      run: () =>
        buildAgentRoleCapabilitySystemPromptSection(judge)?.includes(
          "Do not infer authority from your display name",
        ) === true,
    },
    {
      id: "role-director-pm-handoff",
      domain: "delegation",
      critical: true,
      run: () =>
        validateAgentRoleHandoff({
          requesterRole: "control_director",
          targetRole: "program_manager",
          handoff: { kind: "coordination", requiresMutation: false },
        }).ok,
    },
    {
      id: "role-pm-worker-handoff",
      domain: "delegation",
      critical: true,
      run: () =>
        validateAgentRoleHandoff({
          requesterRole: "program_manager",
          targetRole: "worker",
          handoff: { kind: "implementation", requiresMutation: true },
        }).ok,
    },
    {
      id: "role-judge-mutation-rejected",
      domain: "role_boundary",
      critical: true,
      run: () =>
        !validateAgentRoleHandoff({
          targetRole: "judge",
          handoff: { kind: "verification", requiresMutation: true },
        }).ok,
    },
  ];
}

export function controlDirectorInstructionTortureCases(): ControlDirectorTortureCase[] {
  return [
    ...intentCases(),
    ...policyCases(),
    ...missionCases(),
    ...responseCases(),
    ...roleCases(),
  ];
}

export function runControlDirectorInstructionTortureSuite(): ControlDirectorTortureReport {
  const results = controlDirectorInstructionTortureCases().map((testCase) => {
    try {
      return {
        id: testCase.id,
        domain: testCase.domain,
        critical: testCase.critical,
        passed: testCase.run(),
      };
    } catch (error) {
      return {
        id: testCase.id,
        domain: testCase.domain,
        critical: testCase.critical,
        passed: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  });
  const passed = results.filter((result) => result.passed).length;
  const passRate = results.length === 0 ? 0 : Math.round((passed / results.length) * 10_000) / 100;
  const criticalOmissions = results.filter((result) => result.critical && !result.passed).length;
  return {
    schemaVersion: 1,
    total: results.length,
    passed,
    passRate,
    criticalOmissions,
    accepted: results.length >= 50 && passRate >= 98 && criticalOmissions === 0,
    minimumPassRate: 98,
    results,
  };
}
