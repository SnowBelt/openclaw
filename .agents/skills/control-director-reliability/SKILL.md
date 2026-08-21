---
name: control-director-reliability
description: Build, test, promote, or diagnose the role-scoped OpenClaw Control Director, Codex-like Chat, Pursue Goal, memory, PCC boundary, Judge, and SIG reliability contract.
---

# Control Director Reliability

Use this skill for any Control Director, Todd Stanski, Codex-like Dashboard Chat, Pursue Goal, queue/steer, recent-memory, no-response, PCC overlap, Judge, or SIG reliability work.

## Non-negotiable architecture

- Scope the Control Director only by `agents.list[].role: "control_director"`. Never authorize by id, display name, persona, or selected model.
- Keep the Control Director conversational and responsive. It owns intake, clarification, status condensation, routing, and final delivery; it delegates mutating work by default.
- The Program Manager owns executable decomposition, dependency-aware dispatch, worker fan-out, and evidence fan-in.
- The Project Manager owns bounded project execution and milestone state inside an assigned project.
- The independent Judge receives the immutable mission plus evidence, has read-only inspection capability, and signs a claim-bound receipt. It never performs the work it judges.
- SIG detects recurring systemic failures, routes recommendations, and governs proof-backed closure. It cannot silently modify, deploy, or close production work.
- Chat owns conversation, input admission, inline activity, and compact controls. PCC owns explicit plan records and evidence. System Quality owns Judge, SIG, canary, and diagnostic detail. Never infer PCC state from assistant prose.
- Use one production Chat implementation. Do not create a parallel Chat page or duplicate state store.

## Judge MVP quick contract

Keep every Judge handoff on this short path; the executable contract in `src/agents/judge-contract.ts` is authoritative:

1. Judge only completion, direct evidence, authorization, integrity, and operational invariants. Moral, ethical, political, value, and social-good questions return `OUT_OF_SCOPE`.
2. Run deterministic checks first. A deterministic block never invokes a model.
3. Prefer the independently qualified local Judge route (Qwen 3.8 27B Q8, MTP off). Use GPT-5.6 as the hosted fallback; never route Judge work to GPT-5.5.
4. A model turn is one request with `tools: []`, `tool_choice: "none"`, `parallel_tool_calls: false`, and the closed V2 JSON schema. Missing or drifted execution evidence fails closed.
5. Issue V2 signed receipts for new decisions; keep V1 receipts readable. A completion needs a claim-bound signature plus one-request, known-route, zero-tool proof.
6. The Judge reads evidence and inspects goal state only. It never executes, mutates, delegates, messages, approves tools, or declares completion from prose alone.

## Operations Room truth contract

- Treat activity, health, and attention as separate facts. An agent may be working and still need
  attention; never flatten that into one color or status.
- Never display work as current unless its task or workflow is active. Terminal work is last activity
  or history, and `running` requires a live owner, active task, or explicit waiting state.
- Compute exact aggregates before row limits. Every bounded collection must expose total, shown, and
  truncated state instead of presenting a cap as the total.
- Treat snapshot time, source freshness, and source completeness as operational facts. A stale,
  partial, or failed required source can never produce an unconditional healthy state.
- Treat `operations.snapshot.v2` as authoritative. Preserve the exact V1 wire contract and use it in
  the Control UI only after an explicit unsupported-method response; never hide a real V2 failure
  behind fallback. The adapted V1 view is always Partial and unverified.
- Do not resolve an incident merely because its source disappeared. Carry unresolved findings as
  Last known until the category is authoritatively observed without the issue.
- Separate monitor attempts from successful sweeps. Stopped, never-successful, stale, and
  latest-attempt-failed states must fail closed without fabricating sweep timestamps.
- Treat rejected process rows as partial source evidence, an entirely rejected or empty probe as
  unavailable, and an intentionally omitted probe as omitted. Never expose process arguments.
- Restore task and TaskFlow registries through staged atomic replacement. An initial restore failure
  blocks writes; retry failure preserves the last complete authoritative state.
- Build the concise briefing deterministically from structured facts. A model may not replace or
  contradict the canonical briefing, counts, issue ownership, or next action.
- Use generic task contracts for display and rollup: `label`, `progressSummary`, `terminalSummary`,
  `taskKind`, and `sourceId`. Do not parse raw prompts or add plugin-specific Operations imports.
- Separate Needs you, OpenClaw is handling it, Watching, and History. Every actionable issue needs
  impact, response owner, response state, last progress, next action, and next check when known.

## Model policy

- Default conversational Control Director model: `ollama/openclaw-control-gemma4-31b-q8:latest`.
- Keep safe alternatives config-derived and selectable without changing Control Director authorization.
- Do not make hosted Codex the silent conversational default.
- Use local deterministic or local-model lanes for ACKs, status, memory lookup, routing, ordinary chat, and routine coordination.
- Warm the selected local model only after Gateway readiness and shared resource admission. Use the provider-owned cancellable warmup hook, never evict or pull automatically, and verify exact residency afterward. The standard initial keep-alive is 15 minutes; ordinary inference retains its configured idle policy.
- Inject bounded hot recent task/session state deterministically. Reserve model-backed Active Memory for explicit recall prompts so a second local-model request cannot delay every ordinary turn.
- Escalate to Codex only through the governed adapter with an explicit mission packet, approval, budget, scope, attribution, and fail-closed behavior.
- Recommended Codex route for approved complex implementation: `gpt-5.6-luna` with max reasoning. Escalate to `gpt-5.6-sol` with high reasoning for architecture, difficult debugging, security, or final independent review where the incremental cost is justified. Use low only for a fully deterministic, mechanically verified runbook.

## Subagent orchestration repair (M62-M68)

Start with `pnpm control-director:subagent-incident-proof`. Keep its observations synthetic and its output sanitized: receipts may contain scenario ids, typed issue codes, and repository-relative evidence references, but never secrets or raw user diagnostic paths. Do not treat this reproduction baseline as a repair.

Repair in dependency order: task-root inheritance and worktree confinement (M63), worker discovery (M64), role-capability and handoff alignment (M65), deployed skill and workflow consistency (M66), and evidence-bound completion truth (M67). M68 requires the landed exact SHA to pass managed Control Director-to-Program Manager-to-worker-to-Judge execution plus the existing live, device, restart, rollback, and soak gates. A source-only or mock-only pass cannot complete M63-M68.

## Source workflow

1. Work only in a clean branch/worktree based on the intended immutable SHA. Never mix this work with unrelated dirty files.
2. Read root and scoped `AGENTS.md` files before edits.
3. Preserve the immutable mission envelope: request, acceptance criteria, scope, approvals, provenance, idempotency identity, and evidence references.
4. Add executable production callers for every contract. A helper with no caller is incomplete.
5. Update source, protocol, server, UI, plugin, skill, docs, and workflow surfaces together when the contract crosses them.
6. Treat every Dashboard, plugin, skill, workflow, model-policy, and runtime customization as update-sensitive. Register its stable capability ID and required paths in `config/custom-runtime-capabilities.json`, align `src/pcc/capability-addition-registry.ts`, and make its executable proof part of the preservation gate. An unregistered customization is incomplete.
7. Run narrow tests while editing. Before handoff, run:

```bash
pnpm custom-runtime:update-survival
pnpm control-director:torture
pnpm control-director:chaos
pnpm control-director:format-check
pnpm control-director:deployment-consistency -- --source-only --expected-sha "$(git rev-parse HEAD)"
pnpm control-director:verify -- --expected-sha "$(git rev-parse HEAD)"
pnpm ui:smoke:control-director-no-response
```

`control-director:verify` intentionally requires a clean exact-SHA checkout. Commit intended files before the final source gate. It runs the curated tests, core/UI/plugin typechecks, build, and source-only readiness sequentially and writes an ignored receipt under `.artifacts/control-director/`.

The immutable candidate must include the registered Control Director skill, plugin manifests, role/prompt contracts, Workflow Sanity definition, managed runtime helpers, and both customization inventories. After activation, use the repository-managed restart command and bind its `restarted_verified` receipt to:

```bash
pnpm control-director:deployment-consistency -- \
  --expected-sha <exact-sha> \
  --restart-receipt <restart-receipt.json>
```

This gate compares every registered file byte-for-byte with the exact source, verifies bundled plugin manifests, validates the immutable pointer and manifest digest, invokes the managed launcher verifier, and checks only boolean loaded state for Gateway, weekly update broker, and recovery guard services. Never substitute source-only proof for this post-restart receipt.

8. Run `pnpm check:changed` on remote CI or Testbox when it selects broad/shared lanes. Never replace a failed gate with a prose assertion.

For Operations Room source work, run `pnpm operations-room:verify`. That canonical command owns the
complete Operations and task-registry regression list, `tsgo:all`, all three test typecheck lanes
including `tsgo:test:src`, DOM and browser proof, localization, both capability registries, workflow
validation, and build. The exact-SHA workflow adds the remote changed gate; do not maintain a shorter
ad hoc command list in a handoff.

- Treat the current runtime cwd as the trusted task root. `sessions_spawn` must inherit it for both native and ACP workers; an explicit `cwd` may select only an existing real descendant. Reject missing roots, outside paths, and symlink escapes before launch. User-visible diagnostics may expose only the typed issue code and task-root fingerprint, never the raw root.
- Every orchestrator execution budget must include `agents_list` whenever it includes `sessions_spawn`. Discovery returns only configured, allowlisted, spawnable targets and their operational handoff requirements.
- Control Director delegates to Program Manager with `{ handoff: { kind: "coordination", requiresMutation: false } }`. Program Manager delegates to workers with `kind: "implementation"` and an honest mutation flag. Judge accepts only read-only `verification`; operational-role spawns without a compatible typed envelope fail before launch.
- PCC receives typed plan/evidence commands, never prose-derived runtime state. SIG receives typed systemic-defect signals and proof-bound closure evidence, never silent mutation, deployment, closure, or self-approval.
- Every rejected spawn returns one caller-performable recommended action. Never recommend an unavailable discovery or mutation tool as the only recovery path.
- Build completion, blocker, worker, and task-root diagnostics only from typed runtime evidence. Bind each claim to its exact mission, worker, task-root fingerprint, or Judge claim hash; reject unavailable, unsupported, stale, future-dated, expired, or mismatched evidence. Transcript prose is never diagnostic proof.

## Update survival acceptance (M61)

Every Control Director and Dashboard change must survive an official OpenClaw update. M61 is fail-closed and requires all of the following:

1. Normal in-place and automatic updates remain blocked while the immutable custom runtime is active.
2. The update broker starts from the exact active SHA and creates an exact two-parent merge whose first parent is that active SHA and whose second parent is the selected official SHA.
3. The candidate preserves every active capability identity and every active required path. New requirements may be added; existing requirements may not be removed or repurposed.
4. `pnpm custom-runtime:update-survival` proves repository wiring and digest-binds every candidate required path. The broker then runs the ordered verification commands from the manifest rather than a divergent hard-coded list.
5. The prepared receipt binds the preservation proof by SHA-256. Explicit approval revalidates that exact proof, candidate, active base, immutable release, and source branch before managed staging.
6. Staging, promotion, restart, browser/device proof, rollback, restore, and soak remain separate required truth surfaces. Missing preservation, approval, rollback, or live proof blocks completion.
7. Managed promotion installs and loads both the prepare-only weekly update broker and the runtime recovery guard from the promoted release. PCC and production readiness must report each as scheduled; a plist that merely exists but is not loaded is not update-safe.
8. Every tracked file under `scripts/custom-runtime/` has an explicit owning capability. Adding an unregistered control-plane file fails M61 before candidate construction.

Never describe a customization as update-safe merely because its source file still exists. It is update-safe only after its registered capability, exact-parent candidate proof, manifest gates, proof-bound approval, loaded prepare-only broker and recovery guard, managed activation, rollback, and live acceptance all pass.

## Runtime acceptance

Source proof is not production proof. Production acceptance requires all of the following against the same landed SHA:

1. Managed configuration contains exactly one intended `control_director` role and selects the expected config-derived model.
2. `executionState.get` reports ready source SHA, selected model, runtime process provenance, artifact hash, and matching Dashboard canary.
3. A safe live diagnostic receives a durable ACK, visible activity, and a usable terminal answer.
4. Desktop, tablet, and mobile proofs keep transcript and composer visible; no static PCC, Project, Pursue Goal, or Truth & Completion block may obstruct Chat. A collapsed, transcript-owned blocked-claim diagnostic is allowed when it remains non-obstructing. Geometry-only obstruction telemetry is validated server-side and routed to SIG without trusting browser prose.
5. Queue and steer can switch bidirectionally until server admission closes, with revision/idempotency protection.
6. Pursue Goal create, edit, pause, resume, stop, retry, inspect, terminal notification, and refresh persistence are proven.
7. Gateway restart proves pending turns, worker mailbox, goals, and terminal delivery recover or reach an honest terminal state.
8. Soak for at least five minutes while monitoring liveness, memory, CPU, memory pressure, and duplicate delivery.
9. Execute a rollback drill to the previous verified runtime, prove health, then restore and re-prove the intended landed SHA.
10. Run production readiness with exact gate and runtime receipts:

```bash
pnpm control-director:readiness -- \
  --config <managed-config-path> \
  --expected-sha <landed-sha> \
  --gate-proof <source-gate-receipt.json> \
  --runtime-proof <runtime-proof.json>
```

11. Run `pnpm control-director:roadmap-proof` against the landed, active SHA. Bind the clean source gate, managed runtime proof, all-job remote-gate receipt, and production-readiness receipt to that exact SHA.

Do not claim production completion unless readiness and final-ledger verification exit zero, every critical fact passes, aggregate quality is at least 93, and no P0 defect remains.

For Operations Room changes, production acceptance additionally requires the same exact SHA in the
canonical custom-source branch, immutable runtime pointer, capability manifest, Gateway process,
desktop and mobile receipts, restart receipt, at least five minutes of bounded soak, and the verified
rollback bundle. Source tests, a DOM smoke, and an unpromoted candidate do not satisfy that gate.

The source artifact must include a validated V2 browser receipt, five nonempty desktop/mobile/tablet
screenshots including `tablet-768-increased-contrast.png`, a browser-receipt checksum, and a passing
exact-SHA workflow receipt with artifact digests.
The production artifact must separately bind that SHA to runtime identity, persistence across
restart, soak, and rollback proof. It must also include the machine-readable zero-instruction
usability receipt defined in `docs/automation/operations-room.md`: at least five first-use
participants spanning 7-12, 13-64, and 65-90, every participant completing all four outcomes in
60,000 milliseconds or less, with zero hints and zero unsafe actions. Never omit or retry a failed
attempt to turn the aggregate green.

## Failure handling

- Silence: persist ACK/run identity first, arm the no-response watchdog, surface a visible continuing or specific-blocker response, and emit a typed SIG journey signal.
- Stalled goal: reconcile lease, heartbeat, worker, next action, cancellation, and terminal delivery. Never display `running` without live ownership.
- Memory miss: keep hot recent context bounded, preserve provenance, disclose timeout/fallback, and never block the primary reply indefinitely.
- Queue race: reject mutations after admission closes; preserve idempotent duplicate success for the same key.
- False completion: reject delivery without exact mission evidence and a valid signed Judge receipt.
- Recurrence after SIG closure: reopen the causal recommendation and mark prior proof stale.

## Prohibited shortcuts

- No exact-name/id/model authorization bypass.
- No assistant-prose parsing for project or completion state.
- No static diagnostic panel inserted between transcript and composer.
- No hosted-model escalation without the approval envelope.
- No claim that tests, CI, managed runtime, desktop/tablet/mobile, restart, soak, or rollback passed unless that exact surface was observed.
- No npm publish, release tag, stable release, macOS release, Telegram live E2E, OpenAI API live E2E, or unrelated dirty-root edit without separate explicit approval.
