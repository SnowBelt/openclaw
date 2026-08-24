# Program Manager context package

This directory is the canonical, compact source for the Program Manager
workspace. It deliberately keeps policy in one contract instead of repeating
the same rules in every bootstrap file.

## Layout

- `CONTRACT.md`: semantic role, evidence, routing, handoff, and answer profiles.
- `workspace/`: bootstrap files copied into the agent workspace.
- `state/program-manager.json`: checked-in validation fixture only; it is never
  runtime state or completion proof.
- `runtime-config.json`: the reviewed per-agent configuration values.
- `acceptance.md`: local acceptance and proof matrix.

## Applying the package

1. Run `node scripts/program-manager-workspace.mjs check` and
   `check-config --config control/program-manager/runtime-config.json`.
2. Stage the workspace with an explicit destination and backup directory:
   `node scripts/program-manager-workspace.mjs install --workspace <path> --backup-dir <path>`.
3. Apply the values in `runtime-config.json` to the existing
   `program-manager` entry with the normal OpenClaw config tool.
4. Point that entry at the staged workspace, validate the canonical config,
   restart the local gateway if needed, and run the local smoke.
5. Keep the backup directory until the soak check passes. Roll back only with
   `node scripts/program-manager-workspace.mjs rollback ...`.

The installer manages `CONTRACT.md` and the six bootstrap files. Durable goal,
task-flow, progress-card, and session state remain in their owner SQLite
stores; the installer never copies the state fixture. It does not delete
unrelated workspace files or legacy backups. Use `verify-install` before
runtime proof.

## Boundaries

This package does not change model identity, release state, publication, live
user data, or repository landing policy. Scheduled CI is static and secretless;
live model turns remain explicit local/operator proof.
