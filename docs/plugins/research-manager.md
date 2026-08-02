---
summary: "Run local-first, evidence-backed research with Sol planning and fail-closed certification"
title: "Research Manager"
read_when:
  - You want a local-first research team with GPT-5.6 Sol oversight
  - You need research output that fails closed below a measurable quality threshold
  - You need to qualify local models or compare hybrid output with a Sol-only baseline
---

Research Manager is an optional bundled plugin for durable, source-backed research. GPT-5.6 Sol
plans and finalizes certified runs. Qualified local models handle source triage, evidence extraction,
claim construction, contradiction search, citation verification, and conservative judging whenever
their role, context window, queue deadline, and memory reservation permit it.

The plugin does not claim that a swarm makes a weak model equivalent to a frontier model. It uses
specialization, deterministic evidence checks, and Sol oversight to reduce remote work while keeping
the same acceptance bar. A certified result must score at least `93/100`, pass every hard gate, and
contain only verified material claims. Otherwise the run is `blocked`, not silently downgraded.

## Architecture

1. Sol creates a structured research plan in a fresh, tool-disabled context. Explicit user
   requirements and the subquestions needed to answer them are mandatory coverage; each required or
   important question needs its own mapped search-query capacity.
2. OpenClaw web-search providers retrieve candidate sources.
3. Shared SSRF protection and bounded extractors fetch HTML and PDF evidence.
4. Three to five logical specialists process distinct question assignments. Each specialist is
   decomposed into bounded question/source units, and every successful unit is checkpointed before
   the next inference. Each question-specific unit ranks the complete fetched corpus by semantic
   relevance while retaining planned-query provenance, so useful evidence is not hidden by an
   imperfect search-to-question assignment. Sources shared by multiple planned queries remain
   available through balanced, relevance-selected evidence packets.
5. An independent verifier checks quotations, source links, contradictions, and claim support, and
   records exactly which sources independently entail each claim. It also rejects a sourced fact
   that is merely related to, rather than materially responsive to, its assigned question.
6. Sol finalizes from the plan and verified ledger only.
7. Deterministic gates and an independent critic score correctness, completeness, source quality,
   citation entailment, freshness, contradiction handling, and calibration.

Every stage and successful research unit is persisted. Status, resume, cancellation, fallback
attempts, queue waits, token use, memory reservations, and certification results survive gateway
restarts. Resume reuses completed units and regenerates only missing work.

Trusted or bundled installations use OpenClaw's native keyed plugin state. Config-path installations
fall back only when that API is explicitly trust-restricted, using a private, WAL-backed SQLite
database under the active OpenClaw state directory. Both backends enforce bounded namespaces, TTLs,
atomic writes, JSON-only values, and restrictive file permissions. The SQLite backend permits
bounded large evidence/run records up to 16 MiB; ordinary keyed values remain capped at 64 KiB.

## Prerequisites

- Node.js 22 or newer; Node.js 24 is recommended for this checkout.
- The bundled `codex` plugin and `@openai/codex` `0.144.5` or newer.
- A Codex account that exposes `gpt-5.6-sol`.
- At least one configured OpenClaw web-search provider.
- Ollama for the default local model team.
- Enough host memory for the configured local reservations. The defaults assume a 256 GB host and
  cap Research Manager at 150 GB.

Authenticate the OpenClaw Codex profile used by Research Manager:

```bash
openclaw models auth login --provider openai-codex --profile-id openai-codex:default
```

Enable the bundled `codex` plugin by ID. Do not add a source-checkout `extensions/codex` path to
`plugins.load.paths`; a config-path copy cannot claim the bundled plugin's reserved command
ownership.

Confirm that Sol appears in the live Codex catalog before enabling certified runs:

```bash
openclaw agent --message "/codex models"
```

Hybrid runs use Sol `high` for ordinary planning, `xhigh` for high-stakes planning, and `xhigh` for
finalization. The locked Sol-only comparator uses OpenClaw's canonical `max` level for every Sol
role; the Codex adapter maps that level to Sol's advertised `ultra` effort. Preflight fails unless the
live catalog advertises `high`, `xhigh`, `max`, and `ultra`, so the benchmark cannot silently compare
against a lower effort. Local structured calls use Ollama's native `/api/chat` JSON-schema format
with streaming and thinking disabled, bounded context and output tokens, and a finite keep-alive.
This direct adapter avoids embedded-agent overhead while keeping Research Manager's scheduler,
qualification, fallback, attempt, and token telemetry authoritative.

## Configuration

Enable both plugins. Research Manager is not enabled by default because certified runs can use a
remote frontier model.

```json5
{
  plugins: {
    entries: {
      codex: { enabled: true },
      "research-manager": {
        enabled: true,
        config: {
          defaultMode: "certified",
          certificationThreshold: 93,
          resourceLimits: {
            softMemoryGb: 130,
            hardMemoryGb: 145,
            absoluteMemoryGb: 150,
            maxLocalParallel: 1,
            maxLoadedModels: 3,
            maxLogicalWorkers: 5,
          },
          retrieval: {
            queryCount: 24,
          },
        },
      },
    },
  },
}
```

The built-in model roster is:

| Assignment                       | Model                                          | Initial certified state                        |
| -------------------------------- | ---------------------------------------------- | ---------------------------------------------- |
| Planner and finalizer            | `codex/gpt-5.6-sol`                            | Trusted primary, live probe required           |
| Non-frontier Sol fallback        | `codex/gpt-5.6-sol`                            | Disabled by qualification score until measured |
| Frontier fallback                | `codex/gpt-5.5`                                | Disabled by qualification score until measured |
| Researcher and critic            | `ollama/qwen3.6:27b-q8_0`                      | Disabled until role bakeoff passes             |
| Verifier and critic              | `ollama/openclaw-control-gemma4-31b-q8:latest` | Disabled until role bakeoff passes             |
| Scout and lightweight researcher | `ollama/qwen3.5:9b-q4_K_M`                     | Disabled until role bakeoff passes             |

Model IDs, quantizations, and context windows are configuration, not proof of readiness. `doctor
--live` distinguishes configured, installed, reachable, compatible, qualified, loaded, and busy.

The default 24-query retrieval budget matches the planner's maximum of 24 atomic questions. A plan
that tries to compress more required or important questions than its retained query capacity fails
closed before retrieval. Certification treats both `required` and `important` plan questions as
mandatory; only genuinely nonessential `optional` questions are excluded from the deterministic
coverage gate.

### Search provider

The validated local setup uses SearXNG on loopback as the primary provider and DuckDuckGo as a
bounded fallback. The setup helper pins the SearXNG container image by digest, creates a private
settings file under the active state directory, enables JSON results, and writes a readiness
receipt:

```bash
node extensions/research-manager/qa/setup-search.mjs \
  --state-dir "$OPENCLAW_STATE_DIR" \
  --output extensions/research-manager/qa/artifacts/search-service-current.json
```

Verify an existing service without pulling or restarting it:

```bash
node extensions/research-manager/qa/setup-search.mjs \
  --state-dir "$OPENCLAW_STATE_DIR" \
  --verify-only
```

Set `retrieval.providerOrder` to `["searxng", "duckduckgo"]`. Provider failure, empty public
results, or a bot challenge is recorded before the next provider is tried. `doctor --live` performs
an actual search, not only a configuration check.

## Qualification

Run preflight first:

```bash
openclaw research doctor --live --json --output research-receipts/doctor.json
```

Record redacted Codex OAuth readiness after preflight. The receipt stores only presence flags and
JWT timestamps, never token values, token hashes, or account identity:

```bash
node extensions/research-manager/qa/auth-preflight.mjs \
  --preflight extensions/research-manager/qa/artifacts/preflight-current.json \
  --output extensions/research-manager/qa/artifacts/auth-current.json
```

When the gateway uses a non-default `OPENCLAW_STATE_DIR`, set the same value for operator CLI
commands. This keeps qualification, acceptance, and run receipts in the gateway's durable state.

Then evaluate each fallback only for its assigned roles. Qualification receipts include the exact
locked corpus version and SHA-256, parameter and quantization metadata when Ollama reports them,
context, latency, schema adherence, crash rate, quality score, and an integrity hash. Changing the
corpus invalidates older qualification receipts instead of carrying scores forward.

```bash
openclaw research bakeoff --model qwen3.5-9b-scout --roles scout,researcher --output research-receipts/qwen35.json
openclaw research bakeoff --model qwen3.6-27b-researcher --roles planner,researcher,critic,finalizer --output research-receipts/qwen36.json
openclaw research bakeoff --model gemma4-31b-verifier --roles verifier,critic --output research-receipts/gemma4.json
openclaw research bakeoff --model sol-general-fallback --roles scout,researcher,verifier,critic --output research-receipts/sol-general.json
openclaw research bakeoff --model gpt-5.5-fallback --roles planner,scout,researcher,verifier,critic,finalizer --output research-receipts/gpt55.json
```

The per-role thresholds are planner `93`, scout `75`, researcher `82`, verifier `90`, critic `88`,
and finalizer `93`. A role also requires `100%` schema adherence and zero crashes. Failed measurements
persist a score of zero in the certified registry.

## Running research

```bash
openclaw research run "Compare the current official guidance on ..." --mode certified
openclaw research status
openclaw research status <run-id> --json
openclaw research resume <run-id>
openclaw research cancel <run-id>
openclaw research replay <run-id> --model-profile hybrid
openclaw research replay <run-id> --model-profile sol-only
```

Replay preserves the source run's normalized plan and fetched corpus so model-team changes can be
compared without retrieval drift. Certified replay requires qualified frontier planner provenance
bound to the exact plan SHA-256; inherited planning does not count as a new model call or token use.

The optional `research-manager` agent tool exposes run, list, status, resume, cancel, doctor, and
acceptance-status actions. It does not expose the expensive acceptance runner to autonomous model
calls; paired benchmarks are an operator CLI action.

## Scheduling and fallback

Five logical workers do not mean five model copies. The validated default admits one local inference
at a time and no more than three loaded local models, while accounting for model weights plus
per-inference context memory. It enforces a 130 GB soft limit, 145 GB hard limit, and 150 GB absolute
limit, with bounded queues, priority, fairness, deadlines, and exclusive reservations for oversized
models.
While external Ollama work owns RAM, queued local work rechecks the live inventory every second and
starts automatically when capacity returns.

Model-level `maxParallel` must match the serving backend. The validated Ollama service uses
`OLLAMA_NUM_PARALLEL=1`, so each default local model is configured with `maxParallel: 1`; logical
parallelism comes from different loaded models, not simultaneous requests to one runner.

When a model is already in use, work waits in the bounded queue until capacity becomes available or
the stage deadline expires. Local inference timeouts adapt to measured qualification latency, with a
four-minute floor and five-minute ceiling inside the overall stage deadline. A qualified fallback is
tried only after the prior attempt is recorded. Two consecutive local busy or timeout failures place
that model on a ten-minute cooldown; cooldown skips are recorded but do not count as model work or
consume an inference attempt. The cooldown state is reconstructed when a run resumes.

Certified mode never silently substitutes an unqualified model. If every qualified candidate is
busy, unavailable, incompatible, or fails, the run returns `blocked`. Best-effort mode may continue
with compatible unqualified candidates but can never be labeled certified. Local-call share counts
successful inference only, so timeouts, failures, cancellation, and cooldown skips cannot inflate
the reported savings.

## Acceptance benchmark

The locked acceptance corpus covers factual, comparative, current, adversarial, ambiguous, and
high-stakes research. For each query, the Sol-only arm generates the qualified frontier plan,
retrieves the evidence corpus, and runs every model role at Sol's advertised `ultra` maximum. The
hybrid arm then reuses that exact plan and fetched corpus with normal routing. Shared planner and
retrieval model work is charged to the hybrid metrics, so replay cannot overstate remote-token
savings.

```bash
openclaw research acceptance run --output research-receipts/acceptance.json
openclaw research acceptance status
openclaw research acceptance run --resume <receipt-id> --output research-receipts/acceptance.json
```

Acceptance passes only when:

- every Sol-only and hybrid case is certified at `93/100` or higher
- every paired case has the same fetched-evidence SHA-256
- every required authority domain contributes fetched evidence independently verified as
  supporting a final claim
- no hybrid case scores below its paired Sol-only case
- at least half of successful hybrid model calls are local
- remote token telemetry is complete and hybrid remote token use is lower
- no profile run is blocked, failed, or cancelled

The zero-point non-inferiority margin is intentionally stricter than an average-only comparison. A
single regressed category fails the receipt.

Run the deterministic source verification gate after implementation changes. It records command
results and a source-tree fingerprint without embedding command output:

```bash
node extensions/research-manager/qa/verify.mjs \
  --output extensions/research-manager/qa/artifacts/verification-current.json
```

## Security and privacy

- Search and fetched content are untrusted data, never model instructions.
- Shared SSRF policy rejects unsafe destinations, credentials in URLs, unsafe redirects, and blocked
  address ranges.
- Fetches have HTTPS, timeout, redirect, byte, character, and concurrency limits.
- Exact evidence quotations must exist in the fetched source body.
- Certification counts source breadth, domain breadth, freshness, and required-domain proof only
  from sources the independent verifier marked as directly supporting a used verified claim.
- Unknown, duplicate, unresolved, missing, or unrelated final-answer claim and citation references
  fail closed.
- Public reports omit fetched bodies and redact credential-like text from errors, plans, evidence,
  findings, and limitations.
- Model loops, repair passes, retries, queues, and output tokens are bounded.
- Restart recovery never automatically resumes remote spending.

## Cost

Local Ollama work has no per-token API charge but still uses electricity and hardware. Sol and other
remote fallbacks can consume a Codex subscription allowance or API billing, depending on the active
Codex authentication profile. Research Manager records token telemetry and reported cost when the
provider exposes it; it does not invent a dollar estimate when cost data is unavailable.

## Troubleshooting

`doctor --live` is the authoritative first check. Typical failures are:

- **Configured but not installed:** pull the exact Ollama model or remove the stale reference.
- **Installed but unqualified:** run the locked role bakeoff; do not raise the stored score manually.
- **Busy:** wait for the bounded queue or lower local parallelism.
- **Sol missing:** update the Codex harness and verify the account's live model catalog.
- **OAuth session ended:** run `openclaw models auth login --provider openai-codex --force` and then
  repeat `research doctor --live`; certified mode remains blocked until a frontier finalizer passes.
- **No search provider:** configure an OpenClaw web-search plugin before certified research.
- **Below 93:** inspect hard-gate and dimension failures; adding more workers cannot override missing
  evidence, weak sources, unsupported claims, or stale information.

Research Manager cannot mathematically guarantee a `93/100` result for every possible question.
Its guarantee is procedural: it never reports certification unless the measured run passes the locked
threshold and hard gates.
