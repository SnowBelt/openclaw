#!/usr/bin/env bash
set -euo pipefail

ROOT="/Users/openclaw/openclaw"
PLIST_SRC="$ROOT/youtube-v1/automation/pattern-lab-wake-scheduler.plist"
PLIST_DST="/Library/LaunchDaemons/com.openclaw.pattern-lab.wake-scheduler.plist"

sudo install -o root -g wheel -m 644 "$PLIST_SRC" "$PLIST_DST"
sudo launchctl bootout system "$PLIST_DST" >/dev/null 2>&1 || true
sudo launchctl bootstrap system "$PLIST_DST"
sudo launchctl kickstart -k system/com.openclaw.pattern-lab.wake-scheduler
sudo launchctl print system/com.openclaw.pattern-lab.wake-scheduler | sed -n '1,120p'
pmset -g sched
