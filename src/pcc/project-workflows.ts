// PCC project workflow templates create deterministic milestone/sub-milestone plans.
import type {
  PccMilestone,
  PccPhase,
  PccProject,
  PccStatus,
  PccSubMilestone,
} from "../../packages/gateway-protocol/src/schema/types.js";

export type PccWorkflowTemplateId =
  | "software-product"
  | "dashboard-data"
  | "creative-media"
  | "research"
  | "trading-finance"
  | "snes-studio"
  | "custom";

export type PccPlanningMode = "template_only" | "local_project_manager" | "codex_full_plan";

export type PccAiUsePolicy = "local_only" | "codex_expert" | "codex_everything";

export type PccWorkflowTemplate = {
  id: PccWorkflowTemplateId;
  title: string;
  description: string;
  phases: PccPhase[];
  milestones: PccWorkflowMilestoneTemplate[];
};

type PccWorkflowMilestoneTemplate = {
  title: string;
  phaseId: string;
  responsibility: string;
  proofLevel: string;
  stopHere?: boolean;
  requiresCodex?: boolean;
  requiresRemoteProof?: boolean;
  subMilestones: readonly string[];
};

export type PccWorkflowDraft = {
  project: Pick<PccProject, "title" | "goal" | "status" | "priority" | "phases" | "metadata">;
  milestones: Array<Omit<PccMilestone, "id" | "projectId" | "createdAt" | "updatedAt">>;
  subMilestonesByMilestoneTitle: Record<
    string,
    Array<Omit<PccSubMilestone, "id" | "projectId" | "milestoneId" | "createdAt" | "updatedAt">>
  >;
};

const PHASES: PccPhase[] = [
  { id: "setup", title: "Setup", status: "not_started", weight: 10, order: 0 },
  { id: "tools-skills", title: "Tools/Skills", status: "not_started", weight: 15, order: 1 },
  { id: "mvp", title: "MVP", status: "not_started", weight: 25, order: 2 },
  { id: "refinement", title: "Refinement", status: "not_started", weight: 20, order: 3 },
  {
    id: "production-proof",
    title: "Production Proof",
    status: "not_started",
    weight: 25,
    order: 4,
  },
  { id: "maintenance", title: "Maintenance", status: "not_started", weight: 5, order: 5 },
];

function milestone(
  title: string,
  phaseId: string,
  subMilestones: readonly string[],
  opts: Partial<PccWorkflowMilestoneTemplate> = {},
): PccWorkflowMilestoneTemplate {
  return {
    title,
    phaseId,
    responsibility: opts.responsibility ?? "local_openclaw_agent",
    proofLevel: opts.proofLevel ?? "local",
    subMilestones,
    ...opts,
  };
}

const DEFAULT_MILESTONES: PccWorkflowMilestoneTemplate[] = [
  milestone("Define scope and success criteria", "setup", [
    "Capture the user-visible goal and non-goals.",
    "List constraints, approvals, and hard blockers.",
    "Write acceptance criteria that can be verified without guessing.",
  ]),
  milestone("Prepare tools, data, and workspace", "tools-skills", [
    "List required tools, skills, inputs, and credentials.",
    "Run a deterministic preflight or record the exact blocker.",
    "Save the proof command or checklist as a receipt candidate.",
  ]),
  milestone("Build MVP", "mvp", [
    "Implement the smallest end-to-end useful slice.",
    "Run targeted proof for the changed surface.",
    "Record known gaps before refinement.",
  ]),
  milestone("Refine and harden", "refinement", [
    "Fix usability, reliability, and edge-case gaps.",
    "Add regression coverage for the highest-risk path.",
    "Confirm the experience remains simple and skimmable.",
  ]),
  milestone(
    "Production proof",
    "production-proof",
    [
      "Run local targeted proof.",
      "Run remote or runtime proof if required and approved.",
      "Create completion receipt with do-not-redo notes.",
    ],
    { requiresRemoteProof: true, responsibility: "remote_proof", proofLevel: "remote" },
  ),
  milestone("Maintain backlog", "maintenance", [
    "Record bugs, enhancements, and reopen rules.",
    "Keep prior receipts linked so solved problems are not redone.",
  ]),
];

export const PCC_WORKFLOW_TEMPLATES: readonly PccWorkflowTemplate[] = [
  {
    id: "software-product",
    title: "Software/Product",
    description: "Code, UI, runtime, and proof work with local and remote gates.",
    phases: PHASES,
    milestones: DEFAULT_MILESTONES,
  },
  {
    id: "dashboard-data",
    title: "Dashboard/Data",
    description: "Source-backed dashboard work with metric definitions and proof.",
    phases: PHASES,
    milestones: [
      milestone("Define metrics and source truth", "setup", [
        "List the decisions this dashboard must support.",
        "Define each metric, denominator, source, and freshness rule.",
        "Record data-quality risks and blocked sources.",
      ]),
      milestone("Validate data access and quality", "tools-skills", [
        "Run read-only source checks.",
        "Verify row counts, freshness, and required fields.",
        "Record data caveats before building visuals.",
      ]),
      ...DEFAULT_MILESTONES.slice(2),
    ],
  },
  {
    id: "creative-media",
    title: "Creative/Media",
    description: "Creative projects with rights-safe assets, review, and packaging.",
    phases: PHASES,
    milestones: [
      milestone(
        "Define creative brief",
        "setup",
        [
          "Capture audience, tone, format, and references.",
          "List rights and source-media rules.",
          "Get user approval for the creative direction.",
        ],
        { stopHere: true },
      ),
      ...DEFAULT_MILESTONES.slice(1),
    ],
  },
  {
    id: "research",
    title: "Research",
    description: "Source-first research with explicit claims and citations.",
    phases: PHASES,
    milestones: [
      milestone("Define research question and evidence bar", "setup", [
        "Write the exact question and decision to support.",
        "List required source types and disallowed weak evidence.",
        "Define the final artifact format.",
      ]),
      milestone("Collect and verify sources", "tools-skills", [
        "Gather bounded source candidates.",
        "Reject stale, duplicate, or low-authority sources.",
        "Record source URLs and caveats.",
      ]),
      ...DEFAULT_MILESTONES.slice(2),
    ],
  },
  {
    id: "trading-finance",
    title: "Trading/Finance",
    description: "Finance work with strict no-live-action guardrails by default.",
    phases: PHASES,
    milestones: DEFAULT_MILESTONES.map((item) => ({
      ...item,
      proofLevel: item.phaseId === "production-proof" ? "remote" : item.proofLevel,
      responsibility: item.phaseId === "production-proof" ? "remote_proof" : item.responsibility,
    })),
  },
  {
    id: "snes-studio",
    title: "SNES Studio",
    description: "Patch-only SNES game creation with emulator proof and no ROM delivery.",
    phases: PHASES,
    milestones: [
      milestone(
        "Define game concept, scope, and safety rules",
        "setup",
        [
          "Gather game idea, genre, target play length, controls, and visual scale.",
          "Record ROM/patch safety rules and forbidden deliverables.",
          "Create project brief and get user approval.",
        ],
        { stopHere: true },
      ),
      milestone("Verify SNES toolchain and emulator smoke path", "tools-skills", [
        "List assembler, patch, emulator, and capture tools.",
        "Run deterministic preflight.",
        "Save proof receipt.",
      ]),
      milestone(
        "Create graphics, sprite, audio, and UI style kit",
        "mvp",
        [
          "Choose art direction, sprite size, palette, HUD scale, and animation budget.",
          "Create rights-safe contact sheet.",
          "Get user approval before implementation.",
        ],
        { stopHere: true },
      ),
      milestone("Build playable MVP loop", "mvp", [
        "Implement title/start, movement, camera, collision, objective, hazard, fail state, and win state.",
        "Run emulator smoke.",
        "Save screenshot or video proof.",
      ]),
      milestone("Add level flow, challenge, and fun pass", "refinement", [
        "Improve readability, movement feel, retries, scoring, progression, and one memorable moment.",
        "Run gameplay proof.",
        "Collect feedback.",
      ]),
      milestone(
        "Package patch-only deliverable and receipts",
        "production-proof",
        [
          "Build patch package and instructions.",
          "Include checksums and screenshots.",
          "Scan for forbidden ROM files and create completion receipt.",
        ],
        { requiresRemoteProof: true, responsibility: "remote_proof", proofLevel: "remote" },
      ),
      milestone("Maintain bug, improvement, and expansion backlog", "maintenance", [
        "Classify bugs and enhancements.",
        "Record future level, graphics, and audio ideas.",
        "Preserve prior receipts and reopen rules.",
      ]),
    ],
  },
  {
    id: "custom",
    title: "Custom",
    description: "Minimal template for projects that do not fit a standard workflow.",
    phases: PHASES,
    milestones: DEFAULT_MILESTONES,
  },
];

export function getPccWorkflowTemplate(id: string | undefined): PccWorkflowTemplate {
  return (
    PCC_WORKFLOW_TEMPLATES.find((template) => template.id === id) ??
    PCC_WORKFLOW_TEMPLATES.find((template) => template.id === "software-product")!
  );
}

function slug(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
}

function planFor(title: string): string {
  return [
    `Complete: ${title}.`,
    "Follow the listed sub-milestones in order.",
    "Stop and record an exact blocker if a required permission, tool, source, or proof surface is missing.",
  ].join("\n");
}

function responsibilityForAiUsePolicy(
  item: PccWorkflowMilestoneTemplate,
  policy: PccAiUsePolicy,
): string {
  if (item.responsibility === "user" || item.responsibility === "remote_proof") {
    return item.responsibility;
  }
  if (policy === "codex_everything") {
    return "codex";
  }
  if (policy === "codex_expert") {
    const expertWork =
      item.phaseId === "setup" ||
      item.phaseId === "refinement" ||
      /architect|approv|criteria|debug|diagnos|investigat|plan|problem|readiness|refine|review|scope/iu.test(
        item.title,
      );
    return expertWork ? "codex" : "local_openclaw_agent";
  }
  return item.responsibility.includes("codex") ? "local_openclaw_agent" : item.responsibility;
}

export function buildPccWorkflowDraft(input: {
  title: string;
  goal?: string;
  templateId?: string;
  priority?: number;
  codexPlanningAllowed?: boolean;
  remoteProofAllowed?: boolean;
  runtimeActionsAllowed?: boolean;
  planningMode?: PccPlanningMode;
  aiUsePolicy?: PccAiUsePolicy;
}): PccWorkflowDraft {
  const template = getPccWorkflowTemplate(input.templateId);
  const title = input.title.trim() || "Untitled Project";
  const phases = template.phases.map((phase) => ({ ...phase }));
  const planningMode = input.planningMode ?? "template_only";
  const aiUsePolicy = input.aiUsePolicy ?? "local_only";
  const needsCodexPlan =
    (planningMode === "codex_full_plan" || aiUsePolicy !== "local_only") &&
    input.codexPlanningAllowed !== true;
  const needsProjectManagerReview = planningMode === "local_project_manager";
  const milestones = template.milestones.map((item, index) => {
    const responsibility = responsibilityForAiUsePolicy(item, aiUsePolicy);
    const requiresCodex = responsibility.includes("codex");
    const metadata = {
      pccWorkflowTemplateId: template.id,
      pccProofLevel: item.proofLevel,
      pccResponsibility: responsibility,
      pccAiUsePolicy: aiUsePolicy,
      pccCostRisk: responsibility === "remote_proof" || requiresCodex ? "medium" : "low",
      pccStopHere: item.stopHere === true,
      requiresCodex: item.requiresCodex === true || requiresCodex,
      requiresRemoteProof: item.requiresRemoteProof === true,
      parallelSafe: responsibility !== "user" && responsibility !== "remote_proof",
      workspaceLock: `${slug(title)}:${item.phaseId}`,
    };
    return {
      title: item.title,
      status: needsCodexPlan && index === 0 ? ("needs_approval" as PccStatus) : "not_started",
      phaseId: item.phaseId,
      order: index + 1,
      implementationPlan: planFor(item.title),
      acceptanceCriteria: [
        "All sub-milestones are complete or explicitly skipped with reason.",
        "Required proof is attached before completion.",
        "A completion receipt records what was done and what not to redo.",
      ],
      metadata,
    };
  });

  return {
    project: {
      title,
      ...(input.goal?.trim() ? { goal: input.goal.trim() } : {}),
      status: "active",
      ...(input.priority !== undefined ? { priority: input.priority } : {}),
      phases,
      metadata: {
        pccWorkScope: "project_work",
        pccWorkflowTemplateId: template.id,
        pccWorkflowTemplateTitle: template.title,
        pccPlanningMode: planningMode,
        pccAiUsePolicy: aiUsePolicy,
        pccIntakeStatus: needsCodexPlan
          ? "codex_permission_needed"
          : needsProjectManagerReview
            ? "project_manager_review"
            : "template_ready",
        pccCodexPlanningAllowed: input.codexPlanningAllowed === true,
        pccRemoteProofAllowed: input.remoteProofAllowed === true,
        pccRuntimeActionsAllowed: input.runtimeActionsAllowed === true,
      },
    },
    milestones,
    subMilestonesByMilestoneTitle: Object.fromEntries(
      template.milestones.map((item) => [
        item.title,
        item.subMilestones.map((subTitle, subIndex) => {
          const responsibility = responsibilityForAiUsePolicy(item, aiUsePolicy);
          return {
            title: subTitle,
            status: "not_started" as PccStatus,
            order: subIndex + 1,
            implementationPlan: [
              `Execute: ${subTitle}`,
              "Use the parent milestone plan, preserve scope, and stop on missing proof or permissions.",
            ].join("\n"),
            acceptanceCriteria: [
              "The step has an observable result or exact blocker.",
              "Any command, artifact, source, or screenshot proof is recorded.",
            ],
            metadata: {
              pccWorkflowTemplateId: template.id,
              pccResponsibility: responsibility,
              pccAiUsePolicy: aiUsePolicy,
              pccProofLevel: item.proofLevel,
              requiresCodex: responsibility.includes("codex"),
              parallelSafe: responsibility !== "user" && responsibility !== "remote_proof",
              workspaceLock: `${slug(title)}:${item.phaseId}`,
            },
          };
        }),
      ]),
    ),
  };
}
