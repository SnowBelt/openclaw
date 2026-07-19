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

## Model policy

- Default conversational Control Director model: `ollama/openclaw-control-gemma4-31b-q8:latest`.
- Keep safe alternatives config-derived and selectable without changing Control Director authorization.
- Do not make hosted Codex the silent conversational default.
- Use local deterministic or local-model lanes for ACKs, status, memory lookup, routing, ordinary chat, and routine coordination.
- Warm the selected local model only after Gateway readiness and shared resource admission. Use the provider-owned cancellable warmup hook, never evict or pull automatically, and verify exact residency afterward. The standard initial keep-alive is 15 minutes; ordinary inference retains its configured idle policy.
- Inject bounded hot recent task/session state deterministically. Reserve model-backed Active Memory for explicit recall prompts so a second local-model request cannot delay every ordinary turn.
- Escalate to Codex only through the governed adapter with an explicit mission packet, approval, budget, scope, attribution, and fail-closed behavior.
- Recommended Codex route for approved complex implementation: `gpt-5.5` with high reasoning. Use xhigh only for architecture, difficult debugging, security, or final independent review where the incremental cost is justified. Use low only for a fully deterministic, mechanically verified runbook.

## Source workflow

1. Work only in a clean branch/worktree based on the intended immutable SHA. Never mix this work with unrelated dirty files.
2. Read root and scoped `AGENTS.md` files before edits.
3. Preserve the immutable mission envelope: request, acceptance criteria, scope, approvals, provenance, idempotency identity, and evidence references.
4. Add executable production callers for every contract. A helper with no caller is incomplete.
5. Update source, protocol, server, UI, plugin, skill, docs, and workflow surfaces together when the contract crosses them.
6. Run narrow tests while editing. Before handoff, run:

```bash
pnpm control-director:torture
pnpm control-director:chaos
pnpm control-director:format-check
pnpm control-director:verify -- --expected-sha "$(git rev-parse HEAD)"
pnpm ui:smoke:control-director-no-response
```

`control-director:verify` intentionally requires a clean exact-SHA checkout. Commit intended files before the final source gate. It runs the curated tests, core/UI/plugin typechecks, build, and source-only readiness sequentially and writes an ignored receipt under `.artifacts/control-director/`.

7. Run `pnpm check:changed` on remote CI or Testbox when it selects broad/shared lanes. Never replace a failed gate with a prose assertion.

## Runtime acceptance

Source proof is not production proof. Production acceptance requires all of the following against the same landed SHA:

1. Managed configuration contains exactly one intended `control_director` role and selects the expected config-derived model.
2. `executionState.get` reports ready source SHA, selected model, runtime process provenance, artifact hash, and matching Dashboard canary.
3. A safe live diagnostic receives a durable ACK, visible activity, and a usable terminal answer.
4. Desktop, tablet, and mobile proofs keep transcript and composer visible; no static PCC, Project, Pursue Goal, or Truth & Completion block may obstruct Chat. Geometry-only obstruction telemetry is validated server-side and routed to SIG without trusting browser prose.
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

11. If the work uses a milestone roadmap, run `pnpm control-director:roadmap-proof` after the final commit is landed and active. Bind the clean source gate, managed runtime proof, all-job remote-gate receipt, and production-readiness receipt to that exact SHA. A roadmap's `passed` text is inert without this post-commit attestation.

Do not claim production completion unless readiness and final-ledger verification exit zero, every critical fact passes, aggregate quality is at least 93, and no P0 defect remains.

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
