// Registry-backed standards make new PCC and custom-runtime capabilities reviewable in CI.
import {
  PCC_OPERATIONAL_QUALITY_DIMENSIONS,
  type PccCapabilityKind,
} from "./capability-contract.js";
import type { PccCapabilityAdditionDefinition } from "./capability-standards.js";
import type { CustomRuntimeCapabilityKind } from "./custom-runtime-capabilities.js";
import type { PccWorkflowTemplateId } from "./project-workflows.js";

type CapabilityAdditionInput = {
  id: string;
  kind: PccCapabilityAdditionDefinition["kind"];
  owner: string;
  trigger: string;
  permissionClass?: PccCapabilityAdditionDefinition["permissionClass"];
  costClass?: PccCapabilityAdditionDefinition["costClass"];
  localFirstRoute: string;
  fallback: string;
  tests: readonly string[];
  proofSurfaces: readonly string[];
  observability: readonly string[];
  upgradeImpact: string;
  rollback: string;
  docs: readonly string[];
};

function addition(input: CapabilityAdditionInput): PccCapabilityAdditionDefinition {
  return {
    id: input.id,
    kind: input.kind,
    version: "1",
    owner: input.owner,
    trigger: input.trigger,
    requiredInputs: ["versioned capability contract", "permission and cost classification"],
    permissionClass: input.permissionClass ?? "none",
    costClass: input.costClass ?? "local",
    localFirstRoute: input.localFirstRoute,
    fallback: input.fallback,
    tests: input.tests,
    proofSurfaces: input.proofSurfaces,
    qualityDimensions: PCC_OPERATIONAL_QUALITY_DIMENSIONS,
    observability: input.observability,
    upgradeImpact: input.upgradeImpact,
    rollback: input.rollback,
    docs: input.docs,
  };
}

const WORKFLOW_NAMES: Record<PccWorkflowTemplateId, string> = {
  "software-product": "Software product",
  "dashboard-data": "Dashboard and data",
  "creative-media": "Creative media",
  research: "Research",
  "trading-finance": "Trading and finance",
  "snes-studio": "SNES Studio",
  custom: "Custom",
};

export const PCC_WORKFLOW_ADDITION_STANDARD_IDS = Object.keys(WORKFLOW_NAMES).map(
  (id) => `workflow-template:${id}`,
);

const workflowAdditions = (Object.keys(WORKFLOW_NAMES) as PccWorkflowTemplateId[]).map((id) =>
  addition({
    id: `workflow-template:${id}`,
    kind: "workflow",
    owner: "Project Command Center",
    trigger: `${WORKFLOW_NAMES[id]} template selected during PCC project creation.`,
    localFirstRoute: "Build and validate the deterministic template locally before dispatch.",
    fallback: "Stop project creation and report the exact template validation error.",
    tests: ["src/pcc/project-workflows.test.ts", "src/pcc/capability-contract.test.ts"],
    proofSurfaces: ["pnpm check:pcc-capabilities", "PCC project capability preflight"],
    observability: ["pccCapabilityContract", "pccCapabilityPreflight"],
    upgradeImpact: "Template IDs, phase requirements, and completion evidence remain additive.",
    rollback: "Select a prior compatible template version or keep the project blocked.",
    docs: ["docs/automation/pcc-operational-excellence.md"],
  }),
);

type CustomRuntimeAdditionInput = {
  id: string;
  kind: CustomRuntimeCapabilityKind;
  owner: string;
  tests?: readonly string[];
  proofSurfaces?: readonly string[];
  observability?: readonly string[];
  upgradeImpact?: string;
  rollback?: string;
  docs?: readonly string[];
};

const CUSTOM_RUNTIME_ADDITIONS: readonly CustomRuntimeAdditionInput[] = [
  { id: "dashboard:pcc", kind: "dashboard_surface", owner: "Project Command Center" },
  { id: "dashboard:app-studio", kind: "dashboard_surface", owner: "App Studio" },
  { id: "dashboard:music-studio", kind: "dashboard_surface", owner: "Music Studio" },
  { id: "dashboard:snes-studio", kind: "dashboard_surface", owner: "SNES Studio" },
  { id: "dashboard:book-writer", kind: "dashboard_surface", owner: "Book Writer" },
  { id: "dashboard:kalshi", kind: "dashboard_surface", owner: "Kalshi Dashboard" },
  { id: "dashboard:pattern-lab", kind: "dashboard_surface", owner: "Pattern Lab" },
  { id: "plugin:apps", kind: "plugin", owner: "Apps plugin" },
  { id: "plugin:book-writer", kind: "plugin", owner: "Book Writer plugin" },
  {
    id: "plugin:research-manager",
    kind: "plugin",
    owner: "Research Manager plugin",
    tests: [
      "extensions/research-manager/index.test.ts",
      "extensions/research-manager/manifest.test.ts",
      "extensions/research-manager/src/runtime.test.ts",
    ],
    proofSurfaces: [
      "pnpm test extensions/research-manager",
      "sterile managed-runtime plugin discovery and execution smoke",
    ],
    docs: ["docs/plugins/research-manager.md"],
  },
  {
    id: "workflow:pcc-project-management",
    kind: "workflow",
    owner: "Project Command Center",
  },
  {
    id: "workflow:pcc-operational-excellence",
    kind: "workflow",
    owner: "Project Command Center",
  },
  {
    id: "runtime:control-director-deployment-consistency",
    kind: "runtime",
    owner: "Control Director and custom runtime update broker",
    tests: [
      "test/scripts/control-director-deployment-consistency.test.ts",
      "test/scripts/control-director-verify.test.ts",
      "test/scripts/custom-runtime-lifecycle.test.ts",
    ],
    proofSurfaces: [
      "pnpm control-director:deployment-consistency -- --source-only",
      "exact-SHA post-restart deployment consistency receipt",
    ],
  },
  {
    id: "runtime:control-director-truth-gates",
    kind: "runtime",
    owner: "Control Director",
    tests: [
      "src/agents/agent-role-capabilities.test.ts",
      "src/agents/control-director-diagnostic-evidence.test.ts",
      "src/agents/control-director-delivery-guards.test.ts",
      "src/agents/independent-judge-service.test.ts",
      "src/agents/subagent-spawn-recovery.test.ts",
      "src/agents/subagent-task-root.test.ts",
      "src/agents/tools/agents-list-tool.test.ts",
      "src/agents/tools/sessions-spawn-tool.test.ts",
      "src/tasks/pursue-goal-controller.test.ts",
      "src/gateway/server-methods/execution-state.test.ts",
    ],
    proofSurfaces: ["pnpm control-director:verify", "exact-SHA managed runtime readiness receipt"],
  },
  {
    id: "runtime:control-director-codex-chat",
    kind: "runtime",
    owner: "Control Director and Control UI Chat",
    tests: [
      "ui/src/ui/views/chat.test.ts",
      "ui/src/ui/chat/layout-health.test.ts",
      "ui/src/pages/chat/chat-controls.test.ts",
      "ui/src/pages/chat/chat-view.test.ts",
      "ui/src/lib/chat/model-select-state.test.ts",
      "src/gateway/server.chat.gateway-server-chat-b.test.ts",
      "src/gateway/server.sessions.list-changed.test.ts",
      "src/gateway/session-utils.test.ts",
      "src/gateway/chat-turn-inbox-state.test.ts",
      "src/gateway/server-methods/self-improvement.test.ts",
      "test/scripts/control-ui-production-chat-stack.test.ts",
    ],
    proofSurfaces: [
      "pnpm control-director:verify",
      "native model routing and context contract focused proof",
      "authenticated Control Director desktop and mobile browser proof",
      "pnpm ui:smoke:control-director-no-response",
      "exact-SHA desktop and mobile Dashboard receipts",
    ],
  },
  {
    id: "runtime:local-first-model-intelligence",
    kind: "runtime",
    owner: "Model routing",
  },
  {
    id: "runtime:chat-work-surface",
    kind: "runtime",
    owner: "Control UI Chat",
    tests: ["ui/src/ui/chat/work-snapshot.test.ts", "ui/src/ui/views/chat.test.ts"],
    proofSurfaces: ["pnpm ui:smoke:chat-work-surface"],
  },
  {
    id: "runtime:chat-native-projects",
    kind: "runtime",
    owner: "PCC and Control UI Chat",
    tests: [
      "ui/src/ui/controllers/chat.test.ts",
      "src/gateway/sessions-patch.test.ts",
      "src/gateway/server.sessions.create.test.ts",
    ],
    proofSurfaces: ["pnpm ui:smoke:chat-projects"],
  },
  {
    id: "runtime:chat-plan-mode",
    kind: "runtime",
    owner: "Control UI Chat",
    tests: ["ui/src/ui/chat/proposed-plan.test.ts", "ui/src/ui/chat/grouped-render.test.ts"],
    proofSurfaces: ["pnpm ui:smoke:chat-plan-mode"],
  },
  {
    id: "runtime:chat-pursue-goal",
    kind: "runtime",
    owner: "TaskFlow and Control UI Chat",
    tests: ["src/gateway/server-methods/tasks.test.ts", "ui/src/ui/controllers/chat.test.ts"],
    proofSurfaces: ["pnpm ui:smoke:chat-pursue-goal"],
  },
  {
    id: "runtime:chat-approval-cards",
    kind: "runtime",
    owner: "Control UI Chat",
    tests: ["ui/src/ui/views/chat.test.ts", "ui/src/ui/app-gateway.node.test.ts"],
    proofSurfaces: ["pnpm ui:smoke:chat-approval-cards"],
  },
  {
    id: "runtime:chat-tool-proof-artifact-cards",
    kind: "runtime",
    owner: "Control UI Chat",
    tests: ["ui/src/ui/chat/tool-cards.test.ts", "ui/src/ui/chat/grouped-render.test.ts"],
    proofSurfaces: ["pnpm ui:smoke:chat-tool-proof-artifact-cards"],
  },
  {
    id: "runtime:chat-multi-agent-work-tree",
    kind: "runtime",
    owner: "Control UI Chat",
    tests: ["ui/src/ui/chat/work-snapshot.test.ts", "ui/src/ui/views/chat.test.ts"],
    proofSurfaces: ["multi-agent work tree DOM and browser smoke"],
  },
  {
    id: "runtime:chat-truth-completion-diagnostics",
    kind: "runtime",
    owner: "Control Director and Control UI Chat",
    tests: [
      "ui/src/ui/chat/control-director-diagnostics.test.ts",
      "src/gateway/session-utils.subagent.test.ts",
    ],
    proofSurfaces: ["pnpm ui:smoke:chat-truth-diagnostics"],
  },
  {
    id: "runtime:chat-polish-accessibility",
    kind: "runtime",
    owner: "Control UI Chat",
    tests: ["ui/src/ui/views/chat.test.ts", "ui/src/ui/app-chat.test.ts"],
    proofSurfaces: ["pnpm ui:smoke:chat-polish-a11y"],
  },
  {
    id: "runtime:chat-network-remote-approvals",
    kind: "runtime",
    owner: "Control UI Chat",
    tests: ["ui/src/ui/views/chat.test.ts", "ui/src/ui/app-gateway.node.test.ts"],
    proofSurfaces: ["pnpm ui:smoke:chat-network-remote-approval-cards"],
  },
  {
    id: "runtime:pcc-mobile-control",
    kind: "runtime",
    owner: "Project Command Center",
    tests: ["ui/src/ui/views/pcc.test.ts", "ui/src/ui/controllers/pcc.test.ts"],
    proofSurfaces: ["pnpm ui:smoke:pcc-mobile"],
  },
  {
    id: "runtime:chat-ux-cleanup",
    kind: "runtime",
    owner: "Control UI Chat",
    tests: ["ui/src/ui/views/chat.test.ts", "ui/src/ui/app-chat.test.ts"],
    proofSurfaces: ["pnpm ui:smoke:chat-ux-cleanup"],
  },
  {
    id: "runtime:control-director-chat-reliability",
    kind: "runtime",
    owner: "TaskFlow, Control Director, and Control UI Chat",
    tests: [
      "packages/gateway-protocol/src/schema/tasks.test.ts",
      "src/tasks/task-executor.test.ts",
      "src/gateway/server-methods/tasks.test.ts",
      "src/gateway/server.chat.gateway-server-chat-b.test.ts",
      "ui/src/ui/controllers/chat.test.ts",
      "ui/src/ui/views/chat.test.ts",
    ],
    proofSurfaces: [
      "pnpm ui:smoke:chat-control-director-reliability",
      "authenticated desktop and mobile Control UI proof",
    ],
  },
  {
    id: "runtime:pcc-chat-sync",
    kind: "runtime",
    owner: "Project Command Center and Control UI Chat",
    tests: ["src/pcc/project-action.test.ts", "ui/src/ui/controllers/chat.test.ts"],
    proofSurfaces: ["pnpm ui:smoke:pcc-chat-sync"],
  },
  {
    id: "runtime:dashboard-codex-plus-apps",
    kind: "runtime",
    owner: "Control UI Dashboard",
    tests: ["ui/src/ui/navigation.test.ts", "ui/src/ui/views/chat.test.ts"],
    proofSurfaces: ["pnpm ui:smoke:dashboard-codex-plus-apps"],
  },
  {
    id: "runtime:operations-room",
    kind: "runtime",
    owner: "Operations Room",
    tests: [
      "packages/gateway-protocol/src/schema/operations.test.ts",
      "src/operations/status.test.ts",
      "src/operations/compat.test.ts",
      "src/operations/action-guard.test.ts",
      "src/operations/host-memory-probe.test.ts",
      "src/operations/process-probe.test.ts",
      "src/operations/incident-ledger.test.ts",
      "src/operations/collector.test.ts",
      "src/operations/monitor.test.ts",
      "src/operations/monitor-health.test.ts",
      "src/tasks/task-registry.store.test.ts",
      "src/tasks/task-flow-registry.store.test.ts",
      "src/tasks/task-registry.maintenance.issue-60299.test.ts",
      "src/tasks/task-registry.test.ts",
      "src/tasks/task-flow-registry.test.ts",
      "src/gateway/server-methods/operations.test.ts",
      "src/gateway/method-scopes.test.ts",
      "src/gateway/server-maintenance.test.ts",
      "src/gateway/server-runtime-services.test.ts",
      "src/gateway/server-close.test.ts",
      "src/gateway/server-startup-post-attach.test.ts",
      "test/scripts/changed-lanes.test.ts",
      "ui/src/ui/app.operations-polling.test.ts",
      "ui/src/ui/views/operations.test.ts",
      "ui/src/ui/controllers/operations.test.ts",
      "ui/src/ui/views/operations-model.test.ts",
      "ui/src/ui/controllers/operations-navigation.test.ts",
      "ui/src/ui/controllers/operations-preferences.test.ts",
      "ui/src/ui/navigation.test.ts",
      "ui/src/ui/views/overview.render.test.ts",
      "ui/src/ui/e2e/operations-room.e2e.test.ts",
      "src/pcc/capability-addition-registry.test.ts",
      "src/pcc/custom-runtime-capabilities.test.ts",
      "test/scripts/control-director-source-handoff.test.ts",
    ],
    proofSurfaces: [
      "pnpm operations-room:verify",
      "pnpm ui:smoke:operations-room:dom",
      "pnpm ui:smoke:operations-room:e2e",
      "pnpm ui:i18n:check",
      "pnpm check:pcc-capabilities",
      "pnpm check:custom-runtime-capabilities",
      "pnpm control-director:source-handoff -- preflight --sha <candidate-sha> --branch <codex-branch>",
      "local exact-source Control Director proof receipt",
      "Control Director owner acceptance receipt from production Chrome on the managed Mac Studio at or below 60 seconds",
    ],
    observability: [
      "Gateway operations.snapshot V1 compatibility RPC",
      "Gateway operations.snapshot.v2 truth RPC",
      "bounded Operations incident ledger",
      "Operations Room automated desktop and mobile browser receipts",
      "exact-SHA source, restart, persistence, soak, rollback, production Chrome, and owner acceptance receipts",
    ],
    upgradeImpact:
      "Preserve the additive Operations protocol, collectors, incident history, guarded actions, Control UI, and local exact-source proof contract.",
    rollback:
      "Restore the previous immutable runtime pointer and verify its Operations snapshot, browser receipt, and incident ledger.",
    docs: [
      "docs/automation/operations-room.md",
      "docs/automation/control-director-source-handoff.md",
      "docs/automation/custom-runtime-update-safety.md",
    ],
  },
  {
    id: "runtime:update-safe-customizations",
    kind: "runtime",
    owner: "Custom runtime update broker",
    tests: [
      "src/infra/custom-runtime-update-policy.test.ts",
      "src/pcc/update-safety.test.ts",
      "test/scripts/custom-runtime-lifecycle.test.ts",
      "test/scripts/custom-runtime-update-survival.test.ts",
      "test/scripts/custom-runtime-updater.test.ts",
      "src/gateway/server-methods/update.test.ts",
    ],
    proofSurfaces: [
      "pnpm check:custom-runtime-capabilities",
      "pnpm custom-runtime:update-survival",
      "PCC Update Safety dashboard scheduled-broker and recovery-guard status",
      "exact-parent candidate preservation and approval receipts",
    ],
  },
  {
    id: "runtime:tailscale-primary-continuity",
    kind: "runtime",
    owner: "Custom runtime transport guard",
    tests: [
      "test/scripts/custom-runtime-tailscale-primary.test.ts",
      "test/scripts/custom-runtime-lifecycle.test.ts",
    ],
    proofSurfaces: [
      "custom-runtime-tailscale-primary.sh status",
      "primary Tailnet route HTTP proof",
      "authenticated mobile Control UI proof",
    ],
  },
  {
    id: "runtime:self-improvement-governor",
    kind: "runtime",
    owner: "Self-Improvement Governor",
    tests: [
      "src/self-improvement/production-readiness.test.ts",
      "src/gateway/server-methods/self-improvement.test.ts",
      "test/scripts/custom-runtime-lifecycle.test.ts",
    ],
    proofSurfaces: ["pnpm ui:smoke:self-improvement", "Self-Improvement production soak"],
  },
  {
    id: "runtime:release-governor",
    kind: "runtime",
    owner: "PCC Release Governor",
    tests: [
      "src/pcc/release-governance/release-governance.test.ts",
      "test/scripts/custom-runtime-package.test.ts",
      "test/scripts/custom-runtime-lifecycle.test.ts",
      "test/scripts/runtime-package-integrity.test.ts",
    ],
    proofSurfaces: ["pnpm check:release-governor-policy", "PCC deployment-governance view"],
  },
];

export const PCC_CUSTOM_RUNTIME_ADDITION_STANDARD_IDS = CUSTOM_RUNTIME_ADDITIONS.map(
  (entry) => entry.id,
);

function capabilityKind(
  kind: CustomRuntimeCapabilityKind,
): PccCapabilityKind | "plugin" | "dashboard_surface" {
  return kind === "runtime" ? "process" : kind;
}

const customRuntimeAdditions = CUSTOM_RUNTIME_ADDITIONS.map((entry) =>
  addition({
    id: entry.id,
    kind: capabilityKind(entry.kind),
    owner: entry.owner,
    trigger: "A custom immutable runtime is staged or promoted.",
    permissionClass: "local_write",
    localFirstRoute: "Verify the candidate in copied local state before changing the live pointer.",
    fallback: "Reject the candidate and retain or restore the last-known-good runtime.",
    tests: entry.tests ?? [
      "src/pcc/custom-runtime-capabilities.test.ts",
      "test/scripts/custom-runtime-stage-promote.test.ts",
    ],
    proofSurfaces: entry.proofSurfaces ?? [
      "pnpm check:custom-runtime-capabilities",
      "custom runtime stage and rollback receipts",
    ],
    observability: entry.observability ?? ["active-runtime.json", "PCC runtime identity"],
    upgradeImpact:
      entry.upgradeImpact ??
      "The active required-capability set is monotonic across candidate updates.",
    rollback:
      entry.rollback ?? "Restore the previous pointer, service files, and last-known-good release.",
    docs: entry.docs ?? ["docs/automation/pcc-operational-excellence.md"],
  }),
);

export const PCC_CAPABILITY_ADDITION_STANDARDS: readonly PccCapabilityAdditionDefinition[] = [
  ...workflowAdditions,
  ...customRuntimeAdditions,
];
