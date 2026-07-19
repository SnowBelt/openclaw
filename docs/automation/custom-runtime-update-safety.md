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
2. the scheduled, prepare-only custom-runtime update broker for installations with registered custom capabilities.

When an immutable custom runtime is active, normal `update.run` requests are rejected with `custom-runtime-update-broker-required`. The managed Gateway also sets `OPENCLAW_NO_AUTO_UPDATE=1`. These independent locks prevent an official package or source update from replacing custom behavior in place.

## Source of truth

`config/custom-runtime-capabilities.json` is the versioned preservation inventory. The current inventory revision is 3 under schema v2, with preservation contract v2. It requires:

- a stable capability ID and required runtime paths,
- required criticality,
- preserve-or-block migration policy,
- immutable-pointer rollback policy,
- exact-active-SHA merge strategy,
- register-verify-and-block policy for every Dashboard customization,
- explicit approval of one exact proof-bound candidate,
- the canonical `pnpm custom-runtime:update-survival` proof command,
- deterministic verification commands,
- a matching owner, tests, proof surfaces, observability, upgrade impact, rollback, and documentation entry in `src/pcc/capability-addition-registry.ts`.

Both files are checked by:

```bash
pnpm check:custom-runtime-capabilities
pnpm check:pcc-capabilities
pnpm custom-runtime:update-survival
```

Adding a dashboard, plugin, workflow, skill, model policy, runtime feature, or update control without updating both registries and its executable preservation proof fails the build. A candidate may add requirements. It cannot silently remove an active capability identity or required path.

## Durable source requirement

The active runtime pointer records an exact 40-character Git commit, canonical source checkout, and source branch. The update broker stops before network or build work when:

- the active source is only a working-tree provenance hash,
- the canonical checkout is dirty,
- the commit is missing,
- the configured branch does not contain the active commit, or
- the preservation manifest or control plane is missing.

This prevents an update from rebasing custom behavior from an unrelated or incomplete checkout.

## Prepare, review, approve

The scheduled broker only prepares a candidate:

```bash
custom-runtime-updater.sh --prepare
```

Managed promotion installs and loads `ai.openclaw.custom-runtime.update-weekly` from the promoted release. The LaunchAgent runs the prepare-only broker every Sunday at 03:30 local time. It fetches the selected official stable release and creates an exact two-parent merge on a dedicated candidate branch: parent one is the exact active custom commit and parent two is the selected official commit. The broker proves that ancestry, checks the cumulative capability/path inventory, digest-binds every required candidate path, then runs the ordered verification commands from the preservation manifest. It constructs an immutable release and writes a `ready_for_approval` receipt that binds the update-survival proof by SHA-256. It does not change the live runtime. The receipt names that exact candidate branch so an approved runtime remains the durable base for the following update cycle.

After reviewing the receipt, an operator approves that exact candidate:

```bash
custom-runtime-update-approve.sh --receipt /path/to/update-receipt.json
```

Approval fails if the active runtime changed after preparation, the preservation proof or digest changed, the proof names another candidate or parent pair, the release moved outside the immutable release root, or the source stamp changed. A successful approval reuses staging, health, route, WebSocket, RPC, capability, and rollback gates before atomic promotion. Staging starts the previous runtime against the candidate-migrated copied state before promotion, so a state migration that would make rollback unreadable is rejected without touching live state.

## Dashboard customization rule

Every Dashboard edit is update-sensitive. The same change must register or update its stable capability and required paths, add or retain deterministic UI proof, align the checked capability standards registry, and pass `pnpm custom-runtime:update-survival`. The Control Director reliability roadmap records this as M61. Source preservation alone is not completion: managed activation, desktop/tablet/mobile acceptance, restart recovery, rollback-and-restore, and soak remain separate truth surfaces.

## Project Command Center status

The PCC Update Safety card reports:

- whether normal updates are blocked,
- whether source identity is durable,
- whether the prepare-only broker and approval command are installed and its weekly LaunchAgent is loaded,
- whether a candidate is waiting for approval,
- the active release, source branch, and latest update receipt,
- exact protection gaps that must be resolved before an update.

The card is status evidence, not permission to promote. Candidate approval remains an explicit operator action.

## Recovery

Promotion preregisters a hash-bound rollback bundle containing the previous runtime pointer, Gateway service definition, environment file, and launcher. Failed bootstrap, health, runtime identity, route, WebSocket, RPC, or update-scheduler installation restores the prior control plane and prior scheduler state. `custom-runtime-rollback.sh --verify-only` can validate the registered rollback before an update window.

Never delete the previous immutable release or rollback bundle until the new runtime passes restart, desktop browser, mobile browser, and bounded soak proof.

The Operations Room is a required custom runtime capability. Candidate updates must preserve its
collector, shadow monitor, guarded gateway methods, Control UI route, tests, and browser smoke. A
candidate that removes any of those paths fails capability verification before promotion.
