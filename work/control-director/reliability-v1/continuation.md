# Control Director Reliability V1 Continuation

## Durable execution baseline

- Active-lineage repair branch: `codex/control-director-active-lineage-m62-m67-20260722`.
- Active runtime base: `08f32c3f012894c108236add95b4d3af8b47eda5`.
- Repository integration base: `codex/pcc-release-governor-runtime-merge-v1-20260721`; resolve its current immutable SHA from Git rather than copying one from this file.
- Resolve the exact candidate with `git rev-parse HEAD`; do not trust a SHA copied into this document.
- The historical implementation baseline remains recorded in `roadmap.json`.
- The dirty root checkout is excluded from implementation, validation, activation, and evidence.
- Exact-SHA receipts under `.artifacts/control-director/` are authoritative only when their `sourceSha` equals the current clean `HEAD`.

## Completion policy

`roadmap.json` is authoritative. A milestone is complete only when its status is `passed` and its evidence identifies current source plus every applicable test, build, runtime, desktop, tablet, mobile, persistence, restart, soak, and rollback proof surface.

Source implementation, remote CI, managed runtime, Dashboard/device, model, restart, rollback, soak, landing, and final-ledger proof are separate gates. Do not infer completion from a plan, source-string readiness check, mock-only test, screenshot, stale receipt, or prior runtime.

## Current state

- Formal roadmap pass: 4/68. M62-M65 have clean exact-source implementation and targeted-test evidence; the overall program remains incomplete until every milestone has exact-SHA evidence and the post-commit ledger exits zero.
- Source implementation: M01-M67 present on the active runtime lineage. M25 defaults governed Codex work explicitly to `openai/gpt-5.6-sol`, preserves explicit user overrides, and uses preset effort by bounded work class. M61 retains the update-survival control plane. M62 adds sanitized deterministic reproduction for the six observed subagent orchestration incident classes. M63-M65 add validated task-root inheritance, executable worker discovery and recovery guidance, and one typed least-privilege handoff contract. M66 adds immutable deployment consistency without removing any active capability. M67 binds completion, blocker, worker, and task-root diagnostics to typed evidence.
- Local source gates passed before the clean rebase: the M62 six-scenario baseline, deployment-consistency source gate, 399-file Control Director format gate, 79/79 instruction torture suite, 59-test chaos suite, 120-test M62-M67 targeted suite, custom-runtime capability contract, and PCC capability contract. These results guide the repair but are not authoritative post-rebase evidence; rerun them and the broad source gate against the final clean `HEAD`.
- Capability monotonicity: compared with active runtime base `08f32c3f012894c108236add95b4d3af8b47eda5`, the candidate removes no capability and adds only `runtime:control-director-deployment-consistency`.
- Current phase: remote exact-SHA source verification, landing, managed activation/restart, and live acceptance.
- Remaining proof: exact runtime lineage; desktop, tablet, and mobile Chat; local-model routing and latency; memory; delegation; Judge; queue/steer; Pursue Goal; restart recovery; rollback/restore; five-minute soak; landing; reactivation; final ledger.

## Open consistency findings

- The earlier candidate marked M62 passed while omitting its incident-proof command, implementation, and test. The active-lineage branch restores all three and fails closed when the source is dirty.
- The active runtime base contained a stale import order in `src/gateway/server-methods/tasks.test.ts` that blocked the scoped Control Director format gate. The candidate contains only the formatter-prescribed import reorder, and the affected task-method tests pass.
- The final exact-SHA roadmap attestation tool from the older final-attestation lineage is not present on the active runtime lineage. M68 remains blocked until a 68-milestone, current-contract ledger validator is implemented, tested, and run against landed source, remote, update-survival, managed-runtime, device, restart, rollback, soak, and readiness receipts.
- These findings require typed SIG intake after the candidate is live; this source record is not a claim that runtime SIG ingestion already occurred.

## Next dependency-ready work

1. Run the broad exact-source Control Director gate and changed-surface gate in Blacksmith Testbox.
2. Push the active-lineage branch, require fresh exact-head Workflow Sanity and full non-Android CI, and land without a merge commit only when every required job passes.
3. Obtain a new Release Governor exact approval for the landed candidate SHA; the prior approval for `15b77310e2d0fd6bbdea38fc4f145eb440198e85` does not authorize a different SHA.
4. Prepare and activate one immutable candidate through the managed lifecycle; never bypass Keychain, staging, capability, or rollback guards.
5. Run live M66 deployment consistency after managed restart, then collect exact-runtime, browser/device, model, memory, orchestration, SIG, PCC, restart, rollback, and soak receipts for M67-M68.
6. Implement and test the current 68-milestone final-ledger validator, populate M01-M68 with concrete exact-SHA evidence, reactivate the landed SHA after any final source change, and generate the post-commit final ledger.

## Prohibited completion shortcuts

- Do not run validation from the dirty root checkout.
- Do not mark a managed Task Flow `running` without a live controller lease.
- Do not treat deterministic text matching as an independent Judge verdict.
- Do not infer PCC state from ordinary assistant prose.
- Do not use a mock GPT identity as proof for the managed Gemma Control Director.
- Do not claim live or Dashboard completion until the exact promoted SHA is exercised there.
- Do not mark a customization update-safe unless its capability/path inventory, exact-parent candidate proof, loaded prepare-only update broker and runtime recovery guard, managed activation, browser/device proof, rollback/restore, and soak all pass.
- Do not edit milestone status or evidence optimistically; a missing or stale binding remains pending.
