// Static roadmap definitions keep the operational-excellence program resumable outside chat context.
export type PccOperationalExcellenceMilestone = {
  id: string;
  title: string;
  weight: number;
  dependsOn: readonly string[];
  scope: readonly string[];
  acceptance: readonly string[];
  permissionGate?: string;
};

export const PCC_OPERATIONAL_EXCELLENCE_MILESTONES: readonly PccOperationalExcellenceMilestone[] = [
  {
    id: "OE-00",
    title: "Baseline, inventory, and durable roadmap",
    weight: 5,
    dependsOn: [],
    scope: [
      "Inventory workflows, skills, tools, agents, models, permissions, proof lanes, and custom surfaces.",
      "Record one dependency-ordered roadmap that is not dependent on chat memory.",
    ],
    acceptance: [
      "The roadmap is machine-readable and its weights total 100.",
      "Existing strengths, gaps, blockers, and out-of-scope work are recorded without flattening proof types.",
    ],
  },
  {
    id: "OE-01",
    title: "Capability and quality contract",
    weight: 12,
    dependsOn: ["OE-00"],
    scope: [
      "Define versioned workflow, process, skill, software, tool, plugin, agent, model, permission, proof, and quality requirements.",
      "Set the operational quality floor to 93/100 per applicable dimension without averaging away failures.",
    ],
    acceptance: [
      "Every standard PCC workflow resolves to one deterministic contract.",
      "Required external capabilities fail closed when availability is unproven.",
      "Preferred capabilities can fall back only with an explicit recorded reason.",
    ],
  },
  {
    id: "OE-02",
    title: "Automatic capability preflight and routing",
    weight: 14,
    dependsOn: ["OE-01"],
    scope: [
      "Resolve the current skill, software, tool, plugin, agent, and model inventory before a work item starts.",
      "Select local-first execution and stop before paid, remote, destructive, or unavailable work.",
    ],
    acceptance: [
      "PCC records a current redaction-safe preflight snapshot.",
      "Declared tools, plugins, and software resolve from canonical runtime catalogs instead of a second inventory store.",
      "The generated task prompt names every required capability, selected worker, proof surface, and fallback.",
      "No OpenAI API call occurs without an explicit usable grant and budget.",
    ],
  },
  {
    id: "OE-03",
    title: "Capability-use receipts and first-pass telemetry",
    weight: 12,
    dependsOn: ["OE-02"],
    scope: [
      "Record which required and preferred capabilities were actually used.",
      "Capture first-pass defects, retries, latency, cost class, proof coverage, and quality scores.",
    ],
    acceptance: [
      "A final receipt cannot satisfy a contracted milestone while required capability evidence is missing.",
      "Quality scores are evidence-linked and remain separate by dimension.",
    ],
  },
  {
    id: "OE-04",
    title: "Operational SLO, error-budget, and toil dashboard",
    weight: 10,
    dependsOn: ["OE-03"],
    scope: [
      "Show quality dimensions, first-pass rate, retry rate, latency, proof freshness, cost class, and blocked toil.",
      "Expose only actionable alerts for quality risk, capability absence, and runtime drift.",
    ],
    acceptance: [
      "Dashboard metrics have definitions, sources, freshness, and owners.",
      "A regression below 93 is visible and blocks promotion where configured.",
      "Desktop and mobile browser proof passes.",
    ],
  },
  {
    id: "OE-05",
    title: "Future-addition standards gate",
    weight: 10,
    dependsOn: ["OE-01"],
    scope: [
      "Validate new workflows, skills, processes, plugins, models, and custom surfaces against the standard contract.",
      "Require owner, tests, docs, proof, permissions, fallback, upgrade impact, and observability metadata.",
    ],
    acceptance: [
      "Malformed or incomplete additions fail a deterministic local and CI check.",
      "The validator supplies exact repair instructions instead of silently accepting drift.",
    ],
  },
  {
    id: "OE-06",
    title: "Local-first model intelligence on the current PCC architecture",
    weight: 12,
    dependsOn: ["OE-02", "OE-05"],
    scope: [
      "Discover local model capability groups and refresh catalogs without hard-coded releases.",
      "Route to the cheapest capable local model and require explicit approval before paid OpenAI API use.",
    ],
    acceptance: [
      "No OpenAI API request occurs during proof.",
      "Model discovery, grouping, stale-catalog behavior, cost policy, and fallback tests pass.",
      "The current PCC branch receives semantic integration rather than stale-file restoration.",
    ],
  },
  {
    id: "OE-07",
    title: "Declarative custom-feature preservation",
    weight: 10,
    dependsOn: ["OE-05"],
    scope: [
      "Centralize every required custom dashboard, route, plugin, workflow, skill, and runtime contract in one manifest.",
      "Remove duplicated hard-coded surface lists from deployment scripts.",
    ],
    acceptance: [
      "An update candidate fails before promotion if any required custom feature is absent or incompatible.",
      "The manifest is versioned, hash-bound, and included in runtime identity proof.",
    ],
  },
  {
    id: "OE-08",
    title: "Canary update, rollback, and compatibility proof",
    weight: 8,
    dependsOn: ["OE-06", "OE-07"],
    scope: [
      "Stage official updates in isolation with copied state and no live mutation.",
      "Run contract, migration, custom-surface, browser, runtime, and rollback proof before atomic promotion.",
    ],
    acceptance: [
      "A deliberately incomplete candidate is rejected.",
      "A valid candidate promotes atomically and a failed health check restores last known good.",
      "All custom features retain 100 percent of their contract-tested behavior.",
    ],
  },
  {
    id: "OE-09",
    title: "Production proof, soak, and reconciliation",
    weight: 7,
    dependsOn: ["OE-03", "OE-04", "OE-08"],
    scope: [
      "Run targeted local proof, changed-surface validation, remote proof, live runtime/browser/mobile proof, and persistence proof.",
      "Enable bounded reconciliation and alerting only after explicit live-operation approval.",
    ],
    acceptance: [
      "Every proof is bound to the final source and runtime identity.",
      "A bounded soak stays above the 93-point quality floor with no critical regression.",
      "The durable receipt names exact remaining external or human blockers, if any.",
    ],
    permissionGate:
      "Requires explicit permission before remote publication, paid API use, live Gateway replacement, scheduler activation, or reboot.",
  },
];

export function validatePccOperationalExcellenceRoadmap(
  milestones: readonly PccOperationalExcellenceMilestone[] = PCC_OPERATIONAL_EXCELLENCE_MILESTONES,
): string[] {
  const errors: string[] = [];
  const ids = new Set<string>();
  let weight = 0;
  for (const milestone of milestones) {
    if (!/^OE-\d{2}$/u.test(milestone.id)) {
      errors.push(`Invalid milestone id: ${milestone.id}`);
    }
    if (ids.has(milestone.id)) {
      errors.push(`Duplicate milestone id: ${milestone.id}`);
    }
    ids.add(milestone.id);
    weight += milestone.weight;
    if (milestone.scope.length === 0 || milestone.acceptance.length === 0) {
      errors.push(`Milestone ${milestone.id} is missing scope or acceptance criteria.`);
    }
  }
  for (const milestone of milestones) {
    for (const dependency of milestone.dependsOn) {
      if (!ids.has(dependency)) {
        errors.push(`Milestone ${milestone.id} has unknown dependency: ${dependency}`);
      }
      if (dependency >= milestone.id) {
        errors.push(`Milestone ${milestone.id} has a non-prior dependency: ${dependency}`);
      }
    }
  }
  if (weight !== 100) {
    errors.push(`Milestone weights must total 100; received ${weight}.`);
  }
  return errors;
}
