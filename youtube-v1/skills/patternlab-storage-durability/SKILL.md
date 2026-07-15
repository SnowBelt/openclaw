---
name: patternlab-storage-durability
description: Audit, archive, migrate, or reclaim Pattern Lab and adjacent OpenClaw storage without weakening active functionality or deleting source truth.
---

# Pattern Lab Storage Durability

Use this skill before media generation when disk pressure exists, when archiving
a posted episode, or when an operator requests storage cleanup.

## Non-negotiable preservation rules

- Preserve all Kalshi data. Never delete or rewrite active Kalshi JSONL files.
- Preserve exact Pattern Lab approved masters, Shorts, thumbnails, narration,
  source media, rights records, approvals, release manifests, upload receipts,
  and credentials.
- Never use YouTube as the only archive.
- Never lossy-recompress the sole approved master.
- Do not ZIP H.264/H.265 MP4s as a storage strategy; expected savings are
  negligible and the extra container makes verification and playback harder.
- Keep at least two newest Codex repair-backup sets per configured root.
- Keep at least three newest operations-memory backups raw. Older databases may
  become zstd archives only after decompression produces the original SHA-256.
- Do not remove active models, runtimes, worktrees, or optional capabilities
  merely because they are large.

## Required workflow

1. Run `patternlab_storage_lifecycle.py` for the exact operation.
2. Run `patternlab_system_storage_governor.py` without apply flags and inspect
   the pre-action manifest.
3. For a posted episode, run `patternlab_episode_archive_capsule.py` with
   `--require-complete`. Missing upload, rights, approval, or source classes are
   blockers.
4. If `/Volumes/PatternLabMedia` exists, use
   `patternlab_storage_migration.py --apply-copy`; activate only after every
   relative path, byte count, and SHA-256 matches.
5. Apply cleanup only to the explicit class approved by the owner. Stop on the
   first open-file, checksum, restore, path-containment, or health-check error.
6. Rerun audit, restore proof, disk snapshot, and relevant runtime health checks.

## Canonical commands

```bash
youtube-v1/.venv-youtube-3.12/bin/python youtube-v1/scripts/patternlab_storage_lifecycle.py --video-id 04 --require-operation long_form_render
youtube-v1/.venv-youtube-3.12/bin/python youtube-v1/scripts/patternlab_system_storage_governor.py
youtube-v1/.venv-youtube-3.12/bin/python youtube-v1/scripts/patternlab_episode_archive_capsule.py youtube-v1/local-output/video-04 --require-complete
youtube-v1/.venv-youtube-3.12/bin/python youtube-v1/scripts/patternlab_storage_migration.py --destination /Volumes/PatternLabMedia
```

No command in this skill mutates YouTube.
