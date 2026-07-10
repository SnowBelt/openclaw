# Pattern Lab Autonomy Activation Runbook

This runbook activates only the local reliability surfaces. It never uploads,
publishes, comments, pins, sets Related Video, or changes YouTube metadata.

## Preconditions

- The source branch includes the runtime watchdog, topic qualification worker,
  restore drill, and `patternlab-discord-review` plugin.
- The Discord channel owner is on the configured allowlist.
- The owner has given a fresh activation approval.

## 1. Install the deterministic Discord feedback plugin

```bash
cd /Users/openclaw/OpenClaw
openclaw plugins install -l youtube-v1/plugins/patternlab-discord-review
openclaw config set plugins.entries.patternlab-discord-review.enabled true
openclaw config set plugins.entries.patternlab-discord-review.config.repoRoot /Users/openclaw/OpenClaw
openclaw gateway restart
openclaw plugins inspect patternlab-discord-review --runtime --json
openclaw gateway status --deep --require-rpc
```

Pass condition: runtime inspection lists a Discord `patternlab` interactive
handler. A plugin install or gateway restart is not proof of a clicked button.

## 2. Prove the button loop in a safe test channel

Send one manually constructed `patternlab:` button whose callback targets a
disposable `video-feedback-smoke` fixture and only uses `action=approve`.
The handler must reply that it recorded feedback and did not perform a YouTube
action. Verify only the fixture's `owner-feedback.jsonl`; do not use Video 04.

Pass condition: the click creates one owner-feedback event with `source` set to
`discord`, a recognized reason, and no YouTube report change.

## 3. Activate watchdog scheduling only after the check receipt is green

Run the watchdog by hand first:

```bash
youtube-v1/.venv-youtube-3.12/bin/python youtube-v1/scripts/patternlab_runtime_watchdog.py --check
```

Then install `automation/pattern-lab-runtime-watchdog.plist` as a user
LaunchAgent. Keep `allow_discord_alerts` and `allow_launchd_recovery` false
until a separate approval exists. The watchdog's first scheduled release is
receipt only; it has no restart or alert authority.

## 4. Restore-confidence drill

```bash
youtube-v1/.venv-youtube-3.12/bin/python youtube-v1/scripts/patternlab_restore_drill.py --video-id 04
```

Pass condition: all source surface checks and no-mutation commands pass. This
does not substitute for a full machine restore.

## Prohibited Actions

- No YouTube API mutation.
- No paid provider call.
- No secrets copied into repo, local-output, or Discord messages.
- No automatic media repair after a Discord click; feedback only queues the
  scoped repair for a separately reviewed local run.
