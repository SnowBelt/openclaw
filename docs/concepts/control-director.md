---
summary: "Role-scoped conversational control plane for responsive delegation, durable goals, evidence-gated completion, and Codex-like Dashboard Chat"
title: "Control Director"
read_when:
  - You want a responsive coordinator that delegates long-running work
  - You are configuring Pursue Goal, queue and steer, or Control Director memory
  - You need to understand the Control Director, PCC, Judge, SIG, or Codex boundary
---

The Control Director is OpenClaw's role-scoped conversational control plane. It keeps a user-facing conversation responsive while durable workers perform long-running work. It acknowledges accepted input, preserves the original mission, delegates through least-privilege roles, condenses progress into Chat, and delivers a final answer only when the evidence supports it.

The role is activated only by explicit configuration. A display name such as “Control Director,” an agent id, a persona, or a selected model never grants Control Director behavior.

```json5
{
  agents: {
    list: [
      {
        id: "director",
        role: "control_director",
        model: {
          primary: "ollama/openclaw-control-gemma4-31b-q8:latest",
          fallbacks: ["ollama/qwen3.6:27b-q8_0"],
        },
      },
      { id: "program-manager", role: "program_manager" },
      { id: "independent-judge", role: "judge" },
    ],
  },
}
```

## Responsibility boundaries

Each surface has one owner so status, authority, and proof do not drift:

| Component         | Owns                                                                                                        | Does not own                                                       |
| ----------------- | ----------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| Control Director  | Intake, clarification, durable acknowledgement, routing, condensed status, user control, and final delivery | Unbounded direct implementation or independent completion approval |
| Program Manager   | Executable decomposition, dependencies, worker dispatch, and evidence fan-in                                | User-facing conversation or independent judging                    |
| Project Manager   | Bounded execution and milestone state for an assigned project                                               | Platform-wide routing or SIG governance                            |
| Workers           | Scoped implementation and evidence production                                                               | Mission reinterpretation or completion declaration                 |
| Independent Judge | Read-only evidence review and a signed claim-bound receipt                                                  | Performing or repairing the work being judged                      |
| PCC               | Explicit plans, milestones, dependencies, and evidence                                                      | Chat transcript ownership or prose-derived execution state         |
| SIG               | Recurring systemic failure detection, recommendation routing, and proof-backed closure governance           | Silent code changes, deployment, or self-approval                  |
| System Quality    | Detailed Judge, SIG, canary, and diagnostic evidence                                                        | Static obstruction of the Chat transcript or composer              |

Chat and PCC are intentionally separate. Chat may attach to or open an explicit PCC plan, but ordinary assistant prose cannot create, complete, or rewrite PCC milestones. Execution state is a typed, read-only projection of the orchestrator rather than a second PCC state store.

### Judge MVP contract

The Judge is a technical verifier, not an ethics or morality reviewer. It evaluates only completion, direct evidence, authorization, integrity, and operational invariants. Requests to decide whether something is moral, ethical, political, value-based, socially good, or socially bad return `OUT_OF_SCOPE` and never become an approval decision.

The executable contract is centralized in `src/agents/judge-contract.ts`:

- deterministic gates run first; deterministic blocks do not invoke a model;
- new decisions issue signed V2 receipts while V1 receipts remain readable;
- a model turn uses one physical request with an empty tool list, `tool_choice: "none"`, `parallel_tool_calls: false`, and the closed V2 JSON schema;
- the independently qualified local Judge is preferred (Qwen 3.8 27B Q8, MTP off); GPT-5.6 is the hosted fallback, and GPT-5.5 is not a Judge route;
- missing route, model, request-count, or zero-tool evidence fails closed; completion requires the exact claim-bound signature and V2 execution proof.

The Judge can read supplied evidence and inspect goal state, but it never executes work, mutates state, delegates, messages, grants approvals, or treats worker prose as proof.

### Executable delegation handoffs

Operational delegation uses one fail-closed contract rather than role names in prose:

- every execution-capable orchestrator has both `agents_list` and `sessions_spawn` in the same effective capability budget;
- `agents_list` returns only configured, allowlisted targets and includes each target's accepted handoff kinds and mutation boundary;
- Control Director may hand off only `coordination` work to Program Manager, with `requiresMutation: false`;
- Program Manager may hand off only `implementation` work to workers, with an explicit and honest `requiresMutation` value;
- Judge accepts only `verification` work and never mutation;
- workers cannot reinterpret the mission, expand scope, self-approve, or delegate unless a separate assignment contract explicitly grants it;
- PCC accepts typed plan, milestone, dependency, approval, and evidence commands only; SIG accepts typed systemic-defect signals and proof-bound closure evidence only.

Every operational-role call to `sessions_spawn` includes a typed `handoff` object. A missing or incompatible handoff is rejected before either a native or ACP worker launches. Rejected spawns include a caller-performable recommended action that does not assume the caller has another tool.

The active run's real cwd is the trusted task root. Both native and ACP workers inherit that same canonical root. An explicit `cwd` can narrow the worker to an existing real descendant but cannot replace the root or escape it through `..` or a symlink. The result reports only a versioned root fingerprint and source/scope classification; raw task paths are not diagnostic output.

### Evidence-bound diagnostics

Completion, blocker, worker, and task-root statements are runtime claims, not transcript summaries. OpenClaw builds them from typed task state, Pursue Goal state, signed Judge receipts, or sanitized spawn receipts and verifies each claim independently. Evidence must match the exact mission or worker subject and its claim hash, agent id, or task-root fingerprint. It must also have a durable source id and a current observation window; unavailable, unsupported, older than five minutes, future-dated, expired, or mismatched evidence is rejected rather than displayed as fact.

A completion claim still requires the independent Judge's valid signed receipt for the exact mission and claim hash. A terminal blocker still requires the same blocker to survive the configured repeated-confirmation threshold. Worker and task-root diagnostics expose only bounded ids and fingerprints, never raw filesystem paths or model prose.

## Responsive Chat contract

An accepted turn receives a durable run identity and visible acknowledgement before long work begins. The server owns the mutable turn inbox and outbox, so a browser refresh or second client cannot lose or duplicate the turn.

The Chat transcript remains the primary surface on desktop, tablet, and mobile:

- activity is condensed inline and can be expanded when detail is useful;
- Project, Pursue Goal, PCC, and System Quality are compact controls or destinations, not static blocks between transcript and composer;
- recent sessions are immediately visible, receive content-derived titles, and support pin and rename;
- the composer remains available while delegated work runs;
- a no-response watchdog produces an honest continuing or specific-blocker delivery instead of silence.

A compact **System ready** disclosure reports exact runtime lineage, execution health, and recent-memory freshness without inserting a static diagnostic panel into the transcript. Detailed Judge and SIG evidence remains on System Quality.

### Queue and steer

New input can be sent as either:

- **Queue**: preserve the current run and process the input next; or
- **Steer**: apply the input to the active mission as soon as the server admits it.

A pending input may switch from queue to steer or steer to queue until server admission closes. Revision and idempotency checks make that mutation safe across refreshes and multiple clients. Once admission has closed, the server rejects late mutation instead of pretending it was applied.

## Pursue Goal

Pursue Goal is a durable orchestration mode, not a long model turn. A running goal has a lease, heartbeat, controller, next action, worker correlation, and terminal-delivery obligation. The user can create, edit, pause, resume, stop, retry, inspect, and later return to the goal without surrendering the conversation lane.

If the Gateway restarts or a worker disappears, the reconciler resumes safe work or moves the goal to an honest terminal state. The UI must never show `running` when no current lease/controller owns the goal.

## Local-first model policy and Codex

The recommended conversational default is the local `ollama/openclaw-control-gemma4-31b-q8:latest` model. Safe alternatives come from the active model configuration and may be selected without changing role authorization.

Local providers may expose a bounded, read-only residency probe. The resource governor combines that provider-owned fact with CPU load, free unified memory, thermal pressure, active work, and concurrency. It never unloads an active model, and unavailable residency telemetry fails safe rather than guessing.

When the configured provider supports it, the Gateway schedules a separate post-ready warmup for the selected Control Director model. The shared resource governor must admit the load first; startup warmup never evicts another model, never pulls a missing model, never delays Gateway readiness, and is cancelled during shutdown. Ollama uses an empty `/api/generate` request with a 15-minute initial idle lifetime, then OpenClaw verifies the exact model through `/api/ps`. Ordinary inference requests retain their configured `keep_alive`, so an inactive Control Director does not reserve unified memory indefinitely. Set `OPENCLAW_SKIP_STARTUP_MODEL_PREWARM=1` to disable both startup metadata and resident-model warmup.

Hosted Codex should not be the silent conversational default. Local deterministic and local-model lanes are usually better for acknowledgement, status, recent-memory recall, routing, ordinary conversation, and routine coordination. This keeps latency, resource use, and hosted token consumption bounded.

Use Codex as a governed implementation and review capability:

- send a compact typed mission packet instead of the full transcript;
- include the goal, constraints, approvals, state, evidence, acceptance criteria, and budget;
- require explicit approval for hosted or otherwise paid execution;
- attribute the route and fail closed when it is unavailable;
- use GPT-5.6 Luna with max reasoning for approved complex implementation;
- escalate to GPT-5.6 Sol with high reasoning for difficult architecture, debugging, security, or final independent review;
- use low reasoning only for deterministic runbooks with exhaustive automated verification.

This hybrid pattern lets the local model remain responsive while Codex is used where its incremental quality is measurable.

## Memory and context continuity

Control Director continuity uses tiers instead of repeatedly injecting the whole history:

1. **Hot**: recent turns, active missions, approvals, decisions, and current task state.
2. **Warm**: project and session summaries plus recent-task indexes with provenance.
3. **Cold**: compact older history that remains searchable and rebuildable.

Recent context is assembled automatically before the first reply. [Active memory](/concepts/active-memory) has a separate fail-fast Control Director timeout so a slow recall cannot hold the primary response indefinitely. Compaction preserves the immutable mission, decisions, approvals, work state, evidence references, and recent turns before trimming lower-value transcript detail.

For ordinary Control Director turns, bounded hot task/session state is deterministic and does not launch a second recall model. Model-backed Active Memory is reserved for explicit recall prompts and has a two-second Control Director work budget. This avoids competing with the primary local model while preserving deeper searchable recall when the user actually asks about prior work.

Increasing the raw context window alone is not the preferred fix. A larger window can increase latency and still preserve irrelevant tool output. Typed mission state, bounded recent recall, deterministic compaction, and searchable cold history provide more durable continuity.

## Quality and self-improvement

User-journey failures such as silence, an activity gap, a stalled goal, a recent-memory miss, layout obstruction, title failure, queue race, terminal-delivery miss, proofless completion, or runtime-lineage mismatch emit typed SIG evidence. Server-owned paths observe runtime failures directly. The Dashboard reports only a closed layout reason plus bounded geometry; the Gateway revalidates those measurements and never promotes arbitrary browser prose into trusted evidence. Truth and Completion presence is reported separately from obstruction, so the intentional collapsed transcript diagnostic remains visible without creating a false layout incident; older clients that omit the additive obstruction measurement remain fail-closed. SIG groups recurrence and assigns an owner and SLA. Closure requires exact proof, an observation window, and an independent signed Judge receipt; recurrence reopens the recommendation and marks old proof stale.

Automatic repair is limited to allowlisted, reversible actions with an attempt bound, cooldown, evidence, and rollback reference. Repeated failure escalates instead of creating an autonomous repair loop.

The independent Judge is deliberately separate from the Control Director and workers. It validates the immutable mission against observed evidence and signs the exact claim it approved. A plan, progress update, plausible prose answer, or worker self-report is not completion evidence by itself.

The M62-M68 orchestration repair lane begins with a deterministic, sanitized reproduction baseline for missing task roots, workspace mismatches, unavailable worker discovery, self-spawn, role-capability conflicts, and unsupported completion claims. Later milestones repair those contracts in dependency order and finish only after the landed exact SHA completes managed Control Director-to-Program Manager-to-worker-to-Judge execution together with live device, restart, rollback, and soak proof.

## Managed role activation and rollback

The runtime role graph must be applied through the transactional helper rather than by manually editing agent entries. The helper controls only role, delegation, and role-tool fields; preserves unrelated configuration; writes an atomic state record; creates a timestamped backup before every operation; and refuses to overwrite controlled fields that changed outside the helper.

After activating a candidate that supports the role schema:

```bash
runtime_home="${OPENCLAW_CUSTOM_RUNTIME_HOME:-$HOME/.openclaw-custom-runtime}"
"$runtime_home/bin/control-director-role-config.py" apply
"$runtime_home/bin/custom-runtime-launcher.sh" config validate
"$runtime_home/bin/custom-runtime-restart.sh" --port 18789
"$runtime_home/bin/custom-runtime-launcher.sh" gateway status --deep
```

The Director delegates only to the Program Manager. The Program Manager delegates only to the curated worker set and receives worker results through the subagent announce/fan-in path; it does not need `sessions_send`. The Judge receives read-only evidence and goal-inspection tools while goal mutation, delegation, and direct execution remain denied.

When rolling back to a runtime that predates the role schema, restore the baseline fields before changing the runtime pointer:

```bash
runtime_home="${OPENCLAW_CUSTOM_RUNTIME_HOME:-$HOME/.openclaw-custom-runtime}"
"$runtime_home/bin/control-director-role-config.py" remove
"$runtime_home/bin/custom-runtime-launcher.sh" config validate
# Run the managed custom-runtime rollback here.
"$runtime_home/bin/custom-runtime-launcher.sh" gateway status --deep
```

If the new candidate is restored after a rollback drill, run `apply`, validate the config, and restart once more. Never bypass a helper refusal: inspect the current config and its backup/state receipts, reconcile the out-of-band edit, and then retry.

When an explicitly authorized operator change has left the controlled role fields
different from both the recorded baseline and applied contract, use the helper's
auditable reconciliation operation instead of editing the config or state file:

```bash
"$runtime_home/bin/control-director-role-config.py" reconcile
```

`reconcile` snapshots the stale state, records the current controlled fields as
the rollback baseline, reapplies the role contract, and preserves all unrelated
configuration. It refuses to run when there is no state record or no actual
controlled-field drift.

## Verification and readiness

Source acceptance from a clean immutable checkout:

```bash
pnpm control-director:torture
pnpm control-director:chaos
pnpm control-director:subagent-incident-proof
pnpm custom-runtime:update-survival
pnpm control-director:verify -- --expected-sha "$(git rev-parse HEAD)"
pnpm ui:smoke:control-director-no-response
```

`control-director:verify` runs the curated source, protocol, plugin, and UI tests, script lint, required typechecks, production build, and source-only readiness sequentially. Its ignored receipt is written under `.artifacts/control-director/`.

Source acceptance is not production acceptance. A production claim also requires exact managed-runtime lineage, explicitly enabled managed SIG background processing, the selected model and runtime process, a matching Dashboard canary, a safe live diagnostic, desktop, tablet, and mobile proof, restart recovery, at least a five-minute soak, and a rollback-and-restore drill. Run `control-director:readiness` with both the source-gate receipt and runtime-proof receipt; it fails closed if any critical surface is absent or refers to another SHA.

Assemble the production receipt from separate exact-SHA evidence files instead of hand-editing a passing boolean:

```bash
pnpm control-director:runtime-proof -- \
  --source-sha "$SHA" --lineage lineage.json --model-eval model-eval.json \
  --desktop desktop.json --tablet tablet.json --mobile mobile.json \
  --restartRecovery restart.json \
  --soak soak.json --rollback rollback.json --liveDiagnostic live.json \
  --output runtime-proof.json
```

The assembler hashes every input, requires timestamps and evidence references, rejects a soak shorter than five minutes, and refuses mismatched source SHAs or incomplete cold/warm model-evaluation coverage.

For a milestone program, the roadmap's `passed` fields are not sufficient by themselves. Bind the final committed ledger to the clean source gate, managed runtime proof, all-job remote gates, and production-readiness scorecard after the final SHA is landed and active:

```bash
pnpm control-director:roadmap-proof -- \
  --source-sha "$SHA" \
  --roadmap work/control-director/reliability-v1/roadmap.json \
  --source-proof ".artifacts/control-director/source-gates-$SHA.json" \
  --update-survival ".artifacts/control-director/update-survival-$SHA.json" \
  --runtime-proof ".artifacts/control-director/runtime-$SHA/runtime-proof.json" \
  --remote-proof ".artifacts/control-director/remote-gates-$SHA.json" \
  --readiness ".artifacts/control-director/runtime-$SHA/readiness.json" \
  --output ".artifacts/control-director/final-ledger-$SHA.json"
```

The final-ledger command rejects a dirty or mismatched checkout, any milestone from M01 through M86 not implemented and marked `passed`, contradictory implementation and certification state, missing milestone evidence, a quality score below 93, partial CI, a non-exact landing, an invalid update-survival proof, or an incomplete managed-runtime truth surface. The official completion percentage is certification coverage; implementation coverage is reported separately so source progress remains visible without being confused with exact-SHA runtime certification. M61 requires every Dashboard and custom capability to survive an exact-parent official-update candidate with monotonic capability/path preservation, proof-bound approval, and loaded prepare-only weekly broker and recovery guard. M69-M86 add canonical lineage, automatic proof, one-shot blocker enumeration, lifecycle arbitration, lease provenance, legacy evidence audit, candidate freeze, and final managed-runtime certification. The ledger independently rechecks each strict runtime contract, timestamped evidence, exact selected-model route and cold/warm task coverage, canary lineage, soak duration, and the all-passed readiness fact ledger instead of trusting summary booleans. This post-commit receipt avoids the impossible and unsafe pattern of embedding a Git commit's own SHA inside that commit.

The remote-gates input uses `openclaw.control-director-remote-gates.v1`. It must retain each Workflow Sanity and non-Android CI run ID, run URL, checked timestamp, evidence references, exact head SHA, and complete job ledger. Every job must be completed with an accepted conclusion, and the landing record must name the exact merged SHA, pull request, merge timestamp, and evidence reference. Summary counts without the underlying job ledger are rejected.

## Questions to ask during a reliability review

- Did the server persist an acknowledgement, or did only the browser optimistically render one?
- Which durable owner currently holds the goal lease and heartbeat?
- Can the user still chat, pause, stop, queue, or steer while work runs?
- Is status projected from typed execution state or guessed from assistant prose?
- Did recent memory miss, time out, conflict, or lack provenance?
- Does the selected model satisfy measured quality and resource thresholds for this route?
- Is the Judge independent, and is its receipt bound to the exact mission and evidence?
- Could SIG detect this failure before a user reports it, and what proof would close it?
- Does the active Dashboard report the exact landed source and UI artifact?
- Have restart, multi-client mutation, duplicate delivery, soak, and rollback been tested rather than assumed?

These questions expose the common gap between code that exists and a system that is actually responsive, durable, and proven in production.
