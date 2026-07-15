---
name: patternlab-media-qa-director
description: Run or repair Pattern Lab final visual and audio quality assurance. Use for thumbnails, long-form videos, Shorts, captions, narration, loudness, visual-to-narration matching, random text boxes, dim or flat imagery, mobile text readability, artifact freshness, adversarial defect testing, and owner-review readiness.
---

# Pattern Lab Media QA Director

Enter through `patternlab-production-director` and the canonical
`youtube-v1/scripts/patternlab_production.py` profile. Direct commands below are
for diagnosing the exact failed stage; rerun the canonical entrypoint before
claiming readiness.

Judge the exported pixels and audio, not the plan, prompt, metadata, or intent.
Every final thumbnail, long-form video, and Short must independently score at
least 93/100 and clear every hard gate. Never average a weak asset into a pass.
An owner rejection or sub-93 owner score invalidates every earlier automated
approval for that artifact. Archive it as rejected, add the observed defect to
the adversarial fixtures, repair the detector, and require a new artifact hash.

## Required order

1. Read `youtube-v1/resources/media-qa-policy.json`,
   `youtube-v1/resources/visual-quality-rubric.json`, and the relevant source,
   thumbnail, and synthetic-media policies.
2. Confirm every final asset exists and bind every report to its current SHA-256.
   A stale receipt is a failure.
3. Run thumbnail source semantics, final-pixel energy, sharpness, clipping,
   actual 320x180 and 160x90 OCR, text margins, unexpected-large-text, font
   allowlist, font hierarchy, rights, and promise checks.
4. Run final audio stream, sample-rate, channel, integrated loudness, true peak,
   loudness range, silence/dropout, and A/V sync checks on the long-form video
   and every Short.
5. Inspect rendered video samples and detector output for black frames, frozen
   frames, dim or flat stretches, unreadable/clipped captions, persistent
   unexpected text or boxes, and visual-event gaps.
6. Run the hash-bound hybrid local judge. Deterministic pixel/OCR/audio/video
   detectors own measurable defects; Qwen3-VL owns semantic narration,
   evidence-role, entity, and misleading-visual judgment. Require the 20-case
   adversarial benchmark to meet both >=95% hybrid accuracy and >=95% semantic
   VLM accuracy. Then require current frame paths, frame hashes, timestamps,
   dimension scores, first-30-second coverage, and remainder coverage. SigLIP
   retrieval may prefilter; it may not approve a wrong visual.
7. Require exact source rights and synthetic-disclosure decisions. AI may
   support presentation but may not become historical proof.
8. For historical-photo parallax, require source/mask/output hashes, expected
   frame PSNR/SSIM, safe mask coverage and cohesion, zero intermediate-frame
   sprawl, no temporal jump, and >=93 local Qwen3-VL source-preservation,
   cutout, and motion judgment.
9. For local AI image-to-video, include the source as cell one in a 12-frame
   contact sheet. Require source similarity, luma/edge/temporal stability, OCR
   text stability, no identity/geometry/object drift, disclosure when
   realistic, and >=93 local Qwen3-VL. A missing model or receipt is not a pass.
   The aggregate must also prove that every rendered AI asset is generic,
   non-proof, disclosed, no longer than five seconds, within the eight-percent
   long-form runtime cap, and backed by the exact local still-tournament or
   AI-motion receipt. A passing no-op AI report is valid only when final pixels
   contain no AI asset.
10. Require the visual-retention plan and rendered proof: meaningful event
    gaps <=2.5 seconds in Shorts/first 30 seconds and <=5 seconds afterward.
    Motion that does not reveal information cannot satisfy the gate.
11. For an approximately eight-minute long-form episode, require at least 52
    unique assets, at least 50% unique-asset share across beats, no static asset
    more than three times, at least 30 seconds between static reuses, no more
    than 20% map/document beats, and at least 20% moving-image beats. Run
    sequence-wide pHash, seam/wrap detection, and every contact sheet. No asset
    ID may appear twice on the same 16-cell sequence sheet; repair that route
    before rendering or local-model judgment. A prose reuse reason never
    excuses duplicate rendered pixels.
12. Long-form narration uses a toggleable SRT plus selective editorial labels.
    Do not burn the complete narration into the picture, and never let captions
    or callouts rescue a semantically wrong visual in a model judgment.
13. Run `patternlab_media_qa.py`. A `blocked` result means repair and rerun.
    Owner review begins only after this strict aggregate passes.

## Non-negotiable failures

- Any asset score below 93 or any unresolved release warning.
- Dim, flat, blurry, clipped, corrupt, or generic final imagery.
- Missing, unreadable, clipped, or unexpected public text.
- Generic or unapproved public font; same-font hierarchy without exact approval.
- Random box, persistent unknown large OCR text, unsafe caption margin.
- Missing/silent/clipped/out-of-range audio, internal dropout, or A/V desync.
- Black/frozen stretches or pacing gaps above policy.
- Visuals that do not support nearby narration or evidence.
- Missing, stale, forged, unhashed, or wrong-artifact receipts.

Read `references/qa-contract.md` before changing a threshold or approving an
exception. Use `patternlab-thumbnail-director` and
`patternlab-visual-source-motion-director` for repairs; this skill is the
independent release judge.

## Commands

Run from the repository root:

```bash
youtube-v1/.venv-youtube-3.12/bin/python youtube-v1/scripts/patternlab_thumbnail_pixel_quality.py --video-id 04
youtube-v1/.venv-youtube-3.12/bin/python youtube-v1/scripts/patternlab_audio_quality.py --video-id 04
youtube-v1/.venv-youtube-3.12/bin/python youtube-v1/scripts/patternlab_rendered_media_quality.py --video-id 04
youtube-v1/.venv-youtube-3.12/bin/python youtube-v1/scripts/patternlab_local_visual_judge_runner.py --video-id 04 --benchmark
youtube-v1/.venv-youtube-3.12/bin/python youtube-v1/scripts/patternlab_local_visual_model_benchmark.py --video-id 04
youtube-v1/.venv-youtube-3.12/bin/python youtube-v1/scripts/patternlab_local_visual_judge_runner.py --video-id 04 --judge-final
youtube-v1/.venv-youtube-3.12/bin/python youtube-v1/scripts/patternlab_visual_judge.py --video-id 04
youtube-v1/.venv-youtube-3.12/bin/python youtube-v1/scripts/patternlab_historical_motion_quality.py --video-id 04 --all-production
youtube-v1/.venv-youtube-3.12/bin/python youtube-v1/scripts/patternlab_ai_motion_quality.py --video-id 04
youtube-v1/.venv-youtube-3.12/bin/python youtube-v1/scripts/patternlab_visual_retention_quality.py --video-id 04
youtube-v1/.venv-youtube-3.12/bin/python youtube-v1/scripts/patternlab_media_qa.py --video-id 04
youtube-v1/.venv-youtube-3.12/bin/python youtube-v1/scripts/patternlab_media_qa_e2e.py --video-id 04
```

No QA command may mutate YouTube.
