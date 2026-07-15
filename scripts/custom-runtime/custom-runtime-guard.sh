#!/bin/sh
# Repairs launchd drift only when the Keychain prerequisite is available.
set -eu

runtime_home=${OPENCLAW_CUSTOM_RUNTIME_HOME:-"$HOME/.openclaw-custom-runtime"}
plist=${OPENCLAW_GATEWAY_PLIST:-"$HOME/Library/LaunchAgents/ai.openclaw.gateway.plist"}
label=${OPENCLAW_GATEWAY_LABEL:-ai.openclaw.gateway}
launcher="$runtime_home/bin/custom-runtime-launcher.sh"
desired_plist="$runtime_home/ai.openclaw.gateway.desired.plist"
provider=${OPENCLAW_SECRET_PROVIDER:-"$HOME/.openclaw/bin/patternlab-keychain-secret-provider"}
port=${OPENCLAW_GATEWAY_PORT:-18789}
uid=$(id -u)
mkdir -p "$runtime_home/receipts" "$runtime_home/locks"
for operation in activation promotion restart rollback; do
  operation_lock="$runtime_home/locks/$operation.lock"
  if [ -d "$operation_lock" ]; then
    now=$(date +%s)
    modified=$(stat -f %m "$operation_lock" 2>/dev/null || printf 0)
    case "$modified" in *[!0-9]*|'') modified=0 ;; esac
    age=$((now - modified))
    if [ "$age" -ge 0 ] && [ "$age" -lt 900 ]; then
      exit 0
    fi
    rmdir "$operation_lock" 2>/dev/null || exit 0
    receipt_stamp=$(date -u +%Y%m%dT%H%M%SZ)
    printf '{"at":"%s","result":"stale_%s_lock_removed"}\n' \
      "$receipt_stamp" "$operation" > "$runtime_home/receipts/guard-stale-$operation-lock-$receipt_stamp.json"
  fi
done
lock="$runtime_home/locks/guard.lock"
if ! mkdir "$lock" 2>/dev/null; then exit 0; fi
trap 'rmdir "$lock"' EXIT
stamp=$(date -u +%Y%m%dT%H%M%SZ)
receipt() { printf '{"at":"%s","result":"%s"}\n' "$stamp" "$1" > "$runtime_home/receipts/guard-$stamp.json"; }

runtime_root=$(python3 - "$runtime_home/active-runtime.json" <<'PY'
import json, sys
try:
    print(json.load(open(sys.argv[1])).get("runtimeRoot", ""))
except Exception:
    pass
PY
)
plist_uses_launcher=false
if [ -f "$plist" ] && python3 - "$plist" "$launcher" <<'PY'
import plistlib, sys
try:
    with open(sys.argv[1], "rb") as f:
        args = plistlib.load(f).get("ProgramArguments", [])
except (OSError, plistlib.InvalidFileException):
    raise SystemExit(1)
raise SystemExit(0 if sys.argv[2] in args else 1)
PY
then
  plist_uses_launcher=true
fi
if "$launcher" --verify >/dev/null 2>&1 && [ "$plist_uses_launcher" = true ] && [ -n "$runtime_root" ] && pgrep -f "$runtime_root/dist/index.js gateway" >/dev/null 2>&1
then
  exit 0
fi

# Never restart into a configuration that cannot retrieve its required secret.
if ! printf '%s' '{"ids":["discord/bot-token"]}' | "$provider" | python3 -c 'import json,sys; d=json.load(sys.stdin); raise SystemExit(0 if d.get("values",{}).get("discord/bot-token") else 1)' 2>/dev/null; then
  receipt repair_deferred_keychain
  exit 75
fi
registered_rollback="$runtime_home/active-rollback.json"
rollback_script="$runtime_home/bin/custom-runtime-rollback.sh"
if [ -f "$registered_rollback" ] && [ -x "$rollback_script" ]; then
  rollback_identity=$(python3 - "$registered_rollback" <<'PY'
import json
import sys

with open(sys.argv[1], encoding="utf-8") as f:
    registration = json.load(f)
for key in ("candidateRuntimeReleaseId", "rollbackReleaseId"):
    value = registration.get(key)
    if not isinstance(value, str) or not value:
        raise SystemExit("registered rollback identity is incomplete")
    print(value)
PY
  ) || { receipt registered_rollback_invalid; exit 1; }
  candidate_runtime_release=$(printf '%s\n' "$rollback_identity" | sed -n '1p')
  rollback_release=$(printf '%s\n' "$rollback_identity" | sed -n '2p')
  now=$(date +%s)
  last=$(cat "$runtime_home/last-restart.epoch" 2>/dev/null || printf 0)
  if [ $((now - last)) -lt 600 ]; then receipt repair_rate_limited; exit 75; fi
  printf '%s\n' "$now" > "$runtime_home/last-restart.epoch"
  if "$rollback_script" \
    --candidate-runtime-release "$candidate_runtime_release" \
    --rollback-release "$rollback_release" \
    --port "$port"; then
    receipt repaired_by_registered_rollback
    exit 0
  fi
  receipt registered_rollback_failed
  exit 1
fi
[ -f "$runtime_home/last-known-good.json" ] || { receipt repair_unavailable_no_last_good; exit 1; }
[ -f "$desired_plist" ] || { receipt repair_unavailable_no_desired_plist; exit 1; }
python3 - "$desired_plist" "$launcher" <<'PY'
import plistlib, sys
with open(sys.argv[1], "rb") as f: args = plistlib.load(f).get("ProgramArguments", [])
raise SystemExit(0 if sys.argv[2] in args else 1)
PY
now=$(date +%s)
last=$(cat "$runtime_home/last-restart.epoch" 2>/dev/null || printf 0)
if [ $((now - last)) -lt 600 ]; then receipt repair_rate_limited; exit 75; fi
previous_plist="$runtime_home/backups/guard-gateway-$stamp.plist"
mkdir -p "$runtime_home/backups"
cp -p "$plist" "$previous_plist"
rollback() {
  cp -p "$previous_plist" "$plist"
  launchctl bootout "gui/$uid/$label" 2>/dev/null || true
  for _ in $(seq 1 15); do
    launchctl print "gui/$uid/$label" >/dev/null 2>&1 || break
    sleep 1
  done
  launchctl bootstrap "gui/$uid" "$plist" 2>/dev/null || true
}
cp -p "$runtime_home/last-known-good.json" "$runtime_home/active-runtime.json"
cp -p "$desired_plist" "$plist"
printf '%s\n' "$now" > "$runtime_home/last-restart.epoch"
launchctl bootout "gui/$uid/$label" 2>/dev/null || true
for _ in $(seq 1 15); do
  launchctl print "gui/$uid/$label" >/dev/null 2>&1 || break
  sleep 1
done
if ! launchctl bootstrap "gui/$uid" "$plist"; then
  rollback
  receipt repair_rolled_back_bootstrap
  exit 1
fi
for _ in $(seq 1 45); do
  if curl --silent --fail --max-time 3 "http://127.0.0.1:$port/health" | grep -q '"ok":true'; then
    receipt repaired
    exit 0
  fi
  sleep 2
done
rollback
receipt repair_rolled_back_health
exit 1
