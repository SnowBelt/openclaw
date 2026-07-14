#!/bin/sh
# Starts a release against copied state on port 18790 before it can be promoted.
set -eu

runtime_home=${OPENCLAW_CUSTOM_RUNTIME_HOME:-"$HOME/.openclaw-custom-runtime"}
config_source=${OPENCLAW_CONFIG_PATH:-"$HOME/.openclaw/openclaw.director.json"}
state_source=${OPENCLAW_STATE_DIR:-"$HOME/.openclaw-director-state"}
node_bin=${OPENCLAW_NODE_BIN:-/opt/homebrew/opt/node/bin/node}
provider=${OPENCLAW_SECRET_PROVIDER:-"$HOME/.openclaw/bin/patternlab-keychain-secret-provider"}
launcher="$runtime_home/bin/custom-runtime-launcher.sh"

usage() { printf '%s\n' 'usage: custom-runtime-stage.sh --release PATH --source-sha SHA [--port 18790]' >&2; exit 64; }
release= source_sha= port=18790
while [ $# -gt 0 ]; do
  case "$1" in
    --release) release=${2:-}; shift 2 ;;
    --source-sha) source_sha=${2:-}; shift 2 ;;
    --port) port=${2:-}; shift 2 ;;
    *) usage ;;
  esac
done
[ -n "$release" ] && [ -n "$source_sha" ] || usage
[ -f "$release/dist/index.js" ] || usage
capability_manifest="$release/config/custom-runtime-capabilities.json"
[ -f "$capability_manifest" ] || { printf '%s\n' 'candidate capability manifest is missing' >&2; exit 64; }

# A missing Keychain value is a hard stop. It is never replaced by a file value.
printf '%s' '{"ids":["discord/bot-token"]}' | "$provider" | python3 -c 'import json,sys; d=json.load(sys.stdin); raise SystemExit(0 if d.get("values",{}).get("discord/bot-token") else 1)' 2>/dev/null || {
  printf '%s\n' 'candidate stage blocked: Keychain secret provider is unavailable' >&2; exit 75;
}
stage=$(mktemp -d "$runtime_home/stage.XXXXXX")
pid=
cleanup() { [ -n "$pid" ] && kill "$pid" 2>/dev/null || true; rm -rf "$stage"; }
trap cleanup EXIT INT TERM
cp -p "$config_source" "$stage/openclaw.director.json"
mkdir -p "$stage/state"
rsync -a --exclude 'logs' --exclude 'tmp' "$state_source/" "$stage/state/"

# Custom extensions that own dashboard RPCs must remain enabled in copied state.
python3 - "$stage/openclaw.director.json" "$capability_manifest" <<'PY'
import json, sys
with open(sys.argv[1], encoding="utf-8") as f:
    config = json.load(f)
with open(sys.argv[2], encoding="utf-8") as f:
    manifest = json.load(f)
plugins = config.get("plugins", {})
allowed = plugins.get("allow", [])
entries = plugins.get("entries", {})
required_plugins = [
    item.get("pluginId") for item in manifest.get("capabilities", [])
    if isinstance(item, dict) and item.get("kind") == "plugin"
]
if not required_plugins or not all(isinstance(item, str) and item for item in required_plugins):
    raise SystemExit("candidate capability manifest has no valid required plugins")
for plugin_id in required_plugins:
    if plugin_id not in allowed or entries.get(plugin_id, {}).get("enabled") is not True:
        raise SystemExit(f"required dashboard plugin unavailable: {plugin_id}")
PY

# Reuse the launcher's verification logic with a private staging pointer.
manifest="$release/dist/control-ui/dashboard-surfaces.json"
manifest_sha=$(shasum -a 256 "$manifest" | awk '{print $1}')
capability_manifest_sha=$(shasum -a 256 "$capability_manifest" | awk '{print $1}')
printf '%s\n' "$source_sha" > "$release/.openclaw-production-sha"
python3 - "$stage/pointer.json" "$release" "$source_sha" "$manifest" "$manifest_sha" "$capability_manifest" "$capability_manifest_sha" "$runtime_home/active-runtime.json" <<'PY'
import json, os, sys
target, root, sha, manifest, manifest_sha, capability_manifest, capability_manifest_sha, active = sys.argv[1:]
with open(manifest, encoding="utf-8") as f:
    candidate = json.load(f)
with open(capability_manifest, encoding="utf-8") as f:
    capability_data = json.load(f)
if capability_data.get("schema") != "openclaw.custom-runtime-capabilities.v1" or not isinstance(capability_data.get("version"), int) or capability_data["version"] < 1:
    raise SystemExit("candidate capability manifest schema is invalid")
raw_capabilities = capability_data.get("capabilities")
if not isinstance(raw_capabilities, list):
    raise SystemExit("candidate capability manifest entries are invalid")
surfaces = {
    item.get("id"): item for item in candidate.get("surfaces", [])
    if isinstance(item, dict) and isinstance(item.get("id"), str) and item.get("id")
}
if not surfaces:
    raise SystemExit("candidate surface manifest is empty")
capabilities = {
    item.get("id"): item for item in raw_capabilities
    if isinstance(item, dict) and isinstance(item.get("id"), str) and item.get("id")
}
if not capabilities or len(capabilities) != len(raw_capabilities):
    raise SystemExit("candidate capability manifest is empty")
previous = []
previous_capabilities = []
if os.path.exists(active):
    with open(active, encoding="utf-8") as f:
        previous_data = json.load(f)
    previous = previous_data.get("requiredSurfaces", [])
    if not isinstance(previous, list) or not all(isinstance(item, str) and item for item in previous):
        raise SystemExit("active runtime requiredSurfaces is invalid")
    previous_capabilities = previous_data.get("requiredCapabilities", [])
    if not isinstance(previous_capabilities, list) or not all(isinstance(item, str) and item for item in previous_capabilities):
        raise SystemExit("active runtime requiredCapabilities is invalid")
missing = [item for item in previous if item not in surfaces]
if missing:
    raise SystemExit("candidate removed required custom surfaces: " + ", ".join(missing))
missing_capabilities = [item for item in previous_capabilities if item not in capabilities]
if missing_capabilities:
    raise SystemExit("candidate removed required custom capabilities: " + ", ".join(missing_capabilities))
required = list(dict.fromkeys([*previous, *surfaces.keys()]))
required_capabilities = list(dict.fromkeys([*previous_capabilities, *capabilities.keys()]))
with open(target, "w", encoding="utf-8") as f:
    json.dump({"runtimeRoot": root, "entrypoint": root + "/dist/index.js", "sourceSha": sha,
               "manifestPath": manifest, "manifestSha256": manifest_sha,
               "requiredSurfaces": required,
               "capabilityManifestPath": capability_manifest,
               "capabilityManifestSha256": capability_manifest_sha,
               "requiredCapabilities": required_capabilities}, f, sort_keys=True)
PY
OPENCLAW_CUSTOM_RUNTIME_POINTER="$stage/pointer.json" "$launcher" --verify >/dev/null
OPENCLAW_CONFIG_PATH="$stage/openclaw.director.json" OPENCLAW_STATE_DIR="$stage/state" \
  "$node_bin" "$release/dist/index.js" gateway --port "$port" >"$stage/gateway.log" 2>&1 &
pid=$!
for _ in $(seq 1 45); do
  if curl --silent --fail --max-time 3 "http://127.0.0.1:$port/health" | grep -q '"ok":true'; then
    routes=$(python3 - "$manifest" "$stage/pointer.json" <<'PY'
import json, sys
with open(sys.argv[1], encoding="utf-8") as f: manifest = json.load(f)
with open(sys.argv[2], encoding="utf-8") as f: pointer = json.load(f)
by_id = {item.get("id"): item for item in manifest.get("surfaces", []) if isinstance(item, dict)}
for surface_id in pointer["requiredSurfaces"]:
    surface = by_id[surface_id]
    values = [surface.get("path"), *surface.get("aliases", [])]
    for value in values:
        if isinstance(value, str) and value.startswith("/") and " " not in value:
            print(value.lstrip("/"))
PY
)
    for route in $routes; do
      [ "$(curl --silent --output /dev/null --write-out '%{http_code}' --max-time 3 "http://127.0.0.1:$port/$route")" = 200 ] || {
        printf '%s\n' "candidate stage route failed: $route" >&2
        exit 1
      }
    done
    curl --silent --show-error --max-time 3 --dump-header "$stage/websocket.headers" --output /dev/null \
      --http1.1 -H 'Connection: Upgrade' -H 'Upgrade: websocket' \
      -H 'Sec-WebSocket-Version: 13' -H 'Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==' \
      "http://127.0.0.1:$port/" >/dev/null 2>&1 || true
    grep -q '^HTTP/1.1 101 ' "$stage/websocket.headers" || {
      printf '%s\n' 'candidate stage WebSocket upgrade failed' >&2
      exit 1
    }
    printf '%s\n' "CUSTOM_RUNTIME_STAGE_OK release=$(basename "$release")"
    exit 0
  fi
  sleep 2
done
sed -E 's/(token|password|secret|key)=[^[:space:]]+/\1=[REDACTED]/Ig' "$stage/gateway.log" >&2 || true
exit 1
