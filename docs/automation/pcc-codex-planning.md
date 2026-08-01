---
summary: "Planning-only Codex OAuth for PCC project plans, setup repair, and Autopilot prompts"
read_when:
  - You want to know which model plans PCC projects
  - You need to enable or revoke the PCC planning-only grant
  - You are troubleshooting PCC project-plan generation
title: "PCC Codex Planning"
sidebarTitle: "PCC Codex Planning"
---

# PCC Codex planning

PCC uses Codex for semantic planning and OpenClaw local agents for execution by default. These are separate authorities: enabling PCC planning does not authorize Codex implementation, shell tools, deployments, credentials, purchases, publication, destructive actions, or external writes.

## Planning contract

The canonical planning policy is stored once in the PCC ledger. Its default model is `openai/gpt-5.6-sol` through the native Codex runtime and OpenAI OAuth. Automatic depth uses medium effort for ordinary work and high effort for architecture, migration, security, concurrency, integration, production, or similarly complex plans.

The persistent planning-only grant covers four surfaces:

- new project creation;
- project replanning from a natural-language change request;
- setup repair;
- Autopilot prompt generation.

Every result records provider, exact model, runtime, effort, OAuth provenance, generation time, and `planningOnly: true`. The grant can be disabled through `pcc.planningPolicy.upsert`. A disabled grant fails closed before any model call.

Sign in or repair OAuth with:

```bash
openclaw models auth login --provider openai
```

PCC never stores or displays the OAuth token. Authentication remains owned by the existing OpenClaw model-auth profile.

## Plan generation

PCC sends a tool-free request to the native Codex runtime. The response must be strict JSON containing a real title, concrete goal, outcome metrics, ordered milestones, sub-milestones, responsibilities, acceptance criteria, proof levels, assumptions, and risks. Invalid JSON, unsupported workflow templates, empty steps, forward dependencies, and cycles fail closed.

User-entered title, goal, and setup answers are preserved. Codex fills blanks and presents a reviewable draft. No project, milestone, or sub-milestone is written until the user creates the project or applies the setup-repair preview.

Project creation runs as a durable planning job. PCC shows the current stage, exact model, effort, and elapsed time while the planner is working. The operator can cancel without losing the project description. The run record remains under the OpenClaw state directory across page navigation, and an interrupted Gateway marks an unfinished run as lost instead of pretending it succeeded.

Autopilot uses Codex to plan editable prompts, but those prompt slots default to local-model execution. Any later Codex execution remains governed by the project execution profile and a separate project-bound approval.

## Private team operating envelope

For a private team of one to five people, PCC keeps one shared ledger behind the existing Gateway authentication boundary. Every authenticated operator can see the shared projects; this MVP does not pretend to provide per-person project roles or tenant isolation. Keep the Gateway private and use its normal device, token, and scope controls for membership.

PCC records the small-team guardrails in the ledger and exposes them in the dashboard: up to five authenticated operators, 100 active projects, two simultaneous Codex planning runs, and up to 200 files or 1 GiB of attachments per project. A full planning slot returns a retryable message rather than over-admitting work. Abandoned upload parts are removed automatically before a new upload begins, while committed attachments remain content-addressed and untouched.

Every committed ledger mutation preserves the previous committed snapshot in a private last-known-good backup before the next write. SQLite transactions and WAL remain the primary store; the backup is a recovery point, not a claim that a deployment or project is complete. If storage or metadata is corrupt, stop and use the existing Doctor repair path rather than silently rewriting the ledger.

This envelope is intentionally not a scale-out or collaborative-editing design. It favors predictable local behavior, clear recovery, and local AI for routine work. Multi-tenant roles, distributed storage, resumable uploads across machine restarts, and large-team load testing remain separate future work.

## Project files

Existing projects can attach images, documents, text, audio, video, and common office files. Every file records a role, project or milestone scope, usage instructions, sensitivity, model-access policy, SHA-256 identity, and versioned attachment metadata. Uploads are chunked, resumable for one hour, size-bounded, MIME-checked, content-addressed outside the web root, and idempotent.

The optional `Make my instructions clearer with local AI` action uses only a configured local utility model. PCC fails closed rather than silently sending the note to a cloud model, preserves the original note, stores the improved wording separately, and shows the exact local provider and model provenance. Storage-only and restricted attachments are excluded from AI handoff packets. Other attachment instructions are included in project and milestone context so workers know what the file is for before acting. Authorized workers read content through the bounded `pcc.attachments.read` method and record a usage receipt afterward; raw attachment bytes never enter the PCC ledger.

## Changing An Existing Project

The selected-project action `Change this project with AI` accepts an everyday-language request. PCC asks Codex for a planning-only revision and shows an impact preview before writing anything. The preview identifies milestones that will be added or updated, completed history that will be preserved, affected active work, dependency changes, proof that becomes stale, the exact planning model and effort, and the rollback path.

Completed milestones and completed sub-milestones are immutable history. A revision that would overwrite them, create duplicate titles, introduce a dependency cycle, or reference an unknown dependency fails closed. Applying an accepted revision pauses affected active work, stores the prior plan snapshot, and records the change reason. `Undo last AI plan change` restores that snapshot without deleting historical records. If the project changes after the preview was generated, PCC rejects the stale preview and requires a fresh one.

## Execution boundary

Planning provenance is not execution permission. PCC always uses the separate planning-only OAuth grant for initial project planning and AI-assisted project changes. Project creation then separates local work speed from optional Codex help after planning. The recommended minimum post-plan policy uses Codex for material replanning and final review, and uses Automatic for high-impact architecture or repeated local failure. All executable work remains assigned to OpenClaw local agents unless the user explicitly changes an individual milestone after creation.

PCC execution teams use the resource governor, project coordinator, workspace leases, local model routing, stop conditions, and proof-gated fan-in described in [PCC Execution Teams](/automation/pcc-execution-teams).

If the planner is unavailable, PCC reports the exact OAuth or model-catalog blocker. It does not substitute deterministic text or claim that local autofill came from Codex.
