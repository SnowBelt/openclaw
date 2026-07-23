---
summary: "Preserve custom OpenClaw features through official updates with immutable candidates, explicit approval, and verified rollback."
read_when:
  - You operate an immutable custom OpenClaw runtime
  - You are preparing an official OpenClaw update without losing custom features
  - The Project Command Center reports an update-safety warning
title: "Custom Runtime Update Safety"
---

# Custom runtime update safety

An update-safe custom runtime uses two separate control planes:

1. the normal OpenClaw update path for unmodified installations, and
2. the custom-runtime update broker for installations with registered custom capabilities.

When an immutable custom runtime is active, normal `update.run` requests are rejected with `custom-runtime-update-broker-required`. The managed Gateway also sets `OPENCLAW_NO_AUTO_UPDATE=1`. These independent locks prevent an official package or source update from replacing custom behavior in place.

## Source of truth

`config/custom-runtime-capabilities.json` is the versioned preservation inventory. Its v2 contract requires:

- a stable capability ID and required runtime paths,
- required criticality,
- preserve-or-block migration policy,
- immutable-pointer rollback policy,
- deterministic verification commands,
- a matching owner, tests, proof surfaces, observability, upgrade impact, rollback, and documentation entry in `src/pcc/capability-addition-registry.ts`.

Declared entries in both files are checked by:

```bash
pnpm check:custom-runtime-capabilities
pnpm check:pcc-capabilities
```

A candidate may add declared requirements and cannot silently remove an active declared
requirement. These registry checks do not prove that every customization has been declared. The
deterministic customization inventory is the separate discovery surface for undeclared paths;
PE-02 requires complete capability coverage or an accountable owner waiver before that inventory
becomes a promotion gate.

Generate a deterministic inventory of the customization delta against an exact cached official ref:

```bash
pnpm custom-runtime:customization-inventory -- --upstream-ref origin/main
```

The inventory binds exact commits, merge base, ahead/behind counts, patch equivalence, changed lines,
path ownership, intended disposition, capability coverage, and an SHA-256 inventory hash. Paths
that do not match an owned plugin, core, dashboard, proof, documentation, configuration, or tooling
boundary are marked `manual_classification_required`; candidate extraction must not silently treat
them as preserved.

## Durable source requirement

The active runtime pointer records an exact 40-character Git commit, canonical source checkout, and source branch. The update broker stops before network or build work when:

- the active source is only a working-tree provenance hash,
- the canonical checkout is dirty,
- the canonical checkout or its Git object store resolves outside `$HOME` or the explicitly configured durable source root,
- the commit is missing,
- the checkout HEAD no longer equals the active source commit,
- the configured branch does not contain the active commit, or
- a credential-free remote branch or tag does not resolve to the exact active commit,
- the preservation manifest or control plane is missing.

This prevents an update from rebasing custom behavior from an unrelated or incomplete checkout.
Set `OPENCLAW_CUSTOM_RUNTIME_DURABLE_SOURCE_ROOT` only when the persistent source checkout
intentionally lives on another operator-owned volume. Temporary directories remain invalid even
when their Git object database is stored elsewhere.

Use the migration helper to plan a stable worktree without changing the active runtime:

```bash
custom-runtime-source-migrate.sh \
  --target "$HOME/OpenClaw-custom-runtime-source" \
  --remote SnowBelt
```

After reviewing the JSON plan, the explicit `--apply` form creates a detached worktree at the exact
active SHA and atomically updates source provenance. It does not rebuild or restart the Gateway. A
failed Git or launcher verification restores the previous pointer and removes only a worktree that
the failed attempt created:

```bash
custom-runtime-source-migrate.sh \
  --target "$HOME/OpenClaw-custom-runtime-source" \
  --remote SnowBelt \
  --apply
```

The helper resolves the named remote to a credential-free URL, checks the exact branch or
`--remote-ref`, verifies that the linked worktree's Git object store is persistent, and records the
verified object store, remote URL, ref, and SHA in the active pointer. It shares lifecycle locks
with activation and promotion so source metadata cannot be rewritten across a concurrent runtime
change. Annotated tags are resolved
to their peeled commit. It refuses to migrate when the remote ref is absent or identifies another
commit. HTTPS, SSH, Git, file, absolute local, and SCP-style repository locations are supported;
credential-bearing URLs and executable Git remote helpers are rejected. Remote verification is
required for recovery provenance but never runs on Gateway startup. PCC accepts remote recovery
evidence for at most eight days. The weekly broker writes an exact-identity source-provenance
receipt after a fresh remote lookup; expired pointer metadata without a matching fresh receipt is
reported as non-durable.

## Release retention inventory

Runtime retention is fail-closed and dry-run-only until a separately reviewed quarantine workflow is
approved. Generate a deterministic plan without moving or deleting any release:

```bash
pnpm custom-runtime:retention-plan
```

The planner protects the active runtime, last-known-good runtime, registered rollback candidate and
target, pending update, newest canonical releases, and releases inside the minimum age window.
Legacy, malformed, symlinked, or otherwise unclassified releases are retained for manual review.
The output sets `destructiveOperationsPermitted` to `false` and includes a SHA-256 `planHash`.
There is intentionally no `--apply` or delete mode. Quarantine and permanent deletion remain
separate future milestones requiring an exact reviewed plan and explicit destructive-action
approval.

Capture the broader storage baseline separately:

```bash
pnpm custom-runtime:storage-inventory -- --repo /path/to/durable/source
```

This read-only inventory reports filesystem-allocated bytes for releases, rollback bundles, update
worktrees, receipts, and backups, plus Git loose objects, packed objects, garbage, refs, and linked
worktrees. The complete inventory has one 30-second deadline; each Git or tree-size subprocess gets
at most 15 seconds from the remaining budget. A tree that exceeds that budget is reported as
`measurementStatus: "timed_out"` with `physicalBytes: null`, never as a false zero. Required Git
metrics fail closed when missing, invalid, or timed out. The command does not run Git maintenance or
remove an artifact.

## Prepare, review, approve

The scheduled broker only prepares a candidate:

```bash
custom-runtime-updater.sh --prepare
```

It fetches the selected official stable release, merges it onto the exact active custom commit on a
dedicated candidate branch, runs the configured check/build/test/browser surface, constructs an
immutable release, and writes a `ready_for_approval` receipt. It does not change the live runtime.
The receipt names the candidate branch and its future recovery ref.

After reviewing the receipt, an operator approves that exact candidate:

```bash
custom-runtime-update-approve.sh --receipt /path/to/update-receipt.json
```

Approval fails if the active runtime changed after preparation, the release moved outside the
immutable release root, the source stamp changed, or the recovery ref already identifies another
commit. Approval reruns the isolated staging preflight before it publishes the exact candidate SHA
to the receipt-bound recovery ref, verifies it, and carries the stable source checkout, Git object
store, remote URL, ref, SHA, and verification time into the promoted pointer. A successful approval
reuses staging, health, route, WebSocket,
RPC, capability, and rollback gates before atomic promotion. Staging starts the previous runtime
against the candidate-migrated copied state before promotion, so a state migration that would make
rollback unreadable is rejected without touching live state.

## Project Command Center status

The PCC Update Safety card reports:

- whether normal updates are blocked,
- whether source identity is durable,
- whether the scheduled broker and approval command are installed,
- whether a candidate is waiting for approval,
- the active release, source branch, and latest update receipt,
- exact protection gaps that must be resolved before an update.

The card is status evidence, not permission to promote. Candidate approval remains an explicit operator action.

The scoped exact-SHA remote proof is:

```bash
gh workflow run update-durability-proof.yml \
  --repo SnowBelt/openclaw \
  --ref <update-durability-branch>
```

This dedicated workflow runs only the update-durability lane rather than the wider PCC proof
fan-out.

## Primary Tailnet route continuity

An installation that has a userspace Tailscale state file also installs an independent primary-route guard. The route is optional on systems without that state. On configured systems, the guard:

- recreates the expected LaunchAgent through an atomic, validated plist replacement,
- backs up a malformed or drifted service definition before repair,
- requires the userspace node itself to be online instead of treating a separate GUI-node fallback as healthy,
- restores the HTTPS Serve target with persistent `--bg` state when it is missing, and
- records a redaction-safe receipt without retaining the full Tailscale peer or Serve status payload.

The custom-runtime guard runs this check independently of Gateway process health. A healthy GUI fallback therefore keeps emergency access available, but it no longer hides a failed primary mobile route.

Inspect the configured primary route without repairing it:

```bash
~/.openclaw-custom-runtime/bin/custom-runtime-tailscale-primary.sh status
```

The command exits nonzero when the configured service definition, node health, or persistent Serve target is not ready.

## Recovery

Promotion preregisters a hash-bound rollback bundle containing the previous runtime pointer, Gateway service definition, environment file, and launcher. Failed bootstrap, health, runtime identity, route, WebSocket, or RPC proof restores the prior control plane. `custom-runtime-rollback.sh --verify-only` can validate the registered rollback before an update window.

Never delete the previous immutable release or rollback bundle until the new runtime passes restart, desktop browser, mobile browser, and bounded soak proof.

The Operations Room is a required custom runtime capability. Candidate updates must preserve its
additive protocol, truth and freshness policy, collector, persisted incident history, local probes,
fail-closed monitor-health derivation, atomic task and TaskFlow restore, guarded Gateway methods,
Control UI controller, route, styles, localization, skills, documentation, unit tests, DOM smoke,
real browser E2E, and dedicated exact-SHA workflow proof. The authoritative inventory is the
`runtime:operations-room` entry in `config/custom-runtime-capabilities.json`; a
candidate that removes any declared path fails capability verification before promotion.

Run the canonical focused source proof before candidate preparation:

```bash
pnpm operations-room:verify
```

That command includes the complete Operations and task-registry regression list, all production and
test type lanes including `pnpm tsgo:test:src`, both smoke layers, localization, capability and
workflow checks, and the build.

The complete focused unit-test invocation is maintained in
[Operations Room](/automation/operations-room#focused-verification). The DOM smoke is not browser
proof. The mocked E2E is not managed-runtime proof. The proof workflow must produce the validated
browser receipt, five named screenshots including `tablet-768-increased-contrast.png`, their
checksums, and a passing exact-SHA workflow receipt;
a green job without that uploaded receipt set is incomplete. Production
acceptance requires the same exact source SHA in the canonical source branch, immutable candidate,
active runtime pointer, capability manifest, and Gateway process. After approval, rebuild or restart
the managed Gateway, capture desktop and mobile Operations Room receipts, prove that incident and
since-last-visit state survive restart, observe at least five minutes without liveness, memory, CPU,
focus, refresh, duplicate-transition, or duplicate-change regressions, and keep the preregistered
rollback bundle verified. Run the zero-instruction usability protocol in
[Operations Room](/automation/operations-room#zero-instruction-60-second-usability-protocol) and
retain its exact-SHA receipt; every participant must complete all four outcomes in 60 seconds or
less without a hint or unsafe action. If any identity or proof surface differs, a receipt is missing,
or any usability attempt fails, stop and restore the previous immutable runtime.
