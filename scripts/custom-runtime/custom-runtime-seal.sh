#!/bin/sh
# Seal or verify a prepared runtime without following symlinks or changing file contents.
set -eu

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

verify_integrity() {
  [ -n "$closure_hash" ] || return 0
  integrity="$release/scripts/custom-runtime/runtime-package-integrity.mjs"
  [ -f "$integrity" ] && [ ! -L "$integrity" ] || {
    printf '%s\n' 'runtime seal blocked: runtime integrity verifier is missing or unsafe' >&2
    exit 64
  }
  if [ -n "${OPENCLAW_NODE_BIN:-}" ]; then
    node_bin=$OPENCLAW_NODE_BIN
  else
    node_bin=$(command -v node || true)
  fi
  [ -n "$node_bin" ] && [ -x "$node_bin" ] || {
    printf '%s\n' 'runtime seal blocked: node is unavailable for integrity verification' >&2
    exit 64
  }
  "$node_bin" "$integrity" verify --release "$release" --expected-root "$release"
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
