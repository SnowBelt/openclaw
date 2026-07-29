---
doc-schema-version: 1
summary: "Fail-closed release classification, approval, evidence, promotion, and rollback for custom runtimes"
read_when:
  - Preparing or reviewing an immutable custom runtime release
  - Investigating why staging, promotion, restart, or rollback was blocked
  - Creating bounded release approval or exact-SHA evidence
title: "Release Governor"
---

The PCC Release Governor is the single deployment-policy boundary for immutable
custom runtimes. Staging, promotion, restart, rollback, and the weekly updater
all call the same deterministic verifier. A missing policy, missing evidence,
invalid hash, wrong SHA, wrong operation, failed check, missing reviewer, or
insufficient approval blocks the operation.

The Release Governor does not edit product code, bypass policy, or approve a
change to itself. Deterministic policy always wins over agent consensus.

## Risk and trust boundaries

| Risk        | Examples                                                                     | Baseline decision                                                      |
| ----------- | ---------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| P0 Critical | Authentication, authorization, secrets, permissions, security, policy bypass | Exact approval                                                         |
| P1 High     | Agents, prompts, skills, orchestration, memory, governance                   | Exact approval                                                         |
| P2 Medium   | CI, deployment, runtime infrastructure, tests, telemetry                     | Automatic only when every gate passes and no protected path is touched |
| P3 Low      | Documentation, comments, formatting, nonfunctional metadata                  | Automatic only when every gate passes                                  |

The versioned source of truth is
`config/release-governor-policy.json`. Unknown paths escalate. Protected paths,
external disclosure, capability weakening, failed or waived checks, and new
destinations always require explicit approval or remain denied.

The `stage` operation is a local-only, side-effect-suppressed preflight and uses
its pre-stage gate set. Promotion, restart, and finalization require the complete
exact-SHA test, Workflow Sanity, immutable-build, staging, browser, rollback,
Gateway, and ledger-readiness evidence appropriate to the operation.

## Evidence flow

1. Collect exact candidate facts, active and candidate capability manifests,
   checks, approvals, and structured reviews.
2. Evaluate the candidate:

   ```bash
   node dist/release-governor.js evaluate \
     --input release-governor-input.json \
     --output release-governor-evaluation.json
   ```

3. Create a canonical hash-bound evidence bundle from the evaluation and all
   release evidence:

   ```bash
   node dist/release-governor.js bundle \
     --input release-evidence-input.json \
     --output release-evidence.json
   ```

4. Store each operation bundle at:

   ```text
   $OPENCLAW_RELEASE_GOVERNANCE_BUNDLE_DIR/<candidate-sha>/<operation>.json
   ```

   Operations are `stage`, `promotion`, `restart`, `rollback`, and `finalize`.

5. The immutable-runtime script verifies the bundle against the trusted active
   Release Governor before it mutates the selected runtime or service. The
   candidate Governor is accepted only for first-install bootstrap, which still
   requires policy-authorized exact-SHA evidence.
6. After deployment and post-deployment health pass, write the final evidence
   and idempotent PCC receipt:

   ```bash
   node dist/release-governor.js ledger-record \
     --bundle final-evidence.json \
     --release /absolute/path/to/immutable-release
   ```

Evidence files and status are private state. They must not contain credentials,
raw tokens, or secrets.

### Policy-version migration

The active immutable runtime remains the default Release Governor authority. A
candidate cannot select its own Governor merely because it carries a newer
policy.

When a candidate introduces the next policy version and the active Governor
cannot evaluate that version, an operator may provide a private
`openclaw.release-governance-policy-migration.v1` record through
`OPENCLAW_RELEASE_GOVERNANCE_POLICY_MIGRATION`. This exception is fail-closed
and applies only to `stage` and `promotion`. The migration record must:

- be owner-private and expire within 24 hours;
- advance the policy by exactly one version;
- bind the active and candidate runtime SHAs;
- bind the active and candidate Governor, policy, and capability-manifest
  SHA-256 hashes;
- bind the operation-specific evidence-bundle SHA-256 hash and exact approval
  identity;
- target the local-only `project-command-center` release using the
  `mac_studio_control_director` proof profile.

After those migration checks pass, the candidate Governor must still verify the
complete canonical evidence bundle and immutable runtime artifacts. Promotion
rechecks the migration's active SHA after acquiring the lifecycle lock and
before changing managed-runtime state. Restart, finalization, rollback,
unrelated projects, external destinations, wider version jumps, expired
records, hash drift, and missing approvals remain blocked. Once promotion makes
the candidate active, normal active-Governor verification resumes and the
migration record no longer grants authority.

Every lifecycle verification re-hashes the immutable release's Gateway entry,
Release Governor entry, dashboard surface manifest, Release Governor policy,
capability manifest, and `dist/build-info.json`. The evidence
`build.artifactHashes` map uses those repository-relative paths as keys, and
`dist/build-info.json` plus `.openclaw-production-sha` must both identify the
exact candidate SHA.

## Reviews and approval

Release Governor and Judge reviews are always required. Control Director review
is required for P0, P1, or protected changes. Telemetry and Evaluation review is
required for promotion, restart, rollback, and finalization. Program Manager
review is required when schedule or scope coordination is material.

Bounded grants cover only descendants of an approved base SHA within the same
project, repository, branch, destination, risk, categories, path exclusions,
expiration, depth, and commit limit. They cannot cover protected paths, policy changes,
agent or prompt changes, capability weakening, or a new external destination.

When exact approval is needed, PCC shows copyable wording bound to the precise
candidate SHA, branch, repository, destination, operation, allowed CI and
runtime actions, and explicit exclusions.

## Health and rollback

Promotion and finalization evaluate Gateway connectivity, required routes, PCC,
latency, error rate, startup failures, capabilities, desktop/mobile browser
errors, active-run reconciliation, and PWA integrity where applicable.

A deterministic health failure recommends rollback. Automatic rollback occurs
only when rollback is already policy-authorized. Otherwise the release is
blocked and PCC displays the exact approval required.

## Verification

```bash
pnpm check:release-governor-policy
pnpm check:custom-runtime-capabilities
pnpm test src/pcc/release-governance/release-governance.test.ts
pnpm test test/scripts/custom-runtime-lifecycle.test.ts
pnpm ui:smoke:pcc-release-governor
pnpm build
```

The PCC deployment-governance panel displays candidate and active SHAs, risk,
protected paths, capability changes, checks, approvals, reviewer decisions,
rollback target, decision, blocker, evidence receipt, and approval wording.

## Safe runtime inspection

Do not run `pnpm`, `npm`, or another package manager from an immutable release
directory. Package-manager dependency reconciliation is a mutation, not a
status check. Inspect the active managed runtime through its direct launcher:

```bash
$HOME/.openclaw-custom-runtime/bin/custom-runtime-status.sh --deep --json
```

Prepared releases are sealed after their snapshot is written. Every directory
inside the release is non-writable, so an accidental package-manager command
fails before it can relocate runtime dependencies. The seal verifier is:

```bash
$HOME/.openclaw-custom-runtime/bin/custom-runtime-seal.sh \
  --verify --release "$RELEASE_ROOT"
```
