# Pattern Lab Storage Durability Workflow

## Goal

Keep enough working space for local visual generation and long-form rendering
without sacrificing exact release bytes, source provenance, restore points, or
active OpenClaw capabilities.

## Posted episodes

A posted episode is an immutable, hash-bound archive capsule. The capsule lists
the long-form master, every Short, final thumbnail, script, narration, source
media, rights records, owner approvals, upload receipts/YouTube IDs, and release
manifests. MP4 files remain in their approved encoding; ZIP and lossy archival
recompression are prohibited because they offer little space benefit or destroy
the exact approved bytes.

The preferred storage tier is an external APFS SSD mounted at
`/Volumes/PatternLabMedia`. Copy first, verify every path/size/SHA-256, then
activate the external store. Source retirement is a separate action and is not
performed by migration.

## Local backup retention

- Codex repair backups: newest two top-level sets per configured root remain.
  A manifest records purpose, timestamp, bytes, retention decision, and deletion
  result before any superseded set is removed.
- Operations memory: newest three canonical backups remain raw. Older SQLite
  databases are compressed individually with zstd in their original directory.
  The raw database is removed only after streaming decompression reproduces its
  SHA-256. `patternlab_operations_backup_restore.py` restores either shape.
- Kalshi: all data remains. Only immutable checksum-backed snapshots may use
  transparent APFS compression; active logs are never compressed or deleted.

## Storage hierarchy

1. Internal SSD: active runtime, current episode, small proxies, receipts.
2. External APFS SSD: source originals, active media, models, exact masters.
3. Rebuildable cache: extracted frames, failed candidates, intermediates.

Every cleanup is dry-run first, bounded to an allowlisted class, and followed by
restore or runtime proof. No storage task mutates YouTube.
