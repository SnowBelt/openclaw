#!/bin/sh
# Move active source provenance to a persistent Git worktree without restarting the Gateway.
set -eu

runtime_home=${OPENCLAW_CUSTOM_RUNTIME_HOME:-"$HOME/.openclaw-custom-runtime"}
durable_source_root=${OPENCLAW_CUSTOM_RUNTIME_DURABLE_SOURCE_ROOT:-"$HOME"}
pointer=${OPENCLAW_CUSTOM_RUNTIME_POINTER:-"$runtime_home/active-runtime.json"}
launcher=${OPENCLAW_CUSTOM_RUNTIME_LAUNCHER:-"$runtime_home/bin/custom-runtime-launcher.sh"}
activation_lock="$runtime_home/locks/activation.lock"
promotion_lock="$runtime_home/locks/promotion.lock"
rollback_lock="$runtime_home/locks/rollback.lock"
migration_lock="$runtime_home/locks/source-migration.lock"
activation_lock_acquired=false
promotion_lock_acquired=false
rollback_lock_acquired=false
migration_lock_acquired=false
lifecycle_started=false
lifecycle_result=source-migration-failed
created=false
mutation_started=false
migration_complete=false

usage() {
  printf '%s\n' 'usage: custom-runtime-source-migrate.sh --target PATH [--remote NAME_OR_URL] [--remote-ref REF] [--apply]' >&2
  exit 64
}

target=
remote=
remote_ref=
apply=false
while [ $# -gt 0 ]; do
  case "$1" in
    --target) target=${2:-}; shift 2 ;;
    --remote) remote=${2:-}; shift 2 ;;
    --remote-ref) remote_ref=${2:-}; shift 2 ;;
    --apply) apply=true; shift ;;
    *) usage ;;
  esac
done
[ -n "$target" ] || usage
case "$target" in /*) ;; *) usage ;; esac

[ -f "$pointer" ] || {
  printf '%s\n' 'custom runtime source migration blocked: active pointer is missing' >&2
  exit 64
}
[ -x "$launcher" ] || {
  printf '%s\n' 'custom runtime source migration blocked: managed launcher is unavailable' >&2
  exit 64
}
[ -d "$durable_source_root" ] || {
  printf '%s\n' 'custom runtime source migration blocked: durable source root is missing' >&2
  exit 64
}

target_parent=$(dirname "$target")
target_name=$(basename "$target")
[ -n "$target_name" ] && [ "$target_name" != . ] && [ "$target_name" != .. ] || usage
[ -d "$target_parent" ] || {
  printf '%s\n' 'custom runtime source migration blocked: target parent is missing' >&2
  exit 64
}
[ ! -L "$target" ] || {
  printf '%s\n' 'custom runtime source migration blocked: target cannot be a symlink' >&2
  exit 64
}
target_parent=$(cd "$target_parent" && pwd -P)
target="$target_parent/$target_name"
durable_source_root=$(cd "$durable_source_root" && pwd -P)
case "$target" in
  "$durable_source_root"/*) ;;
  *)
    printf '%s\n' 'custom runtime source migration blocked: target is outside the durable source root' >&2
    exit 64
    ;;
esac

release_coordination_locks() {
  [ "$migration_lock_acquired" != true ] || rmdir "$migration_lock" 2>/dev/null || true
  [ "$rollback_lock_acquired" != true ] || rmdir "$rollback_lock" 2>/dev/null || true
  [ "$promotion_lock_acquired" != true ] || rmdir "$promotion_lock" 2>/dev/null || true
  [ "$activation_lock_acquired" != true ] || rmdir "$activation_lock" 2>/dev/null || true
}

cleanup_migration() {
  exit_code=$?
  trap - EXIT INT TERM
  if [ "$migration_complete" != true ] && [ "$mutation_started" = true ]; then
    restore || exit_code=1
  fi
  if [ "$lifecycle_started" = true ]; then
    custom_runtime_lifecycle_finish "$runtime_home" "$lifecycle_result" "$exit_code" || exit_code=1
  fi
  release_coordination_locks
  exit "$exit_code"
}

if [ "$apply" = true ]; then
  mkdir -p "$runtime_home/locks" "$runtime_home/backups" "$runtime_home/receipts"
  # Defer termination until cleanup traps own every acquired lifecycle lock.
  trap '' INT TERM
  if ! mkdir "$activation_lock" 2>/dev/null; then
    printf '%s\n' 'custom runtime source migration blocked: activation is active' >&2
    exit 75
  fi
  activation_lock_acquired=true
  if ! mkdir "$promotion_lock" 2>/dev/null; then
    release_coordination_locks
    printf '%s\n' 'custom runtime source migration blocked: promotion is active' >&2
    exit 75
  fi
  promotion_lock_acquired=true
  if ! mkdir "$rollback_lock" 2>/dev/null; then
    release_coordination_locks
    printf '%s\n' 'custom runtime source migration blocked: rollback is active' >&2
    exit 75
  fi
  rollback_lock_acquired=true
  if ! mkdir "$migration_lock" 2>/dev/null; then
    release_coordination_locks
    printf '%s\n' 'custom runtime source migration blocked: another migration is active' >&2
    exit 75
  fi
  migration_lock_acquired=true
  trap release_coordination_locks EXIT
  trap 'exit 130' INT
  trap 'exit 143' TERM
  auth_helper=$(dirname "$0")/custom-runtime-auth.sh
  [ -f "$auth_helper" ] || auth_helper="$runtime_home/bin/custom-runtime-auth.sh"
  [ -f "$auth_helper" ] || {
    printf '%s\n' 'custom runtime source migration blocked: lifecycle auth helper is missing' >&2
    exit 64
  }
  . "$auth_helper"
  custom_runtime_lifecycle_begin "$runtime_home" source-migration "" ""
  lifecycle_started=true
  trap cleanup_migration EXIT
  trap 'exit 130' INT
  trap 'exit 143' TERM
fi

pointer_fields=$(python3 - "$pointer" <<'PY'
import json
import sys

with open(sys.argv[1], encoding="utf-8") as f:
    value = json.load(f)
for key in ("sourceSha", "sourceRepo", "sourceBranch", "sourceRemoteUrl", "sourceRemoteRef"):
    item = value.get(key)
    if key in ("sourceSha", "sourceRepo", "sourceBranch") and (
        not isinstance(item, str) or not item
    ):
        raise SystemExit(f"active pointer is missing {key}")
    print(item if isinstance(item, str) else "")
PY
) || {
  printf '%s\n' 'custom runtime source migration blocked: active source identity is invalid' >&2
  exit 64
}
source_sha=$(printf '%s\n' "$pointer_fields" | sed -n '1p')
source_repo=$(printf '%s\n' "$pointer_fields" | sed -n '2p')
source_branch=$(printf '%s\n' "$pointer_fields" | sed -n '3p')
pointer_remote_url=$(printf '%s\n' "$pointer_fields" | sed -n '4p')
pointer_remote_ref=$(printf '%s\n' "$pointer_fields" | sed -n '5p')
case "$source_sha" in *[!0-9a-fA-F]*|'') usage ;; esac
[ "${#source_sha}" -eq 40 ] || usage
if [ "$apply" = true ]; then
  custom_runtime_lifecycle_assert_active_sha "$source_sha" "$runtime_home" || exit 75
fi
git -C "$source_repo" rev-parse --git-dir >/dev/null 2>&1 || {
  printf '%s\n' 'custom runtime source migration blocked: current source is not a Git checkout' >&2
  exit 64
}
[ "$source_branch" != HEAD ] || source_branch=$(git -C "$source_repo" symbolic-ref --quiet --short HEAD 2>/dev/null || true)
[ -n "$source_branch" ] || {
  printf '%s\n' 'custom runtime source migration blocked: HEAD is detached; provide a branch-backed source checkout' >&2
  exit 64
}
case "$source_branch" in
  refs/heads/*) source_branch_ref=$source_branch ;;
  *) source_branch_ref="refs/heads/$source_branch" ;;
esac
git check-ref-format "$source_branch_ref" >/dev/null 2>&1 || {
  printf '%s\n' 'custom runtime source migration blocked: source branch is invalid' >&2
  exit 64
}
[ -z "$(git -C "$source_repo" status --porcelain)" ] || {
  printf '%s\n' 'custom runtime source migration blocked: current source is dirty' >&2
  exit 64
}
git -C "$source_repo" cat-file -e "$source_sha^{commit}" 2>/dev/null || {
  printf '%s\n' 'custom runtime source migration blocked: source commit is missing' >&2
  exit 64
}
git -C "$source_repo" rev-parse --verify "$source_branch_ref^{commit}" >/dev/null 2>&1 || {
  printf '%s\n' 'custom runtime source migration blocked: source branch is missing' >&2
  exit 64
}
git -C "$source_repo" merge-base --is-ancestor "$source_sha" "$source_branch_ref" || {
  printf '%s\n' 'custom runtime source migration blocked: source branch does not contain the active commit' >&2
  exit 64
}
source_git_common_dir=$(git -C "$source_repo" rev-parse --git-common-dir) || {
  printf '%s\n' 'custom runtime source migration blocked: source Git object store is unavailable' >&2
  exit 64
}
case "$source_git_common_dir" in
  /*) ;;
  *) source_git_common_dir="$source_repo/$source_git_common_dir" ;;
esac
[ ! -L "$source_git_common_dir" ] || {
  printf '%s\n' 'custom runtime source migration blocked: source Git object store cannot be a symlink' >&2
  exit 64
}
source_git_common_parent=$(dirname "$source_git_common_dir")
source_git_common_name=$(basename "$source_git_common_dir")
[ -d "$source_git_common_parent" ] && [ -d "$source_git_common_dir" ] || {
  printf '%s\n' 'custom runtime source migration blocked: source Git object store is unavailable' >&2
  exit 64
}
source_git_common_parent=$(cd "$source_git_common_parent" && pwd -P)
source_git_common_dir="$source_git_common_parent/$source_git_common_name"
if [ -z "$remote" ]; then
  [ -n "$pointer_remote_url" ] || {
    printf '%s\n' 'custom runtime source migration blocked: --remote is required until remote provenance is recorded' >&2
    exit 64
  }
  remote=$pointer_remote_url
fi
if git -C "$source_repo" remote get-url "$remote" >/dev/null 2>&1; then
  remote_url=$(git -C "$source_repo" remote get-url "$remote")
else
  remote_url=$remote
fi
[ -n "$remote_ref" ] || remote_ref=$pointer_remote_ref
if [ -z "$remote_ref" ]; then
  case "$source_branch" in
    refs/*) remote_ref=$source_branch ;;
    *) remote_ref="refs/heads/$source_branch" ;;
  esac
fi
case "$remote_ref" in
  refs/heads/*|refs/tags/*) ;;
  *)
    printf '%s\n' 'custom runtime source migration blocked: remote ref must be a branch or tag ref' >&2
    exit 64
    ;;
esac
git check-ref-format "$remote_ref" >/dev/null 2>&1 || {
  printf '%s\n' 'custom runtime source migration blocked: remote ref is invalid' >&2
  exit 64
}
python3 - "$remote_url" <<'PY' || {
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
  printf '%s\n' 'custom runtime source migration blocked: remote URL contains credentials or unsupported metadata' >&2
  exit 64
}
remote_result=$(git ls-remote --exit-code -- "$remote_url" "$remote_ref" "${remote_ref}^{}" 2>/dev/null) || {
  printf '%s\n' 'custom runtime source migration blocked: remote ref is unavailable' >&2
  exit 64
}
remote_sha=$(printf '%s\n' "$remote_result" | awk -v peeled="${remote_ref}^{}" '
  $2 == peeled { peeled_sha = $1 }
  !first_sha { first_sha = $1 }
  END { print peeled_sha ? peeled_sha : first_sha }
')
[ -n "$remote_sha" ] || {
  printf '%s\n' 'custom runtime source migration blocked: remote ref is unavailable' >&2
  exit 64
}
[ "$remote_sha" = "$source_sha" ] || {
  printf '%s\n' 'custom runtime source migration blocked: remote ref does not identify the active commit' >&2
  exit 64
}

target_state=new
target_git_common_dir="$target/.git"
if [ -e "$target" ]; then
  [ -d "$target" ] && git -C "$target" rev-parse --git-dir >/dev/null 2>&1 || {
    printf '%s\n' 'custom runtime source migration blocked: existing target is not a Git worktree' >&2
    exit 64
  }
  [ "$(git -C "$target" rev-parse HEAD)" = "$source_sha" ] || {
    printf '%s\n' 'custom runtime source migration blocked: existing target is at another commit' >&2
    exit 64
  }
  [ -z "$(git -C "$target" status --porcelain)" ] || {
    printf '%s\n' 'custom runtime source migration blocked: existing target is dirty' >&2
    exit 64
  }
  target_git_common_dir=$(git -C "$target" rev-parse --git-common-dir) || {
    printf '%s\n' 'custom runtime source migration blocked: target Git object store is unavailable' >&2
    exit 64
  }
  case "$target_git_common_dir" in
    /*) ;;
    *) target_git_common_dir="$target/$target_git_common_dir" ;;
  esac
  target_git_common_dir=$(cd "$target_git_common_dir" && pwd -P) || {
    printf '%s\n' 'custom runtime source migration blocked: target Git object store is unavailable' >&2
    exit 64
  }
  case "$target_git_common_dir" in
    "$durable_source_root"|"$durable_source_root"/*) ;;
    *)
      printf '%s\n' 'custom runtime source migration blocked: target Git object store is outside the durable source root' >&2
      exit 64
      ;;
  esac
  target_state=reused
fi

python3 - "$source_sha" "$source_repo" "$source_git_common_dir" "$source_branch" "$remote_url" "$remote_ref" \
  "$target_git_common_dir" \
  "$target" "$target_state" "$apply" <<'PY'
import json
import sys

(
    sha,
    source,
    source_git_common_dir,
    branch,
    remote_url,
    remote_ref,
    target_git_common_dir,
    target,
    state,
    apply,
) = sys.argv[1:]
print(json.dumps({
    "schema": "openclaw.custom-runtime-source-migration-plan.v1",
    "sourceSha": sha,
    "sourceRepo": source,
    "sourceGitCommonDir": source_git_common_dir,
    "sourceBranch": branch,
    "sourceRemoteUrl": remote_url,
    "sourceRemoteRef": remote_ref,
    "sourceRemoteSha": sha,
    "targetGitCommonDir": target_git_common_dir,
    "targetRepo": target,
    "targetState": state,
    "operation": "apply" if apply == "true" else "plan",
}, indent=2, sort_keys=True))
PY
[ "$apply" = true ] || exit 0

timestamp=$(date -u +%Y%m%dT%H%M%SZ)
verified_at=$(date -u +%Y-%m-%dT%H:%M:%SZ)
backup="$runtime_home/backups/active-runtime.source-migration.$timestamp.json"
receipt="$runtime_home/receipts/source-migration-$timestamp.json"
cp -p "$pointer" "$backup"

restore() {
  restored=true
  python3 - "$backup" "$pointer" <<'PY' || restored=false
import os
import shutil
import sys

source, target = sys.argv[1:]
temporary = f"{target}.restore.{os.getpid()}"
shutil.copy2(source, temporary)
os.replace(temporary, target)
PY
  if [ "$created" = true ]; then
    python3 - "$target" <<'PY' || restored=false
import shutil
import sys

shutil.rmtree(sys.argv[1])
PY
  fi
  [ "$restored" = true ]
}

mutation_started=true
if [ "$target_state" = new ]; then
  if ! git init -q "$target"; then
    printf '{"at":"%s","result":"failed","stage":"target_init"}\n' "$timestamp" > "$receipt"
    exit 1
  fi
  created=true
  if ! git -C "$target" remote add origin "$remote_url"; then
    printf '{"at":"%s","result":"failed","stage":"target_remote"}\n' "$timestamp" > "$receipt"
    exit 1
  fi
  if ! git -C "$target" fetch -q --no-tags origin "$remote_ref"; then
    printf '{"at":"%s","result":"failed","stage":"target_fetch"}\n' "$timestamp" > "$receipt"
    exit 1
  fi
  if ! git -C "$target" checkout -q --detach "$source_sha"; then
    printf '{"at":"%s","result":"failed","stage":"target_checkout"}\n' "$timestamp" > "$receipt"
    exit 1
  fi
  if ! git -C "$target" update-ref "$source_branch_ref" "$source_sha"; then
    printf '{"at":"%s","result":"failed","stage":"target_branch"}\n' "$timestamp" > "$receipt"
    exit 1
  fi
fi

if [ "$(git -C "$target" rev-parse HEAD)" != "$source_sha" ] ||
  [ -n "$(git -C "$target" status --porcelain)" ]; then
  printf '{"at":"%s","result":"failed","stage":"target_verify"}\n' "$timestamp" > "$receipt"
  exit 1
fi
if [ "$(git -C "$target" rev-parse --verify "$source_branch_ref^{commit}")" != "$source_sha" ]; then
  printf '{"at":"%s","result":"failed","stage":"target_branch"}\n' "$timestamp" > "$receipt"
  exit 1
fi

target_git_common_dir=$(git -C "$target" rev-parse --git-common-dir) || {
  printf '{"at":"%s","result":"failed","stage":"target_git_common_dir"}\n' "$timestamp" > "$receipt"
  exit 1
}
case "$target_git_common_dir" in
  /*) ;;
  *) target_git_common_dir="$target/$target_git_common_dir" ;;
esac
target_git_common_dir=$(cd "$target_git_common_dir" && pwd -P) || {
  printf '{"at":"%s","result":"failed","stage":"target_git_common_dir"}\n' "$timestamp" > "$receipt"
  exit 1
}
case "$target_git_common_dir" in
  "$durable_source_root"|"$durable_source_root"/*) ;;
  *)
    printf '{"at":"%s","result":"failed","stage":"target_git_common_dir"}\n' "$timestamp" > "$receipt"
    exit 1
    ;;
esac
[ "$target_git_common_dir" = "$target/.git" ] || {
  printf '{"at":"%s","result":"failed","stage":"target_git_common_dir"}\n' "$timestamp" > "$receipt"
  exit 1
}

if ! python3 - "$pointer" "$target" "$target_git_common_dir" "$source_branch" "$remote_url" "$remote_ref" "$source_sha" "$verified_at" <<'PY'
import json
import os
import sys

path, source_repo, git_common_dir, source_branch, remote_url, remote_ref, remote_sha, migrated_at = sys.argv[1:]
with open(path, encoding="utf-8") as f:
    value = json.load(f)
value["sourceRepo"] = source_repo
value["sourceBranch"] = source_branch
value["sourceGitCommonDir"] = git_common_dir
value["sourceMigratedAt"] = migrated_at
value["sourceRemoteUrl"] = remote_url
value["sourceRemoteRef"] = remote_ref
value["sourceRemoteSha"] = remote_sha
value["sourceRemoteVerifiedAt"] = migrated_at
temporary = path + ".tmp"
with open(temporary, "w", encoding="utf-8") as f:
    json.dump(value, f, indent=2, sort_keys=True)
    f.write("\n")
os.replace(temporary, path)
PY
then
  printf '{"at":"%s","result":"failed","stage":"pointer_update"}\n' "$timestamp" > "$receipt"
  exit 1
fi

if ! OPENCLAW_CUSTOM_RUNTIME_POINTER="$pointer" \
  OPENCLAW_CUSTOM_RUNTIME_DURABLE_SOURCE_ROOT="$durable_source_root" \
  "$launcher" --verify >/dev/null; then
  printf '{"at":"%s","result":"failed","stage":"runtime_verify"}\n' "$timestamp" > "$receipt"
  exit 1
fi

python3 - "$receipt" "$timestamp" "$source_sha" "$target" "$target_git_common_dir" "$source_branch" "$remote_ref" <<'PY'
import json
import os
import sys

path, at, source_sha, source_repo, git_common_dir, source_branch, remote_ref = sys.argv[1:]
temporary = path + ".tmp"
with open(temporary, "w", encoding="utf-8") as f:
    json.dump(
        {
            "at": at,
            "result": "passed",
            "sourceBranch": source_branch,
            "sourceGitCommonDir": git_common_dir,
            "sourceRemoteRef": remote_ref,
            "sourceRepo": source_repo,
            "sourceSha": source_sha,
        },
        f,
        indent=2,
        sort_keys=True,
    )
    f.write("\n")
os.replace(temporary, path)
PY
migration_complete=true
lifecycle_result=source-migration-complete
printf '%s\n' "CUSTOM_RUNTIME_SOURCE_MIGRATED source=$target sha=$source_sha"
