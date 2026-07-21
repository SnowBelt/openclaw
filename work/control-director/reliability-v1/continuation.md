# Control Director Reliability V1 Continuation

## Durable execution baseline

- Final-attestation branch: `codex/control-director-final-attestation-20260719`.
- Resolve the exact candidate with `git rev-parse HEAD`; do not trust a SHA copied into this document.
- The historical implementation baseline remains recorded in `roadmap.json`.
- The dirty root checkout is excluded from implementation, validation, activation, and evidence.
- Exact-SHA receipts under `.artifacts/control-director/` are authoritative only when their `sourceSha` equals the current clean `HEAD`.

## Completion policy

`roadmap.json` is authoritative. A milestone is complete only when its status is `passed` and its evidence identifies current source plus every applicable test, build, runtime, desktop, tablet, mobile, persistence, restart, soak, and rollback proof surface.

Source implementation, remote CI, managed runtime, Dashboard/device, model, restart, rollback, soak, landing, and final-ledger proof are separate gates. Do not infer completion from a plan, source-string readiness check, mock-only test, screenshot, stale receipt, or prior runtime.

## Current state

- Formal roadmap pass: 4/68. M62-M65 have exact-source evidence; the overall program remains incomplete until every milestone has exact-SHA evidence and the post-commit ledger exits zero.
- Source implementation: M01-M65 present. M25 defaults governed Codex work explicitly to `openai/gpt-5.6-sol`, preserves explicit user overrides, and uses preset effort by bounded work class. M61 inventory revision 5 adds the update-survival control plane. M62 adds sanitized deterministic reproduction for the six observed subagent orchestration incident classes. M63-M65 add validated task-root inheritance, executable worker discovery and recovery guidance, and one typed least-privilege handoff contract. M66-M68 remain unimplemented.
- Current phase: deployment consistency and evidence-bound diagnostic truth, then managed activation and live acceptance.
- Remaining proof: exact runtime lineage; desktop, tablet, and mobile Chat; local-model routing and latency; memory; delegation; Judge; queue/steer; Pursue Goal; restart recovery; rollback/restore; five-minute soak; landing; reactivation; final ledger.

## Next dependency-ready work

1. Verify mandatory skill, plugin, prompt, workflow, runtime-helper, and customization inventory deployment consistency (M66).
2. Bind completion, blocker, worker, and task-root diagnostics to typed fresh evidence and independent rejection (M67).
3. Require fresh exact-head Workflow Sanity and full non-Android CI; dependency advisories remain out of scope until separately approved.
4. Prepare and activate one immutable candidate through the managed lifecycle; never bypass Keychain, staging, capability, or rollback guards.
5. Collect all exact-runtime, browser/device, model, memory, orchestration, restart, rollback, and soak receipts for M68.
6. Populate M01-M68 with concrete exact-SHA evidence, land without a merge commit, reactivate the landed SHA, and generate the post-commit final ledger.

## Prohibited completion shortcuts

- Do not run validation from the dirty root checkout.
- Do not mark a managed Task Flow `running` without a live controller lease.
- Do not treat deterministic text matching as an independent Judge verdict.
- Do not infer PCC state from ordinary assistant prose.
- Do not use a mock GPT identity as proof for the managed Gemma Control Director.
- Do not claim live or Dashboard completion until the exact promoted SHA is exercised there.
- Do not mark a customization update-safe unless its capability/path inventory, exact-parent candidate proof, loaded prepare-only update broker and runtime recovery guard, managed activation, browser/device proof, rollback/restore, and soak all pass.
- Do not edit milestone status or evidence optimistically; a missing or stale binding remains pending.
