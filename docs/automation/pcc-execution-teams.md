---
summary: "Capacity-aware PCC execution teams with one project profile, local-first routing, workspace leases, and proof-gated fan-in"
read_when:
  - You want multiple OpenClaw agents to work on one PCC project
  - You need to understand PCC Ultra, capacity, Codex roles, or workspace leases
title: "PCC Execution Teams"
sidebarTitle: "PCC Execution Teams"
---

PCC execution teams run explicitly independent project tasks in parallel while keeping one project-level execution profile as the source of truth. Local work speed and Codex help are two independent parts of that profile. `Ultra` is a local-team speed preset, not a reasoning level and not permission to use Codex. Semantic project planning is a separate tool-free OAuth capability described in [PCC Codex Planning](/automation/pcc-codex-planning).

## Choose Local Work Speed

The first decision controls only OpenClaw local work:

| Local speed | OpenClaw work                                          |
| ----------- | ------------------------------------------------------ |
| Focused     | One local worker at a time                             |
| Parallel    | Independent local work runs together when safe         |
| Ultra       | Maximum safe local work with resource-governed backoff |

Changing local speed does not turn Codex on or off and cannot change a Codex checkpoint choice.

## Choose Codex Help

The second decision controls the checkpoints where Codex may provide a clear advantage:

| Codex policy        | Checkpoint behavior                                                                                                              |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| Local only          | Every post-plan checkpoint stays with local AI                                                                                   |
| Recommended minimum | Codex handles material replans and final review, and automatically helps with high-impact architecture or repeated local failure |
| More oversight      | Codex handles every defined post-plan checkpoint                                                                                 |
| Custom              | The user chooses Local AI, Codex, or Automatic independently for each post-plan checkpoint                                       |

`Recommended minimum` is the default. It keeps routine implementation local while using Codex for major replanning, difficult recovery, and final verification. `Automatic` means local AI remains the default and Codex is selected only for a high-impact change or after two documented local attempts fail. The decision records the checkpoint, selected executor, exact model, effort, reason, and whether approval is still required.

Initial project planning is controlled only by the separate planning-only OAuth policy. The project execution profile does not duplicate or override that authority. Its supported post-plan checkpoints are material replanning, architecture review, blocked recovery, and final review. A checkpoint is a review or planning gate, not an executable project milestone. Generated project milestones therefore default to OpenClaw local execution even when Codex planned them.

Fine-tuning the local model, Codex model, normal effort, maximum automatic effort, or approval scope edits the same canonical `pccExecutionProfile`. There is no second routing switch that can silently override it. A canonical profile takes precedence over legacy planner metadata.

Codex effort uses `Medium`, `High`, `Very high`, or `Maximum`; it is not a token budget or a team-size control. The normal effort is used for explicit Codex checkpoints. The maximum automatic effort is only a ceiling for an automatically escalated checkpoint. A configured project-scoped permission is still required before Codex execution.

## Model Truth

The PCC model pickers use the live Gateway model catalog. They show configured available models and their prepared runtime classification. Removed or unavailable models remain visible only when needed to explain an existing saved choice and cannot be admitted for a new run.

The OpenClaw coordinator must use a non-Codex runtime. A Codex model can participate only in the profile's explicit Codex role. Refreshing the catalog bypasses the short UI cache.

## Capacity Governor

The Gateway reports a browser-safe snapshot derived from:

- logical CPU count and one-minute load;
- total and free RAM;
- configured subagent concurrency;
- active queued or running OpenClaw tasks.

PCC keeps headroom for the Gateway, reduces capacity under load, memory, or thermal pressure, and stops admission when no safe slot remains. PCC does not add a fixed worker cap: the current OpenClaw concurrency configuration and measured host headroom are the safety bounds. Provider-owned residency probes account for loaded local-model processes when available; missing residency telemetry is shown as a warning instead of guessed.

## Task Admission And Coordination

A task is eligible only when it:

- is active, in progress, reopened, or not started;
- is assigned to OpenClaw/local work;
- has `metadata.parallelSafe: true`;
- has a non-empty `metadata.workspaceLock`;
- does not collide with another admitted workspace or a live lease from another loaded project.

PCC saves the versioned execution plan before dispatch. The plan records the project revision, profile snapshot, coordinator, deterministic partitions, worker assignments, two-hour workspace leases, proof requirements, transitions, and bounded audit events. One active plan is allowed per project.

The Dashboard uses the Gateway-owned `pcc.execution.start`, `pcc.execution.get`,
`pcc.execution.pause`, and `pcc.execution.stop` methods for supervised work. Start
is revision-checked and idempotent: PCC commits the plan and its idempotency key
before dispatching the verified local coordinator. If the coordinator cannot be
admitted, PCC leaves a truthful blocked or failed result rather than showing a
project as working. Pause and stop attempt to abort the named run before saving
the durable state; a failed control attempt is recorded as blocked for recovery.

The coordinator receives only admitted assignments and is instructed to use isolated subagents, use each assignment's recorded local model, serialize work that shares a lease, stop on a model mismatch or ambiguity, and return structured fan-in evidence. PCC prefers a configured `program_manager` agent for coordination and falls back to the default local OpenClaw agent when that role is unavailable. It may not infer extra work, silently substitute models, broaden Codex use, perform high-risk actions, or mark milestones complete.

## Stop, Fan-In, And Proof

`Stop agent team` aborts the coordinator and persists a cancelled plan. Saved history remains available. Failed dispatch persists a failed plan with the exact reason. A browser reload or closure does not erase a plan because its lifecycle is stored in the Gateway-owned PCC ledger. Terminal lifecycle events reconcile accepted, completed, failed, cancelled, and lost work and create an idempotent model-run receipt from the actual terminal event. Provider usage is recorded when reported; otherwise the receipt explicitly says usage is unavailable. Historical model-run data is never inferred from project progress.

Each terminal run also produces a `pending_review` proof candidate containing only the
worker's reported summary, changed files, checks, blockers, and risks. Operators can
accept or reject that candidate through `pcc.execution.review`; acceptance only makes
the result available for a later milestone review and never completes a milestone or
creates a completion receipt. The project AI-use card reports attempted, succeeded,
failed, and cancelled terminal runs separately from milestone percentage.

Fan-in distinguishes worker completion from PCC milestone completion. A plan can be complete only after every partition succeeds and every required proof item is satisfied. Even then, PCC never auto-completes milestones; the owning workflow must review evidence and perform the explicit completion transition.

## Learning Boundary

Execution output may later support an evidence-bound recommendation through the [PCC Learning Loop](/automation/pcc-learning-loop). Learning remains recommendation-only: it cannot edit prompts, skills, workflows, models, source, or runtime settings without a separate reviewed implementation path.

## Legacy Metadata Repair

Older project plans may contain the producer-only `pccParallelSafe` flag or lack a
logical workspace lease. `openclaw doctor --fix` and the PCC canonical-metadata
repair surface report exact record IDs with issue codes and may add only the
canonical `parallelSafe` and deterministic `workspaceLock` values when the
record is already local, independent, and explicitly marked safe. The repair
preserves milestone content and progress, does not create proof, and never
rewrites a historical completion receipt.
