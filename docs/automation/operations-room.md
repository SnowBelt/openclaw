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
- The Gateway runs a 60-second, unref'd supervisor using local runtime facts.
- The supervisor may run only registered automatic-repair recipes. Every automatic recipe is
  bounded, deterministic, reversible, and post-repair verified. It never kills a process.
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

## Resolving an issue

Every current issue has a **Recommended resolution** disclosure. It explains what happened, the
impact, owner, recommended fix, why it is recommended, confidence, risk, exact expected change,
verification, approval requirement, where progress and completion evidence will appear, and how a
proposed change would be undone.

The primary action is **Fix this for me**. For an eligible reviewed medium-risk repair, it opens the
same exact guarded preview and requires one concise confirmation. For a deterministic low-risk
recipe, OpenClaw may repair immediately and verify it. When no approved recipe exists, the action
opens a visible read-only Chat draft for local investigation and a concrete recommendation. Opening
the draft does not send it or start work. The operator reviews and sends it explicitly. The draft
requires deterministic checks first, local AI for investigation and recommendations, an independent
local Judge safety review, Codex only for high-risk or low-confidence escalation, and a proposed
change/verification/rollback plan before any separate approval. **Not now** only defers the
recommendation; it is never presented as a repair.

The UI never labels an issue as investigating, applying, verifying, or resolved unless the
authoritative finding state supports that label. Missing, stale, partial, ambiguous, or unsupported
state fails closed to **Needs review** and never exposes a generic one-click mutation.

## Automatic remediation

Low-risk issues may be repaired automatically only by one exact registered recipe with a rollback
point, independent deterministic authoritative read-back verification, and the same authoritative
read-back verification for rollback.

Medium-risk issues have the same requirements plus recipe confidence of at least 0.90, a bounded
investigation by local `qwen3.6:27b-q8_0`, and approval by the independent local
`openclaw-judge-qwen35-27b-q8:latest` Judge. A Judge rejection, malformed response, unavailable model,
low confidence, ambiguous recipe match, changed precondition, or unavailable evidence makes no
change and fails closed.

High-risk and security, financial, credential, production-release, destructive, policy-expanding,
irreversible, novel, or uncertain actions always require explicit operator approval. Codex is an
escalation path for high-risk, novel, low-confidence, or repeatedly failing cases; it is not in the
automatic repair loop. Failed or approval-required attempts expose **Review with Codex**, which
opens a read-only escalation draft with the exact recipe, result, and rollback context; it does not
send the draft or start work.

The initial approved recipe pauses an enabled, non-running schedule only after its stored state
confirms at least three consecutive failed runs. It records a rollback point, pauses that exact
schedule, reads the schedule back to verify it is disabled, and exposes the existing guarded
**Undo this repair** action to re-enable it. A failed or thrown verification automatically re-enables
the schedule and verifies the rollback. Automatic rollback is bound to the exact stored schedule
version created by the repair; if another actor changes the schedule meanwhile, rollback stops
instead of overwriting that newer change. A failed rollback stays visible and is never silently
retried. If the Gateway lifecycle interrupts an active attempt, the next supervisor start converts
that receipt to a visible failed/needs-review result; it does not leave a false in-progress state or
silently retry an uncertain mutation.

Each attempt is stored as a bounded private receipt. The current issue shows what happened, impact,
owner, exact repair, repair risk, progress, result, evidence, and rollback or Undo availability.
Active attempts appear under **OpenClaw is handling**. Terminal attempts appear under **Since your
last visit**, where **View repair details** preserves the owner, risk, exact repair, result, evidence,
rollback plan, and guarded Undo availability without crowding the overview. The same finding
identity is not automatically retried, which prevents repair loops.

The overview labels active managed work as **OpenClaw work**. Separately, the System summary shows
**Local AI processes: _N_** from host process telemetry. A loaded local model process is not counted
as an OpenClaw agent or work item and does not prove that an inference is actively generating.
Local-model RSS remains separate from host memory pressure.

The primary overview presents these two signals together in **What is running**:

- **OpenClaw-managed work** counts live agents attached to managed tasks or workflows.
- **Independent local AI** counts loaded local-model processes and explicitly says that loaded does
  not necessarily mean generating.

The header does not repeat a second system-state term. **Now** is the one authoritative primary
status. The first current finding is labeled **Highest-priority issue** and displays **Who owns this**
and **What happens next** before its recommendation. Opening **Recommended resolution** makes no
change. **Not now** defers it explicitly and returns keyboard focus to the recommendation control.

## Source handoff

When a locally verified Operations Room candidate is ready for review, use the deterministic
[Control Director source handoff](/automation/control-director-source-handoff) workflow. It checks
the exact SHA, branch, clean worktree, canonical `SnowBelt` remote, and draft pull-request identity
before any push. **Preflight** is read-only. **Finish** is the only bounded destination action and
requires a literal destination approval; it is idempotent for an exact existing draft PR and stops
on any mismatch. The handoff runs outside the managed Gateway, records a private receipt, and never
starts a release, changes runtime state, merges, or substitutes for local Mac Studio proof.

The stable remediation and handoff entry points delegate to explicit domain, application, and
infrastructure modules. See [Operations Room architecture](/automation/operations-room-architecture)
for the folder map, dependency direction, and compatibility rules.

## Owner acceptance in the page

The usability coordinator returns `ownerAcceptanceQuery` only for a ready `owner-mac-studio`
campaign with one registered anonymous owner. Append that exact query to `/operations`. The
Operations Room then shows a bounded **Begin 60-second check** control.

The timer does not start when the campaign is created, when chat is delivered, or when the page
loads. It starts only when the owner clicks **Begin**. The owner identifies the primary status,
distinguishes OpenClaw work from independent local AI, identifies the highest-priority issue owner
and next action, opens the real resolution preview, and closes it without changes. **Finish and
create receipt** creates a machine-readable
`openclaw.operations-room.owner-ui-attempt.v1` receipt and exposes one-click Copy and Download
controls.

Import the downloaded receipt with the coordinator's `complete-ui` command. The coordinator accepts
it only when the campaign, candidate SHA, fixture hash, anonymous participant, timing, and every
outcome match exactly. A mismatched, late, hinted, unsafe, failed, replayed, or ambiguous attempt
fails closed. Existing failed campaigns and participant-ledger entries are never rewritten or
replaced.

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

| ID     | Milestone                      | Required proof                                                                                                                                                                |
| ------ | ------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| OR2-00 | Baseline and approval          | Current screenshots, user journeys, terminology, and approved information map                                                                                                 |
| OR2-01 | Truth contract                 | Additive protocol, separate state axes, exact totals, freshness, and schema tests                                                                                             |
| OR2-02 | Collector correctness          | Current versus last work, duty, process, count, and owner-invariant tests                                                                                                     |
| OR2-03 | Attention model                | Action, handling, watching, history, ownership, and transition tests                                                                                                          |
| OR2-04 | Summaries and rollups          | Sanitized task summaries and recurring-source grouping tests                                                                                                                  |
| OR2-05 | Overview and navigation        | Briefing, deep-link, URL, focus, and Back and Forward browser proof                                                                                                           |
| OR2-06 | Agent directory                | Priority grouping, stable sort, search, pins, and collapsed idle groups                                                                                                       |
| OR2-07 | System and capability detail   | Honest memory, model, configured, active, unverified, and process states                                                                                                      |
| OR2-08 | Freshness and change history   | Persistent incident ledger, restart, stale, partial, and since-last-visit tests                                                                                               |
| OR2-09 | Accessibility and localization | Keyboard, non-color cues, zoom, contrast, motion, responsive, and i18n proof                                                                                                  |
| OR2-10 | Governance and preservation    | Skills, docs, local proof contract, and both capability registry checks                                                                                                       |
| OR2-11 | Automated release proof        | Targeted tests, DOM smoke, real E2E, typecheck, build, and local exact-source Control Director proof on the Mac Studio                                                        |
| OR2-12 | Production and owner proof     | Exact-SHA promotion, restart, receipts, persistence, soak, rollback, production Chrome, and Control Director owner acceptance on the managed Mac Studio in 60 seconds or less |

Run `pnpm operations-room:verify` and the selected changed lanes through Control Director on the Mac
Studio with `OPENCLAW_LOCAL_CHECK=1`. Use `OPENCLAW_LOCAL_CHECK_MODE=throttled` or `full`, split broad
lanes into bounded sequential commands, and bind the resulting receipt to the exact candidate SHA.
This local exact-source proof is the canonical automated release gate.

`pnpm check:changed` also runs locally by default. Remote delegation requires an explicit user
request plus `OPENCLAW_CHECK_CHANGED_REMOTE=1`; local mode always wins if both flags are present.

`.github/workflows/operations-room-proof.yml` remains available as an optional supplementary check
when a maintainer explicitly requests GitHub execution. Its availability or result is not required
for Operations Room completion and it must not duplicate or replace locally provable Mac Studio
evidence.

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
- `local-proof-receipt.json` with status `passed`, identical expected and checked-out SHAs, the
  canonical and changed-lane commands, the browser-receipt digest, and a SHA-256 digest for every
  prerequisite artifact.

If the optional GitHub workflow is explicitly requested, its separate receipt must bind to the same
exact candidate SHA. That supplementary receipt does not replace `local-proof-receipt.json`.

The production bundle is separate. It must bind the same landed SHA to the canonical source branch,
immutable runtime pointer, capability manifest, and Gateway process; include automated desktop,
mobile, accessibility, localization, and responsive-layout receipts plus a real Chrome receipt from
the managed Mac Studio; prove incident-ledger and since-last-visit persistence across restart; record at least five
minutes of bounded liveness, RAM, CPU, focus, refresh, and duplicate-transition soak; verify the
preregistered rollback bundle by restoring the prior runtime and then re-proving the candidate; and
include the owner acceptance receipt below. A missing field, failed check, identity mismatch, omitted
attempt, or unverifiable artifact fails closed. Blacksmith, Testbox, Crabbox, and equivalent
third-party execution environments are optional diagnostics for this product lane, not completion
gates; their availability must never block Operations Room or Control Director acceptance.

## Control Director owner acceptance protocol

The production acceptance participant is the known Control Director owner who operates OpenClaw on
the managed Mac Studio. Prior Operations Room experience is allowed because this gate measures
release fitness for the actual owner and production surface, not first-use discoverability. Use
Chrome on that Mac Studio and bind the campaign to the exact active candidate SHA and a hash of the
production snapshot. Consent presence is recorded; names and contact details are not.

Give the owner this goal without a walkthrough: “Use Operations Room to confirm system health,
distinguish OpenClaw work from independent local AI, inspect the most important issue, preview
Resolve, and cancel safely.” Start the timer when the production Operations Room becomes visible.
Stop it when the owner has done all five of the following:

1. stated the overall system state correctly;
2. identified one current OpenClaw-managed agent or work item;
3. distinguished OpenClaw-managed work from independently running local AI model processes;
4. opened the highest-priority issue and identified its explanation, owner, or recommended next action; and
5. opened the Resolve preview and canceled without causing a consequential mutation.

The attempt passes only when all five outcomes are correct in 60,000 milliseconds or less, the
observer provided zero hints or corrective prompts, and the owner triggered no mutating or unsafe
action. There is one attempt per exact candidate. Do not discard, replace, or retry a failed attempt;
correct the product and create a new exact-SHA campaign.

Write one machine-readable owner acceptance receipt containing the exact candidate and active-runtime
SHA, production snapshot hash, anonymous owner identifier, `control-director` role, `mac-studio`
device, Chrome browser, viewport, accessibility setting, consent presence, start and finish
timestamps, elapsed milliseconds, five per-outcome booleans, hint count, unsafe-action count,
observer attestation, and aggregate result.

The durable coordinator replaces chat-based `READY`/`DONE` handshakes:

```bash
pnpm operations-room:usability init \
  --campaign "$OPENCLAW_CUSTOM_RUNTIME_HOME/usability/<campaign>.json" \
  --campaign-id <id> --candidate-sha <sha> --active-runtime-sha <sha> \
  --fixture-sha256 <production-snapshot-sha256> --policy owner-mac-studio \
  --expires-at <iso-utc>

pnpm operations-room:usability register \
  --campaign "$OPENCLAW_CUSTOM_RUNTIME_HOME/usability/<campaign>.json" \
  --participant-id <anonymous-owner-sha256> --device mac-studio --browser chrome \
  --operator-role control-director --viewport <width>x<height> \
  --accessibility standard --consent-recorded true

pnpm operations-room:usability status \
  --campaign "$OPENCLAW_CUSTOM_RUNTIME_HOME/usability/<campaign>.json"
```

Use `start` and `complete` for the single bounded attempt. The coordinator records exact source and
runtime identity, consent presence, device, browser, role, viewport, accessibility mode, timestamps,
the five outcomes, hints, unsafe actions, and terminal status. Its private ledger spans campaigns.
The same owner may perform acceptance for a later exact candidate, but cannot retry or replace an
attempt for the same exact candidate through a replacement campaign. A failed attempt makes that
campaign terminal.

Campaign states are `waiting`, `ready`, `running`, `passed`, `failed`, `expired`, and `blocked`.
Every `status` result includes exact missing requirements and one next valid action. `ready` means
the consented owner, managed Mac Studio, Chrome, Control Director role, exact active candidate, and
snapshot hash are present. Only then may the finalization lease be acquired. The lease continuously revalidates the campaign rather than
trusting its stored summary; a failed, expired, malformed, identity-changing, or unsafe campaign
cannot retain the lease. Explicit exact-binding lease release remains available so invalid human
evidence cannot wedge the managed runtime.

After the owner attempt passes, the coordinator automatically writes one private, machine-readable
exact-SHA receipt and binds it to the participant-ledger digest. `finalize` revalidates and returns
that same receipt; it cannot replace it or move it to a different path. The campaign and ledger live below
`$OPENCLAW_CUSTOM_RUNTIME_HOME/usability`, use owner-only permissions, and must never be committed.

## Focused verification

Run the focused source tests as one Vitest invocation so the shared cache cannot race:

```bash
pnpm test \
  test/scripts/custom-runtime-usability-coordinator.test.ts \
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
  ui/src/ui/navigation.browser.test.ts \
  ui/src/ui/views/overview.render.test.ts \
  src/pcc/capability-addition-registry.test.ts \
  src/pcc/custom-runtime-capabilities.test.ts
```

Then run the static, browser, registry, and build surfaces:

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
pnpm build
```

The canonical focused source command is `pnpm operations-room:verify`; it runs the exact unit-test
list and every static, DOM, browser, localization, registry, and build command above in sequence.

`pnpm ui:smoke:operations-room` runs the DOM and browser smoke commands together. Run broad shared
lanes locally through Control Director with throttled resource settings and split them into bounded
sequential lanes when needed. Managed-runtime restart, persistence, soak, rollback, real production
Chrome, and Control Director owner acceptance are later, separate gates. Third-party execution
providers and hosted CI are optional only when explicitly requested and never replace or block these
proof surfaces.
