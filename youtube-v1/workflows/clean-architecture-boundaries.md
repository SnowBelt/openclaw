# Pattern Lab Clean Architecture Boundaries

This document records the production architecture without changing the
existing CLI, report names, owner-review gates, or YouTube safety boundaries.

## Dependency direction

`scripts/ (CLI adapters) -> patternlab/ (application/domain contracts) -> standard library`

Renderer, FFmpeg, OCR, OpenClaw, Discord, and YouTube integrations stay at the
outer edge. They can consume domain contracts and emit the legacy JSON/Markdown
reports, but domain code must not import a renderer, provider SDK, environment
secret, or network client.

## Folder responsibility

```text
youtube-v1/
  patternlab/
    models.py                 # release, approval, and episode domain models
    state.py                  # canonical SQLite persistence boundary
    evidence.py               # evidence graph contracts
    review.py                 # owner-review gate policy
    thumbnail/
      manifest.py             # canonical thumbnail review-manifest repository
      quality.py              # pure candidate issue/status aggregation
  scripts/
    patternlab_thumbnail_*.py # backwards-compatible CLI adapters and pixel/OCR work
    patternlab_media_qa.py    # aggregate CLI adapter
  resources/                  # versioned policy/configuration inputs
  workflows/                  # operator-facing workflow documentation
  tests/                      # deterministic contract and adapter tests
```

## Rules for future refactors

1. Keep public script names, CLI flags, report filenames, report fields, and
   exit behavior stable unless a separately approved migration changes them.
2. Put reusable parsing, paths, result aggregation, and pure policy evaluation
   under `patternlab/`; keep subprocesses, filesystems, OCR, model calls, and
   provider work in `scripts/` or a future infrastructure adapter.
3. Every review artifact is release-candidate/hash-bound before owner approval.
   This architecture does not weaken source rights, 93+ QA, or explicit
   YouTube mutation approvals.
4. Migrate one cohesive slice at a time. Add a contract test before replacing
   a duplicate edge implementation; retain compatibility wrappers for any
   imported script helper.
5. Do not make a global utility module that imports every renderer. A feature
   package owns its own contracts and may depend only inward.

## Completed first migration slice

Thumbnail pixel, semantic, typography, and aggregate media QA now read the
same canonical thumbnail manifest repository. Their legacy reports and
command-line behavior remain unchanged.
