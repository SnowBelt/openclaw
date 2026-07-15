---
name: patternlab-production-director
description: Mandatory entrypoint whenever a request mentions Pattern Lab, James narration, a Pattern Lab city-history video, Short, thumbnail, source pack, production repair, QA, owner review, Discord review, or Pattern Lab automation. Routes every production action through the canonical fail-closed contract so no agent skips source safety, retained-input locks, rendering, 93+ QA, hashes, or owner approval.
---

# Pattern Lab Production Director

Use one command surface. Never reconstruct the workflow from chat memory and
never call production leaf scripts ad hoc.

## Route the request

- Full episode or scheduled automation:
  `youtube-v1/scripts/patternlab_production.py --profile full_package`.
- Rejected long-form with retained narration:
  `youtube-v1/scripts/patternlab_production.py --profile long_form_rebuild`.
- Inspection or planning only: read the contract and current receipts; do not
  run render/review stages.
- A leaf script may be run directly only while debugging a failed canonical
  stage. Rerun the canonical entrypoint afterward; leaf output is not release
  proof.

## Required operating sequence

1. Read `youtube-v1/AGENTS.md` and
   `youtube-v1/resources/patternlab-production-contract.json`.
2. Require explicit episode-owned `city`, hidden-history question, proof
   object, source trail, visual payoff, five thumbnail hypotheses, and 3-5
   Shorts blueprints. Never derive a new city from a title, video id, prior
   package, or renderer default.
   For `--next-scheduled`, require the candidate's production-lock profile to
   match the requested contract profile. No compatible approval lock is a
   healthy idle state recorded in
   `local-output/operations/canonical-production-idle.json`; do not substitute
   another profile or treat the wait as a failed production run.
3. Run a dry run and inspect the exact stage list.
4. Execute the selected profile. Use `--render` only for approved local media
   work and `--send-review` only when the owner requested Discord review.
5. Trust the current content-addressed run receipt, not prose or stale reports.
6. Stop on the first required failure. Repair that stage, then resume through
   the entrypoint; unaffected hash-matched stages are reused automatically.
7. Keep owner approval, private upload, public publish, and analytics proof as
   separate gates.

## Non-negotiable rules

- Every final asset independently scores at least 93/100 and has no warning or
  hard failure.
- Exact historical claims use rights-cleared evidence; generic media is context
  only; AI is labeled non-proof support.
- Machine source acceptance requires exact item/download/license URLs, an
  allowlisted commercial/modifiable license, retrieval timestamp, local hash,
  and deterministic rights receipt. Search-result pages and ambiguous terms
  fail closed.
- Configured Pexels/Pixabay sources use bounded automatic acquisition and
  `context_media_library` before exact generic-context hashes may enter the
  source pool. Missing keys stay visible; they never trigger an unlicensed or
  AI substitution.
- Local AI is a typed contract path: compile one narration-bound prompt, prove
  the active local route, select one hash-bound >=93 winner, then independently
  validate any generated motion. No AI beat may appear only in prose.
- Every full-package run renders 3-5 Shorts and the complete five-hypothesis
  thumbnail tournament before creating one hash-bound owner-review packet.
- No repeated-image disguise, split/wrap artifact, random text box, caption
  clutter, narration mismatch, stale hash, or hidden bypass.
- Full narration remains toggleable closed captions; burned editorial text is
  selective.
- Never call a paid provider or mutate YouTube without exact scoped approval.
- Future workflow additions must extend the typed contract, tests, scoped agent
  rules, runbook, specialist skills, and workflow-integrity gate before they
  are considered available.
- `patternlab_skill_deployment.py` must pass for both active Codex and OpenClaw
  skill roots. A tracked skill that is not deployed is not production-ready.
- `patternlab_runtime_source_deploy.py` must pass against the active
  `PatternLabRuntime` snapshot. Development-only source is not scheduler proof.
- `patternlab_launchd_install.py` must pass in verify-only mode before a
  production profile runs. Only its explicit `--apply` mode may replace jobs,
  and that mode backs up matching files, rolls back on failure, and installs
  only canonical user agents without manually triggering production.
- Do not ask the owner to remember routine substeps. The selected contract
  profile owns ordering, preflight, rendering, QA, hashes, and review handoff.

## Extension rule

A new process, provider, renderer, QA check, asset class, or review action does
not exist for production until one change updates all governance surfaces in
`change_governance`, adds deterministic tests and failure fixtures, deploys the
shared skills, and produces a passing workflow-integrity receipt. Never add an
undocumented side path or make a weaker fallback silent.

## Canonical commands

```bash
youtube-v1/.venv-youtube-3.12/bin/python youtube-v1/scripts/patternlab_production.py --video-id 04 --profile long_form_rebuild --dry-run
youtube-v1/.venv-youtube-3.12/bin/python youtube-v1/scripts/patternlab_production.py --video-id 04 --profile long_form_rebuild --render
youtube-v1/.venv-youtube-3.12/bin/python youtube-v1/scripts/patternlab_production.py --next-scheduled --profile full_package --render --send-review --live-voice never --shorts-target 5
```

Add `--send-review` only after the same run passes every local release gate.
