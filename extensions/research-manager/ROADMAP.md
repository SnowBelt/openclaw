# Research Manager Completion Roadmap

This file is the durable source of truth for Research Manager implementation and acceptance.
Milestones pass only when every listed exit gate has current evidence in `qa/continuation.json`.
Percentages are weighted and sum to 100.

## Product Contract

- Certified runs use GPT-5.6 Sol for planning and finalization unless a role-qualified frontier fallback has passed the same evaluation gate.
- Local models perform retrieval support, evidence extraction, claim construction, contradiction search, and verification whenever capacity allows.
- No model fallback is silent. Every attempt, fallback, queue wait, and failure is recorded.
- A run is never labeled certified below 93/100 or with an unsupported material claim.
- When a required capability is unavailable, certified mode waits until its deadline and then returns `blocked`; best-effort mode may continue but returns `uncertified`.
- Model output is untrusted. Deterministic schemas, source checks, citation checks, prompt-injection isolation, resource limits, and certification gates remain authoritative.

## Milestones

### RM-00 Runtime Preflight (4%)

Status: in progress

Exit gates:

- Record the active OpenClaw config, Node runtime, Codex harness version, Ollama inventory, and loaded-model state without exposing secrets.
- Probe every configured role and distinguish configured, reachable, compatible, qualified, and busy.
- Detect deleted/stale model references and fail with actionable diagnostics.

### RM-01 Product and Failure Contract (6%)

Status: in progress

Exit gates:

- Ship strict plugin configuration and typed run/result contracts.
- Define certified, uncertified, blocked, failed, and cancelled semantics.
- Encode explicit fallback, deadline, retry, and fail-closed behavior.

### RM-02 Evaluation Corpus and Baselines (8%)

Status: pending

Exit gates:

- Ship versioned research tasks covering factual, comparative, current, adversarial, ambiguous, and high-stakes queries.
- Score correctness, completeness, source quality, citation entailment, freshness, contradiction handling, and calibration.
- Preserve baseline receipts for Sol-only `ultra` and hybrid runs with reproducible inputs.

### RM-03 Sol Planning Contract (6%)

Status: pending

Exit gates:

- Sol, or a frontier fallback qualified at the same threshold, produces a schema-valid research plan before certified retrieval begins.
- Plans include decomposed questions, search queries, freshness requirements, source requirements, risk, and stop conditions.
- Planner unavailability follows the qualified fallback/deadline contract without silent downgrade.

### RM-04 Evidence and Retrieval Layer (12%)

Status: pending

Exit gates:

- Search uses OpenClaw's provider runtime and records provider/query provenance.
- Source fetching uses the shared SSRF guard, HTTPS by default, redirect and byte limits, content hashing, and prompt-injection isolation.
- Evidence is deduplicated, freshness-labeled, source-ranked, and stored in a claim-addressable ledger.

### RM-05 Local Model and Backend Bakeoff (8%)

Status: pending

Exit gates:

- Measure installed local candidates for each role using the same eval tasks.
- Record memory, context, latency, throughput, schema adherence, quality, and crash rate.
- Only measured role-qualified models enter certified fallback chains.

### RM-06 Capability Registry and Resource Scheduler (12%)

Status: pending

Exit gates:

- Maintain role, context, quality, memory, backend, concurrency, and qualification metadata per model.
- Enforce 130 GB soft, 145 GB hard, and 150 GB absolute local-memory limits by default.
- Use bounded queues, reservations, fairness, deadlines, backpressure, busy detection, and exclusive scheduling for oversized models.

### RM-07 Durable Orchestration (10%)

Status: pending

Exit gates:

- Persist resumable run state and artifacts using OpenClaw plugin state and Task Flow.
- Make every stage idempotent and safe across gateway restart or process interruption.
- Support status, resume, cancel, and stale-run recovery with immutable attempt history.

### RM-08 Local Research Team (8%)

Status: pending

Exit gates:

- Run three to five logical specialist roles with no more than the configured local inference concurrency.
- Assign non-overlapping questions/evidence partitions and require structured claims with citations.
- Include independent contradiction and per-source citation-verification passes that identify the exact sources directly entailing each claim.

### RM-09 Sol Synthesis and Repair (6%)

Status: pending

Exit gates:

- A fresh Sol context finalizes only from the plan, evidence ledger, and verified claims.
- Targeted repair addresses explicit gate failures and cannot erase supported content without reason.
- Revision regression checks reject a lower-quality repair.

### RM-10 Certification and Quality Gate (8%)

Status: pending

Exit gates:

- Deterministic and model-assisted judges score the complete rubric.
- Every material assertion maps to independently verified retrievable support; unrelated or unresolved citations fail closed; contradictions and uncertainty are disclosed.
- Scores below 93, missing proof, or a failed hard gate return uncertified/blocked, never certified.

### RM-11 Security and Operations (7%)

Status: pending

Exit gates:

- Protect against SSRF, prompt injection, oversized content, unsafe redirects, secret leakage, and unbounded tool/model loops.
- Emit redacted diagnostics for stage timing, model use, fallback reason, memory reservation, cost/token use, and certification.
- Ship operator doctor/status commands and restart/recovery tests.

### RM-12 Optimization and Acceptance (5%)

Status: pending

Exit gates:

- Hybrid output is non-inferior to the Sol-only `ultra` baseline and reaches at least 93/100 on the locked acceptance corpus.
- Local work share, remote token use, wall time, and failure rate are measured; optimization cannot weaken quality gates.
- Targeted, changed-surface, broad remote, live local-model, and restart acceptance evidence is current.

## Completion Rule

Completion is exactly 100% only when RM-00 through RM-12 are `passed`, all weighted gates have current evidence, the active OpenClaw configuration is validated, and no required human, environment, or elapsed-time gate remains. Code completion alone is not product completion.
