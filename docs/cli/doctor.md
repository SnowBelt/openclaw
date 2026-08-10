---
summary: "CLI reference for `openclaw doctor` (health checks + guided repairs)"
read_when:
  - You have connectivity/auth issues and want guided fixes
  - You updated and want a sanity check
title: "Doctor"
---

# `openclaw doctor`

Health checks and quick fixes for the gateway, channels, plugins, skills, model routing, local state, and config migrations. Use it whenever something is not behaving as expected and you want one command to explain what is wrong.

Related:

- Troubleshooting: [Troubleshooting](/gateway/troubleshooting)
- Security audit: [Security](/gateway/security)

## Postures

| Posture | Command                  | Behavior                                                                    |
| ------- | ------------------------ | --------------------------------------------------------------------------- |
| Inspect | `openclaw doctor`        | Human-oriented checks and guided prompts.                                   |
| Repair  | `openclaw doctor --fix`  | Applies supported repairs, prompting unless non-interactive repair is safe. |
| Lint    | `openclaw doctor --lint` | Read-only structured findings for CI, preflight, and review gates.          |

Prefer `--lint` when automation needs a stable result. Prefer `--fix` when a human operator wants doctor to edit config or state.

## Examples

```bash
openclaw doctor
openclaw doctor --lint
openclaw doctor --lint --json
openclaw doctor --lint --severity-min warning
openclaw doctor --lint --all
openclaw doctor --lint --allow-exec
openclaw doctor --deep
openclaw doctor --fix
openclaw doctor --fix --non-interactive
openclaw doctor --check pcc
openclaw doctor --fix pcc
openclaw doctor --generate-gateway-token
openclaw doctor --post-upgrade
openclaw doctor --post-upgrade --json
```

For channel-specific permissions, use the channel probes instead of `doctor`:

```bash
openclaw channels capabilities --channel discord --target channel:<channel-id>
openclaw channels status --probe
```

`channels capabilities` reports the bot's effective permissions for a specific channel target. `channels status --probe` audits all configured channels and voice auto-join targets.

## Options

- `--no-workspace-suggestions`: disable workspace memory/search suggestions
- `--yes`: accept defaults without prompting
- `--repair`: apply recommended non-service repairs without prompting; gateway service installs and rewrites still require interactive confirmation or explicit gateway commands
- `--fix [area]`: alias for `--repair`; use `--fix pcc` to repair only PCC ledger storage and production-proof bindings
- `--check <area>`: run a narrow read-only check; `--check pcc` checks only PCC ledger storage and production-proof bindings
- `--force`: apply aggressive repairs, including overwriting custom service config when needed
- `--non-interactive`: run without prompts; safe migrations and non-service repairs only
- `--generate-gateway-token`: generate and configure a gateway token
- `--allow-exec`: allow doctor to execute configured exec SecretRefs while verifying secrets
- `--deep`: scan system services for extra gateway installs and report recent Gateway supervisor restart handoffs
- `--lint`: run modernized health checks in read-only mode and emit diagnostic findings
- `--post-upgrade`: run post-upgrade plugin compatibility probes; emits findings to stdout; exits with code 1 if any error-level findings are present
- `--json`: with `--lint`, emit JSON findings instead of human output; with `--post-upgrade`, emit a machine-readable JSON envelope (`{ probesRun, findings }`)
- `--severity-min <level>`: with `--lint`, drop findings below `info`, `warning`, or `error`
- `--skip <id>`: with `--lint`, skip a check id; repeat to skip more than one
- `--only <id>`: with `--lint`, run only a check id; repeat to run a small selected set

## Lint mode

`openclaw doctor --lint` is read-only: no prompts, no repair, no config/state rewrites.

```bash
openclaw doctor --lint
openclaw doctor --lint --severity-min warning
openclaw doctor --lint --json
openclaw doctor --lint --all
openclaw doctor --lint --allow-exec
openclaw doctor --lint --only core/doctor/gateway-config --json
```

Human output is compact:

```text
doctor --lint: ran 6 check(s), 1 finding(s)
  [warning] core/doctor/gateway-config gateway.mode - gateway.mode is unset; gateway start will be blocked.
    fix: Run `openclaw configure` and set Gateway mode (local/remote), or `openclaw config set gateway.mode local`.
```

JSON output is the scripting surface:

```json
{
  "ok": false,
  "checksRun": 5,
  "checksSkipped": 0,
  "findings": [
    {
      "checkId": "core/doctor/gateway-config",
      "severity": "warning",
      "message": "gateway.mode is unset; gateway start will be blocked.",
      "path": "gateway.mode",
      "fixHint": "Run `openclaw configure` and set Gateway mode (local/remote), or `openclaw config set gateway.mode local`."
    }
  ]
}
```

Exit codes:

| Code | Meaning                                                       |
| ---- | ------------------------------------------------------------- |
| `0`  | No findings at or above the selected severity threshold.      |
| `1`  | At least one finding meets the selected threshold.            |
| `2`  | Command/runtime failure before lint findings can be produced. |

`--severity-min` controls both which findings print and the exit threshold: `openclaw doctor --lint --severity-min error` can print nothing and exit `0` even when lower-severity `info`/`warning` findings exist.

`--all` controls which checks are selected before severity filtering. The default lint run excludes checks that are deep, historical, or more likely to surface repairable legacy residue; use `--all` for the complete inventory. `--only <id>` is the most precise selector and can run any registered check by id.

## Structured health checks

Modern doctor checks use a small split contract:

```ts
detect(ctx, scope?) -> HealthFinding[]
repair?(ctx, findings) -> HealthRepairResult
```

`detect()` powers `doctor --lint`. `repair()` is optional and only runs under `doctor --fix` / `doctor --repair`. Checks that have not migrated to this shape still use the legacy doctor contribution flow.

Repair contexts can carry `dryRun`/`diff` requests; repair results can return structured `diffs` (config/file edits) and `effects` (service, process, package, state, or other side effects), so converted checks can grow toward `doctor --fix --dry-run` without moving mutation planning into `detect()`.

`repair()` reports `status: "repaired" | "skipped" | "failed"` (omitted status means `repaired`). When repair returns `skipped` or `failed`, doctor reports the reason and skips validation for that check. After a successful repair, doctor re-runs `detect()` scoped to the repaired findings; if the finding is still present, doctor reports a repair warning instead of treating the change as complete.

A finding includes:

| Field             | Purpose                                                |
| ----------------- | ------------------------------------------------------ |
| `checkId`         | Stable id for skip/only filters and CI allowlists.     |
| `severity`        | `info`, `warning`, or `error`.                         |
| `message`         | Human-readable problem statement.                      |
| `path`            | Config, file, or logical path when available.          |
| `line` / `column` | Source location when available.                        |
| `ocPath`          | Precise `oc://` address when a check can point to one. |
| `fixHint`         | Suggested operator action or repair summary.           |

Modernized core doctor checks stay attached to the ordered doctor contribution that owns their human `doctor` / `doctor --fix` behavior. The shared structured health registry is the extension point: bundled and plugin-backed checks run after core doctor checks once their owning package registers them in the active command path. `openclaw/plugin-sdk/health` exposes the same contract for plugin authors.

## Check selection

```bash
openclaw doctor --lint --only core/doctor/gateway-config --json
openclaw doctor --lint --skip core/doctor/skills-readiness
openclaw doctor --lint --all --skip core/doctor/session-locks
```

`--only` and `--skip` accept full check ids and may be repeated. If an `--only` id is not registered, no check runs for that id; use `checksRun`/`checksSkipped` in the output to confirm a focused gate selects the checks you expect.

## PCC state repair

Use the narrow PCC commands when the Project Command Center needs a state migration or
proof-binding repair without running unrelated doctor repairs:

```bash
openclaw doctor --check pcc
openclaw doctor --fix pcc
```

`--check pcc` is read-only. `--fix pcc` only migrates the legacy PCC JSON ledger to
transactional SQLite when needed and repairs the PCC product's verified source, runtime,
and browser-proof SHA bindings. It preserves the legacy ledger as a backup and does not
change project work, Gateway configuration, credentials, services, or other doctor areas.

The PCC check also reports historical completion or model-run receipts whose `completedAt`
value is missing or unusable. Those records remain preserved and are excluded only from
chronological activity. Doctor never invents a completion time from `createdAt`, ledger
revision time, or the current clock; an operator must supply an authoritative timestamp
before that warning can clear.

## Post-upgrade mode

`openclaw doctor --post-upgrade` runs plugin compatibility probes for chaining after a build or upgrade. Findings go to stdout; exit code is 1 if any finding has `level: "error"`. Add `--json` for a machine-readable envelope (`{ probesRun, findings }`), suitable for CI, the community `fork-upgrade` skill, and other post-upgrade smoke tooling. If the installed plugin index is missing or malformed, JSON mode still emits the envelope with a `plugin.index_unavailable` error finding.

Container image startup is the exception to the usual "run doctor after
updating" flow. When `openclaw gateway run` starts on a new OpenClaw version, it
runs safe state and plugin repairs before reporting ready. If repair cannot
finish safely, startup exits and tells you to run the same image once with
`openclaw doctor --fix` against the same mounted state/config before restarting
the container normally.

## Notes

- In Nix mode (`OPENCLAW_NIX_MODE=1`), read-only doctor checks still work, but `doctor --fix`, `doctor --repair`, `doctor --yes`, and `doctor --generate-gateway-token` are disabled because `openclaw.json` is immutable. Edit the Nix source for this install instead; for nix-openclaw, use the agent-first [Quick Start](https://github.com/openclaw/nix-openclaw#quick-start).
- Interactive prompts (keychain/OAuth fixes, etc.) only run when stdin is a TTY and `--non-interactive` is **not** set. Headless runs (cron, Telegram, no terminal) skip prompts.
- Non-interactive `doctor` runs skip eager plugin loading so headless health checks stay fast. Interactive sessions still load the plugin surfaces needed by the legacy health/repair flow.
- `--lint` is stricter than `--non-interactive`: always read-only, never prompts, never applies safe migrations. Use `doctor --fix` or `doctor --repair` when you want doctor to make changes.
- Doctor does not execute `exec` SecretRefs while checking secrets by default. Use `--allow-exec` (with or without `--lint`) only when you intentionally want doctor to run those configured secret resolvers.
- Any config write (including a `--fix` repair) rotates a backup to `~/.openclaw/openclaw.json.bak` (with a numbered `.bak.1`..`.bak.4` ring). `--fix` also drops unknown config keys reported by schema validation, listing each removal; it skips this while an update is in progress so partially written upgrade state is not stripped before its migration finishes.
- Set `OPENCLAW_SERVICE_REPAIR_POLICY=external` when another supervisor owns the gateway lifecycle. Doctor still reports gateway/service health and applies non-service repairs, but skips service install/start/restart/bootstrap and legacy service cleanup.
- On Linux, doctor ignores inactive extra gateway-like systemd units and does not rewrite command/entrypoint metadata for a running systemd gateway service during repair. Stop the service first, or use `openclaw gateway install --force` to replace the active launcher.
- `doctor --fix --non-interactive` reports missing or stale gateway service definitions but does not install or rewrite them outside update repair mode. Run `openclaw gateway install` for a missing service, or `openclaw gateway install --force` to replace the launcher.
- State integrity checks detect orphan transcript files in the sessions directory. Archiving them as `.deleted.<timestamp>` requires interactive confirmation; `--fix`, `--yes`, and headless runs leave them in place.
- Doctor scans `~/.openclaw/cron/jobs.json` (or `cron.store`) for legacy cron job shapes and rewrites them before importing canonical rows into SQLite.
- Doctor reports cron jobs with an explicit `payload.model` override, including provider-namespace counts and mismatches against `agents.defaults.model`, so scheduled jobs that do not inherit the default model are visible during auth or billing investigations.
- On Linux, doctor warns when the user's crontab still runs the unmaintained legacy `~/.openclaw/bin/ensure-whatsapp.sh`, which can misreport `Gateway inactive` when cron lacks the systemd user-bus environment.
- When WhatsApp is enabled, doctor checks for a degraded Gateway event loop with local `openclaw-tui` clients still running. `doctor --fix` stops only verified local TUI clients so WhatsApp replies are not queued behind stale TUI refresh loops.
- Doctor rewrites legacy `openai-codex/*` model refs to canonical `openai/*` refs across primary models, fallbacks, image/video generation models, heartbeat/subagent/compaction overrides, hooks, channel model overrides, and stale session route pins. `--fix` also migrates legacy `openai-codex:*` auth profiles and `auth.order.openai-codex` entries to `openai:*`, moves Codex intent onto provider/model-scoped `agentRuntime.id: "codex"` entries, removes stale whole-agent/session runtime pins, and keeps repaired OpenAI agent refs on Codex auth routing instead of direct OpenAI API-key auth.
- Doctor cleans legacy plugin dependency staging state from older OpenClaw versions and relinks the host `openclaw` package for managed npm plugins that declare it as a peer dependency. It also repairs missing downloadable plugins referenced by config (`plugins.entries`, configured channels, configured provider/search settings, configured agent runtimes). During package updates, doctor skips package-manager plugin repair until the package swap completes; rerun `openclaw doctor --fix` afterward if a configured plugin still needs recovery. If a download fails, doctor reports the install error and preserves the configured plugin entry for the next repair attempt.
- Doctor repairs stale plugin config by removing missing plugin ids from `plugins.allow`/`plugins.deny`/`plugins.entries`, plus matching dangling channel config, heartbeat targets, and channel model overrides, when plugin discovery is healthy.
- Doctor quarantines invalid plugin config by disabling the affected `plugins.entries.<id>` entry and removing its invalid `config` payload. Gateway startup already skips only that bad plugin so other plugins and channels keep running.
- Doctor removes the retired `plugins.entries.codex.config.codexDynamicToolsProfile`; the Codex app-server always keeps Codex-native workspace tools native.
- Doctor auto-migrates legacy flat Talk config (`talk.voiceId`, `talk.modelId`, and friends) into `talk.provider` + `talk.providers.<provider>`. Repeat `doctor --fix` runs no longer report/apply Talk normalization when the only difference is object key order.
- Doctor includes a memory-search readiness check and can recommend `openclaw configure --section model` when embedding credentials are missing.
- Doctor warns when no command owner is configured. The command owner is the human operator account allowed to run owner-only commands and approve dangerous actions. DM pairing only lets someone talk to the bot; if you approved a sender before first-owner bootstrap existed, set `commands.ownerAllowFrom` explicitly.
- Doctor reports an info note when Codex-mode agents are configured and personal Codex CLI assets exist in the operator's Codex home. Local Codex app-server launches use isolated per-agent homes; install the Codex plugin first if needed, then use `openclaw migrate plan codex` to inventory assets that should be promoted deliberately.
- Doctor warns when skills allowed for the default agent are unavailable in the current runtime environment (missing bins, env vars, config, or OS requirements). `doctor --fix` can disable those unavailable skills with `skills.entries.<skill>.enabled=false`; install/configure the missing requirement instead if you want to keep the skill active.
- If sandbox mode is enabled but Docker is unavailable, doctor reports a high-signal warning with remediation (`install Docker` or `openclaw config set agents.defaults.sandbox.mode off`).
- If legacy sandbox registry files or shard directories are present (`~/.openclaw/sandbox/containers.json`, `~/.openclaw/sandbox/browsers.json`, `~/.openclaw/sandbox/containers/`, or `~/.openclaw/sandbox/browsers/`), doctor reports them; `--fix` migrates valid entries into SQLite and quarantines invalid legacy files.
- If `gateway.auth.token`/`gateway.auth.password` are SecretRef-managed and unavailable in the current command path, doctor reports a read-only warning and does not write plaintext fallback credentials. For exec-backed SecretRefs, doctor skips execution unless `--allow-exec` is present.
- If channel SecretRef inspection fails in a fix path, doctor continues and reports a warning instead of exiting early.
- After state-directory migrations, doctor warns when enabled default Telegram or Discord accounts depend on env fallback and `TELEGRAM_BOT_TOKEN` or `DISCORD_BOT_TOKEN` is unavailable to the doctor process.
- Telegram `allowFrom` username auto-resolution (`doctor --fix`) requires a resolvable Telegram token in the current command path. If token inspection is unavailable, doctor reports a warning and skips auto-resolution for that pass.

## macOS: `launchctl` env overrides

If you previously ran `launchctl setenv OPENCLAW_GATEWAY_TOKEN ...` (or `...PASSWORD`), that value overrides your config file and can cause persistent "unauthorized" errors.

```bash
launchctl getenv OPENCLAW_GATEWAY_TOKEN
launchctl getenv OPENCLAW_GATEWAY_PASSWORD

launchctl unsetenv OPENCLAW_GATEWAY_TOKEN
launchctl unsetenv OPENCLAW_GATEWAY_PASSWORD
```

## Related

- [CLI reference](/cli)
- [Gateway doctor](/gateway/doctor)
