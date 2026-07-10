#!/bin/sh
# Launch only a verified immutable PCC runtime described by active-runtime.json.
set -eu

runtime_home=${OPENCLAW_CUSTOM_RUNTIME_HOME:-"$HOME/.openclaw-custom-runtime"}
pointer=${OPENCLAW_CUSTOM_RUNTIME_POINTER:-"$runtime_home/active-runtime.json"}
node_bin=${OPENCLAW_NODE_BIN:-/opt/homebrew/opt/node/bin/node}
required_surfaces='pcc app-studio music-studio snes-studio book-writer kalshi pattern-lab'

fail() { printf '%s\n' "custom-runtime-launcher: $*" >&2; exit 64; }
[ -f "$pointer" ] || fail "missing active runtime pointer"

fields=$(python3 - "$pointer" <<'PY'
import json, os, sys
p = os.path.realpath(sys.argv[1])
with open(p, encoding="utf-8") as f: data = json.load(f)
for key in ("runtimeRoot", "entrypoint", "sourceSha", "manifestPath", "manifestSha256"):
    value = data.get(key)
    if not isinstance(value, str) or not value:
        raise SystemExit(f"pointer field missing: {key}")
    print(value)
PY
) || fail "invalid runtime pointer"
runtime_root=$(printf '%s\n' "$fields" | sed -n '1p')
entrypoint=$(printf '%s\n' "$fields" | sed -n '2p')
source_sha=$(printf '%s\n' "$fields" | sed -n '3p')
manifest=$(printf '%s\n' "$fields" | sed -n '4p')
manifest_sha=$(printf '%s\n' "$fields" | sed -n '5p')

case "$runtime_root" in
  "$HOME"/.openclaw-runtime-releases/*) ;;
  *) fail "runtime root is not an immutable release" ;;
esac
case "$runtime_root" in *'/tmp/'*|*'/private/tmp/'*|*'/.worktrees/'*|*'/.npm-global/'*) fail "runtime root is mutable or forbidden" ;; esac
[ "$entrypoint" = "$runtime_root/dist/index.js" ] || fail "entrypoint is outside runtime root"
[ "$manifest" = "$runtime_root/dist/control-ui/dashboard-surfaces.json" ] || fail "manifest is outside runtime root"
[ -x "$node_bin" ] || fail "node executable unavailable"
[ -f "$entrypoint" ] || fail "gateway entrypoint missing"
[ -f "$manifest" ] || fail "surface manifest missing"
[ -f "$runtime_root/.openclaw-production-sha" ] || fail "release source stamp missing"
[ "$(tr -d '[:space:]' < "$runtime_root/.openclaw-production-sha")" = "$source_sha" ] || fail "source stamp mismatch"
[ "$(shasum -a 256 "$manifest" | awk '{print $1}')" = "$manifest_sha" ] || fail "surface manifest hash mismatch"

for surface in $required_surfaces; do
  python3 - "$manifest" "$runtime_root/dist/control-ui" "$surface" <<'PY'
import json, os, sys
manifest, root, required = sys.argv[1:]
with open(manifest, encoding="utf-8") as f: data = json.load(f)
for surface in data.get("surfaces", []):
    if surface.get("id") != required: continue
    assets = surface.get("assets")
    if not isinstance(assets, list) or not assets:
        raise SystemExit(1)
    if all(isinstance(a, str) and os.path.isfile(os.path.join(root, a)) for a in assets):
        raise SystemExit(0)
raise SystemExit(1)
PY
  [ $? -eq 0 ] || fail "surface contract failed: $surface"
done

if [ "${1:-}" = "--verify" ]; then
  printf '%s\n' "CUSTOM_RUNTIME_OK sha=$source_sha"
  exit 0
fi
exec "$node_bin" "$entrypoint" "$@"
