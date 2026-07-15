#!/bin/sh
# Atomically select a verified release and restart launchd, rolling back on failure.
set -eu

runtime_home=${OPENCLAW_CUSTOM_RUNTIME_HOME:-"$HOME/.openclaw-custom-runtime"}
releases_dir=${OPENCLAW_CUSTOM_RUNTIME_RELEASES:-"$HOME/.openclaw-runtime-releases"}
plist=${OPENCLAW_GATEWAY_PLIST:-"$HOME/Library/LaunchAgents/ai.openclaw.gateway.plist"}
env_wrapper=${OPENCLAW_GATEWAY_ENV_WRAPPER:-"$HOME/.openclaw-director-state/service-env/ai.openclaw.gateway-env-wrapper.sh"}
env_file=${OPENCLAW_GATEWAY_ENV_FILE:-"$HOME/.openclaw-director-state/service-env/ai.openclaw.gateway.env"}
config_path=${OPENCLAW_CONFIG_PATH:-"$HOME/.openclaw/openclaw.director.json"}
state_dir=${OPENCLAW_STATE_DIR:-"$HOME/.openclaw-director-state"}
label=${OPENCLAW_GATEWAY_LABEL:-ai.openclaw.gateway}
uid=$(id -u)
launcher="$runtime_home/bin/custom-runtime-launcher.sh"
desired_plist="$runtime_home/ai.openclaw.gateway.desired.plist"
rollback_launcher=${OPENCLAW_CUSTOM_RUNTIME_ROLLBACK_LAUNCHER:-}
rollback_root="$runtime_home/rollbacks"
auth_helper=$(dirname "$0")/custom-runtime-auth.sh
[ -f "$auth_helper" ] || { printf '%s\n' 'custom runtime Gateway auth helper is missing' >&2; exit 64; }
. "$auth_helper"

usage() { printf '%s\n' 'usage: custom-runtime-promote.sh --release PATH --source-sha SHA [--port 18789] [--enable-sig-background]' >&2; exit 64; }
release= source_sha= port=18789 enable_sig_background=false
while [ $# -gt 0 ]; do
  case "$1" in
    --release) release=${2:-}; shift 2 ;;
    --source-sha) source_sha=${2:-}; shift 2 ;;
    --port) port=${2:-}; shift 2 ;;
    --enable-sig-background) enable_sig_background=true; shift ;;
    *) usage ;;
  esac
done
[ -n "$release" ] && [ -n "$source_sha" ] || usage
case "$source_sha" in *[!0-9a-fA-F]*|'') usage ;; esac
[ -d "$releases_dir" ] || { printf '%s\n' 'immutable releases root is missing' >&2; exit 64; }
releases_dir=$(cd "$releases_dir" && pwd -P)
release=$(cd "$release" && pwd -P)
case "$release" in "$releases_dir"/*) ;; *) printf '%s\n' 'release must be under the immutable releases root' >&2; exit 64 ;; esac
[ -f "$release/dist/index.js" ] || { printf '%s\n' 'release entrypoint is missing' >&2; exit 64; }
[ -f "$release/snapshot.json" ] || { printf '%s\n' 'release runtime provenance is missing' >&2; exit 64; }
manifest="$release/dist/control-ui/dashboard-surfaces.json"
[ -f "$manifest" ] || { printf '%s\n' 'release surface manifest is missing' >&2; exit 64; }
capability_manifest="$release/config/custom-runtime-capabilities.json"
[ -f "$capability_manifest" ] || { printf '%s\n' 'release capability manifest is missing' >&2; exit 64; }
stamp_file="$release/.openclaw-production-sha"
if [ -f "$stamp_file" ] && [ "$(tr -d '[:space:]' < "$stamp_file")" != "$source_sha" ]; then
  printf '%s\n' 'release source stamp conflicts with requested source SHA' >&2
  exit 64
fi
if [ ! -f "$stamp_file" ]; then
  (umask 077 && printf '%s\n' "$source_sha" > "$stamp_file")
fi
mkdir -p "$runtime_home/backups" "$runtime_home/receipts" "$runtime_home/locks"
promotion_lock="$runtime_home/locks/promotion.lock"
if ! mkdir "$promotion_lock" 2>/dev/null; then
  printf '%s\n' 'another custom-runtime promotion is already active' >&2
  exit 75
fi
rollback_bundle_tmp=
promotion_applied=false
promotion_committed=false
cleanup_promotion() {
  status=$?
  trap - EXIT INT TERM
  if [ "$status" -ne 0 ] && [ "$promotion_applied" = true ] && \
     [ "$promotion_committed" = false ]; then
    restore || status=1
  fi
  [ -z "$rollback_bundle_tmp" ] || rm -rf "$rollback_bundle_tmp" 2>/dev/null || true
  rmdir "$promotion_lock" 2>/dev/null || true
  exit "$status"
}
trap cleanup_promotion EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

timestamp=$(date -u +%Y%m%dT%H%M%SZ)
failure_receipt="$runtime_home/receipts/promotion-failure-$timestamp.json"
record_failure() {
  gate=$1
  detail=${2:-}
  python3 - "$failure_receipt" "$timestamp" "$gate" "$detail" "$release" "$source_sha" <<'PY'
import json
import os
import sys

target, at, gate, detail, release, source_sha = sys.argv[1:]
with open(target, "w", encoding="utf-8") as f:
    json.dump(
        {
            "at": at,
            "detail": detail,
            "gate": gate,
            "release": os.path.basename(release),
            "result": "promotion_gate_failed",
            "sourceSha": source_sha,
        },
        f,
        indent=2,
        sort_keys=True,
    )
    f.write("\n")
PY
}
previous_pointer="$runtime_home/active-runtime.json"
pointer_backup="$runtime_home/backups/active-runtime.$timestamp.json"
plist_backup="$runtime_home/backups/ai.openclaw.gateway.$timestamp.plist"
env_backup="$runtime_home/backups/ai.openclaw.gateway.$timestamp.env"
[ -f "$previous_pointer" ] && cp -p "$previous_pointer" "$pointer_backup" || :
cp -p "$plist" "$plist_backup"
cp -p "$env_file" "$env_backup"

rollback_bundle=
rollback_manifest_sha=
if [ -f "$pointer_backup" ]; then
  rollback_source_launcher=$launcher
  [ -z "$rollback_launcher" ] || rollback_source_launcher=$rollback_launcher
  [ -f "$rollback_source_launcher" ] || {
    printf '{"at":"%s","result":"rollback_preflight_launcher_missing"}\n' "$timestamp" > "$runtime_home/receipts/promotion-$timestamp.json"
    exit 1
  }
  if ! OPENCLAW_CUSTOM_RUNTIME_POINTER="$pointer_backup" \
    "$rollback_source_launcher" --verify >/dev/null 2>&1; then
    printf '{"at":"%s","result":"rollback_preflight_verify_failed"}\n' "$timestamp" > "$runtime_home/receipts/promotion-$timestamp.json"
    exit 1
  fi
  mkdir -p "$rollback_root"
  rollback_bundle_tmp="$rollback_root/.rollback-$timestamp-$$"
  rollback_bundle="$rollback_root/rollback-$timestamp-$$"
  mkdir -m 700 "$rollback_bundle_tmp"
  cp -p "$pointer_backup" "$rollback_bundle_tmp/active-runtime.json"
  cp -p "$plist_backup" "$rollback_bundle_tmp/ai.openclaw.gateway.plist"
  cp -p "$env_backup" "$rollback_bundle_tmp/ai.openclaw.gateway.env"
  cp -p "$rollback_source_launcher" "$rollback_bundle_tmp/custom-runtime-launcher.sh"
  python3 - "$rollback_bundle_tmp" "$release" "$source_sha" <<'PY'
import hashlib
import json
import os
import sys

bundle, release, source_sha = sys.argv[1:]
with open(os.path.join(bundle, "active-runtime.json"), encoding="utf-8") as f:
    previous = json.load(f)
with open(os.path.join(release, "snapshot.json"), encoding="utf-8") as f:
    snapshot = json.load(f)
files = {}
for name in (
    "active-runtime.json",
    "ai.openclaw.gateway.plist",
    "ai.openclaw.gateway.env",
    "custom-runtime-launcher.sh",
):
    with open(os.path.join(bundle, name), "rb") as f:
        files[name] = hashlib.sha256(f.read()).hexdigest()
manifest = {
    "version": 1,
    "candidateReleaseId": os.path.basename(release),
    "candidateRuntimeReleaseId": snapshot.get("releaseId"),
    "candidateSourceSha": source_sha,
    "rollbackReleaseId": previous.get("releaseId"),
    "rollbackRuntimeRoot": previous.get("runtimeRoot"),
    "files": files,
}
required = (
    manifest["candidateRuntimeReleaseId"],
    manifest["rollbackReleaseId"],
    manifest["rollbackRuntimeRoot"],
)
if not all(isinstance(value, str) and value for value in required):
    raise SystemExit("rollback manifest identity is incomplete")
with open(os.path.join(bundle, "manifest.json"), "w", encoding="utf-8") as f:
    json.dump(manifest, f, indent=2, sort_keys=True)
    f.write("\n")
PY
  rollback_manifest_sha=$(shasum -a 256 "$rollback_bundle_tmp/manifest.json" | awk '{print $1}')
  mv "$rollback_bundle_tmp" "$rollback_bundle"
  rollback_bundle_tmp=
fi

manifest_sha=$(shasum -a 256 "$manifest" | awk '{print $1}')
capability_manifest_sha=$(shasum -a 256 "$capability_manifest" | awk '{print $1}')
pointer_tmp="$runtime_home/active-runtime.$$.json"
python3 - "$pointer_tmp" "$release" "$source_sha" "$manifest" "$manifest_sha" "$capability_manifest" "$capability_manifest_sha" "$timestamp" <<'PY'
import json, os, sys
target, root, sha, manifest, manifest_sha, capability_manifest, capability_manifest_sha, promoted_at = sys.argv[1:]
previous = None
previous_required = []
previous_capabilities = []
active = os.path.join(os.path.dirname(target), "active-runtime.json")
if os.path.exists(active):
    with open(active, encoding="utf-8") as f: previous_data = json.load(f)
    previous = previous_data.get("releaseId")
    previous_required = previous_data.get("requiredSurfaces", [])
    if not isinstance(previous_required, list) or not all(isinstance(item, str) and item for item in previous_required):
        raise SystemExit("active runtime requiredSurfaces is invalid")
    has_capability_path = "capabilityManifestPath" in previous_data
    has_capability_hash = "capabilityManifestSha256" in previous_data
    has_required_capabilities = "requiredCapabilities" in previous_data
    if any((has_capability_path, has_capability_hash, has_required_capabilities)) and not all((has_capability_path, has_capability_hash, has_required_capabilities)):
        raise SystemExit("active runtime capability fields are partially populated")
    if has_required_capabilities:
        previous_capabilities = previous_data["requiredCapabilities"]
        if not isinstance(previous_capabilities, list) or not all(isinstance(item, str) and item for item in previous_capabilities):
            raise SystemExit("active runtime requiredCapabilities is invalid")
with open(os.path.join(root, "package.json"), encoding="utf-8") as f:
    version = json.load(f).get("version")
if not isinstance(version, str) or not version:
    raise SystemExit("release package version is missing")
with open(manifest, encoding="utf-8") as f:
    surface_manifest = json.load(f)
with open(capability_manifest, encoding="utf-8") as f:
    capability_data = json.load(f)
if capability_data.get("schema") != "openclaw.custom-runtime-capabilities.v1" or not isinstance(capability_data.get("version"), int) or capability_data["version"] < 1:
    raise SystemExit("release capability manifest schema is invalid")
raw_capabilities = capability_data.get("capabilities")
if not isinstance(raw_capabilities, list):
    raise SystemExit("release capability manifest entries are invalid")
surfaces = {
    item.get("id"): item for item in surface_manifest.get("surfaces", [])
    if isinstance(item, dict) and isinstance(item.get("id"), str) and item.get("id")
}
if not surfaces:
    raise SystemExit("release surface manifest is empty")
capabilities = {
    item.get("id"): item for item in raw_capabilities
    if isinstance(item, dict) and isinstance(item.get("id"), str) and item.get("id")
}
if not capabilities or len(capabilities) != len(raw_capabilities):
    raise SystemExit("release capability manifest is empty")
missing = [item for item in previous_required if item not in surfaces]
if missing:
    raise SystemExit("release removed required custom surfaces: " + ", ".join(missing))
missing_capabilities = [item for item in previous_capabilities if item not in capabilities]
if missing_capabilities:
    raise SystemExit("release removed required custom capabilities: " + ", ".join(missing_capabilities))
required = list(dict.fromkeys([*previous_required, *surfaces.keys()]))
required_capabilities = list(dict.fromkeys([*previous_capabilities, *capabilities.keys()]))
data = {"schemaVersion": 1, "releaseId": os.path.basename(root), "runtimeRoot": root,
        "entrypoint": os.path.join(root, "dist", "index.js"), "sourceSha": sha,
        "openclawVersion": version, "manifestPath": manifest,
        "manifestSha256": manifest_sha,
        "requiredSurfaces": required,
        "capabilityManifestPath": capability_manifest,
        "capabilityManifestSha256": capability_manifest_sha,
        "requiredCapabilities": required_capabilities,
        "previousRelease": previous, "promotedAt": promoted_at}
with open(target, "w", encoding="utf-8") as f: json.dump(data, f, indent=2, sort_keys=True); f.write("\n")
PY
if ! OPENCLAW_CUSTOM_RUNTIME_POINTER="$pointer_tmp" "$launcher" --verify >/dev/null; then
  rm -f "$pointer_tmp"
  printf '%s\n' 'release capability or surface verification failed before promotion' >&2
  exit 64
fi

restore() {
  [ -f "$pointer_backup" ] && cp -p "$pointer_backup" "$previous_pointer" || rm -f "$previous_pointer"
  cp -p "$plist_backup" "$plist"
  cp -p "$env_backup" "$env_file"
  cp -p "$plist" "$desired_plist"
  if [ -n "$rollback_launcher" ]; then
    if [ ! -f "$rollback_launcher" ]; then
      printf '{"at":"%s","result":"rollback_launcher_missing"}\n' "$timestamp" > "$runtime_home/receipts/promotion-$timestamp.json"
      return 1
    fi
    install -m 700 "$rollback_launcher" "$runtime_home/bin/.custom-runtime-launcher.sh.rollback-$$"
    mv "$runtime_home/bin/.custom-runtime-launcher.sh.rollback-$$" "$launcher"
  fi
  launchctl bootout "gui/$uid/$label" 2>/dev/null || true
  for _ in $(seq 1 15); do
    launchctl print "gui/$uid/$label" >/dev/null 2>&1 || break
    sleep 1
  done
  if ! launchctl bootstrap "gui/$uid" "$plist"; then
    printf '{"at":"%s","result":"rollback_bootstrap_failed"}\n' "$timestamp" > "$runtime_home/receipts/promotion-$timestamp.json"
    return 1
  fi
  rollback_ok=false
  for _ in $(seq 1 45); do
    if curl --silent --fail --max-time 3 "http://127.0.0.1:$port/health" | grep -q '"ok":true'; then
      rollback_ok=true
      break
    fi
    sleep 2
  done
  if [ "$rollback_ok" = true ] && "$launcher" --verify >/dev/null 2>&1; then
    promotion_applied=false
    printf '{"at":"%s","result":"rolled_back_verified"}\n' "$timestamp" > "$runtime_home/receipts/promotion-$timestamp.json"
  else
    printf '{"at":"%s","result":"rollback_health_failed"}\n' "$timestamp" > "$runtime_home/receipts/promotion-$timestamp.json"
    return 1
  fi
}

fail_promotion() {
  record_failure "$1" "${2:-}"
  restore || exit 1
  exit 1
}

promotion_applied=true
cp -p "$pointer_tmp" "$previous_pointer"
rm -f "$pointer_tmp"
python3 - "$env_file" "$launcher" "$release" "$enable_sig_background" <<'PY'
import os, shlex, stat, sys
path, launcher, release, enable_sig_background = sys.argv[1:]
mode = stat.S_IMODE(os.stat(path).st_mode)
with open(path, encoding="utf-8") as f:
    replaced = (
        "export OPENCLAW_WRAPPER=",
        "export OPENCLAW_RUNTIME_SNAPSHOT_ROOT=",
        "export OPENCLAW_BUNDLED_PLUGINS_DIR=",
    )
    if enable_sig_background == "true":
        replaced += ("export OPENCLAW_SELF_IMPROVEMENT_BACKGROUND=",)
    lines = [line for line in f.readlines() if not line.startswith(replaced)]
lines.append(f"export OPENCLAW_WRAPPER={shlex.quote(launcher)}\n")
lines.append(f"export OPENCLAW_RUNTIME_SNAPSHOT_ROOT={shlex.quote(release)}\n")
lines.append(
    f"export OPENCLAW_BUNDLED_PLUGINS_DIR={shlex.quote(os.path.join(release, 'dist-runtime', 'extensions'))}\n"
)
if enable_sig_background == "true":
    lines.append("export OPENCLAW_SELF_IMPROVEMENT_BACKGROUND=1\n")
with open(path + ".tmp", "w", encoding="utf-8") as f:
    f.writelines(lines)
os.chmod(path + ".tmp", mode)
PY
mv "$env_file.tmp" "$env_file"
python3 - "$plist" "$env_wrapper" "$env_file" "$launcher" "$port" <<'PY'
import plistlib, sys
path, wrapper, env_file, launcher, port = sys.argv[1:]
with open(path, "rb") as f: data = plistlib.load(f)
# Keep the generated environment wrapper as argv[0]. The launchd status audit
# recognizes this canonical shape, unwraps the real launcher, and reads PATH
# from the service environment file before checking runtime drift.
data["ProgramArguments"] = [wrapper, env_file, launcher, "gateway", "--port", port]
with open(path + ".tmp", "wb") as f: plistlib.dump(data, f, sort_keys=False)
PY
mv "$plist.tmp" "$plist"
cp -p "$plist" "$desired_plist"
launchctl bootout "gui/$uid/$label" 2>/dev/null || true
for _ in $(seq 1 15); do
  launchctl print "gui/$uid/$label" >/dev/null 2>&1 || break
  sleep 1
done
if ! launchctl bootstrap "gui/$uid" "$plist"; then
  fail_promotion bootstrap
fi

ok=false
for _ in $(seq 1 45); do
  if curl --silent --fail --max-time 3 "http://127.0.0.1:$port/health" | grep -q '"ok":true'; then ok=true; break; fi
  sleep 2
done
if [ "$ok" != true ]; then fail_promotion health; fi
if ! "$launcher" --verify >/dev/null 2>&1 || \
   ! pgrep -f "$release/dist/index.js gateway --port $port" >/dev/null 2>&1 || \
   ! grep -Fqx "export OPENCLAW_WRAPPER=$launcher" "$env_file" || \
   ! grep -Fqx "export OPENCLAW_RUNTIME_SNAPSHOT_ROOT=$release" "$env_file" || \
   ! grep -Fqx "export OPENCLAW_BUNDLED_PLUGINS_DIR=$release/dist-runtime/extensions" "$env_file"; then
  fail_promotion runtime_identity
fi
if [ "$enable_sig_background" = true ] && \
   ! grep -Fqx 'export OPENCLAW_SELF_IMPROVEMENT_BACKGROUND=1' "$env_file"; then
  fail_promotion sig_background_environment
fi
if ! routes=$(python3 - "$manifest" "$previous_pointer" <<'PY'
import json, sys
with open(sys.argv[1], encoding="utf-8") as f:
    manifest = json.load(f)
with open(sys.argv[2], encoding="utf-8") as f:
    pointer = json.load(f)
by_id = {item.get("id"): item for item in manifest.get("surfaces", []) if isinstance(item, dict)}
for surface_id in pointer["requiredSurfaces"]:
    surface = by_id[surface_id]
    values = [surface.get("path"), *surface.get("aliases", [])]
    for value in values:
        if isinstance(value, str) and value.startswith("/") and " " not in value:
            print(value.lstrip("/"))
PY
); then
  fail_promotion route_inventory
fi
for route in $routes self-improvement; do
  if [ "$(curl --silent --output /dev/null --write-out '%{http_code}' --max-time 3 "http://127.0.0.1:$port/$route")" != 200 ]; then
    fail_promotion route "$route"
  fi
done
websocket_headers="$runtime_home/websocket-promotion.$$.headers"
curl --silent --show-error --max-time 3 --dump-header "$websocket_headers" --output /dev/null \
  --http1.1 -H 'Connection: Upgrade' -H 'Upgrade: websocket' \
  -H 'Sec-WebSocket-Version: 13' -H 'Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==' \
  "http://127.0.0.1:$port/" >/dev/null 2>&1 || true
if ! grep -q '^HTTP/1.1 101 ' "$websocket_headers"; then
  rm -f "$websocket_headers"
  fail_promotion websocket
fi
rm -f "$websocket_headers"
self_improvement_summary="$runtime_home/self-improvement-promotion.$$.json"
if ! custom_runtime_export_gateway_auth "$config_path"; then
  rm -f "$self_improvement_summary"
  fail_promotion self_improvement_auth
fi
if ! OPENAI_API_KEY= AZURE_OPENAI_API_KEY= OPENAI_BASE_URL= \
  OPENCLAW_GATEWAY_URL="ws://127.0.0.1:$port" \
  OPENCLAW_CONFIG_PATH="$config_path" OPENCLAW_STATE_DIR="$state_dir" \
  OPENCLAW_SKIP_CHANNELS=1 OPENCLAW_SKIP_CRON=1 \
  OPENCLAW_SELF_IMPROVEMENT_BACKGROUND=0 \
  OPENCLAW_CUSTOM_RUNTIME_POINTER="$previous_pointer" \
  "$launcher" self-improvement summary \
  --timeout 10000 --limit 1 --json \
  > "$self_improvement_summary"; then
  rm -f "$self_improvement_summary"
  fail_promotion self_improvement_rpc
fi
if ! python3 - "$self_improvement_summary" <<'PY'
import json, sys

with open(sys.argv[1], encoding="utf-8") as f:
    summary = json.load(f)
if not isinstance(summary, dict) or not isinstance(summary.get("scorecard"), dict):
    raise SystemExit("Self-Improvement summary contract failed")
if not isinstance(summary.get("groups"), list):
    raise SystemExit("Self-Improvement groups contract failed")
PY
then
  rm -f "$self_improvement_summary"
  fail_promotion self_improvement_contract
fi
rm -f "$self_improvement_summary"
if [ -n "$rollback_bundle" ]; then
  cp -p "$pointer_backup" "$runtime_home/last-known-good.json"
  rollback_pointer_tmp="$runtime_home/active-rollback.$$.json"
  python3 - "$rollback_pointer_tmp" "$rollback_bundle" "$rollback_manifest_sha" <<'PY'
import json
import os
import sys

target, bundle, manifest_sha = sys.argv[1:]
with open(os.path.join(bundle, "manifest.json"), encoding="utf-8") as f:
    manifest = json.load(f)
with open(target, "w", encoding="utf-8") as f:
    json.dump(
        {
            "version": 1,
            "bundle": bundle,
            "manifestSha256": manifest_sha,
            "candidateReleaseId": manifest["candidateReleaseId"],
            "candidateRuntimeReleaseId": manifest["candidateRuntimeReleaseId"],
            "rollbackReleaseId": manifest["rollbackReleaseId"],
        },
        f,
        indent=2,
        sort_keys=True,
    )
    f.write("\n")
PY
  mv "$rollback_pointer_tmp" "$runtime_home/active-rollback.json"
fi
printf '{"at":"%s","result":"promoted","release":"%s","sourceSha":"%s","sigBackgroundEnabled":%s}\n' "$timestamp" "$(basename "$release")" "$source_sha" "$enable_sig_background" > "$runtime_home/receipts/promotion-$timestamp.json"
printf '%s\n' "CUSTOM_RUNTIME_PROMOTED release=$(basename "$release")"
promotion_committed=true
