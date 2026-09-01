#!/bin/sh
# Weekly stable update broker. It prepares a fully proven immutable candidate but
# never promotes it without a separate approval command.
set -eu

PATH=/opt/homebrew/opt/node/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin
export PATH

repo=${OPENCLAW_CUSTOM_RUNTIME_REPO:-}
branch=${OPENCLAW_CUSTOM_RUNTIME_BRANCH:-}
official_remote=${OPENCLAW_CUSTOM_RUNTIME_OFFICIAL_REMOTE:-openclaw-official}
official_url=${OPENCLAW_CUSTOM_RUNTIME_OFFICIAL_URL:-https://github.com/openclaw/openclaw.git}
official_ref=${OPENCLAW_CUSTOM_RUNTIME_OFFICIAL_REF:-}
worktrees=${OPENCLAW_CUSTOM_RUNTIME_UPDATE_WORKTREES:-"$HOME/OpenClaw-runtime-updates"}
receipts=${OPENCLAW_CUSTOM_RUNTIME_HOME:-"$HOME/.openclaw-custom-runtime"}/receipts
runtime_home=${OPENCLAW_CUSTOM_RUNTIME_HOME:-"$HOME/.openclaw-custom-runtime"}
releases=${OPENCLAW_CUSTOM_RUNTIME_RELEASES:-"$HOME/.openclaw-runtime-releases"}
mkdir -p "$worktrees" "$receipts"
stamp=$(date -u +%Y%m%dT%H%M%SZ)
candidate="$worktrees/$stamp"
update_branch="codex/runtime-update-$stamp"
receipt="$receipts/update-$stamp.json"
fail() {
  printf '{"at":"%s","result":"failed","stage":"%s","worktree":"%s"}\n' "$stamp" "$1" "$candidate" > "$receipt"
  exit 1
}
preparation_lock="$runtime_home/update-preparation.lock"
acquire_result=$(python3 - "$preparation_lock" "$receipts" "$stamp" <<'PY'
import datetime, json, os, stat, sys

lock, receipts, stamp = sys.argv[1:]
try:
    os.mkdir(lock, 0o700)
except FileExistsError:
    info = os.lstat(lock)
    if not stat.S_ISDIR(info.st_mode) or stat.S_ISLNK(info.st_mode):
        raise SystemExit("unsafe")
    age = max(0, datetime.datetime.now().timestamp() - info.st_mtime)
    owner_alive = False
    try:
        with open(os.path.join(lock, "owner.json"), encoding="utf-8") as f:
            owner = json.load(f)
        pid = owner.get("pid") if isinstance(owner, dict) else None
        if isinstance(pid, int) and not isinstance(pid, bool) and pid > 0:
            os.kill(pid, 0)
            owner_alive = True
    except (FileNotFoundError, json.JSONDecodeError, OSError, TypeError, ValueError):
        owner_alive = False
    if owner_alive or age < 30 * 60:
        raise SystemExit("running")
    recovered = os.path.join(receipts, f"stale-update-preparation-lock-{stamp}")
    os.replace(lock, recovered)
    os.mkdir(lock, 0o700)
with open(os.path.join(lock, "owner.json"), "x", encoding="utf-8") as f:
    json.dump({"pid": os.getppid(), "startedAt": stamp}, f, sort_keys=True)
    f.write("\n")
print("acquired")
PY
) || fail preparation_lock
[ "$acquire_result" = acquired ] || fail preparation_lock
release_preparation_lock() {
  rm -f "$preparation_lock/owner.json"
  rmdir "$preparation_lock" 2>/dev/null || true
}
trap release_preparation_lock EXIT
trap 'exit 129' HUP
trap 'exit 130' INT
trap 'exit 143' TERM

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
print(value.get("sourceSha", "") if isinstance(value.get("sourceSha"), str) else "")
provenance = value.get("sourceProvenance")
if not isinstance(provenance, dict):
    provenance = {}
for key in ("recordPath", "recordSha256", "treeSha"):
    item = provenance.get(key, "")
    print(item if isinstance(item, str) else "")
PY
) || fail active_pointer
active_sha=$(printf '%s\n' "$pointer_fields" | sed -n '1p')
provenance_record=$(printf '%s\n' "$pointer_fields" | sed -n '2p')
provenance_record_sha=$(printf '%s\n' "$pointer_fields" | sed -n '3p')
provenance_tree=$(printf '%s\n' "$pointer_fields" | sed -n '4p')
case "$active_sha" in *[!0-9a-fA-F]*|'') fail durable_source_sha ;; esac
[ "${#active_sha}" -eq 40 ] || [ "${#active_sha}" -eq 64 ] || fail durable_source_sha
if [ -n "$provenance_record" ]; then
  [ -n "$provenance_record_sha" ] && [ -n "$provenance_tree" ] || fail durable_source_provenance
  [ -f "$provenance_record" ] && [ ! -L "$provenance_record" ] || fail durable_source_provenance
  [ "$(shasum -a 256 "$provenance_record" | awk '{print $1}')" = "$provenance_record_sha" ] || fail durable_source_provenance
  provenance_helper="$runtime_home/bin/custom-runtime-source-provenance.mjs"
  [ -f "$provenance_helper" ] && [ ! -L "$provenance_helper" ] || fail durable_source_provenance
  verified_provenance=$("${OPENCLAW_NODE_BIN:-node}" "$provenance_helper" verify \
    --record "$provenance_record" --expected-sha "$active_sha" --deep true) \
    || fail durable_source_provenance
  provenance_fields=$(printf '%s' "$verified_provenance" | python3 -c '
import json,sys
value=json.load(sys.stdin)
for key in ("storePath", "sourceRemote", "sourceRemoteBranch"):
    item=value.get(key)
    if not isinstance(item, str) or not item:
        raise SystemExit(f"verified provenance omitted {key}")
    print(item)
') \
    || fail durable_source_provenance
  provenance_store=$(printf '%s\n' "$provenance_fields" | sed -n '1p')
  source_remote=$(printf '%s\n' "$provenance_fields" | sed -n '2p')
  source_remote_branch=$(printf '%s\n' "$provenance_fields" | sed -n '3p')
  [ "$source_remote" = "https://github.com/SnowBelt/openclaw.git" ] || \
    fail durable_source_remote
  [ -n "$provenance_store" ] || fail durable_source_provenance
  [ -d "$provenance_store" ] && [ ! -L "$provenance_store" ] || fail durable_source_provenance
  source_git() { git --git-dir "$provenance_store" "$@"; }
  repo="$provenance_store"
  branch="refs/provenance/$active_sha"
else
  fail durable_source_provenance
fi
source_git cat-file -e "$active_sha^{commit}" 2>/dev/null || fail durable_source_missing_commit
source_git rev-parse --verify "$branch^{commit}" >/dev/null 2>&1 || fail durable_source_branch
source_git rev-parse "$active_sha^{tree}" >/dev/null 2>&1 || fail durable_source_tree
active_source_manifest="$receipts/active-capabilities-$stamp.json"
active_source_manifest_tmp="$active_source_manifest.tmp"
source_git show "$active_sha:config/custom-runtime-capabilities.json" \
  > "$active_source_manifest_tmp" || fail durable_source_capabilities
mv "$active_source_manifest_tmp" "$active_source_manifest"
active_capability_manifest=$active_source_manifest
backup_helper="$runtime_home/bin/custom-runtime-update-backup.mjs"
[ -f "$backup_helper" ] && [ ! -L "$backup_helper" ] || fail verified_backup_tool
backup_result=$("${OPENCLAW_NODE_BIN:-node}" "$backup_helper" create \
  --runtime-home "$runtime_home") || fail verified_backup
backup_fields=$(printf '%s' "$backup_result" | python3 -c '
import json, sys
value = json.load(sys.stdin)
for key in ("receiptPath", "receiptSha256", "sourceSha"):
    item = value.get(key)
    if not isinstance(item, str) or not item:
        raise SystemExit(f"backup result omitted {key}")
    print(item)
if value.get("result") != "passed" or value.get("backupVerified") is not True or value.get("restoreDrill", {}).get("result") != "passed":
    raise SystemExit("backup result did not pass")
') || fail verified_backup
backup_receipt=$(printf '%s\n' "$backup_fields" | sed -n '1p')
backup_receipt_sha=$(printf '%s\n' "$backup_fields" | sed -n '2p')
[ "$(printf '%s\n' "$backup_fields" | sed -n '3p')" = "$active_sha" ] || fail verified_backup
published_active_sha=$(git ls-remote "$source_remote" "refs/heads/$source_remote_branch" | \
  awk 'NR == 1 { print $1 }') || fail durable_source_remote
[ "$published_active_sha" = "$active_sha" ] || fail durable_source_remote

if [ -z "$official_ref" ]; then
  stable_version=$(npm view openclaw dist-tags.latest 2>/dev/null | tr -d '[:space:]') || fail stable_version_lookup
  printf '%s\n' "$stable_version" | grep -Eq \
    '^[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z][0-9A-Za-z.-]*)?$' || fail stable_version_invalid
  official_ref="v$stable_version"
fi
case "$official_remote" in *[!A-Za-z0-9._-]*|'') fail official_remote_invalid ;; esac
case "$official_url" in https://github.com/openclaw/openclaw.git) ;; *) fail official_url_invalid ;; esac
if source_git remote get-url "$official_remote" >/dev/null 2>&1; then
  [ "$(source_git remote get-url "$official_remote")" = "$official_url" ] || fail official_remote_mismatch
else
  source_git remote add "$official_remote" "$official_url" || fail official_remote_add
fi
source_git fetch --prune --tags "$official_remote" || fail fetch
source_git rev-parse --verify "$official_ref^{commit}" >/dev/null 2>&1 || fail stable_ref

base_ref=$active_sha
if source_git merge-base --is-ancestor "$official_ref" "$base_ref"; then
  printf '{"at":"%s","result":"no_update","stableRef":"%s","base":"%s"}\n' \
    "$stamp" "$official_ref" "$base_ref" > "$receipt"
  exit 0
fi

git clone --no-local --no-checkout "$provenance_store" "$candidate" || fail candidate_clone
git -C "$candidate" fetch --no-tags origin "$branch:$branch" || fail candidate_base_fetch
git -C "$candidate" switch -c "$update_branch" "$branch" || fail candidate_branch
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
github_proof_helper="$candidate/scripts/custom-runtime/custom-runtime-update-github-proof.mjs"
[ -f "$github_proof_helper" ] && [ ! -L "$github_proof_helper" ] || fail github_proof_tool
github_proof_receipt="$receipts/update-github-proof-$stamp.json"
github_proof_result=$("${OPENCLAW_NODE_BIN:-node}" "$github_proof_helper" run \
  --source "$candidate" --sha "$sha" --branch "$update_branch" \
  --receipt "$github_proof_receipt") || fail github_proof
github_proof_fields=$(printf '%s' "$github_proof_result" | python3 -c '
import json, sys
value = json.load(sys.stdin)
for key in ("receiptPath", "receiptSha256", "sourceSha"):
    item = value.get(key)
    if not isinstance(item, str) or not item:
        raise SystemExit(f"GitHub proof result omitted {key}")
    print(item)
if value.get("result") != "passed":
    raise SystemExit("GitHub proof did not pass")
') || fail github_proof
github_proof_receipt=$(printf '%s\n' "$github_proof_fields" | sed -n '1p')
github_proof_receipt_sha=$(printf '%s\n' "$github_proof_fields" | sed -n '2p')
[ "$(printf '%s\n' "$github_proof_fields" | sed -n '3p')" = "$sha" ] || fail github_proof
[ "$(git -C "$candidate" rev-parse HEAD)" = "$sha" ] || fail github_proof_source_drift
[ -z "$(git -C "$candidate" status --porcelain --untracked-files=all)" ] || \
  fail github_proof_source_drift
candidate_provenance=$("${OPENCLAW_NODE_BIN:-node}" \
  "$candidate/scripts/custom-runtime/custom-runtime-source-provenance.mjs" import \
  --source "$candidate" --source-sha "$sha" --runtime-home "$runtime_home" \
  --source-remote "https://github.com/SnowBelt/openclaw.git" \
  --source-remote-branch "$update_branch") \
  || fail candidate_source_provenance
candidate_provenance_fields=$(printf '%s' "$candidate_provenance" | python3 -c '
import json, sys
value = json.load(sys.stdin)
for key in ("recordPath", "treeSha", "objectFormat", "storePath", "bundlePath", "bundleSha256", "sourceRemote", "sourceRemoteBranch"):
    item = value.get(key)
    if not isinstance(item, str) or not item:
        raise SystemExit(f"candidate provenance omitted {key}")
    print(item)
') || fail candidate_source_provenance
candidate_provenance_record=$(printf '%s\n' "$candidate_provenance_fields" | sed -n '1p')
candidate_provenance_tree=$(printf '%s\n' "$candidate_provenance_fields" | sed -n '2p')
candidate_provenance_format=$(printf '%s\n' "$candidate_provenance_fields" | sed -n '3p')
candidate_provenance_store=$(printf '%s\n' "$candidate_provenance_fields" | sed -n '4p')
candidate_provenance_bundle=$(printf '%s\n' "$candidate_provenance_fields" | sed -n '5p')
candidate_provenance_bundle_sha=$(printf '%s\n' "$candidate_provenance_fields" | sed -n '6p')
candidate_source_remote=$(printf '%s\n' "$candidate_provenance_fields" | sed -n '7p')
candidate_source_remote_branch=$(printf '%s\n' "$candidate_provenance_fields" | sed -n '8p')
candidate_provenance_record_sha=$(shasum -a 256 "$candidate_provenance_record" | awk '{print $1}')
repo=$candidate_provenance_store
branch="refs/provenance/$sha"
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
python3 - "$release/.openclaw-runtime-provenance.json" "$sha" \
  "$candidate_provenance_tree" "$candidate_provenance_format" "$candidate_provenance_record" \
  "$candidate_provenance_record_sha" "$candidate_provenance_store" "$candidate_provenance_bundle" \
  "$candidate_provenance_bundle_sha" "$candidate_source_remote" \
  "$candidate_source_remote_branch" <<'PY'
import json, os, sys

target, source_sha, tree_sha, object_format, record_path, record_sha, store_path, bundle_path, bundle_sha, source_remote, source_remote_branch = sys.argv[1:]
with open(target, "w", encoding="utf-8") as f:
    json.dump({
        "schema": "openclaw.custom-runtime-runtime-provenance.v1",
        "sourceSha": source_sha,
        "treeSha": tree_sha,
        "objectFormat": object_format,
        "recordPath": os.path.realpath(record_path),
        "recordSha256": record_sha,
        "storePath": os.path.realpath(store_path),
        "bundlePath": os.path.realpath(bundle_path),
        "bundleSha256": bundle_sha,
        "sourceRemote": source_remote,
        "sourceRemoteBranch": source_remote_branch,
    }, f, indent=2, sort_keys=True)
    f.write("\n")
PY
python3 - "$candidate/.artifacts/openclaw-gateway-runtime/latest.json" "$release" \
  "$repo" <<'PY'
import hashlib, json, os, sys

latest_path, release, source_repo = sys.argv[1:]
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
source = snapshot.get("source")
if not isinstance(source, dict):
    raise SystemExit("latest Gateway runtime snapshot source is missing")
provenance_path = os.path.join(release, ".openclaw-runtime-provenance.json")
with open(provenance_path, "rb") as f:
    provenance_sha = hashlib.sha256(f.read()).hexdigest()
source["root"] = source_repo
source["provenancePath"] = provenance_path
source["provenanceSha256"] = provenance_sha
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
  "$official_ref" "$active_sha" "$sha" "$repo" "$branch" "$survival_receipt" \
  "$survival_receipt_sha" "$verification_commands" "$backup_receipt" \
  "$backup_receipt_sha" "$github_proof_receipt" "$github_proof_receipt_sha" <<'PY'
import json, os, sys
receipt, pending, at, worktree, release, stable_ref, base_sha, source_sha, repo, branch, proof_path, proof_sha, commands_path, backup_path, backup_sha, github_path, github_sha = sys.argv[1:]
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
    "sourceRepo": repo,
    "sourceBranch": branch,
    "preservationProof": {
        "path": os.path.realpath(proof_path),
        "sha256": proof_sha,
        "schema": "openclaw.custom-runtime-update-survival.v1",
    },
    "verificationCommands": verification_commands,
    "verificationResult": "passed",
    "verifiedBackup": {
        "path": os.path.realpath(backup_path),
        "sha256": backup_sha,
        "schema": "openclaw.custom-runtime-update-backup.v1",
        "sourceSha": base_sha,
    },
    "repositoryProof": {
        "path": os.path.realpath(github_path),
        "sha256": github_sha,
        "schema": "openclaw.custom-runtime-github-proof.v1",
        "sourceSha": source_sha,
    },
}
for target in (receipt, pending):
    temporary = target + ".tmp"
    with open(temporary, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2, sort_keys=True)
        f.write("\n")
    os.replace(temporary, target)
PY
printf '%s\n' "CUSTOM_RUNTIME_UPDATE_READY receipt=$receipt release=$(basename "$release")"
