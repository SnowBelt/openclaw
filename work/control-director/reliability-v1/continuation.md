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
- Source implementation: M01-M68 contracts are present in the active worktree. M25 defaults governed Codex work explicitly to `openai/gpt-5.6-sol`, preserves explicit user overrides, and uses preset effort by bounded work class. M61 restores the revision-5 update-survival control plane without removing newer deployment, release-governance, Tailscale, Operations Room, or Chat capabilities. M62 adds sanitized deterministic reproduction for the six observed subagent orchestration incident classes. M63-M65 add validated task-root inheritance, executable worker discovery and recovery guidance, and one typed least-privilege handoff contract. M66 adds immutable deployment consistency without removing any active capability. M67 binds completion, blocker, worker, and task-root diagnostics to typed evidence. M68 adds the 68-milestone exact-source, update-survival, remote, runtime, readiness, and final-ledger validator.
- Local source gates passed before the clean rebase: the M62 six-scenario baseline, deployment-consistency source gate, 399-file Control Director format gate, 79/79 instruction torture suite, 59-test chaos suite, 120-test M62-M67 targeted suite, custom-runtime capability contract, and PCC capability contract. These results guide the repair but are not authoritative post-rebase evidence; rerun them and the broad source gate against the final clean `HEAD`.
- Capability monotonicity: compared with active runtime base `08f32c3f012894c108236add95b4d3af8b47eda5`, the candidate removes no capability and adds only `runtime:control-director-deployment-consistency`.
- Current phase: finish exact-source repair, commit the intended active-worktree files, rerun remote exact-SHA source verification, land, then perform managed activation/restart and live acceptance.
- Current active-worktree proof after the M61/M68 hardening includes passing grouped runtime/final-ledger, custom-runtime lifecycle, preservation-digest, PCC update-safety, protocol, Chat-layout, and UI tests; passing changed core/UI/script lint; passing core, core-test, package-test, and UI-test typechecks; passing capability registries; and a passing desktop/tablet/mobile Control Director no-response browser smoke. These are pre-commit local results, not clean exact-SHA, remote, or managed-runtime proof.
- A credential-free loopback Ollama sync replaced all Operations Room fallback overlays in all 20 supported non-English locales with `qwen3.6:27b-q8_0`. The deterministic i18n check reports zero fallback keys. An independent local Gemma audit reviewed 200 deterministic samples, rejected four defects, then passed the corrected full sample at 96.3/100 with a minimum item score of 80 and zero critical defects. The sanitized receipt is `.artifacts/control-director/control-ui-i18n-quality-current.json`.
- Remaining proof: exact runtime lineage; desktop, tablet, and mobile Chat; local-model routing and latency; memory; delegation; Judge; queue/steer; Pursue Goal; restart recovery; rollback/restore; five-minute soak; landing; reactivation; final ledger.

## Open consistency findings

- The earlier candidate marked M62 passed while omitting its incident-proof command, implementation, and test. The active-lineage branch restores all three and fails closed when the source is dirty.
- The active runtime base contained a stale import order in `src/gateway/server-methods/tasks.test.ts` that blocked the scoped Control Director format gate. The candidate contains only the formatter-prescribed import reorder, and the affected task-method tests pass.
- The previous exact-head Workflow Sanity proof failed because 20 Operations Room locale overlays retained English fallback text. The active worktree adds an explicit local Ollama translation provider and is generating reviewed locale output without paid external API use.
- The previous exact-head full non-Android CI also exposed a singular `*.test-fixture.ts` file that Knip did not recognize, two PCC lint violations, and an outdated browser assertion that treated the intentional collapsed blocked-claim diagnostic as an obstruction. The active worktree renames the fixture to the recognized `*.fixture.ts` convention, applies behavior-preserving lint corrections, and distinguishes truthful diagnostic presence from actual obstruction. The corrected browser proof passes at desktop, tablet, and mobile web viewports.
- The approved six-advisory production-dependency remediation is committed as exact source `ef4ee5f5f740e7c3e742241004a7001acd1477dc`. Exact-head Workflow Sanity run `30009893756` passed, and full non-Android CI run `30009893801` passed the security-fast, shrinkwrap, installation, and advisory surfaces; its remaining source, locale, lint, and browser failures are addressed in the active worktree but require a new exact-head run.
- The first restored final-ledger draft could accept abbreviated source, update-survival, and readiness ledgers whose only entries claimed a generic pass. The active worktree now requires the complete canonical source command set, the named M61 preservation facts, the named production-readiness facts, and explicit M61 bindings to source, update-survival, managed runtime, and readiness. Remote CI, landing, and live-diagnostic truth surfaces are also mandatory. This repair is locally covered but remains unverified on remote and managed-runtime surfaces.
- The final exact-SHA roadmap attestation tool is now restored and strengthened for all 68 milestones, but M68 remains pending until it is committed and tested, then run against landed source, remote, update-survival, managed-runtime, device, restart, rollback, soak, and readiness receipts.
- The source and CI findings were reported to SIG as recommendation `sir_7c59c2ba2a61ee9b` with original audit event `sie_f6cd0273eaa135a5`. The live recommendation is now `in_progress` with an appended sanitized note covering the additional proof-integrity findings; it remains intentionally blocked on resolution proof.

## Deferred user-facing request

- The requested Chat profile image remains unconfigured. Preserve the supplied image outside source control, implement or use the supported per-user avatar setting only after the reliability candidate is stable, verify desktop/tablet/mobile rendering, and register any new source customization under M61 before calling it complete.

## Next dependency-ready work

1. Run targeted M61, M68, i18n, PCC, Operations Room, lifecycle, workflow, type, format, and build proof; then commit only intended active-worktree files.
2. Run the broad exact-source Control Director gate and changed-surface gate in Blacksmith Testbox when authenticated; otherwise use exact-head Workflow Sanity and full non-Android CI as the remote proof surface.
3. Push the active-lineage branch, require fresh exact-head Workflow Sanity and full non-Android CI, and land without a merge commit only when every required job passes.
4. Obtain a new Release Governor exact approval for the landed candidate SHA; the prior approval for `15b77310e2d0fd6bbdea38fc4f145eb440198e85` does not authorize a different SHA.
5. Prepare and activate one immutable candidate through the managed lifecycle; never bypass Keychain, staging, capability, or rollback guards.
6. Run live M66 deployment consistency after managed restart, then collect exact-runtime, browser/device, model, memory, orchestration, SIG, PCC, restart, rollback, and soak receipts for M67-M68.
7. Populate M01-M68 with concrete exact-SHA evidence, reactivate the landed SHA after any final source change, and generate the post-commit final ledger.

## Prohibited completion shortcuts

- Do not run validation from the dirty root checkout.
- Do not mark a managed Task Flow `running` without a live controller lease.
- Do not treat deterministic text matching as an independent Judge verdict.
- Do not infer PCC state from ordinary assistant prose.
- Do not use a mock GPT identity as proof for the managed Gemma Control Director.
- Do not claim live or Dashboard completion until the exact promoted SHA is exercised there.
- Do not mark a customization update-safe unless its capability/path inventory, exact-parent candidate proof, loaded prepare-only update broker and runtime recovery guard, managed activation, browser/device proof, rollback/restore, and soak all pass.
- Do not edit milestone status or evidence optimistically; a missing or stale binding remains pending.
