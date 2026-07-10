# Pattern Lab Full Auto Production Runbook V2

Purpose: produce the complete local Pattern Lab package for the next scheduled episode while stopping before any YouTube upload, thumbnail replacement, or public publish.

## Default Command

```bash
youtube-v1/.venv-youtube/bin/python youtube-v1/scripts/patternlab_full_auto_production.py --next-scheduled --live-voice when-configured --shorts-target 5
```

## Required Order

1. Select the next incomplete scheduled episode from the content calendar.
2. Create or refresh the package.
3. Build source and rights-ledger artifacts.
4. Select thumbnail renderer in priority order: Canva no-AI export, Penpot self-host fallback, Chrome/Fontsource fallback.
5. Build media: proof footage, image pack, voiceover, visual source pack, long-form draft.
6. Generate a Shorts tournament and render 3-5 Shorts when the long-form passes quality.
7. Run the episode-standard gate, voice-to-visual match, and finished-video watchdown checks.
8. Generate owner review packet and dashboard state only if the episode-standard gate passes.
9. Stop for owner review.

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
