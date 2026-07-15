# Pattern Lab Motion And AI Visual Policy

Pattern Lab is source-first. Real photos, maps, documents, archival footage, and rights-cleared modern context footage remain the default evidence layer.

## Core Rule

AI can illustrate. It cannot prove.

Use AI image or video only when it improves clarity, pacing, atmosphere, or reconstruction honesty. Do not use AI output to carry a historical claim.

## Visual Priority Order

1. Real source media: historical photos, maps, documents, archival footage, and source pages.
2. Deterministic motion on real media: Ken Burns, crop moves, map zooms, document closeups, source highlights, then/now reveals, and subtle parallax.
3. Source-grounded maps and graphics: route lines, labels, timelines, source boards, evidence tables, and photo-backed composites.
4. Labeled AI text-to-image reconstruction: missing-scene illustrations, non-evidence visual metaphors, and thumbnail support elements.
5. Labeled AI text/image-to-video reconstruction: atmospheric transitions, generic action, and dramatic reconstructions when source footage does not exist.

Canonical routing contract:
`youtube-v1/resources/local-visual-generation-routing-policy.json`.

## Production Routing

- Use FFmpeg deterministic motion by default for source photos, maps, and documents.
- Use Draw Things for routine non-proof still support only after its model and
  companion-file hashes plus a current local generation benchmark pass.
- Evaluate Z-Image-Turbo as the second local still candidate; do not install or select it silently.
- Use ComfyUI for repeatable image-to-video workflows only after the local endpoint, model identity, workflow hash, runtime, and output benchmark pass.
- Benchmark Draw Things LTX-2.3 distilled before other generative motion for
  restrained short support clips; use ComfyUI only when a repeatable node graph
  is materially better than the verified CLI route.
- Record the LTX-2 Community License revenue boundary in every model receipt:
  direct use is royalty-free below USD 10 million annual entity revenue, while
  entities at or above that threshold need a separate commercial license.
- Treat Wan2.2-TI2V-5B as a premium local research candidate until an Apple Silicon quality/runtime benchmark passes.
- Reserve Codex image generation for important thumbnail/hero support and bounded still-image fallback. It is not a substitute for archival proof.

### Native local still contract

Draw Things generation must run outside Codex Seatbelt in the native non-root
user runtime. Serialize Apple Metal generation, use two bounded retries and
atomic outputs, and bind the CLI, model, prompt, negative prompt, seed, and
output hashes. Generate eight drafts, allow at most two prompt-repair rounds,
and promote only a local-Qwen3-VL >=93 winner. The promoted 1536x1024 img2img
result is rejudged; a failed promotion is not silently replaced.

### Documentary depth motion

For historical stills, prefer source-preserving 2.5D parallax over generative
motion. Apple Vision or a reviewed manual mask may separate the focal subject
from the background so they pan or zoom at different restrained speeds. This
is editorial camera treatment, not permission to invent body, face, vehicle,
crowd, object, text, or architecture movement. Bind source, mask, recipe, and
output hashes and run deterministic plus local semantic motion QA.

## Allowed Uses

- Make still photos feel alive with pan, zoom, crop, parallax, and source highlights.
- Use AI-generated atmospherics when the narration needs texture and no rights-safe footage exists.
- Use AI reconstruction stills or clips when the scene is explicitly presented as reconstruction.
- Use generic workers, streets, machines, crowds, or interiors when no specific real person is being impersonated.
- Use generated thumbnail support elements when OpenClaw owns the source safety, title promise, and validation.
- Use 3-5 second local AI motion inserts sparingly when they add a meaningful visual event that deterministic motion cannot provide.

## Owner-Approved Reconstruction

Real historical figures may be animated only as clearly labeled reconstruction and owner-approved. If a realistic AI visual depicts a real person, event, or place in a way that was not actually captured, the visual must carry or be accompanied by:

`Dramatic reconstruction — not archival footage`

This applies to examples such as a public figure appearing to speak, a historic meeting being reenacted, or a real event being shown from an invented camera angle.

## Blocked Uses

- fake lip-sync
- fake quotes
- realistic unlabeled fake archival footage
- fake footage that makes a source claim appear proven
- AI animation of a real person doing controversial, criminal, embarrassing, or unsupported actions
- AI output presented as a historical photo, source record, or archival clip
- AI footage that changes the meaning of a real source image without disclosure

## Required Metadata

Every AI-generated image or video used in a package must have:

- rights-ledger row
- source role: illustration, atmosphere, support element, or reconstruction
- model/tool name when known
- prompt or source-image reference
- synthetic disclosure decision
- owner review status
- source image hash and generated output hash
- exact model and workflow hash
- seed and generation parameters when reproducible
- runtime share contribution

## Runtime Ceilings

- Long-form generated/support motion: maximum 8% of runtime after the opening source proof.
- Shorts generated/support motion: maximum 15% of runtime.
- One routine AI motion insert: target 3 seconds, hard maximum 5 seconds.
- These are ceilings, not quotas. Use zero AI when real media and deterministic motion are stronger.

## Local Motion Benchmark

The Draw Things LTX-2.3 route is not production-ready merely because the model
appears in the local catalog. Lock the exact model and companion-file hashes,
then run:

```bash
youtube-v1/.venv-youtube-3.12/bin/python youtube-v1/scripts/patternlab_local_image_to_video_benchmark.py --video-id 04 --live
```

Do not auto-download the model from a render job. A failed or missing receipt
routes the beat back to deterministic FFmpeg motion.

The model-download and local-image-to-video storage gates must pass first. A
missing external media store or insufficient reserve is a hard block, not a
reason to lower resolution, discard protected sources, or use a paid fallback.

## Motion QA

- Historical parallax: exact expected-frame PSNR/SSIM, mask coverage/cohesion,
  temporal-jump detection, zero extracted-frame sprawl, and >=93 Qwen3-VL
  source identity/cutout/motion judgment.
- Generative motion: source-first 12-cell contact sheet, initial source SSIM,
  luma/edge/temporal stability, OCR stability, no face/hand/object/architecture
  drift, reconstruction disclosure, and >=93 Qwen3-VL.
- All motion: meaningful visual reveal <=2.5 seconds in Shorts/first 30 seconds
  and <=5 seconds for the rest of long-form. Decorative motion does not count.

## Upload And Disclosure

Before private upload, OpenClaw must record whether the package:

- makes a real person appear to say or do something they did not do
- alters footage of a real event or place
- generates a realistic scene that did not actually occur
- requires YouTube AI disclosure
- requires visible or description-level reconstruction language

When in doubt, disclose and label.

YouTube currently treats minor production assistance such as thumbnail creation,
sharpening, captioning, and repair differently from realistic synthetic scenes.
The upload package must still record an altered-content decision whenever a
realistic place, event, or person is meaningfully synthesized or altered.

## Thumbnail AI Support Rule

AI may help Pattern Lab thumbnails when the missing piece is not evidence: a redacted-paper prop, generic map texture, route glow, cutout/mask, background extension, atmospheric texture, or clearly labeled reconstruction support. AI must not replace the active-city hero image when a rights-safe real skyline/landmark/current-city image exists, and it must not create fake archival proof.

Unlicensed internet images cannot be cloned or traced through a generator. They may only be converted into generic written art direction such as `bright skyline hero, high contrast, warm city text, document prop in lower right`; the output must be materially new and rights-ledgered as AI support/reconstruction.
