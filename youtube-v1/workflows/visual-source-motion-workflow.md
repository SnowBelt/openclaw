# Pattern Lab Visual Source and Motion Workflow

Use this workflow after the script is locked and before any final video render.

## 1. Bind narration to visuals

Create `local-output/video-XX/source-packet/visual-contract.json` with:

- one row per narration beat;
- one visual role: proof, context, reconstruction, or system;
- an action, emotional function, and three candidate queries;
- a city-specific proof requirement for every historical claim.
- a canonical planned AI asset id and claim ids for every reconstruction.

Run `patternlab_visual_contract.py --video-id XX`. A draft contract blocks
assembly.

## 2. Source in the correct order

1. Historical proof: exact, rights-cleared source assets.
2. Modern context: generic or city-specific licensed footage only for the
   action it visibly supports.
3. Original system graphic: a logged transformation of real inputs.
4. Local AI: short, disclosed non-proof reconstruction only after the prior
   three routes cannot show the concept honestly.
5. Codex image generation: high-value thumbnail/hero rescue only under its
   approval boundary.

The same order applies to every city. A new episode may not copy a prior
city's route, visual contract, thumbnail concepts, or assets unless a reusable
generic context asset is explicitly selected under its original context-only
rights receipt.

## 3. Handle generic footage honestly

Use the generic-context taxonomy for actions such as foot traffic, relocation,
traffic, storefront economy, industrial labor, transit, and neighborhood life.
Every generic candidate must carry `modern_context`, `context_only`,
`geographic_scope: generic`, and `may_imply_named_city: false`. Add an
`Illustrative footage` label when a viewer could infer it is the named city.

## 4. Build a reusable context library

Do not redownload or re-review the same generic clip for each city. Retain a
local hash-bound receipt and run `patternlab_context_media_library.py`. Only
rows with an exact file, rights receipt, known action, generic scope, and
approved review state may be offered to another episode. The asset remains
context only.

## 5. Keep AI useful and bounded

Use Draw Things locally for routine non-proof stills, reconstructions, and
support variations after a current hash-bound local benchmark. Use deterministic
FFmpeg motion on real evidence before AI motion. AI never supplies historical
proof, a factual map, an archival photo, or final public text.

Compile one visible action instead of sending the full transcript to the image
model. Run the resumable candidate tournament in a native non-root macOS user
runtime: eight drafts, deterministic pixel prefilter, local Qwen3-VL >=93, at
most two repair rounds, winner-only low-strength high-resolution promotion, and
final-pixel rejudgment. Codex Seatbelt Metal failures are environment blocks;
they must not overwrite a fresh native canary.

The canonical contract runs prompt compilation, local route health, the local
still tournament, source-pool promotion, and AI-motion QA in order. If there
is no generation beat, the tournament records `not_applicable`. If generation
is requested, no source-pool or render stage may pass without one selected,
hash-bound >=93 winner.

## 6. Animate historical photos honestly

Use deterministic two-plane documentary parallax for the familiar effect where
a worker/person/object moves at a subtly different speed from the background.
Generate an Apple Vision foreground mask or supply a reviewed manual mask, then
use `documentary_depth`, `lateral_depth`, or `safe_subject_push`. Keep moves
subtle, stream frames to FFmpeg, and preserve source geometry and meaning.

This effect may pan, push, reveal, spotlight, crop, rack focus, or separate
depth. It may not make a person blink, speak, gesture, or perform a new action.
Generated body/object motion is a disclosed reconstruction and must pass the
AI-motion gate. Every selected parallax clip needs source/mask/output hashes,
expected-frame PSNR/SSIM, mask cohesion, temporal stability, and >=93 local
Qwen3-VL cutout/motion QA.

When selected, register the derivative as `asset_kind: source_motion` with the
exact original-source SHA-256 and motion-receipt SHA-256. The canonical renderer
plays that verified derivative as video while the source remains direct
historical evidence. An unbound MP4 cannot be promoted this way.

## 7. Protect storage and pacing

Run the operation-specific storage gate before generation, model download, or
render. Stream intermediates; retain source originals, rights, approvals,
selected/final media, manifests, and upload receipts. Expire only classified
transients. Prefer a hash-verified external APFS Thunderbolt/NVMe store for
active media, model cache, and archive masters.

Plan a meaningful reveal <=2.5 seconds in the first 30 seconds and <=5 seconds
afterward. New evidence, a source crop, map state, then/now comparison, or
purposeful camera move counts. Decorative movement does not.

For an approximately eight-minute episode, acquire at least 60 verified assets
from at least 52 distinct item URLs before routing. The final route must use at
least 52 unique assets and at least 50% unique-asset share, keep static reuse to
three with 30 seconds between uses, cap map/document beats at 20%, and include
at least 20% moving-image beats. A higher count never excuses weak narration
fit, uncertain rights, or misleading generic footage.

Long-form captions are a companion SRT so viewers control them. Burn in only
short editorial text that adds information: names, dates, source labels, map
labels, and proof callouts. Shorts retain burned captions for feed autoplay.

## 8. Release gates

Before owner review, run contract, acquisition, source rights, synthetic
disclosure, visual-match, variety, rendered-media, audio, and aggregate QA.
The rendered pixels and audio decide release readiness—not the prompt or plan.
Inspect every sequence contact sheet. An owner rejection invalidates all prior
passes for that artifact hash and must be converted into a detector fixture and
workflow rule before the replacement is eligible for review.
