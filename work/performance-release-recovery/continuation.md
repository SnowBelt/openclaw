# Performance Release Recovery

Updated: 2026-08-02

## Goal

Land and deploy only the behavior-preserving Chat rendering optimization and Research Manager lazy-loading work as an active-first immutable successor of the managed Mac Studio Gateway. The production package must be self-contained, tamper-evident, rollback-ready, and verified without any push, tag, publish, external release, credential change, signing change, or unrelated product mutation.

## Immutable boundaries

- Recovery worktree: `/private/tmp/openclaw-performance-release-recovery-b7ac-20260802`
- Recovery branch: `codex/performance-release-recovery-b7ac-20260802`
- Starting active source SHA: `b7ac7399f94050a9df34b7b2c1259403ba3dcfb3`
- Original performance candidate provenance: `cd2a5cfa5e948c7b86884f49f4e96afb389445f4`
- The exact active runtime must be rediscovered immediately before packaging and mutation.
- The dirty main checkout remains untouched.

## Milestones

| ID     | Scope                                                    | Status      | Completion | Required proof                                                                                                                           |
| ------ | -------------------------------------------------------- | ----------- | ---------: | ---------------------------------------------------------------------------------------------------------------------------------------- |
| REC-01 | Active-first source integration and exact-scope recovery | in progress |        95% | Clean candidate commit containing only Chat, Research Manager, required capability/docs/dependency closure, and packaging repair         |
| REC-02 | Fail-closed self-contained package implementation        | in progress |        95% | Exact-SHA production build after the already-passed source gates                                                                         |
| REC-03 | Exact-SHA source certification                           | pending     |         0% | Clean exact-SHA build snapshot, full affected tests, independent review, Release Governor receipts                                       |
| REC-04 | Immutable package assembly and sealing                   | pending     |         0% | Production dependency closure, artifact hash, closure hash, packaged verifier, seal verifier, sterile startup                            |
| REC-05 | Managed local deployment and rollback proof              | pending     |         0% | Fresh lineage, preregistered rollback, managed promotion/restart, exact active identity, health/RPC checks                               |
| REC-06 | Production behavior and completion proof                 | pending     |         0% | Authenticated local Chrome Chat proof, Research Manager lazy-load proof, restart persistence, bounded soak, final receipt reconciliation |

## Current evidence

- The complete affected matrix passed in one repository-managed invocation: 42 files and 463 tests across Chat/UI/browser, Research Manager, runtime lifecycle, packaging, capability, dependency, readiness, and Release Governor surfaces.
- The complete Research Manager suite passed within that matrix: 25 files and 134 tests.
- After the final package hardening, the focused lifecycle/package rerun passed 3 files and 22 tests, including dirty-source cleanup, failed-seal cleanup, executable-mode tampering, added-file tampering, external symlinks, missing dependencies, and sensitive files.
- Formatter, scoped lint, shell syntax, production and test type lanes, aggregate production type build, capability registries, dependency ownership, generated plugin inventory, Release Governor policy, import cycles, Madge cycles, deprecated API/JSDoc guards, Kysely generation/guardrails, and database-first guardrails passed.
- The canonical packager now derives a production-only dependency closure with `pnpm deploy`, overlays the exact build snapshot and registered capability paths, records a complete runtime closure, and verifies it before sealing.
- The packaged verifier rejects byte or executable-mode tampering, external or broken symlinks, special files, sensitive files, missing capability paths, missing Research Manager dependencies, and build-artifact drift.
- No release directory, active pointer, Gateway process, credential, signing material, tag, remote, or publication surface has been changed by this recovery worktree.

## Next action

Finish formatting and the complete affected source gate. Repair every in-scope failure, commit the exact candidate, rebuild from that SHA, then continue through Release Governor authorization, immutable packaging, managed local deployment, browser proof, rollback verification, and soak.
