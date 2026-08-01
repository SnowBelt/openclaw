# Control Director Reliability V1 Continuation

## Settled campaign lineage

- Current active lineage verified read-only on 2026-08-01:
  `287e8c6c1dac6507afa99b455f9775c204e2913f`.
- Current active immutable release: `20260730T143948Z-287e8c6c-r4`.
- Current immediate rollback lineage:
  `da466703dbe96fba6a75dce0d5d06d2d246d8f76`.
- Current immediate rollback release: `20260730T032229Z-da466703`.
- Required selected model:
  `ollama/openclaw-control-qwen25-32b:latest`.
- Resolve every later repair candidate with `git rev-parse HEAD`. Do not reuse an
  earlier SHA after any source change, landing, or immutable release.
- Reverify the live active runtime, immutable release, rollback target,
  configuration digests, selected model, lifecycle lock, and certification lease
  immediately before every managed mutation.
- Use only a clean isolated exact-SHA worktree. The operator's primary checkout is
  not an implementation or evidence surface.

## Completion policy

`roadmap.json` defines M01-M106. Implementation and certification are separate.
Official completion is certification coverage, not path existence or source
coverage.

A milestone is complete only when:

1. `implementationStatus` is `implemented`;
2. `certificationStatus` and compatibility `status` are both `passed`;
3. its current exact-SHA evidence includes every required binding; and
4. its dependencies are also certified.

The Mac Studio is the sole Control Director execution and certification platform.
Exact-source validation, landing, immutable runtime, authenticated production
Chrome, local-model routing, Judge, rollback/restoration, soak, and passive
monitoring are independent gates. Blacksmith, Testbox, Crabbox, hosted CI,
secondary hosts, mobile devices, and equivalent remote execution are not Control
Director certification surfaces. GitHub may host source, pull requests, and
sanitized evidence, but automatically triggered checks are diagnostic rather than
certification proof.

Never infer completion from a plan, string-only readiness check, mock-only test,
screenshot alone, stale receipt, prior runtime, or remote runner.

### Repeat accounting

`repeat-ledger.json` is the campaign's durable retry record. Before repeating a
step, announce its attempt number, repeat count, and reason. No more than two
attempts are automatic; a third or later attempt requires explicit owner
approval. An interrupted or environmentally blocked run remains an attempt, and
an outcome whose pass/fail output cannot be recovered is never counted as a
pass. Reuse still-valid exact-SHA receipts instead of rerunning an entire
milestone when a narrower evidence-cached gate proves the same acceptance
surface.

## Current tracked state

- Formal roadmap: 106 milestones.
- Current tracked implementation coverage: 38/106, or 35.85 percent.
- Current tracked certification coverage: 4/106, or 3.77 percent.
- The current uncommitted repair worktree's deterministic implementation audit
  reports 106/106 implemented with zero unassessed or blocked milestones. This is
  structural evidence only: it does not become exact-SHA implementation proof
  until the repair is committed on a clean candidate and the exact audit is
  repeated or independently reopened.
- M62-M65 are the only tracked certified milestones until fresh exact-SHA
  receipts prove later milestones.
- The final ledger remains fail-closed until all 106 milestones are implemented,
  certified, dependency-complete, and bound to the required source,
  update-survival, runtime, Mac Studio-local validation, readiness,
  model-governance, and stability receipts.
- Do not edit tracked milestone status optimistically. Generate a deterministic
  evidence-backed final projection only after the corresponding receipts exist.

## Source repair status

The settled lineage audit found four directly owned certification defects:

1. deterministic Swift protocol projection drift;
2. certification-lease arbitration that could not retain the lease through the
   authorized rollback/restoration drill;
3. stale remote, Testbox, mobile, tablet, and multi-participant proof language;
4. readiness and final-ledger paths that were not fully bound to the configured
   selected model and externally authorized model, configuration, and rollback
   identities.

Each correction must remain a minimal intended-file-only commit with targeted
tests. After the final correction, rerun the complete exact-SHA source verifier
and all selected local lanes on the Mac Studio. Those source receipts become
stale after any later source mutation.

The source integration gate is green under evidence-cached focused closure.
Focused compaction attempt 7 passed all 29 tests, syntax attempt 5 passed all
six changed JavaScript modules, and implementation audit attempt 4 reported 106
implemented with zero unassessed or blocked milestones. Source integration
attempt 10 retained 80 of 80 tooling tests and 12 of 13 agent tests; focused
source-integration repair verification attempt 11 passed all 3 Judge
receipt-signer tests after the approved immutable trial-model and Judge-model/cache
identity fixture repair. Targeted lint attempt 6 and Mac Studio type attempt 6
passed after that edit. Final targeted formatting attempt 7 also passed all
matched formatter-supported files, including `repeat-ledger.json` as valid JSON,
after all source and continuation edits. No attempt 8 was needed before the
bounded architecture repair; the authorized attempt 8 refresh then repaired
one formatter difference in `src/agents/control-director-model-eval.ts` and
passed the complete matched formatter set.

The clean verifier on predecessor candidate
`4739ecfd9af72f197bebfe5cb42a40c091406e31` passed its complete source, UI,
extension, contract, documentation, build, and source-readiness sequence. A
subsequent architecture gate exposed one Madge cycle between model evaluation
and independent Judge service. The bounded repair moved the shared Judge receipt
and issuance types to the authorized signer module and preserved the independent
service type exports. Focused regressions passed 13/13, architecture attempt 2
passed with zero cycles, and post-repair lint and TypeScript refreshes passed.
The predecessor clean-verifier receipt is stale only because those two
authorized agent files changed; rerun the clean exact-SHA verifier after the
final 41-path recommit.

Bounded source review attempt 1 found five P1 defects. Attempt 2 verified four
repairs and left browser proof unresolved because it reconstructed expected
marker HTML instead of recording the visible authenticated page. Attempt 3
confirmed the original soak, restoration, Judge, and lifecycle repairs but found
three remaining P1 gaps: incomplete subprocess credential stripping, stale or
injected browser replay, and futile overflow recovery for a fixed uncompactable
prompt. After repair, independent attempt 4 found no remaining P0 or P1.

The browser observer now launches headed Google Chrome itself, captures bounded
rendered-main-content markers and visible connected-state records plus complete
private PNGs, rejects caller-supplied browser evidence in the production CLI,
restricts injected capture to an explicit test-only dependency seam, binds every
browser and route timestamp to the exact observation window, derives Mac Studio
host identity locally, and accepts local token resolution only through an
explicit environment opt-in against the exact digest-approved owner-only
configuration. It strips the authenticated URL and opt-in flag from every system,
Chrome, managed-runtime, and Tailscale subprocess and maps navigation failures to
credential-free errors. Fixed content that cannot preserve minimum generation
headroom now raises a distinct non-overflow error, preventing futile compaction
recovery.

Focused compaction attempt 7 is current at 29 of 29. Attempt 10's 80 of 80
tooling and 12 passing agent tests remain current because the final repair changed
only `src/agents/judge-receipt-signer.test.ts`; focused source-integration repair
verification attempt 11 passed 3 of 3 tests and closes that cached grouped gate.
Targeted lint attempt 7 and Mac Studio type attempt 7 passed after the bounded
architecture repair. Final formatting attempt 8 also passed after its bounded
one-file repair. Syntax attempt 5, implementation audit attempt 4, focused
compaction attempt 7, and independent review attempt 4 remain current.

## Required proof sequence

1. Freeze one clean repair candidate descended from the settled lineage.
2. Run deterministic protocol generation checks, targeted tests, formatter,
   lint, type, architecture, capability, PCC, SIG, UI, extension, production
   build, and complete Control Director source verification locally.
3. Obtain bounded local-Qwen review of the exact diff without competing with
   CPU-sensitive deterministic gates.
4. Push one complete pull request with Summary and Verification, land without a
   merge commit, and bind local-validation evidence to the exact landed SHA.
5. Create and activate a fresh immutable release only after rechecking no foreign
   lease or conflicting lifecycle operation exists.
6. Verify the authoritative and secondary configuration digests, all 35
   capabilities, M01-M106 inventory, Gateway, Ollama service, required selected
   model, source SHA, release, and process entrypoint.
7. Acquire one repository-managed certification lease for the exact active and
   candidate pair. Keep periodic heartbeats and retain the lease through the one
   authorized rollback/restoration drill.
8. Run queue, steer, cancel, queued/direct `toolsAllow` parity, Pursue Goal,
   memory, delegation, PCC, SIG, proof planning, workflow/skill convergence,
   incident, restart-recovery, and independent signed-Judge proof.
9. Run at least 48 exact-runtime trials spanning all six task classes in cold and
   warm modes. Require 100 percent pass, zero critical omissions, and every
   quality score at least 93.
10. Capture exact route, residency, cache identity, latency, resource, and thermal
    telemetry plus fallback, quality-cascade, invalidation, and shadow-review
    evidence.
11. Perform authenticated visible production Google Chrome proof on the unlocked
    real Mac Studio. Store private sanitized receipts and screenshots.
12. Under the retained lease, roll back to the exact immediate rollback release,
    verify identities and all 35 capabilities, restore the exact candidate
    release, restart when required, and repeat runtime and browser checks.
13. Complete at least 30 continuous minutes of active soak and 24 continuous
    hours of passive exact-runtime monitoring.
14. Generate the final Release Governor, SIG, PCC, exact 35-capability,
    model-governance, stability, rollback, monitoring, and M01-M106 ledgers. Use
    the canonical tracked roadmap only as an immutable specification; write the
    private certified projection first and the final ledger last as its commit
    marker.
15. Release every owned lease and unload every stale owned heartbeat or monitor.
    Verify no owned lifecycle lock or orphaned lease remains.
16. Record owner acceptance only after Matthew explicitly accepts the completed
    demonstrated runtime.

## Fail-closed conditions

Stop managed mutation and release every owned lease after any unexpected active
SHA, foreign lease, conflicting lifecycle operation, configuration-digest drift,
selected-model mismatch, malformed receipt, capability loss, milestone
regression, critical incident, failed rollback, failed restoration, invalidated
evidence, unresolved semantic conflict, or operation outside the active approval.

Do not change dependencies, lockfiles, product versions, public APIs, managed
configuration, credentials, secrets, model definitions, model aliases, memory
skills, or unrelated files. Do not publish packages or public releases. Do not
interfere with another worker.

## Prohibited shortcuts

- Do not certify from a dirty checkout.
- Do not mark a managed task `running` without a live controller lease.
- Do not treat deterministic matching as an independent Judge verdict.
- Do not infer PCC state from assistant prose.
- Do not substitute a mock or fallback model for the required selected route.
- Do not claim browser completion without authenticated production Chrome on the
  exact active Mac Studio runtime.
- Do not claim rollback completion until the exact candidate is restored and
  reverified.
- Do not claim M106 or 100 percent before the 24-hour passive monitor completes
  and all exact-SHA ledgers agree.
