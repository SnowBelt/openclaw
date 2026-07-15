#!/bin/sh
# Restart the currently selected custom runtime without rewriting its managed service.
set -eu

runtime_home=${OPENCLAW_CUSTOM_RUNTIME_HOME:-"$HOME/.openclaw-custom-runtime"}
config_path=${OPENCLAW_CONFIG_PATH:-"$HOME/.openclaw/openclaw.director.json"}
state_dir=${OPENCLAW_STATE_DIR:-"$HOME/.openclaw-director-state"}
label=${OPENCLAW_GATEWAY_LABEL:-ai.openclaw.gateway}
port=${OPENCLAW_GATEWAY_PORT:-18789}
uid=$(id -u)
launcher="$runtime_home/bin/custom-runtime-launcher.sh"
pointer="$runtime_home/active-runtime.json"
auth_helper=$(dirname "$0")/custom-runtime-auth.sh
[ -f "$auth_helper" ] || { printf '%s\n' 'custom runtime Gateway auth helper is missing' >&2; exit 64; }
. "$auth_helper"

usage() {
  printf '%s\n' 'usage: custom-runtime-restart.sh [--port 18789]' >&2
  exit 64
}

while [ $# -gt 0 ]; do
  case "$1" in
    --port) port=${2:-}; shift 2 ;;
    *) usage ;;
  esac
done
case "$port" in ''|*[!0-9]*) usage ;; esac

mkdir -p "$runtime_home/locks" "$runtime_home/receipts"
for operation in activation promotion rollback; do
  [ ! -d "$runtime_home/locks/$operation.lock" ] || {
    printf '%s\n' "custom runtime $operation is already active" >&2
    exit 75
  }
done
restart_lock="$runtime_home/locks/restart.lock"
if ! mkdir "$restart_lock" 2>/dev/null; then
  printf '%s\n' 'another custom-runtime restart is already active' >&2
  exit 75
fi
cleanup_restart_lock() { rmdir "$restart_lock" 2>/dev/null || true; }
trap cleanup_restart_lock EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

timestamp=$(date -u +%Y%m%dT%H%M%SZ)
receipt="$runtime_home/receipts/restart-$timestamp.json"
write_receipt() {
  printf '{"at":"%s","result":"%s","release":"%s"}\n' \
    "$timestamp" "$1" "$runtime_release_id" > "$receipt"
}

[ -f "$pointer" ] && [ -x "$launcher" ] || {
  printf '%s\n' 'custom runtime pointer or launcher is unavailable' >&2
  exit 64
}
identity=$(python3 - "$pointer" <<'PY'
import json
import os
import sys

with open(sys.argv[1], encoding="utf-8") as f:
    pointer = json.load(f)
root = pointer.get("runtimeRoot")
if not isinstance(root, str) or not root:
    raise SystemExit("active runtime root is missing")
with open(os.path.join(root, "snapshot.json"), encoding="utf-8") as f:
    snapshot = json.load(f)
release_id = snapshot.get("releaseId")
if not isinstance(release_id, str) or not release_id:
    raise SystemExit("active runtime release id is missing")
print(root)
print(release_id)
PY
) || exit 64
runtime_root=$(printf '%s\n' "$identity" | sed -n '1p')
runtime_release_id=$(printf '%s\n' "$identity" | sed -n '2p')

if ! "$launcher" --verify >/dev/null 2>&1 || \
   ! launchctl print "gui/$uid/$label" >/dev/null 2>&1; then
  write_receipt preflight_failed
  exit 1
fi
old_pid=$(pgrep -f "$runtime_root/dist/index.js gateway --port $port" | head -n 1 || true)
[ -n "$old_pid" ] || {
  write_receipt preflight_process_missing
  exit 1
}

if ! launchctl kickstart -k "gui/$uid/$label"; then
  write_receipt kickstart_failed
  exit 1
fi

new_pid=
for _ in $(seq 1 45); do
  candidate_pid=$(pgrep -f "$runtime_root/dist/index.js gateway --port $port" | head -n 1 || true)
  if [ -n "$candidate_pid" ] && [ "$candidate_pid" != "$old_pid" ] && \
     curl --silent --fail --max-time 3 "http://127.0.0.1:$port/health" | grep -q '"ok":true'; then
    new_pid=$candidate_pid
    break
  fi
  sleep 2
done
if [ -z "$new_pid" ] || ! "$launcher" --verify >/dev/null 2>&1; then
  write_receipt restart_health_failed
  exit 1
fi

if ! routes=$(python3 - "$pointer" <<'PY'
import json
import os
import sys

with open(sys.argv[1], encoding="utf-8") as f:
    pointer = json.load(f)
manifest_path = pointer.get("manifestPath")
if not isinstance(manifest_path, str) or not manifest_path:
    root = pointer.get("runtimeRoot")
    if not isinstance(root, str) or not root:
        raise SystemExit("active runtime root is missing")
    manifest_path = os.path.join(root, "dist", "control-ui", "dashboard-surfaces.json")
with open(manifest_path, encoding="utf-8") as f:
    manifest = json.load(f)
by_id = {
    item.get("id"): item
    for item in manifest.get("surfaces", [])
    if isinstance(item, dict) and isinstance(item.get("id"), str)
}
for surface_id in pointer.get("requiredSurfaces", []):
    surface = by_id.get(surface_id)
    if not isinstance(surface, dict):
        raise SystemExit(f"required surface is missing: {surface_id}")
    for value in (surface.get("path"), *surface.get("aliases", [])):
        if isinstance(value, str) and value.startswith("/") and " " not in value:
            print(value.lstrip("/"))
PY
); then
  write_receipt restart_route_inventory_failed
  exit 1
fi
for route in $routes self-improvement; do
  if [ "$(curl --silent --output /dev/null --write-out '%{http_code}' --max-time 3 "http://127.0.0.1:$port/$route")" != 200 ]; then
    write_receipt "restart_route_failed:$route"
    exit 1
  fi
done

summary="$runtime_home/self-improvement-restart.$$.json"
cleanup_summary() { rm -f "$summary"; }
trap 'cleanup_summary; cleanup_restart_lock' EXIT
if ! custom_runtime_export_gateway_auth "$config_path"; then
  write_receipt restart_sig_auth_failed
  exit 1
fi
if ! OPENAI_API_KEY= AZURE_OPENAI_API_KEY= OPENAI_BASE_URL= \
  OPENCLAW_GATEWAY_URL="ws://127.0.0.1:$port" \
  OPENCLAW_CONFIG_PATH="$config_path" OPENCLAW_STATE_DIR="$state_dir" \
  OPENCLAW_SKIP_CHANNELS=1 OPENCLAW_SKIP_CRON=1 \
  OPENCLAW_SELF_IMPROVEMENT_BACKGROUND=0 \
  OPENCLAW_CUSTOM_RUNTIME_POINTER="$pointer" \
  "$launcher" self-improvement summary \
  --timeout 10000 --limit 1 --json > "$summary"; then
  write_receipt restart_sig_rpc_failed
  exit 1
fi
if ! python3 - "$summary" <<'PY'
import json
import sys

with open(sys.argv[1], encoding="utf-8") as f:
    summary = json.load(f)
if not isinstance(summary, dict) or not isinstance(summary.get("scorecard"), dict):
    raise SystemExit("Self-Improvement summary contract failed")
if not isinstance(summary.get("groups"), list):
    raise SystemExit("Self-Improvement groups contract failed")
PY
then
  write_receipt restart_sig_contract_failed
  exit 1
fi
cleanup_summary
write_receipt restarted_verified
printf '%s\n' "CUSTOM_RUNTIME_RESTARTED release=$runtime_release_id"
