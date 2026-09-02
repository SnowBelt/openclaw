#!/bin/sh
# Seal or verify a prepared runtime without following symlinks or changing file contents.
set -eu

runtime_home=${OPENCLAW_CUSTOM_RUNTIME_HOME:-"$HOME/.openclaw-custom-runtime"}
trusted_provenance_helper=${OPENCLAW_TRUSTED_SOURCE_PROVENANCE_HELPER:-"$runtime_home/bin/custom-runtime-source-provenance.mjs"}
releases_dir=${OPENCLAW_CUSTOM_RUNTIME_RELEASES:-"$HOME/.openclaw-runtime-releases"}

usage() {
  printf '%s\n' 'usage: custom-runtime-seal.sh --seal|--verify --release PATH' >&2
  exit 64
}

operation= release=
while [ $# -gt 0 ]; do
  case "$1" in
    --seal|--verify) [ -z "$operation" ] || usage; operation=$1; shift ;;
    --release) release=${2:-}; shift 2 ;;
    *) usage ;;
  esac
done
[ -n "$operation" ] && [ -n "$release" ] || usage
[ -d "$releases_dir" ] && [ ! -L "$releases_dir" ] || {
  printf '%s\n' 'runtime seal blocked: immutable releases root is missing or unsafe' >&2
  exit 64
}
releases_dir=$(cd "$releases_dir" && pwd -P)
[ -d "$release" ] && [ ! -L "$release" ] || {
  printf '%s\n' 'runtime seal blocked: release root is missing or unsafe' >&2
  exit 64
}
release=$(cd "$release" && pwd -P)
case "$release" in
  "$releases_dir"/*) ;;
  *) printf '%s\n' 'runtime seal blocked: release is outside immutable releases root' >&2; exit 64 ;;
esac

stamp="$release/.openclaw-production-sha"
marker="$release/.openclaw-runtime-sealed"
[ -f "$stamp" ] && [ ! -L "$stamp" ] || {
  printf '%s\n' 'runtime seal blocked: release source stamp is missing or unsafe' >&2
  exit 64
}
source_sha=$(tr -d '[:space:]' < "$stamp")
case "$source_sha" in *[!0-9a-fA-F]*|'') exit 64 ;; esac
[ "${#source_sha}" -eq 40 ] || exit 64

snapshot="$release/snapshot.json"
closure_hash=
if [ -f "$snapshot" ] && [ ! -L "$snapshot" ]; then
  closure_hash=$(python3 - "$snapshot" <<'PY'
import json, re, sys
with open(sys.argv[1], encoding="utf-8") as handle:
    value = json.load(handle)
version = value.get("runtimeClosureVersion")
digest = value.get("runtimeClosureHash")
if version is None and digest is None:
    print("")
elif version == 1 and isinstance(digest, str) and re.fullmatch(r"[a-f0-9]{64}", digest):
    print(digest)
else:
    raise SystemExit("runtime seal blocked: malformed runtime closure identity")
PY
  ) || exit 64
fi

if [ -n "${OPENCLAW_NODE_BIN:-}" ]; then
  node_bin=$OPENCLAW_NODE_BIN
else
  node_bin=$(command -v node || true)
fi
[ -n "$node_bin" ] && [ -x "$node_bin" ] || {
  printf '%s\n' 'runtime seal blocked: node is unavailable for provenance verification' >&2
  exit 64
}

verify_source_provenance() {
  provenance_envelope="$release/.openclaw-runtime-provenance.json"
  provenance_fields=$(python3 - "$provenance_envelope" "$runtime_home" "$release" "$source_sha" <<'PY'
import json
import os
import re
import stat
import sys

envelope_path, runtime_home, runtime_root, expected_sha = sys.argv[1:]

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

regular_file(envelope_path, "source provenance envelope", private=True)
try:
    with open(envelope_path, encoding="utf-8") as handle:
        envelope = json.load(handle)
except (OSError, json.JSONDecodeError):
    fail("source provenance envelope is malformed")
schema = envelope.get("schema")
if schema not in {
    "openclaw.custom-runtime-runtime-provenance.v1",
    "openclaw.custom-runtime-runtime-provenance.v2",
}:
    fail("source provenance envelope schema is invalid")
if envelope.get("sourceSha") != expected_sha:
    fail("source provenance source identity mismatch")
tree_sha = envelope.get("treeSha")
if not isinstance(tree_sha, str) or not re.fullmatch(r"[a-f0-9]{40,64}", tree_sha):
    fail("source provenance tree identity is invalid")

if schema.endswith(".v1"):
    provenance_root = os.path.realpath(os.path.join(runtime_home, "source-provenance"))
    try:
        root_info = os.lstat(provenance_root)
    except OSError:
        fail("source provenance root is missing")
    if (
        not stat.S_ISDIR(root_info.st_mode)
        or stat.S_ISLNK(root_info.st_mode)
        or stat.S_IMODE(root_info.st_mode) & 0o077
    ):
        fail("source provenance root is unsafe")
    record_path = envelope.get("recordPath")
    record_sha = envelope.get("recordSha256")
    if not isinstance(record_path, str) or not record_path or not isinstance(record_sha, str) or not re.fullmatch(r"[a-f0-9]{64}", record_sha):
        fail("source provenance record identity is incomplete")
    evidence_path = os.path.realpath(record_path)
    try:
        if os.path.commonpath((provenance_root, evidence_path)) != provenance_root:
            fail("source provenance record is outside the private provenance root")
    except ValueError:
        fail("source provenance record path is invalid")
    regular_file(record_path, "source provenance record", private=True)
    evidence_sha = record_sha
    object_format = ""
else:
    bundle_path = envelope.get("bundlePath")
    bundle_sha = envelope.get("bundleSha256")
    object_format = envelope.get("objectFormat")
    if not isinstance(bundle_path, str) or not bundle_path or not isinstance(bundle_sha, str) or not re.fullmatch(r"[a-f0-9]{64}", bundle_sha):
        fail("source provenance bundle identity is incomplete")
    if object_format not in {"sha1", "sha256"}:
        fail("source provenance object format is invalid")
    evidence_path = os.path.realpath(bundle_path)
    try:
        if os.path.commonpath((os.path.realpath(runtime_root), evidence_path)) != os.path.realpath(runtime_root):
            fail("source provenance bundle is outside the immutable runtime")
    except ValueError:
        fail("source provenance bundle path is invalid")
    regular_file(evidence_path, "source provenance bundle")
    evidence_sha = bundle_sha

migration_path = envelope.get("migrationPath", "")
if migration_path:
    migration_path = os.path.realpath(migration_path)
    migration_root = os.path.realpath(runtime_root) if schema.endswith(".v2") else provenance_root
    try:
        if os.path.commonpath((migration_root, migration_path)) != migration_root:
            fail("source provenance migration is outside the private provenance root" if schema.endswith(".v1") else "source provenance migration is outside its immutable root")
    except ValueError:
        fail("source provenance migration path is invalid")
    regular_file(migration_path, "source provenance migration", private=schema.endswith(".v1"))
    migration_sha = envelope.get("migrationSha256")
    if not isinstance(migration_sha, str) or not re.fullmatch(r"[a-f0-9]{64}", migration_sha):
        fail("source provenance migration hash is invalid")
else:
    migration_sha = ""

print(schema)
print(evidence_path)
print(evidence_sha)
print(tree_sha)
print(object_format)
print(migration_path)
print(migration_sha)
print(envelope.get("historicalSourceSha", ""))
PY
  ) || {
    printf '%s\n' 'runtime seal blocked: durable source provenance envelope is invalid' >&2
    return 1
  }
  provenance_schema=$(printf '%s\n' "$provenance_fields" | sed -n '1p')
  provenance_evidence=$(printf '%s\n' "$provenance_fields" | sed -n '2p')
  provenance_evidence_sha=$(printf '%s\n' "$provenance_fields" | sed -n '3p')
  provenance_tree_sha=$(printf '%s\n' "$provenance_fields" | sed -n '4p')
  provenance_object_format=$(printf '%s\n' "$provenance_fields" | sed -n '5p')
  provenance_migration=$(printf '%s\n' "$provenance_fields" | sed -n '6p')
  provenance_migration_sha=$(printf '%s\n' "$provenance_fields" | sed -n '7p')
  provenance_historical_sha=$(printf '%s\n' "$provenance_fields" | sed -n '8p')
  [ "$(shasum -a 256 "$provenance_evidence" | awk '{print $1}')" = "$provenance_evidence_sha" ] || return 1
  if [ "$provenance_schema" = "openclaw.custom-runtime-runtime-provenance.v2" ]; then
    provenance_helper="$release/scripts/custom-runtime/custom-runtime-source-provenance.mjs"
    [ -f "$provenance_helper" ] && [ ! -L "$provenance_helper" ] || return 1
    "$node_bin" "$provenance_helper" verify-portable --bundle "$provenance_evidence" \
      --expected-sha "$source_sha" --expected-tree-sha "$provenance_tree_sha" \
      --object-format "$provenance_object_format" --bundle-sha256 "$provenance_evidence_sha" >/dev/null || return 1
  else
    [ -f "$trusted_provenance_helper" ] && [ ! -L "$trusted_provenance_helper" ] || return 1
    "$node_bin" "$trusted_provenance_helper" verify --record "$provenance_evidence" \
      --expected-sha "$source_sha" --deep true >/dev/null || return 1
  fi
  if [ -n "$provenance_migration" ]; then
    [ -n "$provenance_migration_sha" ] && [ -n "$provenance_historical_sha" ] || return 1
    [ "$(shasum -a 256 "$provenance_migration" | awk '{print $1}')" = "$provenance_migration_sha" ] || return 1
    if [ "$provenance_schema" = "openclaw.custom-runtime-runtime-provenance.v1" ]; then
      "$node_bin" "$trusted_provenance_helper" verify-migration --migration "$provenance_migration" \
        --historical-source-sha "$provenance_historical_sha" --candidate-sha "$source_sha" >/dev/null || return 1
    fi
  fi
}

verify_integrity() {
  [ -n "$closure_hash" ] || return 0
  integrity="$release/scripts/custom-runtime/runtime-package-integrity.mjs"
  [ -f "$integrity" ] && [ ! -L "$integrity" ] || {
    printf '%s\n' 'runtime seal blocked: runtime integrity verifier is missing or unsafe' >&2
    exit 64
  }
  "$node_bin" "$integrity" verify --release "$release" --expected-root "$release"
}

verify_source_provenance || {
  printf '%s\n' 'runtime seal blocked: durable source provenance verification failed' >&2
  exit 64
}
verify_integrity

if [ "$operation" = --seal ]; then
  if [ -n "$closure_hash" ]; then
    printf '%s %s\n' "$source_sha" "$closure_hash" > "$marker"
  else
    printf '%s\n' "$source_sha" > "$marker"
  fi
  chmod a-w "$marker"
  python3 - "$release" <<'PY'
import os
import stat
import sys

root = os.path.realpath(sys.argv[1])
for current, directories, files in os.walk(root, topdown=False, followlinks=False):
    for name in [*files, *directories]:
        path = os.path.join(current, name)
        if os.path.islink(path):
            continue
        mode = stat.S_IMODE(os.stat(path, follow_symlinks=False).st_mode)
        os.chmod(path, mode & ~0o222, follow_symlinks=False)
mode = stat.S_IMODE(os.stat(root, follow_symlinks=False).st_mode)
os.chmod(root, mode & ~0o222, follow_symlinks=False)
PY
fi

python3 - "$release" "$marker" "$source_sha" <<'PY'
import os
import stat
import sys

root, marker, expected_sha = sys.argv[1:]
with open(marker, encoding="utf-8") as handle:
    marker_fields = handle.read().strip().split()
    if not marker_fields or marker_fields[0] != expected_sha or len(marker_fields) not in (1, 2):
        raise SystemExit("runtime seal verification failed: marker mismatch")
for current, directories, files in os.walk(root, followlinks=False):
    paths = [
        current,
        *(os.path.join(current, name) for name in files),
        *(os.path.join(current, name) for name in directories),
    ]
    for path in paths:
        if os.path.islink(path):
            continue
        mode = stat.S_IMODE(os.stat(path, follow_symlinks=False).st_mode)
        if mode & 0o222:
            raise SystemExit(f"runtime seal verification failed: writable path: {path}")
PY

verify_integrity

printf '%s\n' "CUSTOM_RUNTIME_SEALED sha=$source_sha release=$(basename "$release")"
