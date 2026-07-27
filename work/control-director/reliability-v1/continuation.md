# Control Director Reliability V1 Continuation

## Durable execution baseline

- Active-lineage repair branch: `codex/runtime-certification-lease-af84-20260726`.
- Verified planning base and active managed-runtime lineage at the start of the M69-M86 expansion: `af84ed813d59eeed47922434ec8a30463d66b1ab`. Reverify the live active runtime before any managed mutation.
- Writable GitHub fork remote: `SnowBelt`. `origin` intentionally identifies read-only upstream `openclaw/openclaw`; explicit pushes to `origin` fail with HTTP 403 and are not a CI defect.
- Resolve the exact candidate with `git rev-parse HEAD`; do not trust a SHA copied into this document.
- The historical implementation baseline remains recorded in `roadmap.json`.
- The dirty root checkout is excluded from implementation, validation, activation, and evidence.
- Exact-SHA receipts under `.artifacts/control-director/` are authoritative only when their `sourceSha` equals the current clean `HEAD`.

## Completion policy

`roadmap.json` is authoritative. Implementation and exact-SHA certification are separate. Official total completion is certification coverage. A milestone is complete only when `implementationStatus` resolves to `implemented`, `certificationStatus` and its compatibility `status` are both `passed`, and evidence identifies current source plus every applicable test, build, runtime, desktop, tablet, mobile, persistence, restart, soak, and rollback proof surface.

Source implementation, remote CI, managed runtime, Dashboard/device, model, restart, rollback, soak, landing, and final-ledger proof are separate gates. Do not infer completion from a plan, source-string readiness check, mock-only test, screenshot, stale receipt, or prior runtime.

## Current state

- Expanded formal roadmap pass: 4/86, or 4.65 percent. M62-M65 remain the only certified milestones. The denominator increase is planned scope growth, not a regression.
- Minimum implementation coverage after the M69-M82 source lanes: 18/86, or 20.93 percent. M01-M61 and M66-M68 remain unassessed until the M82 candidates receive semantic and exact-SHA review; prior prose and path existence do not promote them.
- M69 adds dual progress and an M01-M86 dependency graph. M70-M73 add exact lineage, accepted-head, semantic inventory, and all-blocker preflight contracts. M74 adds automatic applicable-PR proof. M75 emits one batched remediation manifest. M76-M81 harden certification leases and managed lifecycle arbitration. M82-M86 remain gated on audit, candidate freeze, exact source/CI/landing, managed runtime proof, and final SIG closure.
- Local source gates passed before the clean rebase: the M62 six-scenario baseline, deployment-consistency source gate, 399-file Control Director format gate, 79/79 instruction torture suite, 59-test chaos suite, 120-test M62-M67 targeted suite, custom-runtime capability contract, and PCC capability contract. These results guide the repair but are not authoritative post-rebase evidence; rerun them and the broad source gate against the final clean `HEAD`.
- Capability monotonicity: compared with active runtime base `08f32c3f012894c108236add95b4d3af8b47eda5`, the candidate removes no capability and adds only `runtime:control-director-deployment-consistency`.
- Current phase: finish and validate M69-M81 source implementation, run M82, reconcile the required PR #38 delta under its separate dependency approval boundary, freeze one candidate, and then obtain fresh exact-SHA landing and Release Governor approvals.
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
- The final exact-SHA roadmap attestation now targets M01-M86 and rejects contradictory implementation/certification state, dependency cycles, omitted execution milestones, and incomplete M85/M86 bindings. No new milestone is certified until current exact-SHA receipts exist.
- One-shot preflight against the current branch identifies the dirty implementation worktree and the absent PR #38 accepted head in one result. The remaining PR #38 delta is confined to `pnpm-workspace.yaml`, `pnpm-lock.yaml`, and `scripts/deadcode-unused-files.allowlist.mjs`; the dependency and lockfile files remain outside the current source-only approval.
- The repeated GitHub push failure root cause is an explicit remote-target error: `origin` is read-only upstream while `SnowBelt` is the writable fork and branch tracking target. Pushing to `SnowBelt` succeeds; no source workaround or CI rerun is required.
- The first whole-inventory local-Qwen M82 reviews did not produce a valid receipt: the Judge returned `NO_REPLY`, and the engineering reviewer exceeded its safe context window after reading the 118-file evidence bundle. Keep the deterministic audit, split future local review into bounded milestone groups, and do not treat either failed run as independent approval.
- The source and CI findings were reported to SIG as recommendation `sir_7c59c2ba2a61ee9b` with original audit event `sie_f6cd0273eaa135a5`. The live recommendation is now `in_progress` with an appended sanitized note covering the additional proof-integrity findings; it remains intentionally blocked on resolution proof.

## Deferred user-facing request

- The requested Chat profile image remains unconfigured. Preserve the supplied image outside source control, implement or use the supported per-user avatar setting only after the reliability candidate is stable, verify desktop/tablet/mobile rendering, and register any new source customization under M61 before calling it complete.

## Next dependency-ready work

1. Complete targeted M69-M81 tests, workflow validation, formatting, lint, type, and build checks; commit and push only intended source files to the writable `SnowBelt` remote.
2. Run M82 against M01-M68, recording `implemented` only for milestones with concrete current source/test evidence and leaving all runtime-only certification pending.
3. Obtain separate approval for the required PR #38 brace-expansion declaration, lockfile, and deadcode allowlist delta; reconcile it without additional dependency or semantic changes.
4. Freeze M83, run automatic and explicitly dispatched exact-SHA Control Director proof, Workflow Sanity, full non-Android CI, and desktop/tablet/mobile browser proof.
5. Obtain an exact-SHA landing approval for M84, then a separate Release Governor approval naming the landed SHA, active SHA, rollback SHA, and operation classes.
6. Execute M66-M68 and M85 in one protected managed-runtime lifecycle window, including restart, rollback-and-restore, and minimum five-minute soak.
7. Generate M86 only when all 86 milestone states, evidence bindings, capability inventory, Judge receipt, and sanitized SIG closure agree.

## Prohibited completion shortcuts

- Do not run validation from the dirty root checkout.
- Do not mark a managed Task Flow `running` without a live controller lease.
- Do not treat deterministic text matching as an independent Judge verdict.
- Do not infer PCC state from ordinary assistant prose.
- Do not use a mock GPT identity as proof for the managed Gemma Control Director.
- Do not claim live or Dashboard completion until the exact promoted SHA is exercised there.
- Do not mark a customization update-safe unless its capability/path inventory, exact-parent candidate proof, loaded prepare-only update broker and runtime recovery guard, managed activation, browser/device proof, rollback/restore, and soak all pass.
- Do not edit milestone status or evidence optimistically; a missing or stale binding remains pending.
