#!/bin/sh
# Atomically select a verified release and restart launchd, rolling back on failure.
set -eu

runtime_home=${OPENCLAW_CUSTOM_RUNTIME_HOME:-"$HOME/.openclaw-custom-runtime"}
releases_dir=${OPENCLAW_CUSTOM_RUNTIME_RELEASES:-"$HOME/.openclaw-runtime-releases"}
plist=${OPENCLAW_GATEWAY_PLIST:-"$HOME/Library/LaunchAgents/ai.openclaw.gateway.plist"}
env_wrapper=${OPENCLAW_GATEWAY_ENV_WRAPPER:-"$HOME/.openclaw-director-state/service-env/ai.openclaw.gateway-env-wrapper.sh"}
env_file=${OPENCLAW_GATEWAY_ENV_FILE:-"$HOME/.openclaw-director-state/service-env/ai.openclaw.gateway.env"}
label=${OPENCLAW_GATEWAY_LABEL:-ai.openclaw.gateway}
uid=$(id -u)
launcher="$runtime_home/bin/custom-runtime-launcher.sh"

usage() { printf '%s\n' 'usage: custom-runtime-promote.sh --release PATH --source-sha SHA [--port 18789]' >&2; exit 64; }
release= source_sha= port=18789
while [ $# -gt 0 ]; do
  case "$1" in
    --release) release=${2:-}; shift 2 ;;
    --source-sha) source_sha=${2:-}; shift 2 ;;
    --port) port=${2:-}; shift 2 ;;
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
mkdir -p "$runtime_home/backups" "$runtime_home/receipts"

timestamp=$(date -u +%Y%m%dT%H%M%SZ)
previous_pointer="$runtime_home/active-runtime.json"
pointer_backup="$runtime_home/backups/active-runtime.$timestamp.json"
plist_backup="$runtime_home/backups/ai.openclaw.gateway.$timestamp.plist"
env_backup="$runtime_home/backups/ai.openclaw.gateway.$timestamp.env"
[ -f "$previous_pointer" ] && cp -p "$previous_pointer" "$pointer_backup" || :
cp -p "$plist" "$plist_backup"
cp -p "$env_file" "$env_backup"

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
    previous_capabilities = previous_data.get("requiredCapabilities", [])
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
  launchctl bootout "gui/$uid/$label" 2>/dev/null || true
  for _ in $(seq 1 15); do
    launchctl print "gui/$uid/$label" >/dev/null 2>&1 || break
    sleep 1
  done
  if launchctl bootstrap "gui/$uid" "$plist"; then
    printf '{"at":"%s","result":"rolled_back"}\n' "$timestamp" > "$runtime_home/receipts/promotion-$timestamp.json"
  else
    printf '{"at":"%s","result":"rollback_bootstrap_failed"}\n' "$timestamp" > "$runtime_home/receipts/promotion-$timestamp.json"
  fi
}

cp -p "$pointer_tmp" "$previous_pointer"
rm -f "$pointer_tmp"
python3 - "$env_file" "$launcher" <<'PY'
import os, shlex, stat, sys
path, launcher = sys.argv[1:]
mode = stat.S_IMODE(os.stat(path).st_mode)
with open(path, encoding="utf-8") as f:
    lines = [line for line in f.readlines() if not line.startswith("export OPENCLAW_WRAPPER=")]
lines.append(f"export OPENCLAW_WRAPPER={shlex.quote(launcher)}\n")
with open(path + ".tmp", "w", encoding="utf-8") as f:
    f.writelines(lines)
os.chmod(path + ".tmp", mode)
PY
mv "$env_file.tmp" "$env_file"
python3 - "$plist" "$env_wrapper" "$env_file" "$launcher" "$port" <<'PY'
import plistlib, sys
path, wrapper, env_file, launcher, port = sys.argv[1:]
with open(path, "rb") as f: data = plistlib.load(f)
data["ProgramArguments"] = ["/bin/sh", wrapper, env_file, launcher, "gateway", "--port", port]
with open(path + ".tmp", "wb") as f: plistlib.dump(data, f, sort_keys=False)
PY
mv "$plist.tmp" "$plist"
cp -p "$plist" "$runtime_home/ai.openclaw.gateway.desired.plist"
launchctl bootout "gui/$uid/$label" 2>/dev/null || true
for _ in $(seq 1 15); do
  launchctl print "gui/$uid/$label" >/dev/null 2>&1 || break
  sleep 1
done
if ! launchctl bootstrap "gui/$uid" "$plist"; then
  restore
  exit 1
fi

ok=false
for _ in $(seq 1 45); do
  if curl --silent --fail --max-time 3 "http://127.0.0.1:$port/health" | grep -q '"ok":true'; then ok=true; break; fi
  sleep 2
done
if [ "$ok" != true ]; then restore; exit 1; fi
if ! "$launcher" --verify >/dev/null 2>&1 || \
   ! pgrep -f "$release/dist/index.js gateway --port $port" >/dev/null 2>&1 || \
   ! grep -q '^export OPENCLAW_WRAPPER=' "$env_file"; then
  restore
  exit 1
fi
cp -p "$previous_pointer" "$runtime_home/last-known-good.json"
printf '{"at":"%s","result":"promoted","release":"%s","sourceSha":"%s"}\n' "$timestamp" "$(basename "$release")" "$source_sha" > "$runtime_home/receipts/promotion-$timestamp.json"
printf '%s\n' "CUSTOM_RUNTIME_PROMOTED release=$(basename "$release")"
