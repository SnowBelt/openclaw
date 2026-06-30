---
summary: "Platform-only SNES Game Creator milestone runbook for deterministic low-reasoning execution"
read_when:
  - You are advancing reusable SNES Game Creator platform milestones
  - You need low-reasoning milestone execution steps for SNES Studio PCC
  - You need to keep project-specific game work inactive while improving the creator platform
title: "SNES Game Creator Platform Runbook"
---

# SNES Game Creator Platform Runbook

This runbook is for reusable SNES Game Creator platform work only. It improves
contracts, proof templates, orchestration, status, docs, and deterministic QA
that future SNES projects will use.

Do not use this runbook to advance a named game, generate game-specific art,
build a ROM, run emulator gameplay QA, send files, copy to removable media, or
claim hardware proof.

## Required preflight

Run these commands before any platform milestone:

```bash
pnpm docs:list
pnpm snes:mastery status --json
pnpm snes:team -- --mode validate --project demo-pcc-v2 --json
pnpm snes:team -- --mode next --project demo-pcc-v2 --json
git status --short
```

Stop if SNES mastery is not `15/15` katas and `17/17` generic milestones, PCC
validation fails, or an implementation step would touch unrelated dirty files.

## Allowed platform surfaces

Allowed platform work:

- generic asset intent contracts;
- generic hardware proof plan templates;
- low-reasoning runbooks;
- generic PCC status and dashboard snapshot data;
- PCC receipts for generic platform milestones.

Forbidden without a separate explicit approval:

- named-game milestones or assets;
- hosted GLM;
- paid tools or paid assets;
- commercial SNES ROMs, code, art, maps, palettes, music, SFX, leaks, or
  disassemblies;
- ROM builds and emulator gameplay runs;
- FXPAK, SD card, or removable-media writes;
- Discord/file delivery;
- staging, committing, pushing, publishing, or opening a PR.

## Low-reasoning milestone loop

1. Inspect current status with `pnpm snes:team -- --mode next --project demo-pcc-v2 --json`.
2. Select only the first ready generic platform milestone.
3. Read the milestone Definition of Done and required proof names.
4. Create or update only generic platform code, docs, tests, or PCC receipts.
5. Run the targeted tests for the touched surface.
6. Run PCC validation.
7. Run `next` again and verify the milestone moved forward or is honestly blocked.
8. Report completed work, incomplete work, blockers, and completion percentages.

Never mark a milestone `pass` unless every required proof path exists, validators
pass, and the milestone judge has no missing proof.

## Generic MVP closure command

When the next ready milestone is `PCC-020-integration`, use the deterministic
platform MVP closure command instead of receipt-only worker adapter output:

```bash
pnpm snes:team -- --mode complete-platform-mvp --project demo-pcc-v2 --json
```

This command may complete these generic platform milestones only:

- `PCC-020-integration`
- `PCC-030-rom-build-proof`
- `PCC-040-runtime-proof`

It must use already validated legal clean-room generic SNES mastery receipts
from `.artifacts/snes-game-builder-reference/`. It must stop at
`PCC-050-human-visual-approval` and create an approval request instead of
self-approving visuals. It must not run a named-game build, emulator gameplay
QA, Discord send, FXPAK write, or hosted model call.

When the human has approved the generic platform runtime visuals, apply that
approval explicitly:

```bash
pnpm snes:team -- --mode apply-human-visual-approval \
  --project demo-pcc-v2 \
  --milestone PCC-050-human-visual-approval \
  --approval-note "generic SNES Game Creator MVP runtime visuals human-approved for this checkpoint" \
  --json
```

Then rerun `complete-platform-mvp` to complete `PCC-060-package-readiness`.

## Generic proof requirements

Asset intent milestones must prove:

- asset id, kind, dimensions, frame count, palette limit, runtime proof flag;
- production-facing visual assets include a human visual target;
- positive fixture passes;
- negative fixtures fail for missing dimensions, palette overflow, missing
  runtime proof, and project-specific references;
- no named-game path is active.

Hardware plan milestones must prove:

- emulator launch proof is separate from screenshot/runtime proof;
- screenshot/runtime proof is separate from FXPAK copy proof;
- FXPAK copy proof stays blocked/manual until the exact mounted path and user
  approval exist;
- original hardware proof stays blocked/manual until a human performs it;
- no removable-media write is performed by a template.

## Status reporting

Every platform-only report must include:

- generic kata count;
- generic milestone count;
- next generic PCC milestone;
- blocked generic proof surfaces;
- legal clean-room status;
- local model policy status;
- explicit statement that project-specific game production is inactive.

Completion language must distinguish platform readiness from finished-game
production.
