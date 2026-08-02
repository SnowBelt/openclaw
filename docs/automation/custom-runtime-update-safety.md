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
- exact-active-SHA merge strategy,
- register-verify-and-block Dashboard policy,
- explicit exact-candidate approval,
- the canonical update-survival proof command,
- deterministic verification commands,
- a matching owner, tests, proof surfaces, observability, upgrade impact, rollback, and documentation entry in `src/pcc/capability-addition-registry.ts`.

Both files are checked by:

```bash
pnpm check:custom-runtime-capabilities
pnpm check:pcc-capabilities
pnpm custom-runtime:update-survival
```

Adding a dashboard, plugin, workflow, skill, model policy, runtime feature, or update control without updating both registries and its executable preservation proof fails the build. Every tracked file under `scripts/custom-runtime/` must have an explicit capability owner, so a new control-plane file cannot silently fall outside the cumulative digest-bound inventory. A candidate may add requirements. It cannot silently remove an active capability identity or required path.

Control Director deployment consistency is a separate exact-runtime gate. Its registered capability binds the required reliability skill, bundled plugin manifests, role and prompt contracts, Workflow Sanity definition, managed lifecycle helpers, and both customization inventories. Source verification runs as part of `control-director:verify`. Production verification must run after managed restart and consume that restart's receipt:

```bash
pnpm control-director:deployment-consistency -- \
  --expected-sha <exact-sha> \
  --restart-receipt <restart-receipt.json>
```

The live gate fails closed unless every registered file in the immutable release is byte-identical to the exact source, bundled app plugin manifests exist, the active pointer and capability manifest hashes agree, the managed launcher verifies, and Gateway, the prepare-only weekly broker, and the recovery guard are loaded. Its receipt contains hashes and boolean service results, not configuration or secret values.

## Durable source requirement

The active runtime pointer records an exact 40-character Git commit, canonical source checkout, and source branch. The update broker stops before network or build work when:

- the active source is only a working-tree provenance hash,
- the canonical checkout is dirty,
- the commit is missing,
- the configured branch does not contain the active commit, or
- the preservation manifest or control plane is missing.

This prevents an update from rebasing custom behavior from an unrelated or incomplete checkout.

## Canonical production package

Build and package an approved candidate from its clean exact-SHA source checkout. The package command rejects a candidate unless its `HEAD` equals the requested SHA and the currently active source SHA is an ancestor:

```bash
pnpm build
pnpm custom-runtime:package -- \
  --source /path/to/candidate \
  --releases "$HOME/.openclaw-runtime-releases" \
  --source-sha <candidate-sha> \
  --active-sha <active-sha> \
  --release-id <unique-release-id>
```

The packager uses the exact build snapshot, creates a production-only dependency closure, copies every registered capability path directly from the candidate Git commit rather than mutable working-tree bytes, and writes an additive runtime-closure inventory and SHA-256 digest into `snapshot.json`. It rechecks the candidate after dependency deployment to stop if packaging dirtied the source. Before sealing, after sealing, and before every managed launch, the packaged verifier recomputes both the build-artifact hash and the complete runtime-closure hash. It rejects missing Research Manager dependencies, changed bytes or executable bits, broken or release-escaping symlinks, special filesystem entries, unregistered capability paths, sensitive key or environment files outside dependencies, and forbidden source, state, or build-artifact directories.

The seal marker binds both the exact source SHA and the runtime-closure digest. Legacy sealed runtimes remain valid rollback targets, but every newly closure-enabled package must pass the packaged verifier. A packaging failure never changes the active pointer and leaves no accepted unsealed release.

## Prepare, review, approve

The scheduled broker only prepares a candidate:

```bash
custom-runtime-updater.sh --prepare
```

Managed promotion installs and loads `ai.openclaw.custom-runtime.update-weekly` and `ai.openclaw.custom-runtime.guard` from the promoted release. The update LaunchAgent runs the prepare-only broker every Sunday at 03:30 local time. The guard watches the managed Gateway definition and periodically verifies runtime health; it defers rather than restarting when the required Keychain secret is unavailable. Promotion renders both LaunchAgents with the active user's portable paths instead of retaining machine-specific source paths. The broker fetches the selected official stable release and creates an exact two-parent merge on a dedicated candidate branch: parent one is the exact active custom commit and parent two is the selected official commit. It proves that ancestry, checks the cumulative capability/path inventory, digest-binds every required candidate path, then runs the ordered verification commands from the preservation manifest. It constructs an immutable release and writes a `ready_for_approval` receipt that binds the update-survival proof by SHA-256. It does not change the live runtime. The receipt names that exact candidate branch so an approved runtime remains the durable base for the following update cycle.

After reviewing the receipt, an operator approves that exact candidate:

```bash
custom-runtime-update-approve.sh --receipt /path/to/update-receipt.json
```

Approval fails if the active runtime changed after preparation, the preservation proof or digest changed, any preservation-bound release path is missing, unsafe, or no longer matches its proof digest, the proof names another candidate or parent pair, the release moved outside the immutable release root, the active runtime's trusted seal verifier finds any writable release file or directory, or the source stamp changed. The broker also rechecks that the verified candidate source remains clean immediately before snapshotting it. A successful approval reuses staging, health, route, WebSocket, RPC, capability, and rollback gates before atomic promotion. Staging starts the previous runtime against the candidate-migrated copied state before promotion, so a state migration that would make rollback unreadable is rejected without touching live state.

Direct managed promotion independently reads the current active pointer under the promotion lock and verifies that its exact source commit is an ancestor of the requested candidate commit. A changed or invalid active source identity, missing candidate repository provenance, branch-to-SHA mismatch, or non-ancestor candidate stops before backups, rollback registration, pointer replacement, service files, or launchd are changed. This closes the race where a candidate's CI remains green after another approved runtime is promoted.

Long-running exact-SHA certification can additionally bootstrap an expiring freeze through `custom-runtime-promote.sh --lease-acquire`. The lease binds the current active SHA, candidate SHA, owner, `release-certification` operation class, approval identity, operation identity, certification invocation identity, actor, PID, creation time, and expiration time. Acquisition leaves the lease in `acquired`; even the matching candidate cannot activate or promote until the exact owner binding performs `--lease-authorize-promotion`. A successful promotion advances the lease to `promoted`, after which candidate restart and soak verification can proceed. Exact release or verifiable expiration recovery removes the lease with a private typed receipt.

Human proof uses the separate `human-usability-finalization` operation class after the candidate is
already active. Acquisition requires `--usability-campaign` pointing to an owner-only file below
`$OPENCLAW_CUSTOM_RUNTIME_HOME/usability`. The campaign must be exact-SHA `ready`, contain at least
one consented anonymous Control Director owner, bind the same exact SHA as both candidate and active
runtime, identify Chrome on the managed Mac Studio, and contain no failed or unsafe attempt. Status
and lifecycle checks independently recompute those facts while the lease exists. The same owner may
accept later exact candidates, but cannot retry within a campaign. An invalid campaign blocks
retention, but exact-binding release still works so failed owner evidence cannot strand the runtime
behind a lease.

Promotion, activation, restart, rollback, guard repair, and lease transitions share one private global lifecycle lock. Its receipts bind actor, Release Governor approval identity, operation identity, PID, invocation identity, timestamps, and the exact active/candidate SHA pair. Malformed or conflicting state, unsafe permissions, future creation times, durations above 24 hours, live concurrency, and recently orphaned locks fail closed. A valid dead lock becomes recoverable only after the bounded stale interval and produces a recovery receipt; the guard never deletes lifecycle locks by age alone.

New certification leases also carry an exact-owner heartbeat sequence. The owner must refresh it during remote checks, review waits, and soak:

```bash
custom-runtime-promote.sh --lease-heartbeat \
  --active-sha <active-sha> --candidate-sha <candidate-sha> \
  --owner <owner> --operation-class release-certification \
  --approval-id <approval-id> --operation-id <operation-id> \
  --invocation-id <certification-invocation-id>
```

`--lease-status` reports the heartbeat age as `fresh` or `stale`. A missing or malformed heartbeat fails closed. A lease created before heartbeat support reports `unsupported` and remains recoverable only through the existing explicit emergency path.

Bounded orphan recovery is narrower than emergency invalidation. It is available only for an unexpired lease that is still in `acquired`, has never been promotion-authorized or promoted, is at least 30 minutes old, and has received no heartbeat for at least 30 minutes. Recovery also requires a fresh private activity proof bound to the exact lease digest and identities. That proof must confirm a dead owner PID and no active owner work. While holding the global lifecycle lock, the recovery command independently queries the named GitHub repository for the exact candidate and rejects any queued, waiting, requested, pending, in-progress, malformed, ambiguous, or unqueryable check state. The caller must supply a separate exact Release Governor recovery approval and typed reason. Any ambiguity, recent or future-dated evidence, digest drift, active check, lifecycle concurrency, or state transition blocks recovery without changing the lease.

An active certification lease freezes normal rollback and guard mutation. Emergency rollback remains available only after the normal exact-SHA Release Governor bundle succeeds and the caller supplies a typed reason. Before runtime mutation, that path removes the lease and writes a `certification-invalidated` receipt, so recovery cannot be mistaken for successful certification. The lease is never an approval substitute: every stage, promotion, restart, rollback, and finalization operation still requires its operation-specific Release Governor evidence.

Use one stable owner, approval, operation, and certification invocation binding throughout the campaign:

```bash
custom-runtime-promote.sh --lease-acquire \
  --active-sha <active-sha> --candidate-sha <candidate-sha> \
  --owner <owner> --operation-class release-certification \
  --approval-id <approval-id> --operation-id <operation-id> \
  --invocation-id <certification-invocation-id> --ttl-seconds 3600

custom-runtime-promote.sh --lease-authorize-promotion \
  --active-sha <active-sha> --candidate-sha <candidate-sha> \
  --owner <owner> --operation-class release-certification \
  --approval-id <approval-id> --operation-id <operation-id> \
  --invocation-id <certification-invocation-id>

# Acquire only after `operations-room:usability status` reports ready.
custom-runtime-promote.sh --lease-acquire \
  --active-sha <active-candidate-sha> --candidate-sha <active-candidate-sha> \
  --owner <owner> --operation-class human-usability-finalization \
  --approval-id <approval-id> --operation-id <operation-id> \
  --invocation-id <finalization-invocation-id> --ttl-seconds 3600 \
  --usability-campaign "$OPENCLAW_CUSTOM_RUNTIME_HOME/usability/<campaign>.json"
```

## Dashboard customization rule

Every Dashboard edit is update-sensitive. The same change must register or update its stable capability and required paths, add or retain deterministic UI proof, align the checked capability standards registry, and pass `pnpm custom-runtime:update-survival`. The Control Director reliability roadmap records this as M61. Source preservation alone is not completion: managed activation, automated desktop/tablet/mobile proof, owner acceptance in production Chrome on the managed Mac Studio, restart recovery, rollback-and-restore, and soak remain separate truth surfaces. Blacksmith, Testbox, Crabbox, and equivalent third-party execution environments are optional for Operations Room and Control Director work; their availability is never a completion requirement.

## Project Command Center status

The PCC Update Safety card reports:

- whether normal updates are blocked,
- whether source identity is durable,
- whether the prepare-only broker and approval command are installed and its weekly LaunchAgent is loaded,
- whether the managed runtime recovery guard is installed and its LaunchAgent is loaded,
- whether a candidate is waiting for approval,
- the active release, source branch, and latest update receipt,
- exact protection gaps that must be resolved before an update.

The card is status evidence, not permission to promote. Candidate approval remains an explicit operator action.

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

Control Director production readiness independently calls the same status reader and fails when either the prepare-only broker or runtime recovery guard is missing or its LaunchAgent is not loaded. This prevents source-only control-plane claims from satisfying M61.

## Recovery

Promotion preregisters a hash-bound rollback bundle containing the previous runtime pointer, Gateway service definition, environment file, and launcher. Failed bootstrap, health, runtime identity, route, WebSocket, RPC, update-scheduler installation, or recovery-guard installation restores the prior control plane and the prior loaded/unloaded state of both auxiliary LaunchAgents. `custom-runtime-rollback.sh --verify-only` can validate the registered rollback before an update window.

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
proof. The mocked E2E is not managed-runtime proof. The canonical local exact-source proof must
produce the validated browser receipt, five named screenshots including
`tablet-768-increased-contrast.png`, their checksums, and a passing exact-SHA local proof receipt.
An optional hosted workflow, when explicitly requested, is supplementary and is never a completion
requirement. Production
acceptance requires the same exact source SHA in the canonical source branch, immutable candidate,
active runtime pointer, capability manifest, and Gateway process. After approval, rebuild or restart
the managed Gateway, retain automated desktop and mobile Operations Room receipts, capture the real
production Chrome receipt on the managed Mac Studio, prove that incident and since-last-visit state
survive restart, observe at least five minutes without liveness, memory, CPU, focus, refresh,
duplicate-transition, or duplicate-change regressions, and keep the preregistered rollback bundle
verified. Run the Control Director owner acceptance protocol in
[Operations Room](/automation/operations-room#control-director-owner-acceptance-protocol) and retain
its exact-SHA receipt; the owner must complete all five outcomes in 60 seconds or less without a
hint or unsafe action. If any identity or proof surface differs, a receipt is missing, or the owner
attempt fails, stop and restore the previous immutable runtime.
