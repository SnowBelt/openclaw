# Pattern Lab QA Contract

## Truth hierarchy

1. Final exported asset bytes and SHA-256.
2. Deterministic measurements of those bytes.
3. Benchmarked local Qwen3-VL semantic-judge receipts bound to sampled frames.
4. Source, rights, and synthetic-media receipts.
5. Owner preference review after technical QA passes.

Prompts, plans, renderer metadata, and claimed scores are not proof.
An owner rejection is new ground truth. It supersedes prior automated passes
for that hash and must become a regression fixture before a replacement ships.

## 93/100 rule

- The minimum applies to each asset, not the package average.
- A hard failure caps an asset below 93 even if other dimensions are excellent.
- A release warning is unresolved work and blocks review.
- Human approval cannot waive rights, wrong-artifact, stale-hash, corrupt-media,
  missing-audio, unreadable-text, or factual-match failures.

## Repair routing

- Dim/flat thumbnail: replace or regenerate the hero; do not filter-rescue it.
- Weak typography: rerender actual text with an approved expressive pair, then
  repeat both shelf OCR tests.
- Random text/box: remove the overlay from the affected asset only and rerun
  persistent unknown-text inspection.
- Wrong visual: replace the beat using exact narration entities and proof role;
  rerun frame matching and local visual judge coverage.
- Audio failure: regenerate/remix only the affected asset, normalize, and rerun
  loudness, peak, silence, and sync analysis.
- Stale receipt: never edit the receipt; rerun the producing gate against the
  current asset hash.
- Repeated visuals: expand the rights-cleared pool, enforce sequence-wide pHash
  and route diversity, and never accept a prose reuse reason as pixel evidence.
- Horizontal split or top/bottom wrap: disable the failed transform, sample the
  full render every three seconds, and require zero seam/wrap detections.

## Model boundary

The final judge is hybrid. Deterministic gates decide brightness, contrast,
OCR, safe margins, black/freeze, loudness, peak, silence, and sync. Qwen3-VL
decides city/entity/narration/evidence-role semantics. A VLM never overrules an
objective detector. SigLIP is retrieval/ranking only.
Subtitles, source labels, and callouts are masked from semantic judgment; they
cannot make an unrelated image count as a narration match.

## Long-form sequence floor

- > =52 unique assets and >=50% unique-asset share for an approximately
  > eight-minute episode.
- A static asset appears at most three times and never reappears within 30s.
- Maps plus documents occupy <=20% of visual beats.
- Native or verified moving imagery occupies >=20% of visual beats.
- Full narration is delivered as a toggleable SRT. Burned text is selective:
  dates, names, source labels, maps, and short editorial emphasis only.

The runner is offline and content-addressed. Cached judgments are reusable only
when model, projector, image, prompt, schema, and QA-contract hashes all match.

## Motion truth

- Documentary parallax preserves the source subject and uses only editorial
  camera/depth treatment. Its source, mask, recipe, and output are hash-bound.
- Any generated face, body, object, crowd, architecture, or camera geometry is
  AI motion and must be labeled/reviewed as reconstruction.
- A passing plan or prompt is never motion proof. Production-selected rendered
  clips must independently pass deterministic temporal/source checks and the
  local semantic contact-sheet judge at >=93 with no hard failure.
- Sandbox/Metal failures are environment failures. They cannot invalidate a
  fresh trusted native canary, and they cannot be relabeled as model failures.

## Storage truth

Storage safety is a production prerequisite, not a quality trade. Jobs block
below operation reserves. The system may delete only age-qualified paths
explicitly classified as transient and only in apply mode. Sources, rights,
approvals, selected/final media, manifests, upload receipts, and credentials
are never lifecycle-cleaned.
