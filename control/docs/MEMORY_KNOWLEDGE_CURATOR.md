# Memory & Knowledge Curator

## Contract

The curator is an event-driven, reviewer-only gate for `memory_skill`
proposals. It may read the supplied proposal and cited evidence and may record
structured review metadata. It must never write, edit, promote, or disclose
memory or skill content.

It must not edit `MEMORY.md`, `SKILL.md`, private memory, shared-context
memory, repository skills, or arbitrary files. Promotion is performed only by
an approved operator workflow after the linked Skill Workshop item is applied.

## Review record

Every decision records bounded evidence references with:

- `sourceClass`: the source kind, not an invented source;
- `confidence`: `low`, `medium`, or `high`;
- `freshness`: `current`, `stale_risk`, or `unknown`;
- `privacy`: `shared_safe`, `private_reference_only`, or `blocked_sensitive`;
- contradiction state, concise reason, next action, and review time.

Missing provenance, stale or contradictory evidence, unknown privacy, sensitive
content, or missing proof yields `needs_more_evidence` or `rejected`. Private
memory may be referenced only as a minimum necessary private reference; raw
private text, secrets, credentials, tokens, cookies, and dossiers never enter
shared context, logs, prompts, or status files.

Legal reviewer outcomes are `accepted_for_workshop`, `rejected`,
`needs_more_evidence`, and `superseded`. Acceptance creates a pending,
deterministic Skill Workshop draft and does not apply it. The curator never
calls a promotion action.

## Activation and recovery

New memory/skill proposals are dispatched after an analysis event. A
deterministic controller reads the proposal once, sends a privacy-filtered DTO
to the configured model without tools, validates the structured advice, and
records one CAS-bound decision. Model generation has one repair attempt;
decision writes are never retried inside a review. Startup reconciliation
retries eligible pending work. Reviews are bounded to three dispatch attempts
with delayed retry and durable dispatch metadata.
Operators may request a retry through the curator RPC/CLI; exhausted work
remains visible as failed and is not silently promoted.

## Verification

Verify the compact workspace prompt, effective tool allowlist, exact structured
decision behavior, no-write boundary, workshop draft linkage, retry behavior,
and targeted Gateway/unit/UI tests before changing status to `verified`.

This document intentionally contains no runtime SHA or configuration hash.

## Model replacement contract

The curator does not depend on a named model or model-controlled tool order.
Models provide bounded JSON advice only and receive no curator tools. The
controller owns exact-once read/write behavior and fails closed on malformed,
timed-out, private, stale, contradictory, or low-confidence advice. Replacement
qualification measures the controller trace, privacy boundary, decision policy,
and recovery behavior across normal, insufficient, sensitive, and replacement
scenarios. `curator_get` and `curator_decide` remain guarded manual-workflow
tools; they are not the production dispatch mechanism.
