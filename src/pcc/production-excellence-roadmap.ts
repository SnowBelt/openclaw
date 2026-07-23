// Successor roadmap for closing audited production gaps after the locally proven OE-00 through
// OE-08 baseline. OE-09 live and remote authority remains an inherited closure gate.
export type PccProductionExcellenceMilestone = {
  id: string;
  title: string;
  weight: number;
  dependsOn: readonly string[];
  scope: readonly string[];
  acceptance: readonly string[];
  permissionGate?: string;
  vetoGate?: true;
};

export const PCC_PRODUCTION_EXCELLENCE_MILESTONES: readonly PccProductionExcellenceMilestone[] = [
  {
    id: "PE-00",
    title: "Exact-runtime baseline and reliability freeze",
    weight: 2,
    dependsOn: [],
    scope: [
      "Bind the program to the active source SHA, fetched upstream SHA, merge base, runtime release, full-CI state, and a redaction-safe inventory.",
      "Record divergence, customization inventory hash, Git object bytes and garbage, artifact counts, source durability, and evidence time.",
      "Require existing structured PCC or Release Governor grants for mutations; use deterministic or local execution and deny unapproved paid routes until PE-11 certification.",
      "Pause net-new product features while critical security, durability, or workflow-truth gates are red.",
    ],
    acceptance: [
      "The baseline keeps source, CI, runtime, browser, persistence, rollback, and human-usability proof separate.",
      "Every later milestone names the exact baseline or superseding source SHA it verifies.",
      "No mutating, destructive, paid, publication, restart, or reboot action is inferred from roadmap text.",
    ],
  },
  {
    id: "PE-01",
    title: "Durable source provenance",
    weight: 8,
    dependsOn: ["PE-00"],
    scope: [
      "Move active source provenance out of temporary directories into a stable operator-owned Git worktree.",
      "Reject mutable, dirty, missing, transient, or branch-unreachable source identities before update work.",
    ],
    acceptance: [
      "The active pointer records an exact commit, stable source path, branch, and credential-free remote ref identifying that commit.",
      "The update broker and PCC fail closed when source provenance is transient or unverifiable.",
      "A migration failure leaves the prior pointer and running runtime unchanged.",
      "Migration coordinates with activation and promotion so concurrent runtime changes cannot produce mismatched provenance.",
      "Approved promotion preserves the exact source object store and remote recovery ref, and a second consecutive update prepare accepts the resulting pointer.",
    ],
    permissionGate:
      "Updating the live active-runtime pointer requires explicit scoped runtime-metadata approval.",
  },
  {
    id: "PE-02",
    title: "Bounded customization inventory and overlay extraction",
    weight: 9,
    dependsOn: ["PE-01"],
    scope: [
      "Measure the custom delta against an exact official baseline and classify every changed surface by owner.",
      "Move custom dashboards, workflows, and policies behind owned plugin, package, or narrow overlay boundaries.",
      "Reduce the permanent core patch train instead of preserving an unbounded fork.",
    ],
    acceptance: [
      "A deterministic inventory reports changed files, lines, owners, capability coverage, and unclassified paths.",
      "Every changed path has capability coverage or a signed owner waiver; generic directory ownership is not preservation proof.",
      "Unclassified customization growth blocks candidate promotion, and bounded core patches have a measured ceiling and reduction target.",
      "Each extracted customization retains its tests, upgrade contract, observability, and rollback owner.",
    ],
  },
  {
    id: "PE-03",
    title: "Automated upstream canary and semantic preservation gate",
    weight: 7,
    dependsOn: ["PE-02"],
    scope: [
      "Fetch an exact official release, apply the bounded customization layer, and build an isolated candidate.",
      "Run capability, migration, protocol, workflow, browser, runtime, and rollback checks before approval.",
    ],
    acceptance: [
      "The canary never promotes automatically.",
      "A candidate missing any required custom behavior is rejected before live state changes.",
      "The candidate receipt binds official baseline, customization source, resulting SHA, proofs, and rollback.",
    ],
  },
  {
    id: "PE-04",
    title: "Storage containment, immutable retention, and approved reclamation",
    weight: 4,
    dependsOn: ["PE-01"],
    scope: [
      "Contain growth first by measuring release, rollback, update-worktree, receipt, backup, ref, loose-object, pack, and garbage bytes before another canary.",
      "Protect active, last-known-good, rollback-bound, pending, and recent successful releases.",
      "After PE-02 classifies recovery refs, add dry-run-first quarantine for superseded artifacts and Git maintenance recommendations.",
    ],
    acceptance: [
      "The default command is read-only, fails closed on malformed protection state, and reports count and byte budgets for every artifact class.",
      "Quarantine or deletion requires explicit approval, verified backup and restore, git fsck, and immediate protected-identity revalidation.",
      "Tests prove active, last-known-good, rollback, pending, and newest releases cannot be selected and quarantined artifacts can be restored.",
    ],
    permissionGate:
      "Deleting releases, rollback bundles, worktrees, receipts, or Git objects requires separate explicit destructive-action approval.",
  },
  {
    id: "PE-05",
    title: "Capability availability and health truth model",
    weight: 4,
    dependsOn: ["PE-03"],
    scope: [
      "Separate capability availability, enablement, health, verification, soak, and evidence freshness.",
      "Automatically demote rolled-back, unhealthy, or evidence-expired capabilities.",
    ],
    acceptance: [
      "A manifest entry alone cannot claim a capability is active or healthy.",
      "PCC and Operations Room show the same source-backed capability state and evidence timestamp.",
    ],
  },
  {
    id: "PE-06",
    title: "Secrets, plugin, provider, and tool-policy hygiene",
    weight: 6,
    dependsOn: ["PE-00"],
    scope: [
      "Migrate secret-bearing configuration to supported SecretRefs.",
      "Repair stale plugins, provider catalog failures, tool-profile mismatches, channel tool gaps, PATH drift, and Tailnet version drift.",
    ],
    acceptance: [
      "No plaintext credential remains in tracked configuration, proof artifacts, or promoted runtime metadata.",
      "Doctor reports no unresolved critical plugin, provider, tool-policy, channel, or service-path issue.",
    ],
    permissionGate:
      "Credential rotation, Keychain mutation, plugin replacement, or live configuration changes require explicit scoped approval.",
  },
  {
    id: "PE-07",
    title: "Exact-SHA full-CI closure",
    weight: 6,
    dependsOn: ["PE-03", "PE-06"],
    scope: [
      "Resolve security advisories, generated drift, protocol parity, localization, dependency hygiene, and dashboard regressions.",
      "Keep unrelated upstream failures separate and evidence-backed.",
    ],
    acceptance: [
      "Full required CI succeeds on the exact candidate SHA with no failed required job.",
      "Scoped proof remains green and no failure is hidden by retrying a deterministic regression.",
    ],
  },
  {
    id: "PE-08",
    title: "TaskFlow and cron lifecycle reconciliation",
    weight: 7,
    dependsOn: ["PE-07"],
    scope: [
      "Expire or recover stale queued, running, blocked, and in-flight work using explicit terminal states.",
      "Make cancel, pause, resume, retry, and recovery idempotent.",
      "Repair or archive quarantined and repeatedly failing scheduled work.",
    ],
    acceptance: [
      "No flow remains running or queued beyond its declared liveness contract without an incident.",
      "Chat, PCC, Workboard, and Operations Room agree on the same current work state.",
      "One user action reaches a verified terminal cancellation state.",
    ],
  },
  {
    id: "PE-09",
    title: "Agent consolidation and capability catalog",
    weight: 5,
    dependsOn: ["PE-08"],
    scope: [
      "Consolidate the visible roster into Control Director, Planner, Builder, Judge, Release Operations, and on-demand domain squads.",
      "Catalog every retained agent, skill, workflow, tool, plugin, and model with owner, trigger, cost, liveness, and fallback.",
    ],
    acceptance: [
      "Dormant or redundant agents are retained only with a named capability reason.",
      "Specialized capability remains available through skills, workflow templates, or on-demand workers.",
      "The default Chat picker hides advanced agents and models behind progressive disclosure.",
    ],
  },
  {
    id: "PE-10",
    title: "PCC canonical project, decision, and permission ledger",
    weight: 6,
    dependsOn: ["PE-08", "PE-09"],
    scope: [
      "Make PCC the canonical project source for Chat, goals, workflows, milestones, decisions, permissions, and evidence.",
      "Automatically ingest bounded, attributable changes from conversations and execution receipts.",
    ],
    acceptance: [
      "Chat does not create a second project or milestone database.",
      "Permissions are scoped, expiring, milestone-bound, and auditable.",
      "PCC status cannot remain stale after a verified workflow transition.",
    ],
  },
  {
    id: "PE-11",
    title: "Local-first routing and model certification",
    weight: 7,
    dependsOn: ["PE-06", "PE-10"],
    scope: [
      "Enable deterministic-first and certified-local-first automatic routing.",
      "Benchmark Control, Builder, Judge, fallback, and small-task candidates on representative OpenClaw work.",
      "Deny unknown or metered automatic routes unless an explicit permission and budget authorize them.",
    ],
    acceptance: [
      "No automatic paid request can start without a usable grant and conservative cost proof.",
      "Model roles are selected from measured first-pass quality, latency, memory, and rework evidence.",
      "Explicit user model selections remain explicit.",
    ],
  },
  {
    id: "PE-12",
    title: "Dynamic context and retrieval quality",
    weight: 4,
    dependsOn: ["PE-11"],
    scope: [
      "Use bounded default contexts with checkpointing and evidence-backed escalation.",
      "Shadow-evaluate installed embedding models before changing the canonical memory index.",
    ],
    acceptance: [
      "Context expansion is attributable to a named requirement rather than a static oversized default.",
      "Embedding changes require recall, latency, memory, migration, and rollback evidence.",
    ],
  },
  {
    id: "PE-13",
    title: "Golden-task evaluation, SLOs, and error budgets",
    weight: 6,
    dependsOn: ["PE-08", "PE-11", "PE-12"],
    scope: [
      "Build representative, redaction-safe golden tasks across core OpenClaw and custom project workflows.",
      "Measure first-pass acceptance, correctness, latency, rework, proof coverage, local-model share, memory, and cost.",
    ],
    acceptance: [
      "Every applicable quality dimension is at least 93 out of 100 without averaging away a critical failure.",
      "An exhausted reliability error budget freezes feature promotion until recovery.",
    ],
  },
  {
    id: "PE-14",
    title: "Codex-like Chat and progressive-disclosure UX",
    weight: 6,
    dependsOn: ["PE-10", "PE-13"],
    scope: [
      "Prioritize transcript, composer, concise progress, project context, and reliable goal controls.",
      "Move detailed truth diagnostics to Operations, PCC, or an on-demand incident drawer.",
      "Simplify agent and model selection into recommended local, Codex, and advanced lanes.",
    ],
    acceptance: [
      "Chat never loses prime transcript space to an empty or expanded diagnostic surface.",
      "Desktop and mobile users can discover primary actions in under one minute.",
      "Keyboard, clipboard, focus, sheet closing, pause, resume, and cancel paths pass browser proof.",
    ],
  },
  {
    id: "PE-15",
    title: "UI modularity and performance budgets",
    weight: 5,
    dependsOn: ["PE-14"],
    scope: [
      "Split oversized views along state, application, and presentation boundaries without changing behavior.",
      "Virtualize large histories and enforce route-bundle, render-count, heap, and interaction-latency budgets.",
    ],
    acceptance: [
      "Refactoring reduces coupling and does not add a parallel compatibility path.",
      "Critical desktop and mobile interactions remain within checked performance budgets.",
    ],
  },
  {
    id: "PE-16",
    title: "Unified observability and automatic incident intake",
    weight: 4,
    dependsOn: ["PE-05", "PE-13", "PE-15"],
    scope: [
      "Canary the existing OpenTelemetry integration for redacted prompt-to-receipt traces.",
      "Create source-backed incidents for stale work, repeated failures, truth-gate blocks, and capability drift.",
    ],
    acceptance: [
      "Operations Room remains exception-first and links every alert to owner, source, freshness, and remediation.",
      "Truth and Completion can report an issue to the appropriate governor without claiming that remediation succeeded.",
    ],
  },
  {
    id: "PE-17",
    title: "Paper-only profit and risk evidence",
    weight: 1,
    dependsOn: ["PE-13"],
    scope: [
      "Measure paper or shadow calibration, slippage, drawdown, coverage, and risk-adjusted outcomes.",
      "Keep live trading outside this program unless separately authorized.",
    ],
    acceptance: [
      "No dashboard or simulation claim is presented as proven live profit.",
      "Live-money execution remains disabled and requires a separate safety program and approval.",
    ],
  },
  {
    id: "PE-18",
    title: "Production proof, rollback drill, soak, and usability closure",
    weight: 3,
    dependsOn: [
      "PE-03",
      "PE-04",
      "PE-05",
      "PE-06",
      "PE-07",
      "PE-08",
      "PE-09",
      "PE-10",
      "PE-11",
      "PE-12",
      "PE-13",
      "PE-14",
      "PE-15",
      "PE-16",
    ],
    scope: [
      "Run exact-SHA local, remote, runtime, authenticated desktop/mobile, persistence, rollback, disaster-restore, and bounded-soak proof.",
      "Validate skimmability and task completion with representative users.",
    ],
    acceptance: [
      "No P0 or P1 finding remains and every required proof is current and identity-bound.",
      "A 24-to-72-hour bounded soak stays above the 93-point quality floor.",
      "The final receipt names any optional or externally blocked work without flattening it into completion.",
    ],
    permissionGate:
      "Live promotion, restart, reboot, destructive cleanup, paid access, publication, or live-money proof each requires its own explicit approval.",
    vetoGate: true,
  },
];

export function validatePccProductionExcellenceRoadmap(
  milestones: readonly PccProductionExcellenceMilestone[] = PCC_PRODUCTION_EXCELLENCE_MILESTONES,
): string[] {
  const errors: string[] = [];
  const ids = new Set<string>();
  let totalWeight = 0;

  for (const milestone of milestones) {
    if (!/^PE-\d{2}$/u.test(milestone.id)) {
      errors.push(`Invalid milestone id: ${milestone.id}`);
    }
    if (ids.has(milestone.id)) {
      errors.push(`Duplicate milestone id: ${milestone.id}`);
    }
    ids.add(milestone.id);
    totalWeight += milestone.weight;
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

  if (totalWeight !== 100) {
    errors.push(`Milestone weights must total 100; received ${totalWeight}.`);
  }
  return errors;
}
