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
python3 - "$stage/openclaw.director.json" <<'PY'
import json, sys
with open(sys.argv[1], encoding="utf-8") as f:
    config = json.load(f)
plugins = config.get("plugins", {})
allowed = plugins.get("allow", [])
entries = plugins.get("entries", {})
for plugin_id in ("apps", "book-writer"):
    if plugin_id not in allowed or entries.get(plugin_id, {}).get("enabled") is not True:
        raise SystemExit(f"required dashboard plugin unavailable: {plugin_id}")
PY

# Reuse the launcher's verification logic with a private staging pointer.
manifest="$release/dist/control-ui/dashboard-surfaces.json"
manifest_sha=$(shasum -a 256 "$manifest" | awk '{print $1}')
printf '%s\n' "$source_sha" > "$release/.openclaw-production-sha"
python3 - "$stage/pointer.json" "$release" "$source_sha" "$manifest" "$manifest_sha" <<'PY'
import json, os, sys
target, root, sha, manifest, manifest_sha = sys.argv[1:]
json.dump({"runtimeRoot": root, "entrypoint": root + "/dist/index.js", "sourceSha": sha,
           "manifestPath": manifest, "manifestSha256": manifest_sha}, open(target, "w"), sort_keys=True)
PY
OPENCLAW_CUSTOM_RUNTIME_POINTER="$stage/pointer.json" "$launcher" --verify >/dev/null
OPENCLAW_CONFIG_PATH="$stage/openclaw.director.json" OPENCLAW_STATE_DIR="$stage/state" \
  "$node_bin" "$release/dist/index.js" gateway --port "$port" >"$stage/gateway.log" 2>&1 &
pid=$!
for _ in $(seq 1 45); do
  if curl --silent --fail --max-time 3 "http://127.0.0.1:$port/health" | grep -q '"ok":true'; then
    for route in pcc projects app-studio music-studio snes-studio book-writer kalshi pattern-lab; do
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
