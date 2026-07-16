#!/bin/sh
# Promote one fully prepared custom-runtime candidate after explicit operator approval.
set -eu

runtime_home=${OPENCLAW_CUSTOM_RUNTIME_HOME:-"$HOME/.openclaw-custom-runtime"}
releases_dir=${OPENCLAW_CUSTOM_RUNTIME_RELEASES:-"$HOME/.openclaw-runtime-releases"}
pending=${OPENCLAW_CUSTOM_RUNTIME_PENDING_UPDATE:-"$runtime_home/pending-update.json"}
mkdir -p "$runtime_home/receipts"

usage() {
  printf '%s\n' 'usage: custom-runtime-update-approve.sh [--receipt PATH]' >&2
  exit 64
}
receipt=$pending
while [ $# -gt 0 ]; do
  case "$1" in
    --receipt) receipt=${2:-}; shift 2 ;;
    *) usage ;;
  esac
done
[ -f "$receipt" ] || { printf '%s\n' 'prepared update receipt is missing' >&2; exit 64; }
[ -f "$runtime_home/active-runtime.json" ] || { printf '%s\n' 'active runtime pointer is missing' >&2; exit 64; }

fields=$(python3 - "$receipt" "$runtime_home/active-runtime.json" "$releases_dir" <<'PY'
import json, os, re, sys
receipt_path, active_path, releases_dir = sys.argv[1:]
with open(receipt_path, encoding="utf-8") as f:
    receipt = json.load(f)
with open(active_path, encoding="utf-8") as f:
    active = json.load(f)
if receipt.get("schema") != "openclaw.custom-runtime-update-candidate.v1":
    raise SystemExit("prepared update receipt schema is invalid")
if receipt.get("result") != "ready_for_approval":
    raise SystemExit("prepared update is not awaiting approval")
release = os.path.realpath(str(receipt.get("release", "")))
root = os.path.realpath(releases_dir)
if not release.startswith(root + os.sep):
    raise SystemExit("prepared update release is outside immutable releases")
source_sha = str(receipt.get("sourceSha", ""))
base_sha = str(receipt.get("baseSha", ""))
if not re.fullmatch(r"[0-9a-fA-F]{40}", source_sha):
    raise SystemExit("prepared update source SHA is invalid")
if active.get("sourceSha") != base_sha:
    raise SystemExit("prepared update is stale because the active runtime changed")
for value in (release, source_sha, str(receipt.get("sourceRepo", "")), str(receipt.get("sourceBranch", ""))):
    print(value)
PY
) || exit 64
release=$(printf '%s\n' "$fields" | sed -n '1p')
source_sha=$(printf '%s\n' "$fields" | sed -n '2p')
source_repo=$(printf '%s\n' "$fields" | sed -n '3p')
source_branch=$(printf '%s\n' "$fields" | sed -n '4p')
[ -d "$source_repo/.git" ] || git -C "$source_repo" rev-parse --git-dir >/dev/null 2>&1 || {
  printf '%s\n' 'prepared update source repository is unavailable' >&2
  exit 64
}
[ -z "$(git -C "$source_repo" status --porcelain)" ] || {
  printf '%s\n' 'prepared update source repository is dirty' >&2
  exit 64
}
git -C "$source_repo" cat-file -e "$source_sha^{commit}" 2>/dev/null || {
  printf '%s\n' 'prepared update source commit is unavailable' >&2
  exit 64
}
branch_sha=$(git -C "$source_repo" rev-parse --verify "$source_branch^{commit}" 2>/dev/null) || {
  printf '%s\n' 'prepared update source branch is unavailable' >&2
  exit 64
}
[ "$branch_sha" = "$source_sha" ] || {
  printf '%s\n' 'prepared update source branch does not identify the candidate commit' >&2
  exit 64
}
[ -f "$release/.openclaw-production-sha" ] || { printf '%s\n' 'prepared release source stamp is missing' >&2; exit 64; }
[ "$(tr -d '[:space:]' < "$release/.openclaw-production-sha")" = "$source_sha" ] || {
  printf '%s\n' 'prepared release source stamp changed after proof' >&2
  exit 64
}

"$release/scripts/custom-runtime/custom-runtime-activate.sh" \
  --release "$release" --source-sha "$source_sha" --source-repo "$source_repo" \
  --source-branch "$source_branch" --stage-port 18790 --port 18789

stamp=$(date -u +%Y%m%dT%H%M%SZ)
approval_receipt="$runtime_home/receipts/update-approval-$stamp.json"
python3 - "$approval_receipt" "$receipt" "$stamp" "$release" "$source_sha" <<'PY'
import json, os, sys
target, prepared, at, release, source_sha = sys.argv[1:]
with open(target + ".tmp", "w", encoding="utf-8") as f:
    json.dump({
        "schema": "openclaw.custom-runtime-update-approval.v1",
        "at": at,
        "result": "promoted",
        "preparedReceipt": os.path.realpath(prepared),
        "release": release,
        "sourceSha": source_sha,
    }, f, indent=2, sort_keys=True)
    f.write("\n")
os.replace(target + ".tmp", target)
PY
rm -f "$pending"
printf '%s\n' "CUSTOM_RUNTIME_UPDATE_APPROVED release=$(basename "$release") sourceSha=$source_sha"
