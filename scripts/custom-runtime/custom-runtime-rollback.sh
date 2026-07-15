#!/bin/sh
# Restore a preregistered custom-runtime control-plane bundle transactionally.
set -eu

runtime_home=${OPENCLAW_CUSTOM_RUNTIME_HOME:-"$HOME/.openclaw-custom-runtime"}
releases_dir=${OPENCLAW_CUSTOM_RUNTIME_RELEASES:-"$HOME/.openclaw-runtime-releases"}
plist=${OPENCLAW_GATEWAY_PLIST:-"$HOME/Library/LaunchAgents/ai.openclaw.gateway.plist"}
env_file=${OPENCLAW_GATEWAY_ENV_FILE:-"$HOME/.openclaw-director-state/service-env/ai.openclaw.gateway.env"}
config_path=${OPENCLAW_CONFIG_PATH:-"$HOME/.openclaw/openclaw.director.json"}
state_dir=${OPENCLAW_STATE_DIR:-"$HOME/.openclaw-director-state"}
label=${OPENCLAW_GATEWAY_LABEL:-ai.openclaw.gateway}
uid=$(id -u)
launcher="$runtime_home/bin/custom-runtime-launcher.sh"
pointer="$runtime_home/active-runtime.json"
desired_plist="$runtime_home/ai.openclaw.gateway.desired.plist"
registration="$runtime_home/active-rollback.json"
auth_helper=$(dirname "$0")/custom-runtime-auth.sh
[ -f "$auth_helper" ] || { printf '%s\n' 'custom runtime Gateway auth helper is missing' >&2; exit 64; }
. "$auth_helper"

usage() {
  printf '%s\n' 'usage: custom-runtime-rollback.sh --candidate-runtime-release ID --rollback-release ID [--port 18789] [--verify-only]' >&2
  exit 64
}

candidate_runtime_release= rollback_release= port=18789 verify_only=false
while [ $# -gt 0 ]; do
  case "$1" in
    --candidate-runtime-release) candidate_runtime_release=${2:-}; shift 2 ;;
    --rollback-release) rollback_release=${2:-}; shift 2 ;;
    --port) port=${2:-}; shift 2 ;;
    --verify-only) verify_only=true; shift ;;
    *) usage ;;
  esac
done
[ -n "$candidate_runtime_release" ] && [ -n "$rollback_release" ] || usage
case "$candidate_runtime_release" in *[!A-Za-z0-9._-]*|'') usage ;; esac
case "$rollback_release" in *[!A-Za-z0-9._-]*|'') usage ;; esac
case "$port" in ''|*[!0-9]*) usage ;; esac

mkdir -p "$runtime_home/backups" "$runtime_home/locks" "$runtime_home/receipts"
for operation in activation promotion restart; do
  [ ! -d "$runtime_home/locks/$operation.lock" ] || {
    printf '%s\n' "custom runtime $operation is already active" >&2
    exit 75
  }
done
rollback_lock="$runtime_home/locks/rollback.lock"
if ! mkdir "$rollback_lock" 2>/dev/null; then
  printf '%s\n' 'another custom-runtime rollback is already active' >&2
  exit 75
fi
cleanup_rollback_lock() { rmdir "$rollback_lock" 2>/dev/null || true; }
trap cleanup_rollback_lock EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

timestamp=$(date -u +%Y%m%dT%H%M%SZ)
receipt="$runtime_home/receipts/custom-runtime-rollback-$timestamp.json"
write_receipt() {
  printf '{"at":"%s","result":"%s","candidateRuntimeReleaseId":"%s","rollbackReleaseId":"%s"}\n' \
    "$timestamp" "$1" "$candidate_runtime_release" "$rollback_release" > "$receipt"
}

if ! bundle=$(python3 - "$registration" "$pointer" "$runtime_home" "$releases_dir" \
  "$candidate_runtime_release" "$rollback_release" <<'PY'
import hashlib
import json
import os
import sys

registration_path, pointer_path, runtime_home, releases_dir, candidate_runtime_id, rollback_id = sys.argv[1:]
with open(registration_path, encoding="utf-8") as f:
    registration = json.load(f)
with open(pointer_path, encoding="utf-8") as f:
    active = json.load(f)
bundle = registration.get("bundle")
if not isinstance(bundle, str) or not bundle:
    raise SystemExit("rollback bundle is missing")
bundle = os.path.realpath(bundle)
rollback_root = os.path.realpath(os.path.join(runtime_home, "rollbacks"))
if os.path.commonpath((bundle, rollback_root)) != rollback_root or bundle == rollback_root:
    raise SystemExit("rollback bundle is outside the private rollback root")
if os.path.islink(bundle) or not os.path.isdir(bundle):
    raise SystemExit("rollback bundle is not a private directory")
manifest_path = os.path.join(bundle, "manifest.json")
with open(manifest_path, "rb") as f:
    manifest_bytes = f.read()
if hashlib.sha256(manifest_bytes).hexdigest() != registration.get("manifestSha256"):
    raise SystemExit("rollback manifest hash mismatch")
manifest = json.loads(manifest_bytes)
expected = {
    "candidateReleaseId": active.get("releaseId"),
    "candidateRuntimeReleaseId": candidate_runtime_id,
    "rollbackReleaseId": rollback_id,
}
for key, value in expected.items():
    if registration.get(key) != value or manifest.get(key) != value:
        raise SystemExit(f"rollback identity mismatch: {key}")
runtime_root = active.get("runtimeRoot")
if not isinstance(runtime_root, str) or not runtime_root:
    raise SystemExit("active runtime root is missing")
with open(os.path.join(runtime_root, "snapshot.json"), encoding="utf-8") as f:
    snapshot = json.load(f)
if snapshot.get("releaseId") != candidate_runtime_id:
    raise SystemExit("active runtime is not the scoped candidate")
required = (
    "active-runtime.json",
    "ai.openclaw.gateway.plist",
    "ai.openclaw.gateway.env",
    "custom-runtime-launcher.sh",
)
files = manifest.get("files")
if not isinstance(files, dict) or set(files) != set(required):
    raise SystemExit("rollback file inventory is invalid")
for name in required:
    file_path = os.path.join(bundle, name)
    if os.path.islink(file_path) or not os.path.isfile(file_path):
        raise SystemExit(f"rollback file is invalid: {name}")
    with open(file_path, "rb") as f:
        digest = hashlib.sha256(f.read()).hexdigest()
    if digest != files.get(name):
        raise SystemExit(f"rollback file hash mismatch: {name}")
with open(os.path.join(bundle, "active-runtime.json"), encoding="utf-8") as f:
    rollback_pointer = json.load(f)
if rollback_pointer.get("releaseId") != rollback_id:
    raise SystemExit("rollback pointer release mismatch")
rollback_root_path = rollback_pointer.get("runtimeRoot")
if rollback_root_path != manifest.get("rollbackRuntimeRoot"):
    raise SystemExit("rollback runtime root mismatch")
real_releases = os.path.realpath(releases_dir)
real_rollback = os.path.realpath(str(rollback_root_path))
if os.path.commonpath((real_rollback, real_releases)) != real_releases or real_rollback == real_releases:
    raise SystemExit("rollback runtime is outside the immutable releases root")
print(bundle)
PY
); then
  write_receipt rollback_preflight_failed
  exit 1
fi

rollback_launcher="$bundle/custom-runtime-launcher.sh"
if ! OPENCLAW_CUSTOM_RUNTIME_POINTER="$bundle/active-runtime.json" \
  "$rollback_launcher" --verify >/dev/null 2>&1; then
  write_receipt rollback_launcher_preflight_failed
  exit 1
fi
if [ "$verify_only" = true ]; then
  write_receipt rollback_ready
  printf '%s\n' "CUSTOM_RUNTIME_ROLLBACK_READY candidate=$candidate_runtime_release rollback=$rollback_release"
  exit 0
fi

backup="$runtime_home/backups/rollback-candidate-$timestamp"
mkdir -m 700 "$backup"
cp -p "$pointer" "$backup/active-runtime.json"
cp -p "$plist" "$backup/ai.openclaw.gateway.plist"
cp -p "$env_file" "$backup/ai.openclaw.gateway.env"
cp -p "$launcher" "$backup/custom-runtime-launcher.sh"
[ ! -f "$desired_plist" ] || cp -p "$desired_plist" "$backup/ai.openclaw.gateway.desired.plist"

install_state() {
  source_dir=$1
  install -m 600 "$source_dir/active-runtime.json" "$runtime_home/.active-runtime.json.rollback-$$"
  mv "$runtime_home/.active-runtime.json.rollback-$$" "$pointer"
  install -m 600 "$source_dir/ai.openclaw.gateway.plist" "$plist.rollback-$$"
  mv "$plist.rollback-$$" "$plist"
  install -m 600 "$source_dir/ai.openclaw.gateway.env" "$env_file.rollback-$$"
  mv "$env_file.rollback-$$" "$env_file"
  install -m 700 "$source_dir/custom-runtime-launcher.sh" "$runtime_home/bin/.custom-runtime-launcher.sh.rollback-$$"
  mv "$runtime_home/bin/.custom-runtime-launcher.sh.rollback-$$" "$launcher"
  cp -p "$plist" "$desired_plist"
}

verify_gateway() {
  expected_root=$1
  launchctl bootout "gui/$uid/$label" 2>/dev/null || true
  for _ in $(seq 1 15); do
    launchctl print "gui/$uid/$label" >/dev/null 2>&1 || break
    sleep 1
  done
  launchctl bootstrap "gui/$uid" "$plist" || return 1
  healthy=false
  for _ in $(seq 1 45); do
    if curl --silent --fail --max-time 3 "http://127.0.0.1:$port/health" | grep -q '"ok":true' && \
       pgrep -f "$expected_root/dist/index.js gateway --port $port" >/dev/null 2>&1; then
      healthy=true
      break
    fi
    sleep 2
  done
  [ "$healthy" = true ] || return 1
  "$launcher" --verify >/dev/null 2>&1 || return 1
  pgrep -f "$expected_root/dist/index.js gateway --port $port" >/dev/null 2>&1 || return 1
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
    return 1
  fi
  for route in $routes self-improvement; do
    [ "$(curl --silent --output /dev/null --write-out '%{http_code}' --max-time 3 "http://127.0.0.1:$port/$route")" = 200 ] || return 1
  done
  summary="$runtime_home/self-improvement-rollback.$$.json"
  custom_runtime_export_gateway_auth "$config_path" || return 1
  if ! OPENAI_API_KEY= AZURE_OPENAI_API_KEY= OPENAI_BASE_URL= \
    OPENCLAW_GATEWAY_URL="ws://127.0.0.1:$port" \
    OPENCLAW_CONFIG_PATH="$config_path" OPENCLAW_STATE_DIR="$state_dir" \
    OPENCLAW_SKIP_CHANNELS=1 OPENCLAW_SKIP_CRON=1 \
    OPENCLAW_SELF_IMPROVEMENT_BACKGROUND=0 \
    OPENCLAW_CUSTOM_RUNTIME_POINTER="$pointer" \
    "$launcher" self-improvement summary \
    --timeout 10000 --limit 1 --json > "$summary"; then
    rm -f "$summary"
    return 1
  fi
  if ! python3 - "$summary" <<'PY'
import json
import sys

with open(sys.argv[1], encoding="utf-8") as f:
    summary = json.load(f)
if not isinstance(summary, dict) or not isinstance(summary.get("scorecard"), dict):
    raise SystemExit(1)
if not isinstance(summary.get("groups"), list):
    raise SystemExit(1)
PY
  then
    rm -f "$summary"
    return 1
  fi
  rm -f "$summary"
}

rollback_runtime_root=$(python3 - "$bundle/active-runtime.json" <<'PY'
import json
import sys
with open(sys.argv[1], encoding="utf-8") as f:
    print(json.load(f)["runtimeRoot"])
PY
)
candidate_runtime_root=$(python3 - "$backup/active-runtime.json" <<'PY'
import json
import sys
with open(sys.argv[1], encoding="utf-8") as f:
    print(json.load(f)["runtimeRoot"])
PY
)

install_state "$bundle"
if verify_gateway "$rollback_runtime_root"; then
  cp -p "$pointer" "$runtime_home/last-known-good.json"
  mv "$registration" "$runtime_home/receipts/rollback-registration-used-$timestamp.json"
  write_receipt rolled_back_verified
  printf '%s\n' "CUSTOM_RUNTIME_ROLLED_BACK release=$rollback_release"
  exit 0
fi

install_state "$backup"
if verify_gateway "$candidate_runtime_root"; then
  write_receipt rollback_failed_candidate_restored
else
  write_receipt rollback_failed_candidate_unhealthy
fi
exit 1
