# Pattern Lab Full Auto Production Runbook V2

Purpose: produce the complete local Pattern Lab package for the next scheduled episode while stopping before any YouTube upload, thumbnail replacement, or public publish.

## Default Command

```bash
youtube-v1/.venv-youtube-3.12/bin/python youtube-v1/scripts/patternlab_production.py --next-scheduled --profile full_package --render --send-review --live-voice never --shorts-target 5
```

## Required Order

1. Load and validate the typed production contract, hash-check the active Codex/OpenClaw Pattern Lab skills, and verify the scheduler runtime matches the deployed source manifest.
2. Select the next incomplete scheduled episode and bind every approved input to its current hash.
   Selection must match the requested production profile to the episode's
   production lock. When no compatible lock exists, write the canonical idle
   receipt and stop successfully; never run a different profile or turn an
   expected owner-approval wait into an operational failure.
3. Resolve one explicit city, hidden-history question, proof object, source trail,
   visual payoff, and five episode-owned thumbnail hypotheses. Never inherit a
   prior city's title, prompt, route, or asset.
4. Compile every visual beat, route local AI capability, and run a local still
   tournament only for explicitly planned generic reconstructions. A required
   local-AI route must produce a hash-bound >=93 winner; an episode with no AI
   beat records `not_applicable` instead of inventing work.
5. Build source, evidence, and rights-ledger artifacts before any final media
   render. Machine promotion requires an exact item URL, download URL, license
   URL/code, timezone-aware retrieval time, local hash, and commercial and
   modification permission. Search pages and ambiguous rights are blocked.
6. Build thumbnails with the deterministic local compositor. Codex image generation is reserved for approved high-value non-proof support; local generation is the routine fallback. Final text is never generated into the image.
7. Build source-matched media: proof footage, visual source pack, narration, closed captions, and long-form draft.
8. Generate a Shorts tournament and render 3-5 standalone Shorts only after the long-form passes quality.
9. Run deterministic final-pixel/audio checks, local visual-model checks, narration matching, sequence/repetition checks, and aggregate 93/100 gates with zero warnings.
10. Register an immutable release candidate and create hash-bound Discord owner review only after every required report passes.
11. Stop for owner review. Private upload and public publish remain separate approvals.

Every stage is content-addressed. After a repair, rerun this command; unchanged
upstream stages are reused and the process resumes at the first affected stage.
The owner should never need to remember or request routine substeps.

Direct calls to `patternlab_full_auto_production.py`,
`patternlab_media_pipeline.py`, or render leaf scripts are unsupported outside
debugging. A leaf-script success is not completion proof; rerun this canonical
entrypoint after repair.

## City-Portable Episode Contract

The same contract serves every city. Each episode supplies its own city,
question, proof object, visual payoff, source route, five thumbnail hypotheses,
and Shorts blueprints. `machine_verified_exact_license` is the only unattended
external-media promotion route: it requires exact item/download/license URLs,
an allowlisted license code, commercial and modification permission, a
timezone-aware retrieval timestamp, and verified local bytes. Configured free
stock providers run in bounded automatic mode, download at most one candidate
per provider/context action, and pass through `context_media_library` before
the source pool can use them. Local AI follows
`visual_prompt_compile → local_generation_routes → local_still_tournament →
source_pool_compile → ai_motion_quality`; a requested route cannot be skipped.

## Future Addition Standard

A new provider, renderer, asset class, QA check, model route, review action, or
automation step is unavailable to production until one reviewed change:

1. extends the typed stage/output/side-effect contract;
2. updates scoped agent rules and the mandatory production-director skill;
3. documents its place in this runbook without adding a second entrypoint;
4. adds deterministic success, failure, stale-hash, and side-effect fixtures;
5. preserves crash-safe, content-addressed resume and narrow rollback;
6. passes workflow integrity, shared-skill deployment, and active-runtime drift
   verification; and
7. proves that no weaker fallback, paid call, or YouTube mutation can occur
   silently.

### Sequence reuse preflight

Before a long-form render begins, the canonical sequence gate groups the route
into the same 16-beat windows used by contact-sheet review. An asset ID may
appear only once in each window. This cheap deterministic check catches the
most obvious repeated-image failure before FFmpeg rendering or local VLM
judgment; pHash and semantic sequence judgment remain required for different
IDs that render as near-duplicates.

The active contract is the source of ordering truth. Chat memory, prose status,
or a leaf-script receipt cannot activate a new path. This makes new capability
additive without making the owner remember another production step.

The canonical launch agent includes `--render --send-review`. This means the
unattended path builds the complete local package and sends only a hash-bound
Discord owner-review packet. It does not upload or publish. The scheduler uses
`--live-voice never`; a missing narration remains a deliberate approval/input
block rather than causing an unapproved paid provider call.

## Hard Stops

- Do not upload to YouTube.
- Do not replace a YouTube thumbnail.
- Do not set any video public.
- Do not use paid/pro assets.
- Do not use stock footage as historical proof.
- Do not continue if source rights or title/thumbnail promise checks fail.
- Do not continue if narration contains production-memo language or if repeated visuals lack a new crop, label, comparison, motion purpose, or evidence reveal.

## Approval Templates

```text
I approve replacing the YouTube thumbnail for Pattern Lab Video [exact YouTube video ID] with [exact local candidate path]. I do not authorize public publish or any other YouTube mutation.
```

```text
I approve setting Pattern Lab Video [exact YouTube video ID] public on YouTube. I do not authorize any other YouTube mutation.
```
