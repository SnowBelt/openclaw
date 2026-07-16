---
summary: "Versioned capability routing, quality gates, and upgrade preservation for PCC work"
read_when:
  - You want PCC to select workflows, skills, tools, agents, models, permissions, and proof automatically
  - You are adding a PCC workflow or custom runtime surface
  - You need the operational-excellence milestone sequence and completion rules
title: "PCC Operational Excellence"
---

# PCC operational excellence

The Project Command Center (PCC) operational-excellence program turns implicit agent behavior into a versioned execution contract. It targets at least 93 out of 100 on each applicable quality dimension. The threshold is a release gate backed by evidence, not a promise that every task will be flawless.

The quality dimensions are speed, accuracy, efficiency, first-pass quality, QA coverage, overall quality, reliability, durability, safety, cost discipline, observability, and recoverability. A high average cannot hide a critical failure in one dimension.

## Execution contract

Every new standard workflow carries the `openclaw.pcc.capability-contract.v1` contract. Before work starts, PCC should resolve:

1. workflow and owner,
2. required and preferred processes, skills, tools, agents, and models,
3. local-first route and paid-capacity escalation reason,
4. permission scope and budget,
5. exact proof surfaces,
6. independent QA and quality dimensions,
7. completion-receipt and learning requirements.

Required external capabilities fail closed when current inventory cannot prove availability. Preferred capabilities may use an equivalent fallback only when the reason is recorded. Built-in process and proof requirements remain planned until a completion receipt proves they were used.

OpenAI API use is not automatic. A project must have an explicit current permission and budget before PCC can select paid API capacity. Any required paid use must record its permission ID, budget receipt, and escalation reason in first-pass evidence. Local models and local agents remain the first route when they satisfy the task contract.

## Milestone sequence

The machine-readable roadmap lives in `src/pcc/operational-excellence-roadmap.ts`.

| ID    | Milestone                                                      | Weight | Depends on          |
| ----- | -------------------------------------------------------------- | -----: | ------------------- |
| OE-00 | Baseline, inventory, and durable roadmap                       |      5 | none                |
| OE-01 | Capability and quality contract                                |     12 | OE-00               |
| OE-02 | Automatic capability preflight and routing                     |     14 | OE-01               |
| OE-03 | Capability-use receipts and first-pass telemetry               |     12 | OE-02               |
| OE-04 | Operational SLO, error-budget, and toil dashboard              |     10 | OE-03               |
| OE-05 | Future-addition standards gate                                 |     10 | OE-01               |
| OE-06 | Local-first model intelligence on the current PCC architecture |     12 | OE-02, OE-05        |
| OE-07 | Declarative custom-feature preservation                        |     10 | OE-05               |
| OE-08 | Canary update, rollback, and compatibility proof               |      8 | OE-06, OE-07        |
| OE-09 | Production proof, soak, and reconciliation                     |      7 | OE-03, OE-04, OE-08 |

The weights total 100. A milestone reaches 100 percent only after its own acceptance criteria and proof pass. Blocked live, remote, paid, destructive, publication, or reboot gates remain separate from autonomous engineering progress.

## Future additions

A new workflow, process, skill, tool, agent, model provider, plugin, or custom dashboard surface is incomplete until it declares:

- stable ID and version,
- owner and trigger,
- required inputs and capabilities,
- permission and cost class,
- local-first and approved fallback behavior,
- deterministic tests and real proof surface,
- quality dimensions and failure policy,
- observability and freshness,
- upgrade and migration impact,
- rollback or disable path,
- documentation and completion-receipt fields.

OE-05 turns this list into a deterministic validation gate.

The checked registry is `src/pcc/capability-addition-registry.ts`. It covers every standard PCC workflow and every capability in the custom-runtime manifest. Adding a custom dashboard, plugin, workflow, or runtime contract without a matching owner, trigger, permission/cost class, proof, observability, upgrade impact, rollback, and documentation standard fails `pnpm check:pcc-capabilities`.

## Update preservation

Custom functionality must be declared, versioned, and tested as desired state. An official update is first staged in an isolated candidate runtime. The candidate must pass manifest, migration, plugin, route, workflow, browser, runtime, and rollback checks before atomic promotion. Missing custom features reject the candidate before the live runtime changes.

The desired-state inventory is `config/custom-runtime-capabilities.json`. It covers dashboard surfaces, required plugins, PCC workflows, Control Director truth gates, and local-first model intelligence. Every capability has a stable ID and one or more required runtime paths. The immutable runtime pointer binds the capability manifest hash and the cumulative required capability IDs. Candidates may add capabilities, but cannot silently remove an active requirement.

The current inventory contains 29 preserved capabilities. It includes all seven app dashboards, both required plugins, PCC project management and operational excellence, Control Director truth gates, local-first model intelligence, the complete Codex-style Chat stack, mobile PCC control, PCC-to-Chat synchronization, Chat UX cleanup, the cumulative Codex-plus-apps dashboard, the Self-Improvement Governor runtime, and the PCC Release Governor. Each preserved browser surface also has a named `pnpm ui:smoke:*` command so a future update cannot pass by keeping source files while silently removing the executable proof path.

Chat-native Projects uses the PCC project ledger as its only project source of truth. The picker lists and creates projects through `pcc.projects.*`, while the selected project ID is stored on the canonical session entry through `sessions.create` or `sessions.patch`. There is no second Chat-only project database to drift from PCC.

Use these deterministic checks before staging an update:

```bash
pnpm check:pcc-capabilities
pnpm check:custom-runtime-capabilities
pnpm test src/pcc/custom-runtime-capabilities.test.ts src/pcc/runtime-identity.test.ts test/scripts/custom-runtime-launcher.test.ts test/scripts/custom-runtime-stage-promote.test.ts
```

`custom-runtime-stage.sh` runs the candidate against copied config and state on a private port; it does not modify the active pointer. `custom-runtime-promote.sh` updates the pointer and managed service only after staging, and restores the prior pointer, plist, and environment file if bootstrap or health proof fails.

This follows the same principles used by mature reliability programs: user-centered service objectives and error budgets, automation of repetitive toil, continuous evaluation, declarative desired state, and progressive delivery with rollback.

## Continuation receipt

The current execution branch is `codex/openclaw-operational-excellence-v1-20260713`. Resume with the first dependency-ready milestone that is not proof-complete. Never use a chat transcript as the only source of milestone state.

At each handoff, record:

- completed milestone IDs and exact proof,
- in-progress and blocked IDs with exact blockers,
- current branch and source identity,
- commands and artifacts,
- next dependency-ready milestone,
- weighted program completion.

### Current proof states

- **Locally proof-complete:** OE-00 through OE-08 after the targeted tests, typechecks, capability checks, canary test, and rollback test recorded for the final branch SHA pass.
- **Requires separate live or remote authority:** OE-09 remote CI, live immutable-runtime replacement, browser/mobile proof, bounded soak, and reconciliation activation.
- **Never implied by local proof:** OpenAI API access, a live Gateway configuration change, publication, reboot, or a paid model request.
