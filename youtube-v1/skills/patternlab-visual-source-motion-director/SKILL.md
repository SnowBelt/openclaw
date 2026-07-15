---
name: patternlab-visual-source-motion-director
description: Source, license, select, animate, and validate Pattern Lab city-history images and video without turning search results into evidence.
---

# Pattern Lab Visual Source Motion Director

Enter through `patternlab-production-director` and the canonical
`youtube-v1/scripts/patternlab_production.py` profile. Leaf commands below are
debugging tools only; their receipts do not bypass the full contract.

Build visuals in this order: exact evidence, modern context, deterministic
motion, local AI support, then bounded Codex support. Never invert it.

## Required source workflow

1. Read `resources/source-media-policy.json`,
   `resources/visual-acquisition-routing-policy.json`, and
   `resources/open-archive-provider-registry.json`.
2. Initialize and complete `source-packet/visual-contract.json`. Split the
   locked script into narration beats, assign exactly one role—`proof`,
   `context`, `reconstruction`, or `system`—and define the action, emotional
   function, and three distinct candidate queries. Every historical claim needs
   an exact proof candidate; every beat needs three distinct visual candidates.
3. Query source tiers in order. Search results are leads, never production
   assets. When a provider rate-limits, use cached metadata or another
   sanctioned provider; do not scrape around the limit.
4. Require an exact item page, exact download URL, creator, item-level rights
   basis, license URL, local hash, retrieval time, and editorial role before
   promotion to the evidence intake.
   Deterministic machine acceptance additionally requires an allowlisted
   license code, timezone-aware retrieval timestamp, and explicit commercial
   and modification permission. Otherwise require explicit human acceptance;
   never infer approval from a provider name or rights prose.
5. Openverse and Internet Archive discovery reports are **candidate-only**.
   Openverse license metadata must be verified at the original source. Internet
   Archive download availability never proves commercial reuse rights.
6. Use modern stock footage only for context and pacing. It cannot prove a
   historical claim. A generic, rights-cleared busy street is appropriate for
   narration about foot traffic or street life even when it is not Cleveland
   or Detroit, but log it as `modern_context` / `context_only` and never imply
   it depicts the named city, neighborhood, date, or event. Match the visible
   action, emotional function, and nearby narration; do not use generic clips
   as decorative filler. Prioritize Pexels/Pixabay API, then verified
   Mixkit/Coverr exact items; API keys or browser capture may be needed.
7. Use deterministic motion on real evidence first: source highlight, map
   trace, document closeup, matched then/now, and restrained parallax.
8. Local AI may make non-proof support visuals and short labeled
   reconstructions. Codex is reserved for high-value thumbnail/hero support.
   Neither may impersonate archival evidence.
   Each generated beat needs a canonical `video-XX-local-ai-BEAT` asset id,
   at least one source claim id, generic geographic scope, exact disclosure,
   and a hash-bound local tournament receipt before it can enter the source
   pool. An unavailable optional model route is a capability gap; if a beat
   actually requests that route, the consuming generation stage blocks.
9. Run acquisition, rights, narration-match, variety, motion, final-pixel,
   audio, and release gates. Block rather than use generic wrong-city material.
10. Before rendering an approximately eight-minute long-form episode, require
    at least 60 rights-checked pool assets from at least 52 distinct item URLs,
    route at least 52 unique assets and at least 50% unique-asset share, limit
    static reuse to three with at least 30 seconds between uses, cap maps and
    documents at 20% of beats, and make at least 20% of beats moving image. Do
    not place the same asset ID twice inside one 16-beat contact-sheet window.
    These are floors, not targets; narration fit still outranks filling a quota.
11. Never use a split-screen, wrapped crop, or generative motion adjustment
    unless the final rendered pixels pass seam, top/bottom-wrap, source-identity,
    and contact-sheet QA. After an artifact-related owner rejection, disable the
    failed transformation for the replacement rather than retrying it blindly.

## Local-generation reliability contract

1. Compile the narration beat with `patternlab_visual_prompt_compiler.py`.
   Never paste a whole transcript into the image prompt. Generate from one
   visible action, one focal subject, period constraints, camera, composition,
   light, and preservation rules. Keep the full narration in the receipt and
   independent judge prompt.
2. Generate only in a native non-root macOS user runtime. Codex Seatbelt cannot
   reliably allocate Apple Metal/MPS buffers. A sandbox failure is an
   environment block and may not supersede a fresh native hash-bound canary.
3. Serialize Draw Things with the shared file lock; use two bounded attempts,
   atomic temporary outputs, exact CLI/model/prompt/seed hashes, per-candidate
   receipts, and resumable progress. Never run two Metal generations at once.
4. Run an eight-candidate draft tournament and at most two prompt-repair rounds.
   Deterministic brightness, contrast, saturation, and sharpness checks run
   before Qwen3-VL. Only a >=93 candidate with no hard failure may win.
5. Promote only the winner with one low-strength local img2img pass at the
   model's verified native dimensions, enlarge deterministically to 1536x1024,
   then repeat deterministic and Qwen3-VL QA on those final pixels. If the
   verified model's img2img path reports its known shape failure, use a clearly
   receipted Lanczos enlargement—not a silent model/provider fallback—and
   rejudge it. A failed final-pixel judgment means no selected asset.
6. Generated candidates live in `intermediates/generation-candidates`; only the
   hash-bound winner enters `source-packet/selected-local-ai`. This keeps
   failed candidates safely disposable without risking source evidence.

## Historical-photo documentary motion

Use `patternlab_historical_parallax.py` before any generative image-to-video
model. Apple Vision (or a reviewed manual mask) separates the focal subject;
the background and subject then pan or zoom at restrained different speeds.
Stream frames directly to FFmpeg—never create a frame directory. Prefer:

- `documentary_depth` for the classic slower-subject/faster-background push;
- `lateral_depth` for workers, steel beams, storefronts, or strong silhouettes;
- `safe_subject_push` when preserving every visible source pixel matters more
  than depth strength.

The receipt must bind source, mask, preset, and output hashes. Telea background
fill is a presentation-only non-proof effect. QA reconstructs expected frames,
checks PSNR/SSIM, mask fragmentation, temporal jumps, and local Qwen3-VL cutout
quality. Use `production_selected` only after the actual source and mask pass.
Promote a selected derivative as `asset_kind: source_motion` only when its
manifest binds the original-source and motion-receipt hashes.

Generated body, face, lip, crowd, vehicle, or object motion is not this effect;
it is a disclosed reconstruction and must pass the stricter AI-motion gate.

## Storage contract

- Run `patternlab_storage_lifecycle.py` before still generation, rendering,
  local image-to-video, or model download with the matching operation gate.
- Stream intermediates to FFmpeg. Keep source originals, rights, approvals,
  release manifests, approved masters, and upload receipts. Expire only
  classified transient frames, failed/superseded candidates, and proxies.
- Prefer a dedicated APFS external NVMe/Thunderbolt media store. Use
  `patternlab_storage_migration.py` to copy and SHA-verify before activation;
  it never deletes originals. Configure `PATTERNLAB_MEDIA_STORE` and
  `PATTERNLAB_MODEL_ROOT` through the verified runtime config.
- If free space is below the relevant reserve, block. Do not silently lower a
  quality setting or delete protected media to make a job fit.

## Retention design

Every visual contract needs a retention function, motion intent, and visual
change rule. Open on proof/system imagery. Target a meaningful reveal at most
every 2.5 seconds in the first 30 seconds and every 5 seconds afterward. A
reveal means new evidence, a source crop, map state, then/now comparison,
highlight, or purposeful composition change—not decorative movement. AI motion
is optional and capped; narration match and source truth remain authoritative.

## Visual-role decision

| Role             | Use                                                             | Non-negotiable rule                                                                                              |
| ---------------- | --------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `proof`          | Exact historical photo, map, film, document                     | Item-level rights plus city/entity evidence; never generic or AI.                                                |
| `context`        | Generic people, traffic, stores, factory work, street life      | Match action and emotion, set `context_only`, and never imply the named city/event.                              |
| `reconstruction` | Short AI bridge for a consequence that cannot be shown honestly | Local Draw Things first; disclose `Dramatic reconstruction — not archival footage`; maximum 12 seconds per beat. |
| `system`         | Original map, timeline, source overlay, then/now                | Derive from logged source inputs; never present an invented map as fact.                                         |

Use `resources/generic-context-taxonomy.json` for generic action queries.
Build a reusable context library only from exact, hash-bound, rights-cleared
items. A reusable generic clip remains generic forever; it never becomes proof
because it is later used in Cleveland, Detroit, or another city.

## Provider order

| Need                          | First route                                                            | Fallback                                                     | Promotion condition                         |
| ----------------------------- | ---------------------------------------------------------------------- | ------------------------------------------------------------ | ------------------------------------------- |
| Historical photo/map/document | LOC, NARA, Wikimedia, Smithsonian CC0, DPLA Unlimited Re-Use           | Openverse candidate discovery, local archive permission lead | Original item rights + local hash           |
| Historical motion             | NARA, LOC film, Prelinger item with public-domain/CC-BY/CC-BY-SA terms | Source-grounded still motion                                 | Exact item rights + local hash              |
| Modern city video             | Pexels API, Pixabay API                                                | Mixkit Free License, Coverr exact clip                       | Exact item, creator, license, local file    |
| Present-day map/footprint     | Official government/open geospatial data, OSM support                  | Original source-grounded Pattern Lab map                     | Dataset/item source + transformation record |

## Hard blocks

- DPL, Detroit Historical, Henry Ford, Reuther, Bentley, and similar local
  collections are permission leads unless the exact item exposes compatible
  reuse terms.
- CC BY-NC, CC BY-ND, editorial-only, unknown-rights, watermarked, or
  search-page-only material is blocked.
- No generic city image can substitute for Black Bottom, Paradise Valley,
  Hastings Street, St. Antoine, or the I-375 footprint.
- AI output can illustrate but cannot be archival evidence or factual map proof.

## Context-match rule

Use a generic clip or still only when all of these are true:

1. The narration is describing a general action, atmosphere, consequence, or
   system—not a verifiable historical fact about a specific place or person.
2. The asset's action and mood match the line. For example, use a busy,
   pedestrian-focused street for foot traffic; do not use a skyline or a
   freeway merely because it is city footage.
3. The evidence manifest sets `source_role: modern_context` and
   `editorial_role: context_only`.
4. Nearby source proof establishes any city-specific historical claim before
   or after the context beat.

If a narration beat needs a human consequence but no exact footage exists,
prefer a short locally generated, explicitly labeled reconstruction over a
misleading fake historical clip. Keep the reconstruction brief and non-proof.

## Commands

Run from the repository root:

```bash
youtube-v1/.venv-youtube-3.12/bin/python youtube-v1/scripts/patternlab_open_archive_candidate_acquisition.py --video-id 04 --live
youtube-v1/.venv-youtube-3.12/bin/python youtube-v1/scripts/patternlab_free_stock_acquisition.py --video-id 04 --auto --download-per-context 1
youtube-v1/.venv-youtube-3.12/bin/python youtube-v1/scripts/patternlab_visual_contract.py --video-id 04 --init
youtube-v1/.venv-youtube-3.12/bin/python youtube-v1/scripts/patternlab_visual_contract.py --video-id 04
youtube-v1/.venv-youtube-3.12/bin/python youtube-v1/scripts/patternlab_context_media_library.py --video-id 04
youtube-v1/.venv-youtube-3.12/bin/python youtube-v1/scripts/patternlab_visual_acquisition_quality.py --video-id 04
youtube-v1/.venv-youtube-3.12/bin/python youtube-v1/scripts/patternlab_visual_prompt_compiler.py --video-id 04
youtube-v1/.venv-youtube-3.12/bin/python youtube-v1/scripts/patternlab_local_generation_router.py --video-id 04
youtube-v1/.venv-youtube-3.12/bin/python youtube-v1/scripts/patternlab_local_still_tournament.py --video-id 04 --live
youtube-v1/.venv-youtube-3.12/bin/python youtube-v1/scripts/patternlab_ai_motion_quality.py --video-id 04
youtube-v1/.venv-youtube-3.12/bin/python youtube-v1/scripts/patternlab_storage_lifecycle.py --video-id 04 --require-operation long_form_render
youtube-v1/.venv-youtube-3.12/bin/python youtube-v1/scripts/patternlab_visual_retention_quality.py --video-id 04 --plan-only
```

Treat `blocked` and `candidate_only` as real state. Do not claim a visual pool
is production ready until the existing evidence-intake and rights-ledger gates
pass.

An exact Pexels/Pixabay download may become a reusable generic-context asset
without a separate per-item owner click only when the machine rights contract
passes exact item/download/license URLs, allowlisted license, retrieval time,
and local SHA-256. The final hash-bound episode still requires owner approval.
