import type { PccCapabilityRequirement } from "./capability-contract.js";
// Canonical PCC workflow requirements stay separate from resolution logic.
import type { PccWorkflowTemplateId } from "./project-workflows.js";

export const BASE_REQUIREMENTS: readonly PccCapabilityRequirement[] = [
  {
    id: "workflow-contract",
    kind: "workflow",
    title: "Versioned workflow contract",
    purpose: "Keep phases, ownership, permissions, and proof order deterministic.",
    required: true,
    evidence: "The project records the workflow template and capability-contract version.",
  },
  {
    id: "scope-and-success-criteria",
    kind: "process",
    title: "Scope and success criteria",
    purpose: "Prevent ambiguous work and unverifiable completion claims.",
    required: true,
    evidence: "Approved intake, implementation plan, and observable acceptance criteria.",
  },
  {
    id: "capability-preflight",
    kind: "process",
    title: "Capability preflight",
    purpose:
      "Find the required workflow, skill, tool, model, and proof surface before work starts.",
    required: true,
    evidence: "A current capability resolution is attached to the project or task receipt.",
  },
  {
    id: "permission-gate",
    kind: "process",
    title: "Permission gate",
    purpose: "Stop before paid, remote, destructive, credentialed, or externally visible actions.",
    required: true,
    evidence: "Permission scope is recorded and every required grant is current.",
  },
  {
    id: "local-first-routing",
    kind: "process",
    title: "Local-first routing",
    purpose: "Use the cheapest capable local worker before paid or remote capacity.",
    required: true,
    evidence: "The task records its selected worker, model class, and escalation reason.",
  },
  {
    id: "targeted-proof",
    kind: "proof",
    title: "Targeted changed-surface proof",
    purpose:
      "Catch regressions with the cheapest deterministic test that proves the changed boundary.",
    required: true,
    evidence: "Passed evidence records exact commands, artifacts, and the tested source identity.",
  },
  {
    id: "independent-qa",
    kind: "process",
    title: "Independent quality review",
    purpose: "Separate implementation from final judgment and first-pass quality scoring.",
    required: true,
    evidence: "A reviewer or deterministic judge records defects, score, and disposition.",
  },
  {
    id: "truth-gated-completion",
    kind: "process",
    title: "Truth-gated completion",
    purpose: "Keep code, runtime, browser, device, remote, and human proof distinct.",
    required: true,
    evidence: "The completion receipt links all required passed evidence without inferred success.",
  },
  {
    id: "learning-receipt",
    kind: "process",
    title: "Recommendation-only learning receipt",
    purpose: "Preserve what worked without silently mutating runtime policy.",
    required: true,
    evidence: "The receipt records do-not-redo guidance, gaps, and any learning candidate.",
  },
];

export const TEMPLATE_REQUIREMENTS: Readonly<
  Record<PccWorkflowTemplateId, readonly PccCapabilityRequirement[]>
> = {
  "software-product": [
    {
      id: "dependency-contract-check",
      kind: "process",
      title: "Dependency contract check",
      purpose: "Verify dependency APIs, defaults, and owner boundaries before implementation.",
      required: true,
      evidence: "Source or official dependency contract reviewed for the changed behavior.",
    },
    {
      id: "regression-proof",
      kind: "proof",
      title: "Regression proof",
      purpose: "Prove the original failure and the corrected behavior at the owning seam.",
      required: true,
      evidence: "A focused regression test or live reproduction passes.",
    },
    {
      id: "upgrade-preservation",
      kind: "proof",
      title: "Custom-feature upgrade preservation",
      purpose: "Prevent an update from silently removing custom behavior.",
      required: true,
      evidence: "The custom-feature manifest and upgrade canary retain every required surface.",
    },
    {
      id: "openclaw-testing",
      kind: "skill",
      title: "OpenClaw testing router",
      purpose: "Select the cheapest safe local, Testbox, CI, runtime, or device proof lane.",
      required: false,
      evidence: "Skill use or an equivalent tested proof plan is recorded.",
    },
  ],
  "dashboard-data": [
    {
      id: "data-source-contract",
      kind: "process",
      title: "Data source and metric contract",
      purpose: "Keep each metric traceable to its definition, source, owner, and freshness rule.",
      required: true,
      evidence: "Metric definitions and source-quality checks are recorded.",
    },
    {
      id: "browser-accessibility-proof",
      kind: "proof",
      title: "Browser and accessibility proof",
      purpose: "Prove the real rendered dashboard is usable, responsive, and understandable.",
      required: true,
      evidence: "Browser-visible desktop/mobile proof and accessibility checks pass.",
    },
    {
      id: "control-ui-e2e",
      kind: "skill",
      title: "Control UI end-to-end proof",
      purpose: "Reuse the maintained dashboard browser-proof workflow when available.",
      required: false,
      evidence: "Skill use or an equivalent browser proof receipt is recorded.",
    },
  ],
  "creative-media": [
    {
      id: "rights-and-source-proof",
      kind: "process",
      title: "Rights and source proof",
      purpose: "Keep creative assets source-backed, rights-safe, and attributable.",
      required: true,
      evidence: "Asset provenance, rights status, and source class are recorded.",
    },
    {
      id: "human-creative-approval",
      kind: "process",
      title: "Human creative approval",
      purpose: "Keep subjective direction and final visual quality under explicit human control.",
      required: true,
      evidence: "The approved direction and final human disposition are recorded separately.",
    },
  ],
  research: [
    {
      id: "source-authority-check",
      kind: "process",
      title: "Source authority check",
      purpose: "Prefer primary, current, and decision-relevant evidence over plausible prose.",
      required: true,
      evidence: "Claims map to bounded sources with freshness and caveat notes.",
    },
    {
      id: "citation-proof",
      kind: "proof",
      title: "Claim-to-citation proof",
      purpose: "Make every consequential claim independently traceable.",
      required: true,
      evidence: "Citations directly support their associated claims.",
    },
  ],
  "trading-finance": [
    {
      id: "no-live-action-guard",
      kind: "process",
      title: "No-live-action guard",
      purpose:
        "Keep trading and financial work fail-closed unless live action is explicitly approved.",
      required: true,
      evidence: "A deterministic no-live-action check passes or a scoped grant is recorded.",
    },
    {
      id: "financial-risk-gate",
      kind: "process",
      title: "Financial risk gate",
      purpose: "Separate research, paper execution, and live capital exposure.",
      required: true,
      evidence: "Risk class, limits, data freshness, and execution mode are recorded.",
    },
  ],
  "snes-studio": [
    {
      id: "snes-change-gateway",
      kind: "process",
      title: "SNES change gateway",
      purpose: "Route every SNES change through safety, reference, gameplay, and patch-only gates.",
      required: true,
      evidence: "The SNES gateway receipt identifies ROM safety and the proof envelope.",
    },
    {
      id: "snes-game-creator:snes-change-gateway",
      kind: "skill",
      title: "SNES change gateway skill",
      purpose: "Use the maintained SNES entrypoint automatically when installed and eligible.",
      required: false,
      evidence: "Skill use or an equivalent gateway receipt is recorded.",
    },
    {
      id: "runtime-visual-gameplay-proof",
      kind: "proof",
      title: "Runtime, visual, and gameplay proof",
      purpose: "Keep emulator boot, visible quality, and gameplay envelope as separate gates.",
      required: true,
      evidence: "Current emulator, visual, and gameplay artifacts pass independently.",
    },
    {
      id: "patch-only-delivery",
      kind: "process",
      title: "Patch-only delivery",
      purpose: "Prevent copyrighted ROM delivery while preserving reproducible output.",
      required: true,
      evidence: "Forbidden-file scan, patch checksum, and application instructions pass.",
    },
  ],
  custom: [
    {
      id: "custom-workflow-review",
      kind: "process",
      title: "Custom workflow review",
      purpose: "Prevent a custom template from bypassing the standard quality and proof gates.",
      required: true,
      evidence: "A human or project manager confirms why a standard workflow does not fit.",
    },
  ],
};

export const PHASE_REQUIREMENT_IDS: Readonly<Record<string, readonly string[]>> = {
  setup: ["workflow-contract", "scope-and-success-criteria", "permission-gate"],
  "tools-skills": ["capability-preflight", "local-first-routing"],
  mvp: ["targeted-proof"],
  refinement: ["independent-qa", "regression-proof"],
  "production-proof": ["truth-gated-completion", "upgrade-preservation"],
  maintenance: ["learning-receipt"],
};
