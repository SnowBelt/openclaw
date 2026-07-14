#!/bin/sh
# Launch only a verified immutable PCC runtime described by active-runtime.json.
set -eu

runtime_home=${OPENCLAW_CUSTOM_RUNTIME_HOME:-"$HOME/.openclaw-custom-runtime"}
releases_dir=${OPENCLAW_CUSTOM_RUNTIME_RELEASES:-"$HOME/.openclaw-runtime-releases"}
pointer=${OPENCLAW_CUSTOM_RUNTIME_POINTER:-"$runtime_home/active-runtime.json"}
node_bin=${OPENCLAW_NODE_BIN:-/opt/homebrew/opt/node/bin/node}

fail() { printf '%s\n' "custom-runtime-launcher: $*" >&2; exit 64; }
[ -d "$releases_dir" ] || fail "immutable releases root is missing"
releases_dir=$(cd "$releases_dir" && pwd -P)
[ -f "$pointer" ] || fail "missing active runtime pointer"

fields=$(python3 - "$pointer" <<'PY'
import json, os, sys
p = os.path.realpath(sys.argv[1])
with open(p, encoding="utf-8") as f: data = json.load(f)
path_keys = {"runtimeRoot", "entrypoint", "manifestPath", "capabilityManifestPath"}
for key in ("runtimeRoot", "entrypoint", "sourceSha", "manifestPath", "manifestSha256",
            "capabilityManifestPath", "capabilityManifestSha256"):
    value = data.get(key)
    if not isinstance(value, str) or not value:
        raise SystemExit(f"pointer field missing: {key}")
    print(os.path.realpath(value) if key in path_keys else value)
required = data.get("requiredSurfaces")
if not isinstance(required, list) or not required or not all(isinstance(item, str) and item and not any(c.isspace() for c in item) for item in required):
    raise SystemExit("pointer field missing: requiredSurfaces")
if len(required) != len(set(required)):
    raise SystemExit("pointer requiredSurfaces contains duplicates")
print(" ".join(required))
required_capabilities = data.get("requiredCapabilities")
if not isinstance(required_capabilities, list) or not required_capabilities or not all(isinstance(item, str) and item and not any(c.isspace() for c in item) for item in required_capabilities):
    raise SystemExit("pointer field missing: requiredCapabilities")
if len(required_capabilities) != len(set(required_capabilities)):
    raise SystemExit("pointer requiredCapabilities contains duplicates")
print(" ".join(required_capabilities))
PY
) || fail "invalid runtime pointer"
runtime_root=$(printf '%s\n' "$fields" | sed -n '1p')
entrypoint=$(printf '%s\n' "$fields" | sed -n '2p')
source_sha=$(printf '%s\n' "$fields" | sed -n '3p')
manifest=$(printf '%s\n' "$fields" | sed -n '4p')
manifest_sha=$(printf '%s\n' "$fields" | sed -n '5p')
capability_manifest=$(printf '%s\n' "$fields" | sed -n '6p')
capability_manifest_sha=$(printf '%s\n' "$fields" | sed -n '7p')
required_surfaces=$(printf '%s\n' "$fields" | sed -n '8p')
required_capabilities=$(printf '%s\n' "$fields" | sed -n '9p')

case "$runtime_root" in
  "$releases_dir"/*) ;;
  *) fail "runtime root is not an immutable release" ;;
esac
case "$runtime_root" in *'/tmp/'*|*'/private/tmp/'*|*'/.worktrees/'*|*'/.npm-global/'*) fail "runtime root is mutable or forbidden" ;; esac
[ "$entrypoint" = "$runtime_root/dist/index.js" ] || fail "entrypoint is outside runtime root"
[ "$manifest" = "$runtime_root/dist/control-ui/dashboard-surfaces.json" ] || fail "manifest is outside runtime root"
[ "$capability_manifest" = "$runtime_root/config/custom-runtime-capabilities.json" ] || fail "capability manifest is outside runtime root"
[ -x "$node_bin" ] || fail "node executable unavailable"
[ -f "$entrypoint" ] || fail "gateway entrypoint missing"
[ -f "$manifest" ] || fail "surface manifest missing"
[ -f "$capability_manifest" ] || fail "capability manifest missing"
[ -f "$runtime_root/.openclaw-production-sha" ] || fail "release source stamp missing"
[ "$(tr -d '[:space:]' < "$runtime_root/.openclaw-production-sha")" = "$source_sha" ] || fail "source stamp mismatch"
[ "$(shasum -a 256 "$manifest" | awk '{print $1}')" = "$manifest_sha" ] || fail "surface manifest hash mismatch"
[ "$(shasum -a 256 "$capability_manifest" | awk '{print $1}')" = "$capability_manifest_sha" ] || fail "capability manifest hash mismatch"

for capability in $required_capabilities; do
  if ! python3 - "$capability_manifest" "$runtime_root" "$manifest" "$capability" <<'PY'
import json, os, posixpath, sys
capability_manifest, root, surface_manifest, required = sys.argv[1:]
with open(capability_manifest, encoding="utf-8") as f: data = json.load(f)
if data.get("schema") != "openclaw.custom-runtime-capabilities.v1" or not isinstance(data.get("version"), int) or data["version"] < 1:
    raise SystemExit(1)
capabilities = data.get("capabilities")
if not isinstance(capabilities, list):
    raise SystemExit(1)
matches = [item for item in capabilities if isinstance(item, dict) and item.get("id") == required]
if len(matches) != 1:
    raise SystemExit(1)
item = matches[0]
if item.get("kind") not in ("dashboard_surface", "plugin", "workflow", "runtime"):
    raise SystemExit(1)
paths = item.get("requiredPaths")
if not isinstance(paths, list) or not paths:
    raise SystemExit(1)
for value in paths:
    if not isinstance(value, str) or not value or os.path.isabs(value):
        raise SystemExit(1)
    normalized = posixpath.normpath(value.replace("\\", "/"))
    if normalized != value or normalized == ".." or normalized.startswith("../"):
        raise SystemExit(1)
    if not os.path.isfile(os.path.join(root, value)):
        raise SystemExit(1)
if item.get("kind") == "dashboard_surface":
    surface_id = item.get("surfaceId")
    if not isinstance(surface_id, str) or not surface_id:
        raise SystemExit(1)
    with open(surface_manifest, encoding="utf-8") as f: surfaces = json.load(f).get("surfaces", [])
    if not any(isinstance(surface, dict) and surface.get("id") == surface_id for surface in surfaces):
        raise SystemExit(1)
if item.get("kind") == "plugin" and (not isinstance(item.get("pluginId"), str) or not item.get("pluginId")):
    raise SystemExit(1)
raise SystemExit(0)
PY
  then
    fail "capability contract failed: $capability"
  fi
done

for surface in $required_surfaces; do
  if ! python3 - "$manifest" "$runtime_root/dist/control-ui" "$surface" <<'PY'
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
  then
    fail "surface contract failed: $surface"
  fi
done

if [ "${1:-}" = "--verify" ]; then
  printf '%s\n' "CUSTOM_RUNTIME_OK sha=$source_sha"
  exit 0
fi
exec "$node_bin" "$entrypoint" "$@"
