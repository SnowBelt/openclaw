---
summary: "Versioned capability routing, quality gates, and upgrade preservation for PCC work"
read_when:
  - You want PCC to select workflows, skills, software, tools, plugins, agents, models, permissions, and proof automatically
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
2. required and preferred processes, skills, software, tools, plugins, agents, and models,
3. local-first route and paid-capacity escalation reason,
4. permission scope and budget,
5. exact proof surfaces,
6. independent QA and quality dimensions,
7. completion-receipt and learning requirements.

Required external capabilities fail closed when current inventory cannot prove availability. Preferred capabilities may use an equivalent fallback only when the reason is recorded. Built-in process and proof requirements remain planned until a completion receipt proves they were used.

PCC builds that inventory from the existing runtime truth surfaces rather than maintaining a second registry. Agent and model rows come from the loaded Control UI catalogs, skills and required command-line software come from `skills.status`, and core tools plus their owning plugins come from `tools.catalog`. Project metadata can declare `pccRequired*` or `pccPreferred*` entries for skills, software, tools, plugins, agents, models, and processes. Required entries remain blocked until the corresponding live catalog proves them available.

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

## Production excellence successor

The OE roadmap established the capability contract and update-preservation control plane. The
audited production gaps continue in `src/pcc/production-excellence-roadmap.ts`. That successor
program is also machine-readable, dependency ordered, and weighted to 100 points.

Update durability is first:

| ID    | Milestone                                                     | Weight |
| ----- | ------------------------------------------------------------- | -----: |
| PE-00 | Exact-runtime baseline and reliability freeze                 |      2 |
| PE-01 | Durable source provenance                                     |      8 |
| PE-02 | Bounded customization inventory and overlay extraction        |      9 |
| PE-03 | Automated upstream canary and semantic preservation gate      |      7 |
| PE-04 | Storage containment, retention, and approved reclamation      |      4 |
| PE-05 | Capability availability and health truth model                |      4 |
| PE-06 | Secrets, plugin, provider, and tool-policy hygiene            |      6 |
| PE-07 | Exact-SHA full-CI closure                                     |      6 |
| PE-08 | TaskFlow and cron lifecycle reconciliation                    |      7 |
| PE-09 | Agent consolidation and capability catalog                    |      5 |
| PE-10 | PCC canonical project, decision, and permission ledger        |      6 |
| PE-11 | Local-first routing and model certification                   |      7 |
| PE-12 | Dynamic context and retrieval quality                         |      4 |
| PE-13 | Golden-task evaluation, SLOs, and error budgets               |      6 |
| PE-14 | Codex-like Chat and progressive-disclosure UX                 |      6 |
| PE-15 | UI modularity and performance budgets                         |      5 |
| PE-16 | Unified observability and automatic incident intake           |      4 |
| PE-17 | Paper-only profit and risk evidence                           |      1 |
| PE-18 | Production proof, rollback drill, soak, and usability closure |      3 |

The sequence does not treat the prior operational-excellence source work as failed. It records the
new evidence-backed gaps that must close before the current customized system can claim production
completion. Deletion, live promotion, restart, reboot, paid access, publication, and live-money
proof remain separate explicit approval gates. PE-18 is a non-weighted veto in addition to its
three-point planning weight: production cannot be claimed without it. PE-17 remains a paper-only
domain program and does not block the general production closure gate.

PE-00 applies the existing structured permission and local-first constraints immediately. PE-10
and PE-11 productize those controls later; they do not postpone safe execution until midway through
the program.

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

## Performance and scale contract

PCC treats portfolio reads and rendering as bounded production paths rather than unmeasured dashboard work. The Gateway builds one immutable read index per ledger snapshot, so project summaries reuse grouped milestone, sub-milestone, permission, evidence, receipt, decision, and last-known-good relationships instead of rescanning every ledger collection for every project. Capability preflight similarly builds one case-insensitive inventory index while preserving first-match behavior for duplicate catalog entries.

The Control UI bounds its long-session project-detail cache to 32 recent entries while pinning the selected project and Project Command Center, reuses bounded status and date formatters, and keys project and sub-milestone cards by stable ID. These changes preserve active context, all rows, and all interactions while preventing unbounded cache growth and reducing repeated computation, DOM replacement, and temporary allocation.

Run the deterministic scale budget locally with:

```bash
pnpm ui:smoke:pcc-performance
```

The smoke uses a 600-project portfolio, 14,400 milestones, 1,000 required capabilities, and a 6,000-entry capability inventory. It fails when Gateway summary latency, capability resolution, template generation, initial DOM creation, rerendering, search rendering, or retained heap exceeds its checked budget. The Workflow Sanity operational-excellence lane runs the same command so future additions cannot silently restore quadratic scans.

## Clean architecture map

PCC uses an inward dependency direction so storage, transport, and browser concerns cannot become the source of business rules:

```text
src/pcc/
  domain/
    capability-contract.ts      # stable capability contract vocabulary
    completion-policy.ts       # status and completion invariants
    ledger.ts                  # storage-independent aggregate contract
    workflow.ts                # workflow identity contract
  read-model/
    ledger-index.ts            # immutable relationship index per snapshot
    project-summary.ts         # project and portfolio projections
  ledger-store.ts              # SQLite/JSON infrastructure adapter

src/gateway/server-methods/
  pcc.ts                       # protocol validation and use-case orchestration

ui/src/ui/pcc/
  application/
    state.ts                   # UI state and form contracts
    detail-cache.ts            # bounded selected-project cache policy
    execution-readiness.ts     # pure execution-team readiness use case
  presentation/
    formatters.ts              # bounded display formatting

ui/src/ui/
  controllers/pcc.ts           # mutation orchestration and compatibility facade
  views/pcc.ts                 # Lit composition and event binding
```

Domain modules import protocol types only. Read models depend on the domain, never on Gateway handlers or storage. Gateway methods validate requests and coordinate domain/read-model operations. UI application modules own state and deterministic use cases; presentation imports those modules directly instead of importing a controller facade. The facade keeps existing callers stable while new code follows the narrower boundaries. This permits storage replacement, isolated policy tests, and incremental view decomposition without changing PCC behavior.

PCC and Self-Improvement Governor ledger data operations use compile-checked Kysely builders. Native SQLite calls are confined to shared connection, schema, transaction, integrity, WAL, and PRAGMA lifecycle boundaries. The architecture gate rejects import cycles, direct layer reversals, and unreviewed raw SQLite access.

## Update preservation

Custom functionality must be declared, versioned, and tested as desired state. An official update is first staged in an isolated candidate runtime. The candidate must pass manifest, migration, plugin, route, workflow, browser, runtime, and rollback checks before atomic promotion. Missing custom features reject the candidate before the live runtime changes.

The desired-state inventory is `config/custom-runtime-capabilities.json`. It covers dashboard surfaces, required plugins, PCC workflows, Control Director truth gates, local-first model intelligence, and the update-safety control plane. Every capability has a stable ID and one or more required runtime paths. The v2 preservation contract also binds required criticality, preserve-or-block migration, immutable-pointer rollback, verification commands, and the checked addition-standards registry. The immutable runtime pointer binds the capability manifest hash and the cumulative required capability IDs. Candidates may add capabilities, but cannot silently remove an active requirement.

The current inventory contains 34 preserved capabilities. It includes all seven app dashboards, both required plugins, PCC project management and operational excellence, Control Director truth gates, local-first model intelligence, the complete Codex-style Chat stack, mobile PCC control, PCC-to-Chat synchronization, Chat UX cleanup, the cumulative Codex-plus-apps dashboard, update-safe customizations, Operations Room, Control Director Codex Chat, the Self-Improvement Governor runtime, and the PCC Release Governor. Each preserved browser surface also has a named `pnpm ui:smoke:*` command so a future update cannot pass by keeping source files while silently removing the executable proof path.

Chat-native Projects uses the PCC project ledger as its only project source of truth. The picker lists and creates projects through `pcc.projects.*`, while the selected project ID is stored on the canonical session entry through `sessions.create` or `sessions.patch`. There is no second Chat-only project database to drift from PCC.

Use these deterministic checks before staging an update:

```bash
pnpm check:pcc-capabilities
pnpm check:custom-runtime-capabilities
pnpm test src/pcc/custom-runtime-capabilities.test.ts src/pcc/runtime-identity.test.ts test/scripts/custom-runtime-launcher.test.ts test/scripts/custom-runtime-stage-promote.test.ts
```

`custom-runtime-stage.sh` runs the candidate against copied config and state on a private port; it does not modify the active pointer. The weekly broker prepares and proves a candidate but stops at `ready_for_approval`. `custom-runtime-update-approve.sh` promotes only that exact candidate after explicit approval. `custom-runtime-promote.sh` updates the pointer and managed service only after staging, and restores the prior pointer, plist, and environment file if bootstrap or health proof fails. See [Custom Runtime Update Safety](/automation/custom-runtime-update-safety) for the complete operator flow.

This follows the same principles used by mature reliability programs: user-centered service objectives and error budgets, automation of repetitive toil, continuous evaluation, declarative desired state, and progressive delivery with rollback.

## Continuation receipt

The successor execution branch is `codex/update-durability-v1-20260723`, based on active runtime
source SHA `d05347471845b0978be1b2bdc82f136d69391f2c`. Resume with the first dependency-ready
milestone that is not proof-complete. Never use a chat transcript as the only source of milestone
state.

At each handoff, record:

- completed milestone IDs and exact proof,
- in-progress and blocked IDs with exact blockers,
- current branch and source identity,
- commands and artifacts,
- next dependency-ready milestone,
- weighted program completion.

### Current proof states

- **Inherited baseline:** OE-00 through OE-08 remain the established local capability and
  preservation baseline. Their prior proof does not substitute for successor exact-SHA proof.
- **PE-00 in local proof:** the active source, runtime release, divergence, customization inventory,
  retention plan, storage inventory, and update-safety state are captured without mutation.
- **PE-01 in local proof:** durable-source policy, migration, rollback, exact candidate provenance,
  remote evidence freshness, broker validation, and lifecycle coordination are implemented and
  tested. It remains incomplete until exact-SHA remote proof passes and the active pointer is
  migrated to a durable source/ref under explicit approval.
- **PE-02 partial:** deterministic inventory reports 1,949 changed paths and 664 manual
  classifications. Overlay extraction and complete owner/capability coverage remain incomplete.
- **PE-04 partial:** dry-run retention and bounded storage inventory are implemented. No release,
  bundle, worktree, receipt, ref, or Git object has been quarantined or deleted.
- **Not started:** PE-03 and PE-05 through PE-18 remain dependency ordered in the machine-readable
  roadmap.
- **Never implied by local proof:** source-ref publication, active-pointer mutation, destructive
  reclamation, live Gateway changes, OpenAI API access, restart, reboot, paid access, or live-money
  execution.
