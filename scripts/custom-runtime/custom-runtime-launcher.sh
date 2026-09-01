#!/bin/sh
# Launch only a verified immutable PCC runtime described by active-runtime.json.
set -eu

runtime_home=${OPENCLAW_CUSTOM_RUNTIME_HOME:-"$HOME/.openclaw-custom-runtime"}
trusted_provenance_helper=${OPENCLAW_TRUSTED_SOURCE_PROVENANCE_HELPER:-"$runtime_home/bin/custom-runtime-source-provenance.mjs"}
releases_dir=${OPENCLAW_CUSTOM_RUNTIME_RELEASES:-"$HOME/.openclaw-runtime-releases"}
pointer=${OPENCLAW_CUSTOM_RUNTIME_POINTER:-"$runtime_home/active-runtime.json"}
if [ -n "${OPENCLAW_NODE_BIN:-}" ]; then
  node_bin=$OPENCLAW_NODE_BIN
elif [ -x "$runtime_home/toolchains/node-current/bin/node" ]; then
  node_bin="$runtime_home/toolchains/node-current/bin/node"
else
  node_bin=/opt/homebrew/opt/node/bin/node
fi

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

releases_dir=$(cd "$releases_dir" && pwd -P) || fail "immutable releases root is unavailable"
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
seal_marker="$runtime_root/.openclaw-runtime-sealed"
source_provenance="$runtime_root/.openclaw-runtime-provenance.json"
if [ -L "$source_provenance" ]; then
  fail "source provenance envelope is a symbolic link"
elif [ -f "$source_provenance" ]; then
  provenance_fields=$(python3 - "$source_provenance" "$runtime_home" "$source_sha" <<'PY'
import json
import os
import re
import stat
import sys

envelope_path, runtime_home, expected_sha = sys.argv[1:]

def fail(message):
    raise SystemExit(message)

def regular_file(path, label, private=False):
    try:
        info = os.lstat(path)
    except OSError:
        fail(f"{label} is missing")
    if not stat.S_ISREG(info.st_mode) or stat.S_ISLNK(info.st_mode):
        fail(f"{label} is not a regular file")
    if private and stat.S_IMODE(info.st_mode) & 0o077:
        fail(f"{label} is not private")

regular_file(envelope_path, "source provenance envelope")
with open(envelope_path, encoding="utf-8") as handle:
    envelope = json.load(handle)
if envelope.get("schema") != "openclaw.custom-runtime-runtime-provenance.v1":
    raise SystemExit("invalid source provenance envelope schema")
if envelope.get("sourceSha") != expected_sha:
    raise SystemExit("source provenance source identity mismatch")
for key in ("treeSha", "recordPath", "recordSha256"):
    if not isinstance(envelope.get(key), str) or not envelope[key]:
        raise SystemExit(f"source provenance envelope field missing: {key}")
if not re.fullmatch(r"[a-f0-9]{40,64}", str(envelope.get("treeSha"))):
    raise SystemExit("source provenance tree identity is invalid")
if not re.fullmatch(r"[a-f0-9]{64}", envelope["recordSha256"]):
    raise SystemExit("source provenance record hash is invalid")
provenance_root = os.path.realpath(os.path.join(runtime_home, "source-provenance"))

try:
    root_info = os.lstat(provenance_root)
except OSError:
    raise SystemExit("source provenance root is missing")
if (
    not stat.S_ISDIR(root_info.st_mode)
    or stat.S_ISLNK(root_info.st_mode)
    or stat.S_IMODE(root_info.st_mode) & 0o077
):
    raise SystemExit("source provenance root is unsafe")

def checked_path(value, label):
    if not isinstance(value, str) or not value:
        raise SystemExit(f"source provenance {label} path is missing")
    resolved = os.path.realpath(value)
    try:
        if os.path.commonpath((provenance_root, resolved)) != provenance_root:
            raise SystemExit(f"source provenance {label} is outside the private provenance root")
    except ValueError:
        raise SystemExit(f"source provenance {label} path is invalid")
    regular_file(value, f"source provenance {label}", private=True)
    return resolved

print(checked_path(envelope["recordPath"], "record"))
print(envelope["recordSha256"])
migration_path = envelope.get("migrationPath", "")
if migration_path:
    migration_sha = envelope.get("migrationSha256")
    if not isinstance(migration_sha, str) or not re.fullmatch(r"[a-f0-9]{64}", migration_sha):
        raise SystemExit("source provenance migration hash is invalid")
    print(checked_path(migration_path, "migration"))
    print(migration_sha)
else:
    print("")
    print("")
print(envelope.get("historicalSourceSha", ""))
PY
) || fail "invalid source provenance envelope"
  provenance_record=$(printf '%s\n' "$provenance_fields" | sed -n '1p')
  provenance_record_sha=$(printf '%s\n' "$provenance_fields" | sed -n '2p')
  provenance_migration=$(printf '%s\n' "$provenance_fields" | sed -n '3p')
  provenance_migration_sha=$(printf '%s\n' "$provenance_fields" | sed -n '4p')
  provenance_historical_sha=$(printf '%s\n' "$provenance_fields" | sed -n '5p')
  [ "$(shasum -a 256 "$provenance_record" | awk '{print $1}')" = "$provenance_record_sha" ] || \
    fail "source provenance record hash mismatch"
  [ -f "$trusted_provenance_helper" ] && [ ! -L "$trusted_provenance_helper" ] || \
    fail "trusted source provenance verifier is unavailable"
  "$node_bin" "$trusted_provenance_helper" verify --record "$provenance_record" \
    --expected-sha "$source_sha" --deep true >/dev/null || \
    fail "source provenance verification failed"
  if [ -n "$provenance_migration" ]; then
    [ -n "$provenance_migration_sha" ] && [ -n "$provenance_historical_sha" ] || \
      fail "source provenance migration identity is incomplete"
    [ "$(shasum -a 256 "$provenance_migration" | awk '{print $1}')" = "$provenance_migration_sha" ] || \
      fail "source provenance migration hash mismatch"
    "$node_bin" "$trusted_provenance_helper" verify-migration --migration "$provenance_migration" \
      --historical-source-sha "$provenance_historical_sha" --candidate-sha "$source_sha" >/dev/null || \
      fail "source provenance migration verification failed"
  fi
else
  if [ "${OPENCLAW_ALLOW_LEGACY_SOURCE_STAMP:-0}" = 1 ] && [ "${#source_sha}" -eq 40 ]; then
    : # Explicit rollback-only compatibility for sealed runtimes predating durable provenance.
  else
    fail "release without durable source provenance"
  fi
fi
[ "$(shasum -a 256 "$manifest" | awk '{print $1}')" = "$manifest_sha" ] || fail "surface manifest hash mismatch"
[ "$(shasum -a 256 "$capability_manifest" | awk '{print $1}')" = "$capability_manifest_sha" ] || fail "capability manifest hash mismatch"

for capability in $required_capabilities; do
  if ! python3 - "$capability_manifest" "$runtime_root" "$manifest" "$capability" <<'PY'
import json, os, posixpath, sys
capability_manifest, root, surface_manifest, required = sys.argv[1:]
with open(capability_manifest, encoding="utf-8") as f: data = json.load(f)
schema = data.get("schema")
if schema not in ("openclaw.custom-runtime-capabilities.v1", "openclaw.custom-runtime-capabilities.v2") or not isinstance(data.get("version"), int) or data["version"] < 1:
    raise SystemExit(1)
if schema == "openclaw.custom-runtime-capabilities.v2":
    preservation = data.get("preservation")
    if not isinstance(preservation, dict) or preservation.get("contractVersion") != 2 or preservation.get("criticality") != "required" or preservation.get("migrationPolicy") != "preserve_or_block" or preservation.get("rollbackPolicy") != "immutable_release_pointer" or preservation.get("sourceStrategy") != "merge_from_active_sha" or preservation.get("dashboardChangePolicy") != "register_verify_and_block" or preservation.get("approvalPolicy") != "explicit_exact_candidate" or preservation.get("proofCommand") != "pnpm custom-runtime:update-survival":
        raise SystemExit(1)
    commands = preservation.get("verificationCommands")
    if not isinstance(commands, list) or not commands or not all(isinstance(command, str) and command for command in commands):
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

runtime_snapshot="$runtime_root/snapshot.json"
[ -f "$runtime_snapshot" ] || fail "runtime provenance manifest missing"
python3 - "$runtime_snapshot" "$runtime_root" "$source_sha" "$source_provenance" <<'PY'
import json, os, re, sys

snapshot_path, runtime_root, source_sha, source_provenance = sys.argv[1:]
with open(snapshot_path, encoding="utf-8") as f:
    snapshot = json.load(f)

if snapshot.get("version") != 2:
    raise SystemExit("unsupported runtime provenance schema")
if snapshot.get("root") != runtime_root:
    raise SystemExit("runtime provenance root mismatch")
if not isinstance(snapshot.get("releaseId"), str) or not snapshot["releaseId"]:
    raise SystemExit("runtime provenance release id missing")
if not re.fullmatch(r"[0-9a-f]{64}", str(snapshot.get("artifactHash", ""))):
    raise SystemExit("runtime provenance artifact hash invalid")
source = snapshot.get("source")
if not isinstance(source, dict) or not re.fullmatch(r"[0-9a-f]{40}", str(source.get("commit", ""))):
    raise SystemExit("runtime provenance source commit invalid")
if not os.path.isfile(source_provenance) and source.get("commit") != source_sha:
    raise SystemExit("runtime provenance source commit mismatch")
schemas = snapshot.get("schemas")
required_schemas = {
    "runtimeSnapshot": 2,
    "selfImprovementLedger": 1,
    "selfImprovementRecommendationStore": 3,
    "selfImprovementSignal": 1,
}
if not isinstance(schemas, dict) or any(schemas.get(key) != value for key, value in required_schemas.items()):
    raise SystemExit("runtime provenance SIG schema mismatch")
paths = snapshot.get("paths")
expected_paths = {
    "entrypoint": os.path.join(runtime_root, "dist", "index.js"),
    "controlUi": os.path.join(runtime_root, "dist", "control-ui"),
    "bundledPlugins": os.path.join(runtime_root, "dist-runtime", "extensions"),
}
if not isinstance(paths, dict) or any(paths.get(key) != value for key, value in expected_paths.items()):
    raise SystemExit("runtime provenance path mismatch")
PY

closure_identity=$(python3 - "$runtime_snapshot" "$seal_marker" "$source_sha" <<'PY'
import json, os, re, sys
snapshot_path, marker_path, expected_sha = sys.argv[1:]
with open(snapshot_path, encoding="utf-8") as handle:
    snapshot = json.load(handle)
marker = []
if os.path.isfile(marker_path) and not os.path.islink(marker_path):
    with open(marker_path, encoding="utf-8") as handle:
        marker = handle.read().strip().split()
version = snapshot.get("runtimeClosureVersion")
digest = snapshot.get("runtimeClosureHash")
requires_integrity = len(marker) == 2 or version is not None or digest is not None
if not requires_integrity:
    if marker and (len(marker) != 1 or marker[0] != expected_sha):
        raise SystemExit("invalid legacy release seal marker")
    print("")
elif (
    len(marker) == 2
    and version == 1
    and isinstance(digest, str)
    and re.fullmatch(r"[a-f0-9]{64}", digest)
    and marker[1] == digest
):
    print(digest)
else:
    raise SystemExit("release closure identity mismatch")
PY
) || fail "invalid release closure identity"
if [ -n "$closure_identity" ]; then
  integrity="$runtime_root/scripts/custom-runtime/runtime-package-integrity.mjs"
  [ -f "$integrity" ] && [ ! -L "$integrity" ] || fail "runtime integrity verifier missing"
  "$node_bin" "$integrity" verify --release "$runtime_root" >/dev/null || fail "runtime package integrity mismatch"
fi

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

export OPENCLAW_RUNTIME_SNAPSHOT_ROOT="$runtime_root"
export OPENCLAW_BUNDLED_PLUGINS_DIR="$runtime_root/dist-runtime/extensions"

if [ "${1:-}" = "--verify" ]; then
  printf '%s\n' "CUSTOM_RUNTIME_OK sha=$source_sha release=$(basename "$runtime_root")"
  exit 0
fi
exec "$node_bin" "$entrypoint" "$@"
