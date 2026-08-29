# Program Manager model-agnostic evidence

Date: 2026-08-29

## Implemented

- Role installation no longer owns `model`, fallbacks, provider parameters, authentication, or provider catalogs.
- The source role rejects model/provider-specific policy and uses normalized `thinkingDefault: off`.
- `qualify`, `switch`, `status`, and `rollback` provide isolated qualification, atomic promotion, drift detection, and exact rollback.
- Qualification uses synthetic inputs, portable deterministic parameters, redacted receipts, immutable-identity reuse rules, and a 15-scenario matrix repeated three times.
- Critical truth, safety, tool, delegation, and output checks require a 100% pass rate. Performance metrics never override correctness.

## Before and after

| Surface              | Before                                      | After                                                                                                |
| -------------------- | ------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| Source bootstrap     | 2,192 measured characters                   | 2,194 characters; remains below the 2,200-character limit                                            |
| Active bootstrap     | About 6,146 bytes with drift                | Canonical 2,194-character package installed and verified                                             |
| Skills               | Drift-prone visibility                      | Exactly zero; no inherited, bundled, or extra skill visibility                                       |
| Tools                | Broader than the role contract              | Exactly eight approved tools                                                                         |
| Workers              | Nine configured targets                     | Only `builder-agent` and `research-brief-agent`                                                      |
| Model ownership      | Role installer copied model-specific policy | Operator-owned route and parameters are preserved during role sync                                   |
| Candidate activation | Manual edits could bypass proof             | Failed candidates cannot change the active config; post-activation failure restores the exact backup |

The active reconciliation preserved the model route, provider policy, and existing model-parameter fingerprints while applying the canonical role, tools, skills, delegation boundary, and portable thinking setting.

## Verification

- Source contract check: passed; 2,194 effective prompt characters, zero skill characters, eight tools, and two approved workers.
- Canonical runtime-config check: passed.
- Focused Program Manager tests: passed, covering role/model separation, capability rejection, receipt invalidation, deterministic matrix parsing, atomic promotion, drift detection, and exact rollback.
- Workflow validation: passed.
- Managed Gateway restart and deep health check: passed after active-role reconciliation.
- Failed-switch proof: a rejected local candidate left the active config digest unchanged.

## Candidate results

The current primary and five available local alternatives were exercised through isolated canaries or qualification. None met the complete contract: observed failures included timeout, incomplete continuation after tool use, combined profiles, extra fields/preamble, and nondeterministic profile selection. Every candidate was rejected without weakening the contract or silently changing the active route.

No hosted candidate was run because hosted cost and transfer require separate approval. This is an external qualification gap, not a failure of the switching implementation.

## Certification boundary

The implementation and fail-closed activation path are complete. Model certification remains pending until one compatible candidate passes all 45 critical runs and Matthew accepts the final live evidence. An incompatible model is rejected rather than accommodated by weakening Program Manager truth or safety rules.
