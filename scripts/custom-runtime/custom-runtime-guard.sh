#!/bin/sh
# Repairs launchd drift only when the Keychain prerequisite is available.
set -eu

runtime_home=${OPENCLAW_CUSTOM_RUNTIME_HOME:-"$HOME/.openclaw-custom-runtime"}
plist=${OPENCLAW_GATEWAY_PLIST:-"$HOME/Library/LaunchAgents/ai.openclaw.gateway.plist"}
label=${OPENCLAW_GATEWAY_LABEL:-ai.openclaw.gateway}
launcher="$runtime_home/bin/custom-runtime-launcher.sh"
provider=${OPENCLAW_SECRET_PROVIDER:-"$HOME/.openclaw/bin/patternlab-keychain-secret-provider"}
uid=$(id -u)
mkdir -p "$runtime_home/receipts" "$runtime_home/locks"
lock="$runtime_home/locks/guard.lock"
if ! mkdir "$lock" 2>/dev/null; then exit 0; fi
trap 'rmdir "$lock"' EXIT
stamp=$(date -u +%Y%m%dT%H%M%SZ)
receipt() { printf '{"at":"%s","result":"%s"}\n' "$stamp" "$1" > "$runtime_home/receipts/guard-$stamp.json"; }

if "$launcher" --verify >/dev/null 2>&1 && python3 - "$plist" "$launcher" <<'PY'
import plistlib, sys
with open(sys.argv[1], "rb") as f: args = plistlib.load(f).get("ProgramArguments", [])
raise SystemExit(0 if sys.argv[2] in args else 1)
PY
then
  exit 0
fi

# Never restart into a configuration that cannot retrieve its required secret.
if ! printf '%s' '{"ids":["discord/bot-token"]}' | "$provider" | python3 -c 'import json,sys; d=json.load(sys.stdin); raise SystemExit(0 if d.get("values",{}).get("discord/bot-token") else 1)' 2>/dev/null; then
  receipt repair_deferred_keychain
  exit 75
fi
[ -f "$runtime_home/last-known-good.json" ] || { receipt repair_unavailable_no_last_good; exit 1; }
now=$(date +%s)
last=$(cat "$runtime_home/last-restart.epoch" 2>/dev/null || printf 0)
if [ $((now - last)) -lt 600 ]; then receipt repair_rate_limited; exit 75; fi
cp -p "$runtime_home/last-known-good.json" "$runtime_home/active-runtime.json"
printf '%s\n' "$now" > "$runtime_home/last-restart.epoch"
launchctl bootout "gui/$uid/$label" 2>/dev/null || true
launchctl bootstrap "gui/$uid" "$plist"
receipt repaired
