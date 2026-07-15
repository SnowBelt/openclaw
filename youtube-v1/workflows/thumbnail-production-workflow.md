# Pattern Lab Thumbnail Production Workflow

This workflow makes Pattern Lab thumbnails clickable without turning the channel into clickbait.

Canonical machine-readable policy: `youtube-v1/resources/thumbnail-click-policy.json`.

Canonical autonomous architecture: `youtube-v1/workflows/autonomous-production-architecture.md`.

Required autonomous sequence:

`OpenClaw packaging brief → source and rights preflight → Codex non-proof support generation when useful → Chrome typography composite → semantic/shelf validation → chat-safe owner delivery → owner review / YouTube test`

OpenClaw owns the strategy, source safety, rights ledger, thumbnail brief, deterministic typography, chat-safe delivery, and validation. Codex image generation is the primary approved tool for non-proof support assets; local generation is the resilient fallback. Canva remains optional manual polish only when it can improve an already source-safe composition.

## Goal

Every long-form video ships with five city-first review concepts, then three selected production thumbnail candidates built from a city-agnostic template system. Detroit is only the current Video 03 active city; future packages must substitute the active city resolved from metadata/title/package context:

`one dominant real photo + dominant city name + one emotional mystery + one city anchor + one proof object + 2-4 words`

The goal is not raw click-through rate alone. The goal is the maximum number of qualified viewers clicking and continuing to watch because the first 30 seconds pays off the promise.

The city is the product. The active city name must be primary or co-primary text, not a small tag. If the active city cannot be read in a YouTube search shelf or on a phone, the thumbnail fails. All rules in this workflow apply to any city, not only Detroit.

## Required Review Concepts

Create five review concepts before selecting the production three:

1. City + contradiction: `{CITY} WAS REDRAWN` or another clear city transformation promise
2. City + map/system: `{CITY_POSSESSIVE} HIDDEN MAP`
3. City + year/time-travel: `{CITY} 1942` or another source-year promise
4. City + vanished place: `{CITY_POSSESSIVE} LOST STREETS` / `{CITY} VANISHED`
5. Documentary fall/rise: `{CITY_POSSESSIVE} FALL EXPLAINED` or a clear myth-versus-source promise with a large active-city lockup

Select three production files from the five concepts:

1. `thumbnail_candidate_a.png` — emotional mystery / city contradiction
2. `thumbnail_candidate_b.png` — map/system proof
3. `thumbnail_candidate_c.png` — contrarian history angle

## Creation Path

### 1. Source Packet

Gather rights-cleared source material before design:

- one city anchor: skyline, street grid, landmark, station, factory, neighborhood outline, freeway, street sign, or map label
- one proof object: map, archival photo frame, dated document, route line, building record, neighborhood outline, then/now frame, or source-board element
- one contradiction: old vs new, vanished place, map line cutting through place, familiar myth vs source, or object that explains the city

All source media must follow `youtube-v1/resources/source-media-policy.json` and have rights-ledger rows before owner review.

### 2. Concept Board

Write one sentence for each review concept:

- City contradiction: `The viewer sees DETROIT and wonders...`
- Map/system: `The hidden map/system proof is...`
- Year/time-travel: `The year/source clue is...`
- Vanished place: `The vanished-place question is...`
- Documentary fall/rise: `The generic decline story is challenged by...`

If those sentences are not meaningfully different, redesign before rendering.

### 2A. Click-First Photo Selection

Pattern Lab thumbnails must feel like a historical mystery, not an internal research board.

Default photo priority:

1. people, crowds, workers, transit, factories, street life, landmarks, demolition, attractions, or other visible action
2. a place with an obvious before/after or vanished-place question
3. a map/document only when it has a visible scar, route, boundary, date, or source clue that can read at phone size
4. skyline/context only when it is part of a specific contradiction

Composition rules:

- use one dominant real photo/map/document as the base
- make the city name the largest or co-largest text block
- use at most one major proof mark: route line, tear line, clean split, map glow, or document/redaction prop; arrows only when the story is literally about a route/map/path
- avoid source-board clutter, tiny captions, multiple boxes, thin grids, small labels, and internal words such as SOURCE PHOTO, SOURCE, PROOF, or MAP PROOF
- apply competitive thumbnail-grade contrast: yellow/white city text, dark edges, bright focal point, one bold accent color, thick stroke and strong text shadow
- make the thumbnail sell a curiosity question, not just prove that research was done

If the best available source image is visually flat, find a stronger rights-safe image before rendering. Do not compensate with more boxes or labels.

### 2A.1 Hero Asset and Then/Now Contract

The hero asset must create an emotional reason to stop scrolling: people, street
life, an unmistakable place, a dramatic demolition/route scar, or a concrete
source mystery. A map is a strong proof object only when the map itself is the
mystery; it is not a substitute for a historic street photograph.

- A true `THEN / NOW` treatment requires photo/photo or map/map panels. Keep
  `THEN` fully left and `NOW` fully right.
- Do not pair a map with a photograph under `THEN / NOW`.
- Do not render a final then/now candidate until both source panels have a
  rights-ledger row and an owner-accepted source binding.
- AI may restore, relight, extend, and add atmosphere to a real asset. It may
  not create the historical proof, a fake historic resident, or the factual map.
- If no compelling historic photo is available, omit then/now from the final
  set and use a proof/context or map-system hypothesis instead.

### 2A.2 Typography Contract

Final public type is rendered in the Chrome/Fontsource compositor, never by an
image generator. Use a city lockup, a hook, and an optional support line as
separate typographic roles.

- Use two lines for the hook whenever possible and four non-city words maximum.
- Use custom text fit, restrained outline, directional shadow, and image-aware
  negative space; do not solve readability with a generic rounded black card.
- Run 160x90 and 320x180 shelf screenshots, OCR, crop-safe-zone, and
  generic-text-card checks before owner review.
- Create a city-dominant, mystery-dominant, and proof/transformation-dominant
  hypothesis. Recolors or alternate crops are not separate hypotheses.

### 2B. Active-City Recognition Rule

The factory must resolve the active city before generating thumbnail text, source searches, or validation reports. Resolution order:

1. upload metadata city
2. city profile / package metadata
3. default title or title options
4. policy fallback for the current local package only

For every city, prefer a beautiful, current, instantly recognizable skyline, waterfront, landmark, station, factory, street grid, or place-specific hero image when it fits the promise. Use older photos as proof/contrast when the words promise before/year/lost/fall. Do not use anonymous interiors or generic streets unless paired with a city-specific skyline, landmark, map label, or dated source.

### 2C. Owner Feedback Learning Gate

Owner ratings are production data, not subjective noise. Any thumbnail rated below 4/10 creates blocked patterns for the next render. Current blocked patterns include random red lines, public-facing labels like `SOURCE PHOTO` or `PROOF`, disconnected image pairings, generic/unrecognizable city photos, overlays that cover recognizable landmarks, and arrows that are not tied to a route/map/path promise.

### 3. Render

Default OpenClaw render path:

- generate or assemble the thumbnail from one dominant rights-cleared photo/map/document, one major proof mark, Pattern Lab brand color, and large text
- export 16:9 PNG
- work at 3840x2160 when possible
- deliver at 1920x1080 or at least 1280x720

Manual polish path:

Recommended generator path:

- current final renderer: headless Chrome plus the local open-license Fontsource pack; it owns all visible text and final layout
- primary AI support: Codex image generation for high-instruction-following non-proof support graphics and source-safe edits
- resilient AI support fallback: ComfyUI or Draw Things with license-approved local models when Codex image generation is unavailable
- premium support upgrade if owner approves or a configured route already exists: OpenAI `gpt-image-2` via OpenClaw `image_generate` for high-instruction-following support graphics/reference edits
- transparent cutout upgrade if owner approves: OpenAI `gpt-image-1.5` transparent-background output; otherwise use rembg/SAM2/Photopea/GIMP first
- LLM art director: GPT-5.5-class vision/reasoning critique before a low-reasoning executor renders

- use Photopea or GIMP for free manual edits
- use the Canva plugin as the preferred autonomous renderer when it is connected and can export clean local files without AI, Pro assets, watermark, or unclear stock
- if Canva export is unavailable, use the local backup renderer that produced the accepted Cleveland examples: headless Chrome + bundled open-license display fonts + Sharp delivery export
- Canva Free is acceptable only when the design uses user-uploaded assets, free templates/elements, no Pro-locked media, and exports clean PNG/JPG without a watermark
- use Canva Pro or Adobe Express Premium when fast premium layout, background removal, brand templates, premium elements, and resize tooling materially improve quality
- use Photoshop, Affinity, or Figma only when building reusable professional templates or doing deeper compositing

### 3A. Canva Plugin Renderer

When the Canva plugin is available, OpenClaw should:

1. Complete OpenClaw strategy and source-safety checks before Canva work starts.
2. Generate a Canva brief for each required candidate.
3. Use or create a reusable Pattern Lab thumbnail template.
4. Upload only rights-cleared source images, maps, and graphic elements.
5. Render five city-first review concepts and select three production candidates.
6. Export clean PNG/JPG files with no watermark.
7. Save exports to `youtube-v1/local-output/video-XX/images/`.
8. Record the Canva design URL or id in the owner review packet.
9. Run OpenClaw validation after export.
10. Reject and regenerate if any Pro-locked element, watermark, unclear stock asset, generic template feel, or title-thumbnail mismatch appears.

### 3C. Local Backup Renderer

When Canva export is unavailable, blocked, rate-limited, or not production-safe, OpenClaw must use the local backup renderer rather than falling back to ad-hoc mockups.

Required command path:

```bash
youtube-v1/.venv-youtube/bin/python youtube-v1/scripts/patternlab_chrome_thumbnail_renderer.py --video-id <video-id> --city <City> --candidate-count 5
youtube-v1/.venv-youtube/bin/python youtube-v1/scripts/patternlab_quality_gates.py --video-id <video-id>
youtube-v1/.venv-youtube/bin/python youtube-v1/scripts/generate_owner_review_packet.py --video-id <video-id>
youtube-v1/.venv-youtube/bin/python youtube-v1/scripts/patternlab_dashboard_server.py --check --video-id <video-id>
```

Backup-renderer requirements:

- use rights-ledgered real city photos/maps/documents from the source packet
- use bundled open-license display fonts and vivid poster-style text treatment
- preserve the full 1920x1080 production PNGs for owner packet / YouTube candidate use
- send only `approval/chat-delivery/<run_id>/*_chat.jpg` files in chat
- require `chat_delivery_surface_status=pass`
- require every owner-visible chat preview to be JPEG/RGB 1280x720 with lower-half content verified
- require a non-ultrawide owner-visible contact sheet, currently 2-column for five examples

### 3B. AI Support Assets

AI video generation is not the thumbnail system. Thumbnails are a packaging and marketing product controlled by OpenClaw strategy, source safety, and validation.

The Canva plugin remains the preferred final renderer for thumbnails when connected. Canva should compose, polish, crop, and export the design; it must not invent historical claims or choose unclear source material.

Local text-to-image may be used only for support elements, safe background extensions, non-proof texture, generic redacted documents, cutout/mask assistance, and clearly labeled reconstruction components. It must not create fake archival images or replace the active-city hero/proof object when rights-safe real source media exists.

If a useful internet image cannot be used because rights are unclear, do not clone or trace it through an image generator. At most, extract generic written art direction such as camera angle, contrast, lighting, visual hierarchy, or mood, then generate a materially new support asset. The output must not be a near-duplicate, must not reproduce watermarks/logos/people/distinctive protected composition, and must be logged as AI support/reconstruction rather than evidence.

Every long-form city file still needs five review concepts and three distinct selected thumbnail candidates:

- emotional mystery
- map/system proof
- contrarian history angle
- year/time-travel or dated source
- vanished place

### 4. Quality Gate

Block any candidate that fails one of these checks:

- readable at phone size
- city name dominance: city is primary or co-primary text, not a small badge
- local thumbnail search shelf test passes
- one dominant focal point
- one secondary proof cue
- 2-4 words of text
- one dominant real photo/map/document
- a bright, emotionally compelling hero image; reject dim or flat crops before layout
- no source-board clutter or tiny unreadable labels
- strong thumbnail contrast
- at least one human/action/strong-place-interest candidate when available
- city anchor is clear
- visual mystery is clear
- source/proof object is clear
- no fake archival image
- no watermarked asset
- no Pro-locked Canva element in a Free-plan export
- no copied thumbnail layout
- rights ledger complete
- chat-safe delivery surface passes for the exact files sent to the owner
- no owner-visible full-size PNG is sent directly when a `_chat.jpg` preview exists
- first 30 seconds of the video pays off the thumbnail promise
- semantic thumbnail report passes: no fake archival proof, no map/photo then-now mismatch, and AI support never substitutes for the visible proof object

### 5. Selection And Testing

Before upload:

- select the strongest default title-thumbnail pair
- review the five-concept contact sheet and thumbnail search shelf before owner approval
- preserve all three candidates for YouTube A/B testing
- prefer candidates that should win by watch time and first-30-second retention, not curiosity clicks alone

After public publish:

- use YouTube title/thumbnail A/B testing when available
- evaluate by watch-time share first
- record CTR, first-30-second retention, average view duration, subscriber conversion, and comments about expectation mismatch
- feed the result into the next city-file thumbnail family choice

## Active City Defaults

For any city, thumbnails should usually start with one of:

- freeway or route line across a neighborhood map
- old street or neighborhood photo beside a modern void
- the city's most recognizable station, factory, streetcar/transit clue, waterfront, erased-neighborhood map cue, or city grid
- people, workers, crowds, transit, street life, attractions, factories, demolished/vanished places, or one source object with an obvious visual scar

Avoid generic skyline-only thumbnails for any city unless the skyline is part of a specific visual contradiction.

## Execution-Quality Upgrade: Owner Feedback From 10/10-Change Batch

The 10/10-change experimental batch proved that Pattern Lab should move away from repeated title-bar/proof-card layouts and toward editorial thumbnail families. Future thumbnails must keep that creative variation while fixing execution defects before owner review.

### Every Word Must Earn Its Place

Every visible word must have a documented viewer-facing purpose. Valid purposes are: active city, curiosity hook, simple time comparison, source/promise clarity, or an intentional prop such as a partial redaction sentence. Filler labels and internal production terms fail, including `SOURCE PHOTO`, `SOURCE`, `PROOF`, `MAP PROOF`, and meaningless corner-box text.

### Spelling, OCR, And Cutoff Gate

After render, OpenClaw must produce an OCR-readiness/cutoff report. The expected city and headline words must be spelled correctly and must not be clipped by the canvas, edge safe zone, or timestamp danger zone. A misspelled active city name is a hard blocker.

### Brightness, Subject, And No-Distortion Gate

Source images may be cropped, masked, color-graded, blurred, or extended, but never squeezed or stretched. The main city/photo/document subject must remain visible at YouTube search-shelf size. Dark poster styles are allowed only when the city text and focal proof object remain clear.

### Style-Specific Thumbnail Rules

- Redacted-file thumbnails must show readable fictional sentence fragments with selective redactions. Rows of pure black boxes are not enough.
- Newspaper thumbnails must include a fictional masthead, issue/date line, body-text columns, a photo/caption, and no clipped headline. Before public use, OpenClaw must search the web or require owner/publication-name preflight to avoid confusingly real newspaper names.
- Underground-city thumbnails should use tunnel/underground/source imagery. Generic AI/support imagery is allowed only when it cannot be verified as a different city and is logged as non-proof support.
- Then/now thumbnails default to `THEN` on the left and `NOW` on the right. Both images must preserve source aspect ratio.
- Neon/editorial city-myth thumbnails must avoid meaningless boxes and must not darken the skyline until the city is unreadable.

### Creative Variation Memory

A five-concept batch fails if all thumbnails share the same title-bar, proof-card, color-block, or annotation pattern. The batch must include materially different editorial layouts and must record a critique for each thumbnail: intended viewer reaction, why each word appears, why each image appears, emphasized element, and known weakness.

## Owner-Preferred Current-Style V4 Rules

The latest owner ratings make the normal baseline explicit: use the improved current workflow first, not the rejected major-experimental batch, unless the owner specifically asks for outside-the-box testing.

Required V4 corrections before owner review:

- Redrawn thumbnails must use a city map, street grid, highway map, or map/photo hybrid when available.
- Hidden/under-city thumbnails must use tunnel, sewer, subway, utility, route, or other hidden-system imagery; generic AI support is non-proof only.
- Redacted document thumbnails must redact whole words only, remove low-value labels, and make the curiosity hook visually prominent.
- Lost-streets thumbnails must use streets, maps, road grids, blocks, demolition/voids, or old street imagery; rail/track-only photos fail.
- Then/now thumbnails must keep THEN entirely left and NOW entirely right, with no image crossing the median, no distortion, and a bright/current skyline or modern city image on NOW.
- AI support assets must be ledgered as non-proof and must never be presented as source proof, archival evidence, or a city-specific hero image unless source rights and city specificity are verified.

# World-Class Local-First Gate

Before owner review, run the world-class pipeline in this order:

1. Validate the private owner-reference corpus and anatomy report.
2. Validate `thumbnail-worldclass-brief.json` against the source-first brief contract.
3. Confirm free local tool health and a current local-model benchmark receipt. A failed Apple Metal benchmark must block AI support generation; it must not silently call a paid provider.
4. Produce 20 structurally distinct roughs, shortlist 8, render 5, and select 3 genuinely different finalists.
5. Run 160x90 OCR, dimensions, contrast, saturation, rights, promise, duplicate, and hard-block checks.
6. Use GPT-5.6 Terra only for the 20-to-8, 8-to-5, and final adversarial pairwise checkpoints. Sol Ultra is a one-time creative reset only after two complete failed cycles.
7. Require deterministic final-pixel QA of at least 93/100 for every candidate,
   then require the stricter world-class score receipt threshold (currently
   94/100) with no hard block. No package-average pass is allowed.
8. Send the exact-hash finalists to Discord. Approval must bind to the current release-candidate hash and an owner rating of at least 9/10.

Adversarial reviewers must write exact-hash receipts with
`scripts/patternlab_thumbnail_review_receipt.py`; scores in prose or attached
to stale bytes do not count. Source proposals are written to
`thumbnail-source-acceptance-proposal.json`, but the workflow never promotes a
proposal to accepted evidence automatically.

Engineering readiness, owner approval, and post-publication YouTube testing are separate truth surfaces. Public YouTube changes always require a separate exact approval.

## Proven 89/100 Pattern Lab Treatment

Use this baseline when the episode is a city-history mystery:

- Start with a real proof object full-frame or as the dominant left-side layer:
  a map, document, archival photograph, or current verified place.
- Put the claim/question in large locally rendered yellow/white display type
  with near-black outline; use a red city badge as secondary orientation.
- Add a single vivid blue/gold support layer only to give depth, contrast, and
  visual energy. It may be AI-generated only when ledgered as non-proof.
- Use a torn-paper, split, or map-versus-modern composition only when it makes
  the system change visually obvious. Keep the center seam clean and never
  allow text to clip at either edge.
- Make city name largest only for city-search or broad travel packaging. For a
  neighborhood or erased-place episode, the actual mystery must be largest.
- Prefer a rights-cleared person/street-life or recognizable historical place
  over an additional skyline. A skyline is context, not evidence or emotion.

## Generator Routing

Codex built-in image generation is the approved primary generator for Pattern
Lab non-proof thumbnail support assets. It is used after the proof object and
composition are locked, never to invent historical evidence, maps, documents,
or public headline text. Draw Things and ComfyUI remain the secondary local
fallbacks for resilience, batch work, and cases where Codex generation is
unavailable. Every generated support layer receives a prompt, hash, generator,
and `non_proof_support_only` ledger row before review.

## Strict Final QA Cutover

The plan, renderer metadata, and reviewer score cannot certify the final PNG.
Run `patternlab_thumbnail_pixel_quality.py` and then `patternlab_media_qa.py`.
Both 320x180 and 160x90 OCR passes must recover every intended public word;
dim/flat regions, blur, clipping, unsafe margins, unknown large text/boxes,
generic fonts, stale hashes, warnings, or any candidate score below 93 block
owner review. Use the `patternlab-media-qa-director` skill for final judgment.
