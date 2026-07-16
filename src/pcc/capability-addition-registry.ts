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
    id: "runtime:control-director-truth-gates",
    kind: "runtime",
    owner: "Control Director",
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
    id: "runtime:update-safe-customizations",
    kind: "runtime",
    owner: "Custom runtime update broker",
    tests: [
      "src/infra/custom-runtime-update-policy.test.ts",
      "src/pcc/update-safety.test.ts",
      "test/scripts/custom-runtime-updater.test.ts",
      "src/gateway/server-methods/update.test.ts",
    ],
    proofSurfaces: [
      "pnpm check:custom-runtime-capabilities",
      "PCC Update Safety dashboard status",
      "custom runtime candidate and approval receipts",
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
    observability: ["active-runtime.json", "PCC runtime identity"],
    upgradeImpact: "The active required-capability set is monotonic across candidate updates.",
    rollback: "Restore the previous pointer, service files, and last-known-good release.",
    docs: ["docs/automation/pcc-operational-excellence.md"],
  }),
);

export const PCC_CAPABILITY_ADDITION_STANDARDS: readonly PccCapabilityAdditionDefinition[] = [
  ...workflowAdditions,
  ...customRuntimeAdditions,
];
