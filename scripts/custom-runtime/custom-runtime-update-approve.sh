#!/bin/sh
# Promote one fully prepared custom-runtime candidate after explicit operator approval.
set -eu

runtime_home=${OPENCLAW_CUSTOM_RUNTIME_HOME:-"$HOME/.openclaw-custom-runtime"}
releases_dir=${OPENCLAW_CUSTOM_RUNTIME_RELEASES:-"$HOME/.openclaw-runtime-releases"}
pending=${OPENCLAW_CUSTOM_RUNTIME_PENDING_UPDATE:-"$runtime_home/pending-update.json"}
durable_source_root=${OPENCLAW_CUSTOM_RUNTIME_DURABLE_SOURCE_ROOT:-"$HOME"}
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
for value in (
    release,
    source_sha,
    base_sha,
    str(receipt.get("sourceRepo", "")),
    str(receipt.get("sourceBranch", "")),
    str(receipt.get("sourceRemoteUrl", "")),
    str(receipt.get("sourceRemoteRef", "")),
):
    print(value)
PY
) || exit 64
release=$(printf '%s\n' "$fields" | sed -n '1p')
source_sha=$(printf '%s\n' "$fields" | sed -n '2p')
base_sha=$(printf '%s\n' "$fields" | sed -n '3p')
source_repo=$(printf '%s\n' "$fields" | sed -n '4p')
source_branch=$(printf '%s\n' "$fields" | sed -n '5p')
source_remote_url=$(printf '%s\n' "$fields" | sed -n '6p')
source_remote_ref=$(printf '%s\n' "$fields" | sed -n '7p')
[ -n "$source_remote_url" ] && [ -n "$source_remote_ref" ] || {
  printf '%s\n' 'prepared update is missing durable remote provenance' >&2
  exit 64
}
case "$source_branch" in
  refs/heads/*) ;;
  *)
    printf '%s\n' 'prepared update sourceBranch must be an exact refs/heads branch' >&2
    exit 64
    ;;
esac
git check-ref-format "$source_branch" >/dev/null 2>&1 || {
  printf '%s\n' 'prepared update sourceBranch is invalid' >&2
  exit 64
}
case "$source_remote_ref" in refs/heads/*|refs/tags/*) ;; *) usage ;; esac
git check-ref-format "$source_remote_ref" >/dev/null 2>&1 || usage

[ -d "$durable_source_root" ] || {
  printf '%s\n' 'custom runtime durable source root is unavailable' >&2
  exit 64
}
durable_source_root=$(cd "$durable_source_root" && pwd -P) || {
  printf '%s\n' 'custom runtime durable source root is unavailable' >&2
  exit 64
}
[ -d "$source_repo" ] && [ ! -L "$source_repo" ] || {
  printf '%s\n' 'prepared update source repository is unavailable or symlinked' >&2
  exit 64
}
canonical_source_repo=$(cd "$source_repo" && pwd -P) || {
  printf '%s\n' 'prepared update source repository is unavailable' >&2
  exit 64
}
[ "$source_repo" = "$canonical_source_repo" ] || {
  printf '%s\n' 'prepared update source repository must use its canonical physical path' >&2
  exit 64
}
source_repo=$canonical_source_repo
case "$source_repo" in
  "$durable_source_root"|"$durable_source_root"/*) ;;
  *)
    printf '%s\n' 'prepared update source repository is outside the durable source root' >&2
    exit 64
    ;;
esac

verify_active_base() {
  python3 - "$runtime_home/active-runtime.json" "$base_sha" <<'PY'
import json
import sys

path, expected = sys.argv[1:]
with open(path, encoding="utf-8") as f:
    active = json.load(f)
if active.get("sourceSha") != expected:
    raise SystemExit("prepared update is stale because the active runtime changed")
PY
}

verify_source_identity() {
  [ "$(git -C "$source_repo" rev-parse --is-inside-work-tree 2>/dev/null)" = true ] || {
    printf '%s\n' 'prepared update source repository is not a Git worktree' >&2
    exit 64
  }
  git_common_dir=$(git -C "$source_repo" rev-parse --git-common-dir 2>/dev/null) || {
    printf '%s\n' 'prepared update source Git common directory is unavailable' >&2
    exit 64
  }
  case "$git_common_dir" in
    /*) ;;
    *) git_common_dir="$source_repo/$git_common_dir" ;;
  esac
  [ -d "$git_common_dir" ] && [ ! -L "$git_common_dir" ] || {
    printf '%s\n' 'prepared update source Git common directory is missing or symlinked' >&2
    exit 64
  }
  canonical_git_common_dir=$(cd "$git_common_dir" && pwd -P) || {
    printf '%s\n' 'prepared update source Git common directory is unavailable' >&2
    exit 64
  }
  [ "$git_common_dir" = "$canonical_git_common_dir" ] || {
    printf '%s\n' 'prepared update source Git common directory is not canonical' >&2
    exit 64
  }
  case "$canonical_git_common_dir" in
    "$durable_source_root"|"$durable_source_root"/*) ;;
    *)
      printf '%s\n' 'prepared update source Git common directory is outside the durable source root' >&2
      exit 64
      ;;
  esac
  git -C "$source_repo" cat-file -e "$source_sha^{commit}" 2>/dev/null || {
    printf '%s\n' 'prepared update source commit is unavailable' >&2
    exit 64
  }
  head_sha=$(git -C "$source_repo" rev-parse --verify "HEAD^{commit}" 2>/dev/null) || {
    printf '%s\n' 'prepared update source HEAD is unavailable' >&2
    exit 64
  }
  [ "$head_sha" = "$source_sha" ] || {
    printf '%s\n' 'prepared update source checkout does not identify the candidate commit' >&2
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
  [ -z "$(git -C "$source_repo" status --porcelain --untracked-files=all)" ] || {
    printf '%s\n' 'prepared update source repository is dirty' >&2
    exit 64
  }
}

verify_active_base || exit 64
verify_source_identity
[ -f "$release/.openclaw-production-sha" ] || {
  printf '%s\n' 'prepared release source stamp is missing' >&2
  exit 64
}
[ "$(tr -d '[:space:]' < "$release/.openclaw-production-sha")" = "$source_sha" ] || {
  printf '%s\n' 'prepared release source stamp changed after proof' >&2
  exit 64
}
[ -x "$release/scripts/custom-runtime/custom-runtime-stage.sh" ] || {
  printf '%s\n' 'prepared update stage command is missing' >&2
  exit 64
}
[ -x "$release/scripts/custom-runtime/custom-runtime-activate.sh" ] || {
  printf '%s\n' 'prepared update activation command is missing' >&2
  exit 64
}
sh -n "$release/scripts/custom-runtime/custom-runtime-stage.sh" || {
  printf '%s\n' 'prepared update stage command has invalid shell syntax' >&2
  exit 64
}
sh -n "$release/scripts/custom-runtime/custom-runtime-activate.sh" || {
  printf '%s\n' 'prepared update activation command has invalid shell syntax' >&2
  exit 64
}
python3 - "$source_remote_url" <<'PY' || {
import os
import re
import sys
from urllib.parse import urlsplit

value = sys.argv[1]
if not value or any(character in value for character in ("\r", "\n", "\0")):
    raise SystemExit(1)
if os.path.isabs(value):
    raise SystemExit(0)
if "://" not in value:
    if not re.fullmatch(r"(?:[A-Za-z0-9._-]+@)?[A-Za-z0-9.-]+:[A-Za-z0-9._~/-]+", value):
        raise SystemExit(1)
    raise SystemExit(0)
parsed = urlsplit(value)
if parsed.scheme not in {"file", "git", "https", "ssh"}:
    raise SystemExit(1)
if parsed.password or parsed.query or parsed.fragment:
    raise SystemExit(1)
if parsed.username and parsed.scheme != "ssh":
    raise SystemExit(1)
PY
  printf '%s\n' 'prepared update source remote URL is unsafe' >&2
  exit 64
}

load_remote_sha() {
  remote_result=$(git ls-remote -- "$source_remote_url" "$source_remote_ref" "${source_remote_ref}^{}" 2>/dev/null) || {
    printf '%s\n' 'prepared update source remote is unavailable' >&2
    exit 64
  }
  existing_remote_sha=$(printf '%s\n' "$remote_result" | awk -v peeled="${source_remote_ref}^{}" '
    $2 == peeled { peeled_sha = $1 }
    !first_sha { first_sha = $1 }
    END { print peeled_sha ? peeled_sha : first_sha }
  ')
  if [ -n "$existing_remote_sha" ] && [ "$existing_remote_sha" != "$source_sha" ]; then
    printf '%s\n' 'prepared update source remote ref already identifies another commit' >&2
    exit 64
  fi
}

load_remote_sha
OPENCLAW_CUSTOM_RUNTIME_LAUNCHER="$release/scripts/custom-runtime/custom-runtime-launcher.sh" \
  "$release/scripts/custom-runtime/custom-runtime-stage.sh" \
  --release "$release" --source-sha "$source_sha" --port 18790 || {
  printf '%s\n' 'prepared update failed staging before recovery publication' >&2
  exit 1
}

# Staging can take long enough for the active pointer or source checkout to
# change. Revalidate every immutable identity immediately before publication.
verify_active_base || exit 64
verify_source_identity
[ "$(tr -d '[:space:]' < "$release/.openclaw-production-sha")" = "$source_sha" ] || {
  printf '%s\n' 'prepared release source stamp changed after staging' >&2
  exit 64
}
load_remote_sha
if [ -z "$existing_remote_sha" ]; then
  git -C "$source_repo" push --porcelain "$source_remote_url" "$source_sha:$source_remote_ref" >/dev/null || {
    printf '%s\n' 'prepared update source remote publication failed' >&2
    exit 1
  }
fi
load_remote_sha
published_remote_sha=$existing_remote_sha
[ "$published_remote_sha" = "$source_sha" ] || {
  printf '%s\n' 'prepared update source remote verification mismatch' >&2
  exit 1
}

stamp=$(date -u +%Y%m%dT%H%M%SZ)
approval_receipt="$runtime_home/receipts/update-approval-$stamp.json"
if ! "$release/scripts/custom-runtime/custom-runtime-activate.sh" \
  --release "$release" --source-sha "$source_sha" --source-repo "$source_repo" \
  --source-branch "$source_branch" --source-remote-url "$source_remote_url" \
  --source-remote-ref "$source_remote_ref" --stage-port 18790 --port 18789; then
  python3 - "$approval_receipt" "$receipt" "$stamp" "$release" "$source_sha" "$source_remote_ref" <<'PY'
import json, os, sys
target, prepared, at, release, source_sha, source_remote_ref = sys.argv[1:]
with open(target + ".tmp", "w", encoding="utf-8") as f:
    json.dump({
        "schema": "openclaw.custom-runtime-update-approval.v1",
        "at": at,
        "result": "promotion_failed_after_recovery_publication",
        "preparedReceipt": os.path.realpath(prepared),
        "release": release,
        "sourceRemoteRef": source_remote_ref,
        "sourceSha": source_sha,
    }, f, indent=2, sort_keys=True)
    f.write("\n")
os.replace(target + ".tmp", target)
PY
  exit 1
fi

python3 - "$approval_receipt" "$receipt" "$stamp" "$release" "$source_sha" "$source_remote_ref" <<'PY'
import json, os, sys
target, prepared, at, release, source_sha, source_remote_ref = sys.argv[1:]
with open(target + ".tmp", "w", encoding="utf-8") as f:
    json.dump({
        "schema": "openclaw.custom-runtime-update-approval.v1",
        "at": at,
        "result": "promoted",
        "preparedReceipt": os.path.realpath(prepared),
        "release": release,
        "sourceRemoteRef": source_remote_ref,
        "sourceSha": source_sha,
    }, f, indent=2, sort_keys=True)
    f.write("\n")
os.replace(target + ".tmp", target)
PY
rm -f "$pending"
printf '%s\n' "CUSTOM_RUNTIME_UPDATE_APPROVED release=$(basename "$release") sourceSha=$source_sha"
