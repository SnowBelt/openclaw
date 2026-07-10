#!/usr/bin/env bash
set -euo pipefail

ROOT="/Users/openclaw/PatternLabRuntime"
PLIST_SRC="$ROOT/youtube-v1/automation/pattern-lab-wake-scheduler.plist"
HELPER_SRC="$ROOT/youtube-v1/automation/openclaw-patternlab-schedule-wake"
HELPER_DST="/usr/local/libexec/openclaw-patternlab-schedule-wake"
LABEL="com.openclaw.patternlab-v2.wake-scheduler"
PLIST_DST="/Library/LaunchDaemons/${LABEL}.plist"
LEGACY_LABEL="com.openclaw.patternlab-wake"
LEGACY_PLIST="/Library/LaunchDaemons/${LEGACY_LABEL}.plist"

sudo install -d -o root -g wheel -m 0755 /usr/local/libexec
sudo install -o root -g wheel -m 0755 "$HELPER_SRC" "$HELPER_DST"
sudo install -o root -g wheel -m 644 "$PLIST_SRC" "$PLIST_DST"
sudo launchctl bootout system/$LEGACY_LABEL >/dev/null 2>&1 || true
sudo rm -f "$LEGACY_PLIST"
sudo launchctl bootout system/$LABEL >/dev/null 2>&1 || true
sudo launchctl bootstrap system "$PLIST_DST"
sudo launchctl kickstart -k system/$LABEL
sudo launchctl print system/$LABEL | sed -n '1,120p'
pmset -g sched
