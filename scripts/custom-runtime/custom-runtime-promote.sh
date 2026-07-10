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
release=$(cd "$release" && pwd -P)
case "$release" in "$releases_dir"/*) ;; *) printf '%s\n' 'release must be under the immutable releases root' >&2; exit 64 ;; esac
[ -f "$release/dist/index.js" ] || { printf '%s\n' 'release entrypoint is missing' >&2; exit 64; }
manifest="$release/dist/control-ui/dashboard-surfaces.json"
[ -f "$manifest" ] || { printf '%s\n' 'release surface manifest is missing' >&2; exit 64; }
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
[ -f "$previous_pointer" ] && cp -p "$previous_pointer" "$pointer_backup" || :
cp -p "$plist" "$plist_backup"

manifest_sha=$(shasum -a 256 "$manifest" | awk '{print $1}')
pointer_tmp="$runtime_home/active-runtime.$$.json"
python3 - "$pointer_tmp" "$release" "$source_sha" "$manifest" "$manifest_sha" "$timestamp" <<'PY'
import json, os, sys
target, root, sha, manifest, manifest_sha, promoted_at = sys.argv[1:]
previous = None
active = os.path.join(os.path.dirname(target), "active-runtime.json")
if os.path.exists(active):
    with open(active, encoding="utf-8") as f: previous = json.load(f).get("releaseId")
data = {"schemaVersion": 1, "releaseId": os.path.basename(root), "runtimeRoot": root,
        "entrypoint": os.path.join(root, "dist", "index.js"), "sourceSha": sha,
        "openclawVersion": "2026.6.11", "manifestPath": manifest,
        "manifestSha256": manifest_sha,
        "requiredSurfaces": ["pcc", "app-studio", "music-studio", "snes-studio", "book-writer", "kalshi", "pattern-lab"],
        "previousRelease": previous, "promotedAt": promoted_at}
with open(target, "w", encoding="utf-8") as f: json.dump(data, f, indent=2, sort_keys=True); f.write("\n")
PY

restore() {
  [ -f "$pointer_backup" ] && cp -p "$pointer_backup" "$previous_pointer" || rm -f "$previous_pointer"
  cp -p "$plist_backup" "$plist"
  launchctl bootout "gui/$uid/$label" 2>/dev/null || true
  launchctl bootstrap "gui/$uid" "$plist" 2>/dev/null || true
  printf '{"at":"%s","result":"rolled_back"}\n' "$timestamp" > "$runtime_home/receipts/promotion-$timestamp.json"
}

cp -p "$pointer_tmp" "$previous_pointer"
rm -f "$pointer_tmp"
python3 - "$plist" "$env_wrapper" "$env_file" "$launcher" "$port" <<'PY'
import plistlib, sys
path, wrapper, env_file, launcher, port = sys.argv[1:]
with open(path, "rb") as f: data = plistlib.load(f)
data["ProgramArguments"] = ["/bin/sh", wrapper, env_file, launcher, "gateway", "--port", port]
with open(path + ".tmp", "wb") as f: plistlib.dump(data, f, sort_keys=False)
PY
mv "$plist.tmp" "$plist"
launchctl bootout "gui/$uid/$label" 2>/dev/null || true
launchctl bootstrap "gui/$uid" "$plist"

ok=false
for _ in $(seq 1 45); do
  if curl --silent --fail --max-time 3 "http://127.0.0.1:$port/health" | grep -q '"ok":true'; then ok=true; break; fi
  sleep 2
done
if [ "$ok" != true ]; then restore; exit 1; fi
cp -p "$previous_pointer" "$runtime_home/last-known-good.json"
printf '{"at":"%s","result":"promoted","release":"%s","sourceSha":"%s"}\n' "$timestamp" "$(basename "$release")" "$source_sha" > "$runtime_home/receipts/promotion-$timestamp.json"
printf '%s\n' "CUSTOM_RUNTIME_PROMOTED release=$(basename "$release")"
