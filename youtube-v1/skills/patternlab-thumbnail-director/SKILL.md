---
name: patternlab-thumbnail-director
description: Create, critique, rebuild, or package Pattern Lab city-history YouTube thumbnails. Use for city-first thumbnail strategy, source-safe photo selection, premium typography, Codex support art, shelf QA, and owner review delivery.
---

# Pattern Lab Thumbnail Director

Enter through `patternlab-production-director` and the canonical
`youtube-v1/scripts/patternlab_production.py` profile. Direct renderer or QA
commands are diagnostic only and cannot replace a current canonical run.

Use this skill for every Pattern Lab long-form thumbnail. The target is a
source-led editorial poster that earns a click, not a research board or generic
travel image.

## Canonical locations

- Runtime root: `/Users/openclaw/PatternLabRuntime/youtube-v1`
- Source policies: `resources/thumbnail-worldclass-policy.json`,
  `resources/thumbnail-owner-rating-memory.json`, and
  `resources/source-media-policy.json`
- Workflow: `workflows/thumbnail-production-workflow.md`

Read the policy and active city brief before designing. If a source, rights
status, title/thumbnail promise, or first-30-second payoff is missing, stop
before final rendering and report the exact gap.

## Owner-approved Cleveland visual recipe

1. Lock one narrow city-history contradiction that the first 30 seconds can
   visibly prove.
2. Use one large real proof object tied to the exact claim: a dated archival
   photograph, document, map, or rights-cleared present-day place. AI may not
   be the proof object or historical evidence.
3. Use Codex image generation for the primary **non-proof** support layer when
   it improves city energy, lighting, atmosphere, texture, or depth. Use local
   Draw Things/ComfyUI only as a resilient fallback. Never generate final text
   in an image model.
4. Render all public type with Chrome/Fontsource. Make the active city name
   the largest or co-largest shelf element when city recognition is the hook.
   Pair it with a compact 2-4 word mystery in premium bold condensed type.
5. Default successful palette: vivid cobalt/azure, warm gold/yellow, selective
   signal-red depth, white text, and near-black edge contrast. Reject dim,
   muddy, flat, or gloomy heroes.
6. Keep one focal hierarchy: `emotion -> question -> proof -> city`. Do not
   use generic rounded black cards, map/photo THEN-NOW mismatches, decorative
   arrows, unexplained boxes, filler labels, or source-board clutter.
7. Build three distinct owner finalists: city-dominant contradiction,
   date/photo mystery, and event/transformation. A recolor or crop is not a
   distinct hypothesis.
8. Render 1920x1080 masters, then 1280x720 RGB JPEG chat previews and a
   contact sheet. Bind every preview to exact candidate hashes, title pair,
   source ledger, and review status.

## Non-negotiable checks

- Every evidence asset has an item-level rights-ledger row. An official page
  identifying a historic image does **not** by itself prove commercial reuse of
  the underlying photo.
- A true THEN/NOW is photo/photo or map/map, with THEN left and NOW right.
- The city, hook, and proof object must be understood at phone shelf size.
- Run semantic, pixel, font, shelf, source, and chat-delivery QA. A blocked
  report is a repair, never a pass with a warning.
- Deliver actual preview images to the owner in chat or Discord. Do not upload,
  replace, publish, comment, pin, or mutate YouTube without a separate exact
  approval.

## Preferred rendering stack

1. Source/rights brief and concept tournament.
2. Codex non-proof support art only when it improves the real proof-led design.
3. Deterministic Chrome/Fontsource composite.
4. Local QA and hash-bound owner-review packet.
5. Owner selects or requests a targeted repair; only the affected asset is
   rebuilt.

## Reliable commands

Run from the runtime root, with the active Pattern Lab environment:

```bash
youtube-v1/.venv-youtube-3.12/bin/python youtube-v1/scripts/patternlab_thumbnail_semantic_quality.py --video-id <id>
youtube-v1/.venv-youtube-3.12/bin/python youtube-v1/scripts/patternlab_thumbnail_pixel_quality.py --video-id <id>
youtube-v1/.venv-youtube-3.12/bin/python youtube-v1/scripts/patternlab_thumbnail_font_quality.py --video-id <id>
youtube-v1/.venv-youtube-3.12/bin/python youtube-v1/scripts/patternlab_thumbnail_worldclass.py --video-id <id>
```

Use `PATTERNLAB_NODE_MODULES=/Users/openclaw/PatternLabRuntime/node_modules`
when a renderer or chat-delivery helper requires Sharp from the canonical
runtime installation.
