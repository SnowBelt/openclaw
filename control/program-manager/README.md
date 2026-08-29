# Program Manager context package

This directory is the canonical, compact source for the Program Manager
workspace. `workspace/AGENTS.md` is the sole injected semantic contract;
supporting bootstrap files contain only identity, style, operator, or mechanics.

## Layout

- `workspace/AGENTS.md`: complete injected role and behavior contract.
- `CONTRACT.md`: optional human reference with expanded profile examples only.
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
3. Apply only the controlled Program Manager fields to an existing Director
   config with a dedicated backup:
   `node scripts/program-manager-workspace.mjs apply-config --config <path> --backup-dir <path>`.
   The command updates the canonical `agents.list` entry, preserves the agent
   identity/workspace, and rolls back automatically if its contract check fails.
4. Validate the active config with the OpenClaw binary, restart the local
   gateway only when that config is the managed service authority, and run the
   local smoke.
5. Keep the backup directory until the soak check passes. Roll back the
   workspace with `rollback ...` or the config with `rollback-config ...`.

## Changing the model safely

Model selection is operator policy, not part of this role package. Use the
fail-closed interface rather than editing the active model route directly:

- `pnpm program-manager:model qualify --model <provider/model> --json` runs
  catalog preflight and the isolated contract matrix three times.
- `pnpm program-manager:model switch --model <provider/model> --json`
  qualifies first, preserves the current model as the first fallback, promotes
  atomically, restarts, and automatically restores the exact prior config if
  activation proof fails.
- `pnpm program-manager:model status --json` reports active qualification and
  role/tool/runtime fingerprint drift.
- `pnpm program-manager:model rollback --json` restores the latest pre-switch
  config and restarts the Gateway.

Receipts contain only redacted synthetic scenario results and fingerprints.
Qualification uses portable deterministic parameters (`thinking=off`,
`temperature=0`, `maxTokens=1024`, and short cache retention) in the isolated
candidate config. Those parameters reach the active route only after the model
passes. Immutable local-model receipts remain reusable until the model, role,
tool schema, matrix, or runtime changes; mutable identities must requalify.
Hosted candidates additionally require `--allow-hosted`, explicit operator
approval for cost/data transfer, and synthetic inputs. Mutable hosted aliases
must requalify before every promotion.

The installer manages `CONTRACT.md` and the six bootstrap files. Durable goal,
task-flow, progress-card, and session state remain in their owner SQLite
stores; the installer never copies the state fixture. It does not delete
unrelated workspace files or legacy backups. Use `verify-install` before
runtime proof.

## Boundaries

This package does not change model identity, fallbacks, provider parameters,
release state, publication, live user data, or repository landing policy.
Scheduled CI is static and secretless; model qualification and live model turns
remain explicit local/operator proof.
