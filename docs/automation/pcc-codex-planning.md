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
- project replanning;
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

Autopilot uses Codex to plan editable prompts, but those prompt slots default to local-model execution. Any later Codex execution remains governed by the project execution profile and a separate project-bound approval.

## Execution boundary

Planning provenance is not execution permission. PCC execution teams use the resource governor, project coordinator, workspace leases, local model routing, stop conditions, and proof-gated fan-in described in [PCC Execution Teams](/automation/pcc-execution-teams).

If the planner is unavailable, PCC reports the exact OAuth or model-catalog blocker. It does not substitute deterministic text or claim that local autofill came from Codex.
