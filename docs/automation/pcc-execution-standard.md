---
summary: "The automatic local-first process, skill, QA, judge, repair, and learning contract applied to every PCC project run"
read_when:
  - You want to know which processes and skills PCC applies automatically
  - You are adding a PCC workflow, skill, model route, proof gate, or execution capability
  - You need to understand the PCC 93+ quality contract
title: "PCC Execution Standard"
sidebarTitle: "PCC Execution Standard"
---

PCC applies one automatic execution standard to project work. The user chooses the outcome and, when needed, a model/team profile. PCC resolves the process, installed skills, safety preflight, verification, judge, repair, proof, and learning steps. There is no second workflow switch that can silently override the project profile.

## Automatic Workflow

Every run follows the same top-level sequence:

```text
understand -> preflight -> plan -> execute -> verify -> judge -> repair -> record
```

1. **Understand** binds project scope, user instructions, goal, acceptance criteria, and forbidden actions.
2. **Preflight** checks setup, dependencies, skills, models, host capacity, permissions, and proof requirements before dispatch.
3. **Plan** partitions only dependency-safe work with explicit ownership and workspace leases.
4. **Execute** follows the project’s one canonical local-first model/team profile.
5. **Verify** runs the cheapest proof that can detect a regression in the changed surface.
6. **Judge** independently compares the result with user intent, checks, proof, risks, and completion truth.
7. **Repair** allows at most two targeted local repair passes. A third failure becomes an exact blocker.
8. **Record** saves sanitized proof, a truthful receipt, and recommendation-only learning evidence.

The executor cannot award its own completion grade. PCC does not mark milestones complete merely because a worker returned output.

## Skills And Process Resolution

PCC reads the live Gateway skill catalog when the PCC tab opens. It selects eligible, model-visible skills from the current project goal and work item. Core mappings include:

| Work detected                      | Preferred skill             | Built-in fallback                                             |
| ---------------------------------- | --------------------------- | ------------------------------------------------------------- |
| Debugging or failure repair        | `openclaw-debugging`        | Reproduce, trace owner path, isolate root cause, prove repair |
| OpenClaw implementation or testing | `openclaw-testing`          | Repository instructions and targeted test/type/build gates    |
| Dashboard, mobile, or browser UI   | `control-ui-e2e`            | Maintained desktop/mobile browser proof                       |
| Performance                        | `openclaw-test-performance` | Explicit before/after budget measurement                      |
| Documentation or process cleanup   | `technical-documentation`   | Update one canonical owner page and link to it                |
| Security-sensitive work            | `security-triage`           | Fail closed and request scoped review                         |
| Remote or release proof            | `crabbox`, `verify-release` | Exact-SHA CI, runtime, and browser proof gates                |

PCC can also select up to three eligible domain skills whose live descriptions match the project. This lets a future skill participate without a project-specific code branch.

An installed but disabled or ineligible required skill is an exact blocker; PCC does not silently ignore it. A specialized skill that is not installed uses visible built-in fallback guidance so the MVP remains useful. Failure to load the live skill catalog blocks live team or Autopilot start until the catalog is restored.

## OpenClaw And Codex Roles

OpenClaw is the default coordinator and worker runtime. The project’s canonical execution profile controls focus, parallelism, local model, capacity policy, and any Codex role.

Codex remains off unless that profile explicitly assigns it a role. A scoped permission must then exist before dispatch. PCC never treats a selected Codex model as permission to deploy, write externally, change credentials, perform destructive actions, reboot, or broaden the approved role.

The same execution standard is placed in supervised team plans, Autopilot context packs, and copied PCC handoff packets, so OpenClaw and Codex receive the same scope, skill, QA, and completion contract. A handoff without an exact resolved snapshot says so and requires live skill resolution before work starts rather than silently inventing a plan.

## 93+ Quality Contract

PCC measures six dimensions:

- speed;
- accuracy;
- efficiency;
- first-pass quality;
- QA;
- overall quality.

Each dimension has three mandatory evidence requirements worth 31 points each. An independent judge pass adds 7 points. Missing one requirement drops that dimension below 93. A run passes only when every requirement is present, the judge passes, and every dimension is at least 93.

This is an evidence contract, not a self-reported score. Relevant evidence includes preflight, capacity, acceptance criteria, dependency contract, local-first routing, duplicate-work prevention, targeted checks, type/build checks, browser or manual verification, proof binding, risks, and truthful completion.

The [PCC Learning Loop](/automation/pcc-learning-loop) uses the same six dimensions. A recommendation cannot be promoted unless every after metric is at least 93 and does not regress from its baseline.

## Future Capability Contract

A new PCC process, workflow, skill mapping, model route, or verification capability must:

1. have one unique capability ID;
2. declare its workflow phase and applicable work kind;
3. provide plain-language selection rationale;
4. provide a safe built-in fallback;
5. reference only registered quality evidence;
6. keep model routing in the canonical project execution profile;
7. keep permission checks before execution;
8. add pure contract tests and one boundary smoke when behavior changes;
9. update this canonical page rather than duplicating the policy;
10. preserve recommendation-only learning until a separate reviewed implementation path promotes it.

Registry validation fails if IDs collide, phases lose coverage, fallback or rationale is missing, or evidence references are unknown. The Gateway write path also canonicalizes the execution-standard metadata for existing and future projects; the PCC ledger doctor can repair legacy projects idempotently.

## Operator Experience

The PCC execution card shows:

- `Automatic workflow: Ready` or the exact blocker;
- the `93/100 minimum` quality target;
- selected process and skill counts;
- the eight workflow phases;
- a collapsed `Why this plan?` explanation.

The simple path remains: choose a project, review the next action, approve only what needs permission, then start. Advanced routing, evidence, and selection details remain available without becoming required reading.

## Related Contracts

- [PCC Execution Teams](/automation/pcc-execution-teams)
- [PCC Learning Loop](/automation/pcc-learning-loop)
- [Skills](/tools/skills)
- [Subagents](/tools/subagents)
- [Permission modes](/tools/permission-modes)
