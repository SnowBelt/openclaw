---
summary: "Recommendation-only background review for OpenClaw reliability, efficiency, adherence, skills, routing, and major-change opportunities"
read_when:
  - You want OpenClaw to inspect its own state while idle
  - You are reviewing Self-Improvement Governor recommendations
  - You need the safety boundaries for procedural learning and implementation proposals
title: "Self-Improvement Governor"
sidebarTitle: "Self-Improvement Governor"
---

The Self-Improvement Governor is an optional, default-disabled OpenClaw background reviewer. It
inspects OpenClaw state, writes durable recommendation records, groups recurring
patterns into scorecards, generates pending proposal records, and routes each
recommendation to the right OpenClaw agent role.

It is separate from the Control Director. The Control Director can emit
readiness and completion-discipline signals, but it does not own Governor model
policy, scanning, routing, recommendation closure, or procedural-memory
curation.

It does **not** directly merge, push, release, delete files, expose secrets, or
write skills. Code/config changes still require tests or explicit operator
approval. Skill updates stay in Skill Workshop pending/quarantined review until
approved by the Memory/Knowledge Curator.

Governor candidates are recommendation-only, including candidates routed into
PCC. The [PCC Learning Loop](/automation/pcc-learning-loop) is the canonical
contract for PCC candidate evidence, lifecycle, and promotion: promotion needs
before-and-after metrics at `93` or higher with no regression. Any resulting
memory or skill change remains curator-gated through Skill Workshop; a Governor
or PCC candidate does not authorize it.

## What It Inspects

The MVP scanner is deterministic and checks:

- failed, timed-out, lost, or blocked task records
- stale `queued` or `running` task records with no recent progress
- repeated correction-like task patterns
- repeated slow, blocked, timed-out, or verification-heavy workflow families
- dashboard/mobile/control-UI smoke failures
- explicit operator-recorded dashboard interventions with corrective-action evidence
- model routing, provider, fallback, auth, rate-limit, and timeout errors
- Governor model-review audit events, including local/hosted fallback and invalid JSON
- Governor audit-ledger signals for repeated instruction, efficiency, risk, and metric gaps
- Control Director readiness audit events, as recommendation-only project-health signals
- failed cron/background jobs
- Skill Workshop pending and quarantined proposals
- efficiency signals, such as latency, cost, duplicate work, token waste, and timeouts
- instruction-adherence misses, including repo-rule and test-wrapper mistakes
- workflow simplification and agent minimization opportunities
- capability-evolution and major-change signals
- stale or conflicting knowledge, docs, memory, and skill evidence
- architecture simplification, risk-prevention, and outcome-measurement gaps
- project or agent health gaps when task evidence names them

Terminal task evidence is bounded to the latest 24 hours so a runtime upgrade or
first scan cannot replay the full historical task ledger into new work. Queued
and running tasks remain eligible regardless of age so genuinely stale work is
still detected. Repeated runs of the same task family collapse into one causal
recommendation with merged evidence and recurrence count. Newly created
recommendations carry their deterministic routed owner immediately; SIG does
not wait for a second administrative assignment pass.

The Control UI includes a **Record dashboard intervention** form for real
operator corrections. Submitting it records the issue, corrective action, and
optional evidence as recommendation-only prevention work. It does not change an
existing recommendation status, and the resulting work cannot close without a
passing prevention-proof receipt.

## Typed Improvement Signals

OpenClaw components and plugins can emit a versioned `improvement.signal`
diagnostic event through the public diagnostic runtime seam. A signal includes
an idempotency key, component owner, kind, severity, bounded summary, privacy
class, trace/run/task correlation, expected versus observed behavior, and
evidence references. Optional desired-state metadata declares the expected
outcome, SLO, rollback, and retention policy. Optional capability-routing
metadata records which capabilities were considered, selected, missed, or used
as fallbacks.

SIG sanitizes signal text, persists signals in the canonical ledger, queues
analysis through a retryable outbox, and creates evidence-bound recommendations.
One component can create at most 20 distinct low/medium signals per hour; excess
noise is coalesced into a deterministic budget bucket. Trusted high/critical
signals bypass that budget and wake the background analyzer immediately.

Future integrated components should implement the version 1 admission contract:
component owner, expected outcome, SLO, proof requirements, rollback,
retention/privacy policy, capability list, and `observe` or `recommend`
autonomy. Admission progresses through `shadow`, `dry_run`, `canary`, and
`active`; canary/active require passing proof, and active also requires a
verified rollback path.

## Recommendation Records

After the verified JSON-to-SQLite cutover, canonical records are stored in the
Self-Improvement SQLite ledger under the OpenClaw state directory. Dated JSON
backups/exports remain recovery evidence but are not a second writable source
of truth. Pre-cutover installs continue to use:

```text
self-improvement/recommendations.json
```

Each record includes:

- `status`: `open`, `acknowledged`, `assigned`, `in_progress`, `reopened`, `quarantined`, `resolved`, or `dismissed`
- `category`: reliability, stale work, corrections, smokes, model routing, skills, project health, verification, efficiency, instruction adherence, workflow simplification, agent minimization, capability evolution, knowledge hygiene, architecture simplification, risk prevention, outcome measurement, or major change
- `severity`, `criticality`, `priority`, `impact`, and `effort`
- `groupKey`, `groupTitle`, and `recurrenceCount` for grouping repeated findings
- source metadata, such as task id, run id, cron job id, or Skill Workshop proposal id
- route metadata for the target agent role
- deterministic or model-review analysis metadata (`analysis.mode`, selected tier, model id, attempt count, schema status, confidence, prompt version, and safety notes)
- recommended action and required evidence
- a recommendation-only safety envelope
- optional assignment, claim, resolution proof, dismissal reason, and reopen reason
- optional measured-outcome requirement, proof-receipt id, and outcome state
- derived actionability state for owner, SLA, proof, closure readiness, blockers, and next operator action

Recommendation, proposal, and audit-event text is sanitized before display or refresh. The
governor redacts secret-like values and local filesystem paths from stored
evidence, required proof, operator notes, proposal fields, analysis text, audit
summaries, and audit metadata. Existing records are sanitized when they are
read, so old path-heavy evidence does not need a destructive store rewrite.

Recurring resolved or dismissed findings are marked `reopened` only when the
scan contains novel task evidence for the fingerprint. Healthy SIG lifecycle
events are not generic continuous-improvement evidence, so health, scorecard,
model, review, analysis, production-check, background, and queue bookkeeping
cannot recursively reopen recommendations. When a closed finding receives
novel task evidence, its prior proof becomes stale and must be refreshed before
closure. Recommendations that require tests cannot be
marked resolved through the Gateway unless current resolution proof is already
attached or supplied in the update.

## Dashboard Intervention Evidence

When an operator corrects a real Control UI/dashboard issue, record it with
`openclaw self-improvement record-dashboard-intervention`. SIG preserves the
issue and corrective action as evidence-bound `risk_prevention` work, routes it
to QA, and requires prevention proof before any closure request. Healthy SIG
lifecycle, scorecard, or audit bookkeeping never becomes intervention evidence.

The scanner writes deterministic analysis by default. Analysis runs can request
local-first model review, but idle operation remains evidence-bound and
recommendation-only.
Reviewer input is bounded by whole groups and valid JSON payloads; lower-ranked
groups may be omitted when the input budget is reached rather than truncating a
group or producing malformed JSON.
If there are no grouped recommendations to review, analysis stays deterministic
and records no model attempts; it does not preflight, generate, or claim schema
validation for an empty review.

## Actionability And Closure

The Governor derives actionability from durable recommendation fields instead of
writing a separate workflow store. Each recommendation and grouped card can show
owner state (`unassigned`, `assigned`, `claimed`), SLA state (`fresh`, `aging`,
`overdue`), proof state (`not_required`, `missing`, `attached`), closure state
(`blocked`, `ready_to_resolve`, `closed`), blockers, rank, and the next operator
action.

The default closure SLA is 24 hours for critical items, 72 hours for high items,
7 days for medium items, and 14 days for low items. The Action Queue ranks
overdue, unassigned, proof-missing, and ready-to-resolve items so operators can
triage them without authorizing implementation work.

Dismissal requires a reason. Test-required recommendations and groups cannot be
resolved unless proof is already attached or supplied with the update. Audit
events record status, route, assignment, claim, and proof-present metadata, but
they do not store raw proof text.

When a signal declares desired state, text proof alone is not sufficient.
Resolution also requires a passed outcome receipt that links the originating
signal, diagnosis, corrective action, target metric, observed metric,
observation window, optional holdout, and bounded evidence references. Failed
receipts remain durable evidence but do not unlock closure. A correlated
recurrence reopens the causal recommendation and marks the previous proof stale.

## Improvement Intelligence

The Governor derives an **Improvement Intelligence** summary from active
recommendation groups. It is not a separate store and does not authorize direct
changes. It gives operators a compact view of opportunities that can make
OpenClaw better day after day:

- efficiency opportunities from repeated slow, failed, duplicate, or timed-out work
- instruction-adherence themes that should route through Memory/Knowledge Curator
- workflow simplification and agent-minimization candidates
- architecture simplification and capability-evolution candidates
- risk-prevention gaps that need QA guardrails
- outcome-measurement gaps where improvement cannot yet be proven
- major-change candidates that require option framing, approval, tests, and rollback planning

The summary includes category counts, high/critical pressure, top opportunities,
stale unresolved patterns, instruction themes, simplification candidates,
major-change candidates, and outcome-metric gaps. The Control UI shows the
summary in the Self-Improvement panel, and
`openclaw self-improvement opportunities` lists the same active recommendation
categories from the CLI.

## Analysis Runs And Proposals

`selfImprovement.analysis.run` performs a bounded review pass over grouped
recommendations. The analysis runner:

- writes or refreshes a daily scorecard snapshot in the canonical ledger
- creates or refreshes pending proposal records in the canonical ledger
- preserves operator proposal status, proof, dismissal reason, and notes across refreshes
- records bounded audit events in the canonical ledger

Audit events are an operator ledger, not an action path. They record sanitized
status updates, analysis runs, proposal creation, proposal status changes, and
scorecard snapshots. Audit summaries and metadata are bounded and redacted
before durable writes and again when old records are read.
Model-reviewed analysis events include only bounded attempt metadata, such as
attempt counts, tier/status/preflight summaries, blocked attempt details, and
remediation hints. They do not store model output or reasoning.
Invalid-JSON attempts include a stable, bounded `diagnostic` code, such as
`no_balanced_json`, `missing_required_fields`, `unmatched_group_id`, or
`missing_group_id`. Analysis audit metadata summarizes those codes as
`invalidJsonDiagnostics`, so the Builder Agent can tune local model prompts or
serving configuration without seeing raw model output.
Model-review fallback recommendations are based on the latest relevant
analysis event. If an older local-first run fell back after invalid JSON but a
newer local-first run produced schema-valid review output, the scanner stops
refreshing the stale fallback recommendation and keeps the current model state
separate from the older failure evidence.
Operators can inspect the sanitized ledger with
`openclaw self-improvement audit-events` or the read-only
`selfImprovement.auditEvents.list` Gateway method. The list path does not append
new events or mutate Governor state.

## Reviewer Quality Evals

`selfImprovement.evals.run` runs a bounded reviewer-quality eval corpus through
the same local-first model-review path used by analysis. It is a quality gate,
not an action path. The runner checks whether reviewer output remains
schema-valid, evidence-bound, safely routed, sufficiently confident, and free of
unsafe action recommendations, overbroad rewrite advice, and invented facts.

The default eval command runs the `smoke` fixture set with three cases. Operators
can run `core` or `all` for the full current corpus. The production thresholds
are:

- schema-valid rate at least `0.95`
- safety pass rate exactly `1.0`
- route-preservation rate at least `0.98`
- precision rate at least `0.93`
- first-pass rate at least `0.80`
- p95 model completion at most `180000` ms

Each run appends a sanitized `reviewer_eval_run` audit event with aggregate
scorecard metadata: fixture set, readiness, pass/schema/safety/route rates, p95
completion, selected model/tier, diagnostic counts, and failed case ids. It does
not store model output, reasoning, prompts, raw recommendation text, secrets, or
local filesystem paths. The dashboard renders the latest event as **Reviewer
eval health** so operators can see whether the Governor reviewer is ready,
degraded, or blocked before trusting model-enriched recommendations.

MLX is an optional Apple Silicon research challenger, not a prerequisite and
never a SIG control authority. It is considered only when explicitly enabled
and evaluated on at least 30 frozen validation cases. The challenger must match
or beat the baseline on precision, first-pass rate, p95 latency, and 100%
safety. Passing that diagnostic makes it eligible for further research only; it
does not train a production model, change routing, resolve records, or authorize
mutations.

Proposal records are not changes. They are routed, approval-gated cards for the
next owner to review:

- `implementation`: Builder Agent follow-up
- `verification`: QA Test Agent follow-up
- `sequencing`: Program Manager follow-up
- `memory_skill`: Memory/Knowledge Curator pending memory or skill proposal
- `user_synthesis`: Todd Stanski prioritization/synthesis
- `major_change`: Program Manager major-change review
- `agentless_alternative`: Program Manager review for simplifying work without adding agents

## Memory/Skill Curation Loop

`memory_skill` proposals are the closed-loop handoff between the Governor and
Skill Workshop. They stay in the canonical proposal ledger; the Governor
does not write `SKILL.md` files, apply Skill Workshop proposals, or mutate
memory directly.

Memory/skill proposals carry curator state:

- `pending_review`: default for memory/skill proposals
- `accepted_for_workshop`: reviewed and ready to link to a pending Skill Workshop proposal
- `needs_more_evidence`: more source evidence is required before workshop work
- `rejected`: explicitly rejected with a reason
- `superseded`: replaced by another proposal or recommendation
- `promoted`: promotion proof has been attached after safe Skill Workshop handling

The Gateway exposes `selfImprovement.curator.list`,
`selfImprovement.curator.get`, and `selfImprovement.curator.update`.
These methods only update proposal records and sanitized audit metadata. They
never run tasks, edit files, push, merge, release, or write skills.

Safety gates:

- accepting or promoting requires curator proof
- rejection, supersession, and evidence requests require a curator reason
- promotion requires a linked, non-quarantined Skill Workshop proposal
- raw proof text is stored only on the proposal; audit events store proof-present booleans
- proposals that still contain redacted sensitive markers must be rewritten before workshop acceptance

Operational health degrades when accepted memory/skill proposals are not linked
to Skill Workshop and blocks when linked workshop proposals are quarantined or a
promoted proposal lacks promotion proof. The Control UI renders these records in
the **Memory/Skill Curator Queue**.

Model review is local-first. The production model policy is:

| Tier               | Default model                                         | Use                                                                     |
| ------------------ | ----------------------------------------------------- | ----------------------------------------------------------------------- |
| `primaryReview`    | `ollama/openclaw-control-gemma4-31b-q8:latest`        | Default local Governor reviewer                                         |
| `crossCheck`       | `ollama/openclaw-control-qwen3-30b-q6-chatfix:latest` | Practical local retry after invalid or failed primary JSON              |
| `triage`           | `ollama/qwen3.5:9b-q4_K_M`                            | Cheap local health and triage review                                    |
| `strategic`        | `ollama/openclaw-strategic-qwen3-235b:latest`         | Explicitly enabled local escalation for major-change or critical groups |
| `hostedEscalation` | operator-selected hosted model                        | Approval-only fallback after local attempts                             |
| `optionalExternal` | `kimi-local/moonshotai/Kimi-K2.6`                     | External-GPU guidance only; disabled by default                         |

The default primary is tuned for local review rather than creativity:
`Q8_0`, `31B`, `65536` context, `8192` max output tokens,
`temperature: 0.2`, `top_p: 0.95`, and `180000` ms timeout. The chatfix
cross-check uses `Q6`, `30B`, `262144` context, the same conservative sampling
settings, and the same timeout. For major-change or critical groups,
`--allow-strategic-local` appends the strategic local Qwen attempt after the
primary and cross-check attempts.

Kimi K2.6 remains useful only when an operator has an external GPU serving host.
It is not part of production readiness on a local-first, no-external-GPU setup.
If explicitly selected, it should run behind a local OpenAI-compatible endpoint
such as vLLM or SGLang and is recorded with the optional profile `native INT4`,
`1T total / 32B active`, `262144` context, `16384` max output tokens,
`temperature: 1.0`, `top_p: 0.95`, and `300000` ms timeout.

Use this provider shape only when explicitly registering an external Kimi
endpoint:

```json5
{
  models: {
    mode: "merge",
    providers: {
      "kimi-local": {
        baseUrl: "http://127.0.0.1:8000/v1",
        apiKey: "local-openclaw",
        api: "openai-completions",
        request: { allowPrivateNetwork: true },
        timeoutSeconds: 300,
        models: [
          {
            id: "moonshotai/Kimi-K2.6",
            name: "Kimi K2.6 Local",
            reasoning: true,
            input: ["text", "image"],
            cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
            contextWindow: 262144,
            maxTokens: 16384,
          },
        ],
      },
    },
  },
}
```

`models.mode: "merge"` keeps existing local and hosted fallback models available.
The `apiKey` value above is a non-secret loopback marker; use a real secret only
when the local serving layer enforces one.

Operator-managed serving examples:

```bash
vllm serve moonshotai/Kimi-K2.6 --host 127.0.0.1 --port 8000 --served-model-name moonshotai/Kimi-K2.6
python -m sglang.launch_server --model-path moonshotai/Kimi-K2.6 --host 127.0.0.1 --port 8000 --served-model-name moonshotai/Kimi-K2.6
```

Those commands are intentionally skeletal. Add hardware-specific tensor
parallelism, cache, memory, and quantization flags according to the local
serving backend and hardware. Keep the Governor endpoint on loopback when
possible. For a trusted LAN, Docker, or Tailscale model server, set
`models.providers.<provider>.request.allowPrivateNetwork=true`; OpenClaw still
blocks public-looking provider hosts from local-first reviewer slots and routes
hosted calls through the explicit hosted escalation gates instead.

The CLI can print the same setup skeleton without reading or writing runtime
config:

```bash
openclaw self-improvement models template
openclaw self-improvement models template --json
```

The reviewer receives only bounded, redacted recommendation/group evidence. It
must return schema-valid JSON. OpenClaw strips reasoning content before parsing
or storing output. The prompt explicitly requires a top-level JSON object that
starts with `{` and ends with `}`, and tells reviewers to return
`{"groups":[]}` when no group can be improved safely. It removes common
local-model reasoning wrappers such as
`<think>`, `<thinking>`, `<reasoning>`, `[reasoning]`, and
`<|begin_of_thought|>` blocks, including wrappers that appear inside accepted
JSON fields. It also strips unwrapped reasoning-prefixed field content such as
`Reasoning:`, `Thinking:`, `Analysis:`, or `Scratchpad:` unless a clear
`Final:`, `Answer:`, or `Recommended action:` marker leaves safe final text.
Fields that contain only stripped reasoning do not count as schema-valid review
content. It also skips earlier scratchpad JSON objects and applies the first
schema-valid recommendation payload it can prove. Local
OpenAI-compatible `openai-completions` reviewers such as Kimi on vLLM or SGLang
receive `response_format: {"type":"json_object"}` and `top_p` payload hints.
Native Ollama reviewers receive reviewer-only `format: "json"` and
`options.top_p` hints, and OpenClaw sets `think: false` only when the request
does not already declare a thinking mode.
The parser tolerates common local-model JSON wrapper mistakes such as a bare
top-level group array, object-keyed `groups` or `recommendations` maps, nested
`result`/`review`/`output` wrappers, string-array action fields, confidence
labels such as `high`, and trailing commas. The prompt payload includes both
`id` and `groupId`, and the parser accepts common local field aliases such as
`recommended_action`, `recommended_next_step`, and `safety_notes`. To avoid
misrouting recommendations, a missing `groupId` is recovered only when exactly
one input group and exactly one output group are present. Object-keyed output
must still key entries by an input group id, and ambiguous or unmatched output
still fails schema validation. The reviewer retries invalid JSON once with the
practical local fallback, then falls back to deterministic analysis if the retry
fails.
Providers that do not use either the local OpenAI-compatible completion
transport or native Ollama transport are left unchanged and still rely on schema
validation plus deterministic fallback.

Before a local reviewer attempts generation, OpenClaw runs a fail-fast preflight:

- parse the selected local reviewer ref as `provider/model`
- check `models.providers.<provider>.models` when the provider is configured
- block public hosted provider base URLs in local-first model slots before
  fetching or generating
- allow loopback endpoints by default; require
  `request.allowPrivateNetwork=true` for trusted private-network or local
  hostname model endpoints
- probe the local HTTP model catalog (`/models` for OpenAI-compatible endpoints or `/api/tags` for Ollama) with a short timeout
- record `ready`, `readiness`, `readyTier`, `readyModelId`, `preflightStatus`, `preflightMs`, tier, model id, attempt count, schema status, and fallback reason
- record whether each local endpoint came from an explicit provider config or
  the built-in default Ollama fallback (`preflightSource` and
  `providerConfigured`)
- record bounded reviewer generation duration as `completionMs` for attempts that reach model generation
- summarize bounded group confidence on the analysis result and dashboard/CLI summaries
- attach read-only remediation hints to blocked attempts, such as running the model template helper or fixing a local provider catalog before retrying

Preflight does not install models or mutate runtime config. If a selected local
Gemma, optional external Kimi, or hosted-escalation path is not configured or the
local endpoint is unavailable, that attempt is blocked with bounded metadata and
the runner continues through the deterministic local-first fallback order. If no
planned model path is usable, analysis returns
`mode: fallback` with deterministic recommendations. If a local model is
configured but OpenClaw cannot prove the selected model from the HTTP
health/catalog endpoint, the attempt is blocked as unavailable or missing config
instead of starting a long generation call. A plain 200 response is not enough;
the catalog must parse and list the selected model id.
Failed local endpoint probes are cached briefly inside the running Gateway, so
dashboard refreshes and repeated analysis attempts do not spend the same
timeout on a known-dead vLLM, SGLang, LM Studio, or Ollama endpoint. Successful
probes are not cached; once the endpoint responds and lists the selected model,
the next check can prove readiness normally.
`readiness` describes whether a planned reviewer model path was available and
responsive. `schemaValidated` and invalid-JSON diagnostics describe whether the
review output was safe to use. A reachable chatfix cross-check that returns
invalid JSON after the Gemma primary is blocked is therefore
`readiness: "degraded"` with `schemaValidated: false`, not fully blocked model
readiness.

Use the preflight-only readiness command before enabling model review:

```bash
openclaw self-improvement preflight
openclaw self-improvement preflight --review-model ollama/openclaw-control-gemma4-31b-q8:latest --fallback-model ollama/openclaw-control-qwen3-30b-q6-chatfix:latest
openclaw self-improvement preflight --strategic --allow-strategic-local
```

The command calls `selfImprovement.models.preflight`. It checks the same
local-first policy and returns `ready`, `readiness`, `readyTier`, `readyModelId`,
`reviewPolicy`, `preflightStatus`, `preflightMs`, attempts, tier, model id,
quantization, parameters, context, and any fallback or escalation reason without
mutating runtime config, creating recommendations, creating proposals, or
running LLM completions. It appends a sanitized `model_preflight` audit-ledger
event so future Governor scans can notice repeated degraded or blocked local
model readiness.
`ready` is a compatibility boolean for "at least one configured path is usable."
`readiness` is the operator state:

- `ready`: every planned readiness attempt passed, or deterministic review does not need a model
- `degraded`: at least one planned attempt is usable, but a preferred or fallback path is blocked
- `blocked`: no planned model path is usable

For example, a missing Gemma primary with a responsive chatfix fallback returns
`ready: true`, `readiness: "degraded"`, `readyTier: "crossCheck"`, and
`readyModelId: "ollama/openclaw-control-qwen3-30b-q6-chatfix:latest"` so the dashboard can show that the
Governor can still review locally while the preferred primary model remains a
setup gap.
When that fallback is reached through the built-in Ollama default instead of an
explicit `models.providers.ollama` block, the attempt reports
`preflightSource: "default_ollama"` and `providerConfigured: false`. That is
still local-first and read-only, but it tells operators that the fallback is
coming from the default loopback Ollama catalog rather than from durable config.
Blocked attempts also carry a bounded `remediationHint` in CLI, Gateway, and
dashboard metadata. The hint is advisory only. It never changes configuration,
installs models, writes skills, or starts a merge/push/release path.
The sanitized model-preflight audit event keeps those remediation hints as
bounded metadata so the next Governor scan can route a model-readiness
recommendation with the exact operator next step, without storing model output
or secret-bearing config.
Model-preflight audit events also summarize `preflightSources` and
`defaultOllamaFallbackAttempts` so repeated dependence on the default Ollama
fallback can be inspected from the ledger without storing model output.

Analysis results include the same readiness summary when they make model
attempts. A successful chatfix fallback after a blocked Gemma primary returns
`mode: "local_retry"`, `readiness: "degraded"`, `readyTier: "crossCheck"`,
`readyModelId: "ollama/openclaw-control-qwen3-30b-q6-chatfix:latest"`, and
`blockedPrimaryReason` so CLI, Gateway clients, dashboard cards, and audit
events can explain why the fallback was used. Generated attempts also carry
`completionMs`, which helps separate a
fast schema problem from a slow local reviewer that eventually returned invalid
JSON.

Hosted escalation stays locked down. A hosted model call happens only when all
hosted gates pass:

- hosted escalation is explicitly allowed for the run (`--allow-hosted-escalation` or `allowHostedEscalation: true`)
- the run explicitly approves hosted review (`--approve-llm-review` or `llmApproval: true`)
- the environment enables the governor hosted LLM gate (`OPENCLAW_SELF_IMPROVEMENT_LLM=1`)
- runtime model routing/auth can resolve the requested model or reviewer agent

If any gate fails, the runner reports `mode: fallback`, records the reason, and
uses deterministic analysis. Model output can enrich proposal summaries/actions,
but it still cannot merge, push, release, delete files, expose secrets, or write
skills.

In local-first runs, `modelId` / `--model` is reserved for the hosted escalation
model. It does not replace the primary local reviewer. Use `reviewModelId` /
`--review-model` for the local primary. If a direct caller supplies a
hosted-looking `reviewModelId`, fallback model, or strategic model for a
local-first tier, OpenClaw blocks that attempt before preflight/generation and
continues through the remaining local fallback plan.

## Grouped Scorecard

`selfImprovement.summary` groups active recommendations and returns a current
scorecard:

- active and total recommendation counts
- grouped recommendation count
- critical/high open counts
- test-required and approval-required counts
- reopened/resolved counts for the last 24 hours
- buckets by category and route
- short lists for `needsApproval`, `whatWorsened`, and `whatImproved`
- an Action Queue summary for unassigned, overdue, proof-missing, blocked, and ready-to-resolve items
- an Improvement Intelligence summary for continuous-improvement opportunity pressure

The dashboard and CLI use this grouped view so repeated failures become one
operational card instead of a noisy list of identical task records.

`selfImprovement.scorecard` returns the current scorecard plus recent daily
snapshots written by analysis runs.

## Operational Health

The Governor also derives deterministic operational health from existing
recommendations, scorecards, proposals, audit events, reviewer evals, model
preflight events, and background-cycle signals. Before SQLite cutover, health
snapshots are stored in:

```text
self-improvement/health-snapshots.json
```

Each snapshot includes an overall `ready`, `degraded`, or `blocked` status, a
0-100 score, a trend, blockers, next actions, and dimension cards for:

- recommendations
- reviewer evals
- model readiness
- background cadence
- proposal queue
- verification proof
- improvement intelligence
- outcome effectiveness

Manual analysis writes a health snapshot after analysis. Background cycles write
a sanitized `background_cycle` audit event and then write a health snapshot so
operators can see whether idle review is fresh, stale, or failing. Snapshot
audit events use `operational_health_snapshot` and contain only bounded
aggregate metadata.

Use the read-only health check for production gates:

```bash
openclaw self-improvement health
openclaw self-improvement health --fail-on-degraded
openclaw self-improvement health --fail-on-blocked --json
```

## Production Readiness

`selfImprovement.productionCheck` separates SIG service readiness from the
downstream improvement portfolio, then combines service health with rollout
evidence into a read-only production gate. It does not scan, analyze, call a
model, prune stores, or mutate audit state.

The gate derives:

- SIG service `ready`, `degraded`, or `blocked` status
- executable effectiveness score, blockers, warnings, and next operator actions
- separate portfolio status, score, blockers, and next actions
- health-dimension evidence from recommendations, reviewer evals, model
  readiness, background cadence, proposal queue, verification proof, and
  improvement intelligence
- retention-maintenance evidence from the latest maintenance audit event
- optional strict readiness checks for model preflight and reviewer evals

Recommendation, proposal, verification, and intelligence pressure remains
visible as portfolio health but does not by itself make the SIG service
unhealthy. The service gate fails when outcome effectiveness is below the
configured quality target, background cadence is unhealthy, required
reviewer/model evidence is unhealthy, or required immutable runtime provenance
is missing. This avoids rewarding SIG for hiding real findings while still
keeping every downstream blocker visible and proof-gated.

Use the CLI gate when preparing a production rollout:

```bash
openclaw self-improvement production-check
openclaw self-improvement production-check --fail-on-degraded
openclaw self-improvement production-check --require-model-ready --require-evals-ready --json
```

`--require-model-ready` requires a latest `model_preflight` audit event whose
readiness is `ready`. `--require-evals-ready` requires a latest
`reviewer_eval_run` audit event whose readiness is `ready`. These strict flags
are useful once local reviewer serving and eval scheduling are part of the
operator's production runbook. The Control UI production check uses both strict
flags so its readiness result does not silently fall back to deterministic-only
health.

## Routing

The governor routes by category:

| Route                    | Agent role                               | Used for                                                                                                     |
| ------------------------ | ---------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| Todd Stanski             | User-facing synthesis and prioritization | User-facing priority framing                                                                                 |
| Builder Agent            | Implementation proposals                 | reliability, routing, efficiency, architecture                                                               |
| QA Test Agent            | Verification gaps                        | smoke, test-proof, and risk-prevention gaps                                                                  |
| Program Manager          | Sequencing and prioritization            | stale work, project health, workflow simplification, agent minimization, capability evolution, major changes |
| Memory/Knowledge Curator | Memory and skill updates                 | Skill Workshop, repeated corrections, instruction adherence, knowledge hygiene                               |

If optional configured agent ids are absent, the route still records the
intended role and the best default target id.

## Background Operation

Gateway post-ready maintenance leaves the Governor stopped by default. Set
`OPENCLAW_SELF_IMPROVEMENT_BACKGROUND=1` in the Gateway service environment to
opt in. When enabled, the Gateway starts the Governor as an unref'd background
task with a default cadence of every 6 hours and an initial delayed scan after
startup. Set `OPENCLAW_SELF_IMPROVEMENT_INTERVAL_MS` to change the
interval. Intervals below 15 minutes are floored to 15 minutes so the Governor
cannot accidentally create a tight idle-review loop. Background starts also add
bounded jitter by default, which spreads recurring review work away from Gateway
startup and other cron jobs.

The scheduler is adaptive. Quiet periods back off while preserving periodic
reconciliation; new trusted high/critical improvement signals request a bounded
immediate wake. Overlapping cycles are coalesced, and durable outbox leases make
interrupted signal analysis replayable after restart.

Leaving `OPENCLAW_SELF_IMPROVEMENT_BACKGROUND` unset is the safe deployment
default for read-only verification. Manual read methods and the Control UI
snapshot remain available without starting the writer loop.

Each background cycle runs the deterministic scanner, then runs deterministic
analysis over grouped findings so the daily scorecard and pending proposal queue
stay fresh while OpenClaw is idle. Background analysis does not request model
review, hosted escalation, or local-first generation; explicit CLI or Gateway
parameters are still required for model-reviewed analysis.

Each scan creates a normal system-scoped background task record so the review is
visible in the task ledger. Analysis writes sanitized audit events, scorecard
snapshots, and proposal records, but still cannot merge, push, release, delete
files, expose secrets, or write skills.

If a background cycle is still running when the next interval fires, the next
cycle is skipped and a sanitized `background_cycle` audit event records the
overlap. Background cycles also have a bounded timeout controlled by
`OPENCLAW_SELF_IMPROVEMENT_TIMEOUT_MS` (default 20 minutes). Timeouts are
recorded as audit and health evidence for operator follow-up instead of letting
the scheduler hang indefinitely.

## Retention Maintenance

The Governor keeps durable recommendation, proposal, scorecard, health, and
audit stores bounded through an explicit maintenance command and Gateway method.
Maintenance defaults to dry-run and reports what would be pruned without
changing state:

```bash
openclaw self-improvement maintain --dry-run
openclaw self-improvement maintain --dry-run --json
```

Applying retention requires an explicit apply flag:

```bash
openclaw self-improvement maintain --apply
```

The retention policy preserves active work and prunes only bounded historical
records:

- active recommendations are preserved; closed recommendations are retained for
  90 days, with a maximum recommendation store target of 1000 records
- audit events are retained for 30 days or the latest 500 events
- operational-health snapshots are retained for 30 days or the latest 120
  snapshots
- scorecards are retained for 180 days or the latest 180 snapshots
- pending, accepted, and active proposals are preserved; inactive old proposals
  are retained for 90 days, with a maximum proposal store target of 1000 records
- typed signals are retained for 90 days or the latest 2000 historical records
- completed/quarantined outbox history is retained for 30 days or the latest
  2000 records, while pending/processing work is always preserved
- measured proof receipts are retained for 180 days or the latest 2000 records

When apply mode prunes data, the Governor appends a sanitized
`retention_maintenance` audit event with store names and record counts only. It
does not store raw proof text, recommendation text, proposal text, secrets,
local paths, or model output in maintenance metadata.

## CLI

```bash
openclaw self-improvement scan
openclaw self-improvement models template
openclaw self-improvement preflight
openclaw self-improvement analyze
openclaw self-improvement analyze --local-first
openclaw self-improvement analyze --local-first --allow-strategic-local
OPENCLAW_SELF_IMPROVEMENT_LLM=1 openclaw self-improvement analyze --local-first --allow-hosted-escalation --approve-llm-review --model openai/gpt-5.5
openclaw self-improvement scorecard
openclaw self-improvement health
openclaw self-improvement health --fail-on-degraded
openclaw self-improvement production-check
openclaw self-improvement production-check --require-model-ready --require-evals-ready --json
openclaw self-improvement maintain --dry-run
openclaw self-improvement maintain --apply
openclaw self-improvement proof-receipts list --recommendation-id <recommendation-id>
openclaw self-improvement proof-receipts record <recommendation-id> --diagnosis "..." --action "..." --metric-name first_pass_rate --target ">=0.93" --observed "0.95" --metric-result passed --started-at <ms> --ended-at <ms> --evidence "receipt.json,audit:event"
openclaw self-improvement audit-events
openclaw self-improvement audit-events --kind model_preflight --limit 20
openclaw self-improvement summary
openclaw self-improvement triage --route qa
openclaw self-improvement list
openclaw self-improvement list --status open,acknowledged --severity high
openclaw self-improvement show <recommendation-id>
openclaw self-improvement assign <recommendation-id> --agent qa-test-agent
openclaw self-improvement prove <recommendation-id> --proof "pnpm test ... passed" --resolve
openclaw self-improvement update <recommendation-id> --status assigned --assign qa-test-agent
openclaw self-improvement update <recommendation-id> --status resolved --proof "pnpm test ... passed"
openclaw self-improvement groups update <group-id> --status acknowledged
openclaw self-improvement groups prove <group-id> --proof "pnpm test ... passed" --resolve
openclaw self-improvement proposals list
openclaw self-improvement proposals show <proposal-id>
openclaw self-improvement proposals update <proposal-id> --status approved --proof "operator approved"
```

Use `--json` on any command for automation.

## Dashboard

Open **Agents -> Self-Improvement** in the Control UI to view the daily
scorecard, Action Queue, production readiness, retention-maintenance dry-run results,
operational health, grouped recommendation cards, proposal queue,
sanitized audit ledger, routing, actionability state, required evidence, analysis mode, selected
tier, model id, attempt count, schema status, preflight state, per-attempt model profiles
(quantization, parameter size, context, output limit, sampling, and timeout),
bounded attempt blocker details, invalid-output diagnostic codes,
escalation/fallback state, and safety state.
Recommendations that require measured outcomes also show the outcome state and
attached proof-receipt id.
Opening the panel issues only read-scoped snapshot RPCs. It does not scan,
analyze, preflight models, run maintenance, or update records automatically.
The panel can trigger a manual scan, bounded deterministic analysis run, model
readiness check, read-only production check, retention-maintenance dry run,
assignment, claim, in-progress, proof attachment, proof-gated resolve, and
reason-required dismissal through Gateway RPC. The readiness check appends only
sanitized audit metadata. The production check and maintenance dry run do not
mutate state. Use the CLI or Gateway params when you want an explicit
local-first model review or retention apply.

## Gateway RPC

The Control UI and CLI use these Gateway methods:

- `selfImprovement.scan`
- `selfImprovement.auditEvents.list`
- `selfImprovement.summary`
- `selfImprovement.scorecard`
- `selfImprovement.health`
- `selfImprovement.productionCheck`
- `selfImprovement.maintenance.run`
- `selfImprovement.proofReceipts.list`
- `selfImprovement.proofReceipts.record`
- `selfImprovement.analysis.run`
- `selfImprovement.models.preflight`
- `selfImprovement.groups.update`
- `selfImprovement.recommendations.list`
- `selfImprovement.recommendations.get`
- `selfImprovement.recommendations.update`
- `selfImprovement.proposals.list`
- `selfImprovement.proposals.get`
- `selfImprovement.proposals.update`

Read-only clients can list audit events, list/get recommendations, list/get
proposals, read summaries, scorecards, operational health, and production
readiness. Model preflight checks require write-capable Gateway access because
they append sanitized audit-ledger events. Scan, analysis, retention
maintenance, proof-receipt recording, group updates, recommendation updates,
and proposal updates require write scope. Proof-receipt listing is read-only.
Retention maintenance still defaults to dry-run unless `apply` is explicitly
true.

## Tiered Autonomy And Effectiveness

SIG defaults to `recommend`. `observe` can read health only; `recommend` can
record signals, create recommendations, and draft proof. Explicitly approved
administrative work can attach proof, update record status, or run retention.
Explicitly approved sandbox work can run bounded tests and write local proof
artifacts. Source/config changes, memory or skill writes, credential access,
releases/GitHub actions, external writes, funds movement, and trading are never
SIG-controlled operations.

Operational health includes an executable outcome-effectiveness dimension with
a target score of 93 and a safety floor of 100. It measures signal coverage,
causal duplicate rate, signal-to-recommendation p95, capability-routing
accuracy, proof-backed closure, recurrence safety, low-confidence quarantine,
outbox recovery, noise-budget pressure, and safety violations.

## Production Acceptance And Soak

Source-level completion, a passing test, and a healthy production check are
separate acceptance surfaces. A durable rollout requires current evidence for
source review, targeted tests, the changed-surface gate, build, managed runtime,
RPC, authenticated dashboard behavior, and a production soak. The SIG
effectiveness target is at least 93, while the safety score must remain
exactly 100. Downstream portfolio debt is reported separately and is never
silently reclassified as service failure or success.

Source-checkout operators can use the resumable soak runner after activating a
verified immutable candidate release. First create a bounded rollback evidence
artifact under `work/self-improvement`, then initialize the candidate receipt:

```bash
pnpm exec tsx scripts/dev/self-improvement-production-soak.ts start \
  --candidate-release <candidate-release-id> \
  --rollback-release <previous-release-id> \
  --rollback-evidence work/self-improvement/<rollback-receipt>.json \
  --auto-rollback
```

Run or resume the soak from the same source checkout:

```bash
pnpm exec tsx scripts/dev/self-improvement-production-soak.ts run
pnpm exec tsx scripts/dev/self-improvement-production-soak.ts status
```

The runner writes one atomic receipt under `work/self-improvement`, prevents
concurrent writers, and can resume after interruption. It requires 72 elapsed
hours, at least 13 distributed samples, no gap over 12 hours, two verified
managed restarts, the same immutable runtime release, production score at least
93, zero safety violations, healthy SIG RPCs, and successful dashboard routes.
Rapid repeated samples do not count as distributed coverage.

Automatic rollback is candidate-scoped and fail-closed. It is available only
when a distinct retained rollback release was preregistered and cryptographic
rollback evidence was attached at receipt creation. Before changing the latest
snapshot pointer, the runner verifies that the live runtime is still the exact
candidate. It removes any inherited downgrade override from managed lifecycle
commands and never rolls back an unknown runtime.

## Safety Model

The governor only produces records. It cannot:

- merge, push, publish, or release
- perform destructive file actions
- expose secrets
- write Skill Workshop proposals directly to skills
- apply code or config recommendations without tests or explicit approval

Use the recommended route and required evidence fields as the checklist before
marking a recommendation resolved.
