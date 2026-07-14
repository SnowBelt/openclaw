---
summary: "Capacity-aware PCC execution teams with one project profile, local-first routing, workspace leases, and proof-gated fan-in"
read_when:
  - You want multiple OpenClaw agents to work on one PCC project
  - You need to understand PCC Ultra, capacity, Codex roles, or workspace leases
title: "PCC Execution Teams"
sidebarTitle: "PCC Execution Teams"
---

PCC execution teams run explicitly independent project tasks in parallel while keeping one project-level execution profile as the source of truth. Every team also snapshots the [PCC Execution Standard](/automation/pcc-execution-standard), including its selected processes, skills, 93+ QA contract, judge gate, and bounded repair rules. `Ultra` is a team-speed preset, not a reasoning level and not permission to use Codex.

## Choose One Team Plan

Each project stores one canonical `pccExecutionProfile`:

| Preset        | OpenClaw work                | Codex role                    |
| ------------- | ---------------------------- | ----------------------------- |
| Focused       | One local worker at a time   | Off                           |
| Parallel      | Safe available local workers | Off                           |
| Ultra local   | Maximum safe local workers   | Off                           |
| Balanced      | Parallel local workers       | Approval-gated checkpoints    |
| Ultra + Codex | Maximum safe local workers   | One approval-gated Codex lead |

Fine-tuning the local model, Codex model, Codex depth, capacity policy, or approval scope edits this same profile. There is no second routing switch that can silently override it. A canonical profile takes precedence over legacy planner metadata.

`Ultra local` never invokes Codex. `Ultra + Codex` cannot start until the selected project has a usable scoped Codex permission grant. Codex depth uses `Medium`, `High`, `Very high`, or `Maximum`; it is not a token budget or a team-size control. `Maximum` is admitted only with a configured GPT-5.6 model, so an older saved model cannot silently downgrade the requested depth.

## Model Truth

The PCC model pickers use the live Gateway model catalog. They show configured available models and their prepared runtime classification. Removed or unavailable models remain visible only when needed to explain an existing saved choice and cannot be admitted for a new run.

The OpenClaw coordinator must use a non-Codex runtime. A Codex model can participate only in the profile's explicit Codex role. Refreshing the catalog bypasses the short UI cache.

## Capacity Governor

The Gateway reports a browser-safe snapshot derived from:

- logical CPU count and one-minute load;
- total and free RAM;
- configured subagent concurrency;
- active queued or running OpenClaw tasks.

PCC keeps headroom for the Gateway, caps teams at 12 local workers, reduces capacity under load or memory pressure, and stops admission when no safe slot remains. External local-model process occupancy is not yet portable across providers, so the displayed capacity is a CPU/RAM safety ceiling rather than a throughput guarantee.

## Task Admission And Coordination

A task is eligible only when it:

- is active, in progress, reopened, or not started;
- is assigned to OpenClaw/local work;
- has `metadata.parallelSafe: true`;
- has a non-empty `metadata.workspaceLock`;
- does not collide with another admitted workspace or a live lease from another loaded project.

PCC saves the versioned execution plan before dispatch. The plan records the project revision, profile snapshot, coordinator, deterministic partitions, worker assignments, two-hour workspace leases, proof requirements, transitions, and bounded audit events. One active team is allowed per project.

The coordinator receives only admitted assignments and the exact automatic execution-standard snapshot. It is instructed to load selected skills, use isolated subagents, serialize work that shares a lease, stop on ambiguity, and return structured fan-in evidence. It may not infer extra work, broaden Codex use, perform high-risk actions, award its own quality grade, or mark milestones complete.

## Stop, Fan-In, And Proof

`Stop agent team` aborts the coordinator and persists a cancelled plan. Saved history remains available. Failed dispatch persists a failed plan with the exact reason.

Fan-in distinguishes worker completion from PCC milestone completion. A canonical plan can be complete only after every partition succeeds, every required proof item is satisfied, all six quality dimensions meet 93, and the independent judge passes. Even then, PCC never auto-completes milestones; the owning workflow must review evidence and perform the explicit completion transition.

## Learning Boundary

Execution output may later support an evidence-bound recommendation through the [PCC Learning Loop](/automation/pcc-learning-loop). Learning remains recommendation-only: it cannot edit prompts, skills, workflows, models, source, or runtime settings without a separate reviewed implementation path.
