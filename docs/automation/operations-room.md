---
summary: "Operate OpenClaw from one truthful, low-overhead view of agents, workflows, schedules, capabilities, models, and host resources."
read_when:
  - You need to see what OpenClaw is doing and what needs attention
  - You need to verify that scheduled or always-on work is healthy
  - You are adding an agent, workflow, skill, plugin, tool, model route, or runtime process
title: "Operations Room"
---

# Operations Room

The Operations Room is OpenClaw's deterministic operational briefing. It is exception-first: the
default view summarizes the present situation and progressively discloses inventories only when the
operator asks for them.

It must answer five questions in a few seconds without invoking a model:

1. Is OpenClaw okay?
2. Does anything need me?
3. What is working now?
4. What changed since I last looked?
5. Where can I inspect the evidence?

The page does not pretend that configured means running, that old failures are current incidents, or
that a bounded row list is an exact total. It also does not invent per-agent RAM. Agents share the
Gateway process, so per-agent memory remains unavailable until a runtime provides real attribution.

## Snapshot authority and compatibility

`operations.snapshot.v2` is the authoritative Operations Room contract. The legacy
`operations.snapshot` method remains the exact original V1 wire shape; the Gateway creates that V1
response by projecting and sanitizing a V2 snapshot rather than adding V2-only fields to the old
schema.

The Control UI requests V2 first. It requests V1 only when the Gateway explicitly reports that the
V2 method is unknown, unsupported, or not found. Authentication, connectivity, validation, timeout,
and collector failures remain visible errors; they never trigger a legacy fallback that could hide a
real V2 failure.

When fallback is necessary, the UI adapts the exact V1 response locally into a conservative display
model. That compatibility view is always Partial, caps its quality score below the 93-point target,
marks health and catalog availability unverified, adds an update warning, and cannot show an
all-clear. This local adapter does not change the V1 wire contract.

## Information hierarchy

The default order is:

1. a deterministic one-sentence briefing;
2. no more than five summary controls for issues, current work, agents, automations, and system;
3. Needs your attention;
4. Working now;
5. Since your last visit;
6. the collapsed agent directory;
7. system health; and
8. work history, schedules, capabilities, models, and host processes behind More or Details.

The briefing is assembled from structured facts. An optional model-written explanation can never
replace or contradict it. Each summary control is a real link or button that applies a stable URL
filter, moves focus to the destination heading, and preserves browser Back and Forward behavior.

## State semantics

Activity, health, and attention are independent:

- activity: working, waiting, scheduled, ready, off, or unknown;
- health: healthy, degraded, failed, or unknown; and
- attention: needs user, OpenClaw handling, watching, or none.

An agent can therefore be working and degraded at the same time. `Working` means an active task or a
Control UI-visible Gateway session run has a live owner. The collector reconciles both sources by run
ID so one task-backed session is counted once. Session activity changes the working-agent count
without pretending that an interactive conversation is a detached background task. A terminal task
is Last activity or History, never Current work. A running workflow without an active owner, active
task, or explicit waiting state becomes a reconciliation warning.

Current findings and historical outcomes are separate. The actionable count includes only unresolved
current findings; informational history does not inflate it. Every actionable finding should report
impact, owner, response state, last progress, next action, next check, and whether the operator must
act when those facts are known.

The default finding card exposes its response, owner, and next action before Details. An affected
agent row names the attention condition instead of saying Ready, and its Review issue control returns
the operator to the authoritative finding. A one-click repair appears only when the action is one of
the guarded controls below and has an exact previewable target; the UI never offers a generic Fix
button for an ambiguous or unsafe mutation.

An unresolved incident is resolved only after its source category is observed authoritatively and
the finding is absent. If that source becomes unavailable or fallback-only, the ledger carries the
incident as Last known with its original observation time and marks its current state unverified. It
preserves the prior actionable disposition, using Watching only when a retained historical row needs
to become visible again. Missing data is never treated as recovery.

## Counts, freshness, and partial data

Exact aggregates are computed before pagination or row limits. Every bounded collection reports:

- total count;
- shown count; and
- whether more rows were truncated or remain available.

The UI uses `200+` or `200 of 427`, never `200`, when it has not proved the exact total.

Every snapshot carries an observation time plus source freshness and completeness. If a required
collector is stale, failed, or incomplete, the affected section says Last known or Unknown and the
overall state is Partial. Stale or partial data can never produce an unconditional all-clear.

Process collection follows the same rule. Intentionally omitted process data is marked Omitted and
does not make an otherwise complete snapshot partial. A successful bounded parse is Available. If
some nonblank process rows are rejected, accepted rows remain visible but the source is Fallback and
the snapshot is Partial. Empty, failed, or entirely rejected output is Unavailable. Process totals
count accepted rows only, the collection reports rejected rows separately, command arguments are
never returned, and only the current Gateway PID is classified as the Gateway.

## Work summaries and rollups

Task and workflow producers use the generic runtime contract:

- `label` is the concise display title;
- `progressSummary` is the current one-sentence update;
- `terminalSummary` is the outcome;
- `taskKind` classifies work; and
- `sourceId` identifies recurring work for rollups.

The overview sanitizes and bounds those fields. The raw task or mission remains available in Details
and is not used as the default card body. Repeated runs with the same runtime and `sourceId` collapse
into one row with count, latest outcome, and latest time; warning or critical transitions remain
visible. Plugins consume the same additive generic task and capability contracts. The Operations Room
must not import plugin-specific internals or create a second plugin truth store.

## Agent order

The operational sort is stable within these groups:

1. urgent;
2. needs attention or blocked;
3. working, with unhealthy work first;
4. waiting or scheduled soon;
5. recently changed;
6. ready; and
7. off or unknown.

Within a group, order by attention state, health, activity, explicit pin, latest activity, then name.
Ready and Off groups are collapsed by default. A Directory sort remains available for alphabetical
lookup. Pins never outrank urgent or unhealthy work.

## Color and accessibility

Color reinforces status but never carries it alone. Red means urgent, amber needs attention, blue
working, green verified healthy or complete, and gray ready, waiting, off, or unknown. Every state
also has text and an icon. The page uses no blinking status, respects reduced motion and increased
contrast, retains visible keyboard focus, works at 200% zoom, and keeps primary controls at least 44
CSS pixels on touch layouts. Quiet refreshes preserve focus and do not repeatedly announce unchanged
content to assistive technology.

## Runtime policy

- `operations.snapshot.v2` is authoritative. `operations.snapshot` remains the exact
  backward-compatible V1 response, with fallback behavior defined in Snapshot authority and
  compatibility above.
- The Gateway runs a 60-second, unref'd shadow monitor using local runtime facts only.
- The monitor never starts an agent, invokes an LLM, changes config, or kills a process.
- The monitor reconciles host-resource, task, and workflow findings. Snapshot collection reconciles
  the remaining source categories. All findings use the same transition-aware incident ledger so
  first-observed and since-last-visit state survive a Gateway restart.
- Monitor health distinguishes attempts from completed sweeps. A failed attempt updates the attempt
  time and error while preserving the last successful sweep; it does not fabricate a successful
  sweep. A stopped or not-yet-started monitor is labeled as request-time reconciliation and has no
  invented sweep timestamps.
- The browser refreshes the active Operations Room every 15 seconds while visible.
- Host process collection is bounded, omits command arguments, and returns only the largest RSS rows.
- Host capacity uses Linux `MemAvailable` or macOS `memory_pressure` when available, then falls back
  to raw free memory. The UI labels this as available capacity rather than total resident allocation.
  Available and immediately free RAM remain distinct. Local-model process count and process RSS are
  shown separately because RSS can include shared or reclaimable model pages and must not be added to
  the host pressure estimate.
- Catalogs keep configured, active, unavailable, and unverified states distinct.
- Repeated dashboard findings and task runs are grouped by stable identity so quiet refreshes do not
  turn unchanged state into new visual alerts.

Existing specialized supervisors remain authoritative: heartbeat owns always-on wakeups, cron owns
schedules, task registry maintenance owns task lifecycle, channel health owns channels, the skill
curator owns skill maintenance, and the Self-Improvement Governor owns recommendation governance.
The Operations Room projects and reconciles those facts instead of creating competing loops.

## Registry restore safety

Task and TaskFlow snapshots restore atomically. OpenClaw loads, normalizes, and indexes a candidate
snapshot in temporary memory, then replaces the live registry only after every step succeeds. A load,
normalization, or index failure preserves the previous complete in-memory snapshot.

If the first restore fails, the registry has no authoritative state: writes are refused and
Operations Room marks the affected task or workflow source unavailable. The internal reload seam is
explicitly retryable. A successful retry replaces the registry and clears the restore failure; a
failed retry never clears or partly overlays the last complete state.

## Guarded controls

The supported controls are deliberately bounded:

- run, pause, or enable a cron job;
- cancel a managed task; and
- cancel a managed TaskFlow.

Task and TaskFlow cancellation require `operator.write`. Cron run, pause, and enable preserve the
canonical cron boundary and require `operator.admin`. Every mutation also requires a short-lived
single-use preview, an exact action and target match, fresh and complete source data, and explicit
confirmation. Preview cancellation changes nothing; replay is rejected. Process killing, model
starting, plugin installation, config editing, and permission changes remain in their owner surfaces.

## Addition and update standard

Every new agent, workflow, skill, plugin, tool, model route, or process declares a stable ID, owner,
duty, deterministic health signal, stale threshold, permission and cost class, retry policy,
observability, proof commands, update impact, and rollback path.

Register custom-runtime additions in both `config/custom-runtime-capabilities.json` and
`src/pcc/capability-addition-registry.ts`. Operations Room changes must begin from a clean canonical
custom-source branch at an exact Git SHA. Never edit an immutable release. Candidate staging,
capability checks, atomic promotion, Gateway restart, desktop and mobile browser receipts, persistence
proof, at least five minutes of bounded soak, and a verified rollback bundle are separate gates.

The 93-point target is a release-quality acceptance threshold, not a live reliability score. The
primary live header reports plain facts such as critical issues, warnings, freshness, and system
state. A release cannot pass with a critical defect in truth, issue visibility, stale-data handling,
accessibility, or guarded actions even if its aggregate quality score is above 93.

The frozen V1 compatibility response retains its legacy finding-severity score. V2 also carries that
field during the compatibility window, but the Control UI does not present it as reliability or use
it as a live health gate.

## Milestone and proof map

| ID     | Milestone                      | Required proof                                                                                                                                                      |
| ------ | ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| OR2-00 | Baseline and approval          | Current screenshots, user journeys, terminology, and approved information map                                                                                       |
| OR2-01 | Truth contract                 | Additive protocol, separate state axes, exact totals, freshness, and schema tests                                                                                   |
| OR2-02 | Collector correctness          | Current versus last work, duty, process, count, and owner-invariant tests                                                                                           |
| OR2-03 | Attention model                | Action, handling, watching, history, ownership, and transition tests                                                                                                |
| OR2-04 | Summaries and rollups          | Sanitized task summaries and recurring-source grouping tests                                                                                                        |
| OR2-05 | Overview and navigation        | Briefing, deep-link, URL, focus, and Back and Forward browser proof                                                                                                 |
| OR2-06 | Agent directory                | Priority grouping, stable sort, search, pins, and collapsed idle groups                                                                                             |
| OR2-07 | System and capability detail   | Honest memory, model, configured, active, unverified, and process states                                                                                            |
| OR2-08 | Freshness and change history   | Persistent incident ledger, restart, stale, partial, and since-last-visit tests                                                                                     |
| OR2-09 | Accessibility and localization | Keyboard, non-color cues, zoom, contrast, motion, responsive, and i18n proof                                                                                        |
| OR2-10 | Governance and preservation    | Skills, docs, dedicated proof workflow, and both capability registry checks                                                                                         |
| OR2-11 | Automated release proof        | Targeted tests, DOM smoke, real E2E, typecheck, build, and remote changed gate                                                                                      |
| OR2-12 | Production and human proof     | Exact-SHA promotion, restart, receipts, persistence, soak, rollback, and every first-use participant completing the zero-instruction protocol in 60 seconds or less |

Dispatch `.github/workflows/operations-room-proof.yml` with the candidate branch or tag as
`target_ref` and the candidate's full commit as `expected_sha`. The workflow rejects an identity
mismatch before installing dependencies, runs `pnpm operations-room:verify` plus the remote changed
gate, validates every required browser artifact, and uploads checksummed desktop, mobile,
machine-readable browser, and exact-SHA workflow receipts.

When a recovery branch contains the proof workflow before it is registered on the repository's
default branch, a push to `codex/operations-room-recovery-*` runs the same proof automatically. That
bootstrap path binds `target_ref` to the pushed branch and `expected_sha` to the immutable push SHA;
it does not weaken or bypass any receipt, identity, canonical-verification, or changed-gate check.

`pnpm ui:smoke:operations-room:dom` is structural proof only.
`pnpm ui:smoke:operations-room:e2e` is the deterministic browser proof. Neither proves the managed
runtime until the same exact SHA is promoted and observed. A milestone is complete only when its named
proof passes; source, CI, runtime, browser, persistence, rollback, and human usability remain separate
evidence surfaces.

## Required proof receipts

The automated proof artifact is valid only when all of these files are present and nonempty:

- `receipt.json` with schema `openclaw.operations-room.e2e-receipt.v3`, route `/operations`, result
  `passed`, valid start and completion timestamps, source SHA and worktree state, runtime versions,
  every required boolean check set to `true`, and byte-count and SHA-256 evidence for every screenshot;
- `desktop-light.png`, `desktop-dark.png`, `mobile-320.png`, `mobile-rtl.png`, and
  `tablet-768-increased-contrast.png` named by that browser receipt;
- `browser-receipt.sha256` covering `receipt.json`; and
- `workflow-receipt.json` with schema `openclaw.operations-room.workflow-receipt.v1`, status `passed`,
  identical expected and checked-out SHAs, target ref, workflow run identity, the canonical and
  changed-gate commands, the browser-receipt digest, and a SHA-256 digest for every prerequisite
  artifact uploaded with the workflow receipt.

The production bundle is separate. It must bind the same landed SHA to the canonical source branch,
immutable runtime pointer, capability manifest, and Gateway process; include desktop and mobile
receipts; prove incident-ledger and since-last-visit persistence across restart; record at least five
minutes of bounded liveness, RAM, CPU, focus, refresh, and duplicate-transition soak; verify the
preregistered rollback bundle by restoring the prior runtime and then re-proving the candidate; and
include the human usability receipt below. A missing field, failed check, identity mismatch, omitted
attempt, or unverifiable artifact fails closed.

## Zero-instruction 60-second usability protocol

Use at least five people who have not seen the current Operations Room and have not received a
walkthrough. Include at least one participant in each of the 7-12, 13-64, and 65-90 age cohorts,
with guardian consent where required. Cover desktop and mobile, and include keyboard-only or 200%
zoom in at least one attempt. Use a deterministic safe snapshot containing at least one actionable
issue and one working item; do not expose mutation controls that can affect production.

Give each participant only this neutral goal, with no explanation of labels, colors, controls, or
navigation: “Use this screen to tell me whether OpenClaw needs the operator, what it is doing now,
and show me the most important issue's details.” Start the timer when the rendered Operations Room
becomes visible. Stop it when the participant has done all four of the following:

1. stated the overall system state correctly;
2. stated whether the operator must act and the actionable-issue count;
3. identified one currently working agent or work item; and
4. opened the highest-priority issue's details and identified its owner or next action.

An attempt passes only when all four outcomes are correct in 60,000 milliseconds or less, the
observer provided zero hints or corrective prompts, and the participant triggered no mutating or
unsafe action. The release gate passes only when every recorded participant passes; do not discard,
replace, or retry a failed attempt.

Write one machine-readable usability receipt containing the exact SHA, scenario fixture hash,
non-identifying participant cohort, device and viewport, accessibility settings, start and finish
timestamps, elapsed milliseconds, four per-outcome booleans, hint count, unsafe-action count,
observer attestation, and aggregate result. Store consent separately from the repository and never
put participant names in the receipt.

## Focused verification

Run the focused source tests as one Vitest invocation so the shared cache cannot race:

```bash
pnpm test \
  packages/gateway-protocol/src/schema/operations.test.ts \
  src/operations/status.test.ts \
  src/operations/compat.test.ts \
  src/operations/action-guard.test.ts \
  src/operations/host-memory-probe.test.ts \
  src/operations/process-probe.test.ts \
  src/operations/incident-ledger.test.ts \
  src/operations/collector.test.ts \
  src/operations/monitor.test.ts \
  src/operations/monitor-health.test.ts \
  src/tasks/task-registry.store.test.ts \
  src/tasks/task-flow-registry.store.test.ts \
  src/tasks/task-registry.maintenance.issue-60299.test.ts \
  src/tasks/task-registry.test.ts \
  src/tasks/task-flow-registry.test.ts \
  src/gateway/server-methods/operations.test.ts \
  src/gateway/method-scopes.test.ts \
  src/gateway/server-maintenance.test.ts \
  src/gateway/server-runtime-services.test.ts \
  src/gateway/server-close.test.ts \
  src/gateway/server-startup-post-attach.test.ts \
  ui/src/ui/app.operations-polling.test.ts \
  ui/src/ui/controllers/operations.test.ts \
  ui/src/ui/controllers/operations-navigation.test.ts \
  ui/src/ui/controllers/operations-preferences.test.ts \
  ui/src/ui/views/operations-model.test.ts \
  ui/src/ui/views/operations.test.ts \
  ui/src/ui/navigation.test.ts \
  ui/src/ui/views/overview.render.test.ts \
  src/pcc/capability-addition-registry.test.ts \
  src/pcc/custom-runtime-capabilities.test.ts
```

Then run the static, browser, registry, workflow, and build surfaces:

```bash
pnpm tsgo:all
pnpm tsgo:test:src
pnpm tsgo:test:packages
pnpm tsgo:test:ui
pnpm ui:smoke:operations-room:dom
pnpm ui:smoke:operations-room:e2e
pnpm ui:i18n:check
pnpm check:pcc-capabilities
pnpm check:custom-runtime-capabilities
pnpm check:workflows
pnpm build
```

The canonical focused source command is `pnpm operations-room:verify`; it runs the exact unit-test
list and every static, DOM, browser, localization, registry, workflow, and build command above in
sequence. The exact-SHA workflow invokes this command rather than maintaining a second divergent
test list.

`pnpm ui:smoke:operations-room` runs the DOM and browser smoke commands together. Run the broad
changed gate in Testbox or CI when it selects shared lanes. The exact-SHA workflow remains the
canonical automated release proof; managed-runtime restart, persistence, soak, rollback, and
untrained human usability are later, separate gates.
