#!/bin/sh
# Weekly stable update broker. It prepares a fully proven immutable candidate but
# never promotes it without a separate approval command.
set -eu

PATH=/opt/homebrew/opt/node/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin
export PATH

repo=${OPENCLAW_CUSTOM_RUNTIME_REPO:-}
branch=${OPENCLAW_CUSTOM_RUNTIME_BRANCH:-}
official_remote=${OPENCLAW_CUSTOM_RUNTIME_OFFICIAL_REMOTE:-origin}
official_ref=${OPENCLAW_CUSTOM_RUNTIME_OFFICIAL_REF:-}
worktrees=${OPENCLAW_CUSTOM_RUNTIME_UPDATE_WORKTREES:-"$HOME/OpenClaw-runtime-updates"}
receipts=${OPENCLAW_CUSTOM_RUNTIME_HOME:-"$HOME/.openclaw-custom-runtime"}/receipts
runtime_home=${OPENCLAW_CUSTOM_RUNTIME_HOME:-"$HOME/.openclaw-custom-runtime"}
releases=${OPENCLAW_CUSTOM_RUNTIME_RELEASES:-"$HOME/.openclaw-runtime-releases"}
durable_source_root=${OPENCLAW_CUSTOM_RUNTIME_DURABLE_SOURCE_ROOT:-"$HOME"}
mkdir -p "$worktrees" "$receipts"
stamp=$(date -u +%Y%m%dT%H%M%SZ)
candidate="$worktrees/$stamp"
update_branch="codex/runtime-update-$stamp"
receipt="$receipts/update-$stamp.json"
fail() { printf '{"at":"%s","result":"failed","stage":"%s","worktree":"%s"}\n' "$stamp" "$1" "$candidate" > "$receipt"; exit 1; }

usage() {
  printf '%s\n' 'usage: custom-runtime-updater.sh [--prepare]' >&2
  exit 64
}
[ $# -eq 0 ] || { [ $# -eq 1 ] && [ "$1" = --prepare ]; } || usage

active_pointer="$runtime_home/active-runtime.json"
[ -f "$active_pointer" ] || fail active_pointer
pointer_fields=$(python3 - "$active_pointer" <<'PY'
import json, sys
with open(sys.argv[1], encoding="utf-8") as f:
    value = json.load(f)
for key in (
    "sourceSha",
    "sourceRepo",
    "sourceGitCommonDir",
    "sourceBranch",
    "sourceRemoteUrl",
    "sourceRemoteRef",
    "sourceRemoteSha",
    "capabilityManifestPath",
):
    item = value.get(key, "")
    print(item if isinstance(item, str) else "")
PY
) || fail active_pointer
active_sha=$(printf '%s\n' "$pointer_fields" | sed -n '1p')
pointer_repo=$(printf '%s\n' "$pointer_fields" | sed -n '2p')
pointer_git_common_dir=$(printf '%s\n' "$pointer_fields" | sed -n '3p')
pointer_branch=$(printf '%s\n' "$pointer_fields" | sed -n '4p')
source_remote_url=$(printf '%s\n' "$pointer_fields" | sed -n '5p')
source_remote_ref=$(printf '%s\n' "$pointer_fields" | sed -n '6p')
source_remote_sha=$(printf '%s\n' "$pointer_fields" | sed -n '7p')
active_capability_manifest=$(printf '%s\n' "$pointer_fields" | sed -n '8p')
[ -n "$repo" ] || repo=$pointer_repo
[ -n "$branch" ] || branch=$pointer_branch
[ -n "$repo" ] && [ -n "$branch" ] || fail durable_source_config
case "$active_sha" in *[!0-9a-fA-F]*|'') fail durable_source_sha ;; esac
[ "${#active_sha}" -eq 40 ] || fail durable_source_sha
[ -d "$repo/.git" ] || git -C "$repo" rev-parse --git-dir >/dev/null 2>&1 || fail durable_source_repo
[ ! -L "$repo" ] || fail durable_source_symlink
repo=$(cd "$repo" && pwd -P) || fail durable_source_repo
[ -d "$durable_source_root" ] || fail durable_source_root
durable_source_root=$(cd "$durable_source_root" && pwd -P) || fail durable_source_root
case "$repo" in
  "$durable_source_root"|"$durable_source_root"/*) ;;
  *) fail durable_source_transient_path ;;
esac
case "$worktrees" in
  "$durable_source_root"|"$durable_source_root"/*) ;;
  *) fail durable_update_worktrees_transient ;;
esac
[ -z "$(git -C "$repo" status --porcelain)" ] || fail durable_source_dirty
[ "$(git -C "$repo" rev-parse --verify HEAD^{commit})" = "$active_sha" ] || fail durable_source_head
repo_git_common_dir=$(git -C "$repo" rev-parse --git-common-dir) || fail durable_source_git_common_dir
case "$repo_git_common_dir" in
  /*) ;;
  *) repo_git_common_dir="$repo/$repo_git_common_dir" ;;
esac
repo_git_common_dir=$(cd "$(dirname "$repo_git_common_dir")" && pwd -P)/$(basename "$repo_git_common_dir")
case "$repo_git_common_dir" in
  "$durable_source_root"|"$durable_source_root"/*) ;;
  *) fail durable_source_git_common_dir_transient ;;
esac
[ "$pointer_git_common_dir" = "$repo_git_common_dir" ] || fail durable_source_git_common_dir_mismatch
git -C "$repo" cat-file -e "$active_sha^{commit}" 2>/dev/null || fail durable_source_missing_commit
case "$branch" in refs/heads/*) branch_ref=$branch ;; *) branch_ref="refs/heads/$branch" ;; esac
git check-ref-format "$branch_ref" >/dev/null 2>&1 || fail durable_source_branch
git -C "$repo" rev-parse --verify "$branch_ref^{commit}" >/dev/null 2>&1 || fail durable_source_branch
git -C "$repo" merge-base --is-ancestor "$active_sha" "$branch_ref" || fail durable_source_branch_history
[ -n "$source_remote_url" ] && [ -n "$source_remote_ref" ] || fail durable_source_remote_config
[ "$source_remote_sha" = "$active_sha" ] || fail durable_source_remote_sha
case "$source_remote_ref" in refs/heads/*|refs/tags/*) ;; *) fail durable_source_remote_ref ;; esac
git check-ref-format "$source_remote_ref" >/dev/null 2>&1 || fail durable_source_remote_ref
python3 - "$source_remote_url" <<'PY' || fail durable_source_remote_url
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
remote_result=$(git ls-remote --exit-code -- "$source_remote_url" "$source_remote_ref" "${source_remote_ref}^{}" 2>/dev/null) || fail durable_source_remote_lookup
remote_sha=$(printf '%s\n' "$remote_result" | awk -v peeled="${source_remote_ref}^{}" '
  $2 == peeled { peeled_sha = $1 }
  !first_sha { first_sha = $1 }
  END { print peeled_sha ? peeled_sha : first_sha }
')
[ "$remote_sha" = "$active_sha" ] || fail durable_source_remote_mismatch
source_provenance_receipt="$receipts/source-provenance-$stamp.json"
python3 - "$source_provenance_receipt" "$active_sha" "$source_remote_url" "$source_remote_ref" <<'PY'
import json
import os
import sys
from datetime import datetime, timezone

target, source_sha, remote_url, remote_ref = sys.argv[1:]
temporary = target + ".tmp"
with open(temporary, "w", encoding="utf-8") as f:
    json.dump(
        {
            "schema": "openclaw.custom-runtime-source-provenance.v1",
            "result": "passed",
            "sourceRemoteRef": remote_ref,
            "sourceRemoteSha": source_sha,
            "sourceRemoteUrl": remote_url,
            "sourceSha": source_sha,
            "verifiedAt": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        },
        f,
        indent=2,
        sort_keys=True,
    )
    f.write("\n")
os.replace(temporary, target)
PY
[ -f "$repo/config/custom-runtime-capabilities.json" ] || fail durable_source_capabilities
[ -f "$repo/scripts/custom-runtime/custom-runtime-activate.sh" ] || fail durable_source_control_plane
active_source_manifest="$receipts/active-capabilities-$stamp.json"
active_source_manifest_tmp="$active_source_manifest.tmp"
git -C "$repo" show "$active_sha:config/custom-runtime-capabilities.json" \
  > "$active_source_manifest_tmp" || fail durable_source_capabilities
mv "$active_source_manifest_tmp" "$active_source_manifest"
if [ -n "$active_capability_manifest" ]; then
  [ -f "$active_capability_manifest" ] || fail durable_source_capabilities
  cmp -s "$active_capability_manifest" "$active_source_manifest" || fail durable_source_capabilities
fi
active_capability_manifest=$active_source_manifest

if [ -z "$official_ref" ]; then
  stable_version=$(npm view openclaw dist-tags.latest 2>/dev/null | tr -d '[:space:]') || fail stable_version_lookup
  case "$stable_version" in ''|*[!0-9.]*) fail stable_version_invalid ;; esac
  official_ref="v$stable_version"
fi
git -C "$repo" fetch --prune --tags "$official_remote" || fail fetch
git -C "$repo" rev-parse --verify "$official_ref^{commit}" >/dev/null 2>&1 || fail stable_ref

base_ref=$active_sha
if git -C "$repo" merge-base --is-ancestor "$official_ref" "$base_ref"; then
  printf '{"at":"%s","result":"no_update","stableRef":"%s","base":"%s"}\n' \
    "$stamp" "$official_ref" "$base_ref" > "$receipt"
  exit 0
fi

git -C "$repo" worktree add -b "$update_branch" "$candidate" "$base_ref" || fail worktree
if ! git -C "$candidate" merge --no-ff --no-edit "$official_ref"; then
  git -C "$candidate" diff --binary > "$candidate/openclaw-update-merge-conflict.patch" || true
  git -C "$candidate" merge --abort || true
  fail merge_conflict
fi
git -C "$candidate" diff --check || fail merge_whitespace
pnpm -C "$candidate" install --frozen-lockfile || fail install
pnpm -C "$candidate" deps:shrinkwrap:generate || fail shrinkwrap_generate
git -C "$candidate" diff --quiet || fail generated_drift
sha=$(git -C "$candidate" rev-parse HEAD)
candidate_remote_url=$repo
candidate_remote_ref="refs/heads/$update_branch"
candidate_remote_result=$(git ls-remote --exit-code -- "$candidate_remote_url" "$candidate_remote_ref" "${candidate_remote_ref}^{}" 2>/dev/null) || fail candidate_source_provenance
candidate_remote_sha=$(printf '%s\n' "$candidate_remote_result" | awk -v peeled="${candidate_remote_ref}^{}" '
  $2 == peeled { peeled_sha = $1 }
  !first_sha { first_sha = $1 }
  END { print peeled_sha ? peeled_sha : first_sha }
')
[ "$candidate_remote_sha" = "$sha" ] || fail candidate_source_provenance
survival_receipt="$receipts/update-survival-$stamp.json"
pnpm -C "$candidate" custom-runtime:update-survival -- \
  --repo "$candidate" \
  --active-sha "$active_sha" \
  --official-ref "$official_ref" \
  --candidate-sha "$sha" \
  --active-manifest "$active_capability_manifest" \
  --candidate-manifest "$candidate/config/custom-runtime-capabilities.json" \
  --output "$survival_receipt" || fail update_survival
verification_commands="$receipts/update-verification-commands-$stamp.txt"
python3 - "$candidate/config/custom-runtime-capabilities.json" "$sha" "$verification_commands" <<'PY'
import json, sys

manifest_path, source_sha, output = sys.argv[1:]
with open(manifest_path, encoding="utf-8") as f:
    manifest = json.load(f)
preservation = manifest.get("preservation")
commands = preservation.get("verificationCommands") if isinstance(preservation, dict) else None
if not isinstance(commands, list) or not commands or any(not isinstance(item, str) or not item.strip() for item in commands):
    raise SystemExit("preservation verification commands are invalid")
with open(output + ".tmp", "w", encoding="utf-8") as f:
    for command in commands:
        f.write(command.replace("<candidate-sha>", source_sha) + "\n")
import os
os.replace(output + ".tmp", output)
PY
while IFS= read -r verification_command || [ -n "$verification_command" ]; do
  (cd "$candidate" && /bin/sh -c "$verification_command") || fail verification_commands
done < "$verification_commands"
python3 - "$survival_receipt" "$verification_commands" <<'PY'
import datetime, json, os, sys

proof_path, commands_path = sys.argv[1:]
with open(proof_path, encoding="utf-8") as f:
    proof = json.load(f)
with open(commands_path, encoding="utf-8") as f:
    commands = [line.rstrip("\n") for line in f if line.strip()]
proof["executedVerificationCommands"] = commands
proof["verificationResult"] = "passed"
proof["verifiedAt"] = datetime.datetime.now(datetime.timezone.utc).isoformat().replace("+00:00", "Z")
with open(proof_path + ".tmp", "w", encoding="utf-8") as f:
    json.dump(proof, f, indent=2, sort_keys=True)
    f.write("\n")
os.replace(proof_path + ".tmp", proof_path)
PY
survival_receipt_sha=$(shasum -a 256 "$survival_receipt" | awk '{print $1}')
pnpm -C "$candidate" test \
  src/pcc/project-workflows.test.ts src/pcc/work-loop.test.ts \
  ui/src/ui/controllers/pcc.test.ts ui/src/ui/views/pcc.test.ts \
  ui/src/ui/pcc-context-package.test.ts src/gateway/server-methods/pcc.test.ts \
  src/pcc/production-truth.test.ts src/commands/doctor/shared/legacy-config-migrate.test.ts \
  || fail pcc_tests
pnpm -C "$candidate" test \
  packages/gateway-protocol/src/schema/pcc.test.ts \
  src/agents/control-director-contract.test.ts \
  src/agents/control-director-delivery-guards.test.ts \
  src/agents/control-director-truth-evidence.test.ts \
  src/gateway/pattern-lab-dashboard-data.test.ts \
  src/gateway/server-methods/kalshi-dashboard.test.ts \
  src/gateway/server-methods/pattern-lab-dashboard.test.ts \
  src/gateway/server-methods/snes-studio-benchmark.test.ts \
  ui/src/ui/chat/control-director-diagnostics.test.ts \
  ui/src/ui/controllers/book-writer-dashboard.test.ts \
  ui/src/ui/controllers/kalshi-dashboard.test.ts \
  ui/src/ui/navigation-groups.test.ts ui/src/ui/navigation.browser.test.ts \
  ui/src/ui/navigation.test.ts ui/src/ui/storage.node.test.ts \
  ui/src/ui/views/app-studio-dashboard.test.ts \
  ui/src/ui/views/book-writer-dashboard.test.ts \
  ui/src/ui/views/kalshi-dashboard.test.ts ui/src/ui/views/music-studio.test.ts \
  ui/src/ui/views/pattern-lab-dashboard.test.ts ui/src/ui/views/snes-studio.test.ts \
  src/cli/daemon-cli/install.test.ts src/commands/daemon-install-helpers.test.ts \
  || fail custom_surface_tests
[ -z "$(git -C "$candidate" status --porcelain)" ] || fail verified_source_drift
short_sha=$(printf '%s' "$sha" | cut -c1-8)
release="$releases/$stamp-$short_sha"
[ ! -e "$release" ] || fail release_exists
mkdir -m 700 "$release" || fail release_create
ulimit -n 65536 2>/dev/null || true
previous_release=$(python3 - "$active_pointer" <<'PY'
import json, sys
try:
    value = json.load(open(sys.argv[1], encoding="utf-8")).get("runtimeRoot", "")
except Exception:
    value = ""
print(value if isinstance(value, str) else "")
PY
)
if [ -d "$previous_release" ]; then
  rsync -a --delete --exclude '.git' --exclude '.artifacts' --exclude '.openclaw-production-sha' \
    --link-dest="$previous_release" "$candidate/" "$release/" || fail snapshot
else
  rsync -a --delete --exclude '.git' --exclude '.artifacts' --exclude '.openclaw-production-sha' \
    "$candidate/" "$release/" || fail snapshot
fi
printf '%s\n' "$sha" > "$release/.openclaw-production-sha"
python3 - "$candidate/.artifacts/openclaw-gateway-runtime/latest.json" "$release" <<'PY'
import json, os, sys

latest_path, release = sys.argv[1:]
with open(latest_path, encoding="utf-8") as f:
    latest = json.load(f)
snapshot_root = latest.get("root")
if not isinstance(snapshot_root, str) or not snapshot_root:
    raise SystemExit("latest Gateway runtime snapshot root is missing")
with open(os.path.join(snapshot_root, "snapshot.json"), encoding="utf-8") as f:
    snapshot = json.load(f)
if snapshot.get("root") != snapshot_root:
    raise SystemExit("latest Gateway runtime snapshot provenance root mismatch")
snapshot["root"] = release
snapshot["paths"] = {
    "entrypoint": os.path.join(release, "dist", "index.js"),
    "controlUi": os.path.join(release, "dist", "control-ui"),
    "bundledPlugins": os.path.join(release, "dist-runtime", "extensions"),
}
target = os.path.join(release, "snapshot.json")
with open(target, "w", encoding="utf-8") as f:
    json.dump(snapshot, f, indent=2, sort_keys=True)
    f.write("\n")
PY
"$(dirname "$0")/custom-runtime-seal.sh" --seal --release "$release" || fail release_seal
python3 - "$receipt" "$runtime_home/pending-update.json" "$stamp" "$candidate" "$release" \
  "$official_ref" "$active_sha" "$sha" "$repo" "$repo_git_common_dir" "$update_branch" \
  "$candidate_remote_url" "$candidate_remote_ref" "$candidate_remote_sha" "$survival_receipt" \
  "$survival_receipt_sha" "$verification_commands" <<'PY'
import json, os, sys
(
    receipt,
    pending,
    at,
    worktree,
    release,
    stable_ref,
    base_sha,
    source_sha,
    repo,
    git_common_dir,
    branch,
    remote_url,
    remote_ref,
    remote_sha,
    proof_path,
    proof_sha,
    commands_path,
) = sys.argv[1:]
with open(commands_path, encoding="utf-8") as f:
    verification_commands = [line.rstrip("\n") for line in f if line.strip()]
data = {
    "schema": "openclaw.custom-runtime-update-candidate.v1",
    "at": at,
    "result": "ready_for_approval",
    "worktree": worktree,
    "release": release,
    "stableRef": stable_ref,
    "baseSha": base_sha,
    "sourceSha": source_sha,
    "sourceRepo": worktree,
    "sourceGitCommonDir": git_common_dir,
    "sourceBranch": branch,
    "sourceRemoteUrl": remote_url,
    "sourceRemoteRef": remote_ref,
    "sourceRemoteSha": remote_sha,
    "preservationProof": {
        "path": os.path.realpath(proof_path),
        "sha256": proof_sha,
        "schema": "openclaw.custom-runtime-update-survival.v1",
    },
    "verificationCommands": verification_commands,
    "verificationResult": "passed",
}
for target in (receipt, pending):
    temporary = target + ".tmp"
    with open(temporary, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2, sort_keys=True)
        f.write("\n")
    os.replace(temporary, target)
PY
printf '%s\n' "CUSTOM_RUNTIME_UPDATE_READY receipt=$receipt release=$(basename "$release")"
