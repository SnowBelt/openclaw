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
mkdir -p "$worktrees" "$receipts"
stamp=$(date -u +%Y%m%dT%H%M%SZ)
candidate="$worktrees/$stamp"
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
for key in ("sourceSha", "sourceRepo", "sourceBranch"):
    item = value.get(key, "")
    print(item if isinstance(item, str) else "")
PY
) || fail active_pointer
active_sha=$(printf '%s\n' "$pointer_fields" | sed -n '1p')
pointer_repo=$(printf '%s\n' "$pointer_fields" | sed -n '2p')
pointer_branch=$(printf '%s\n' "$pointer_fields" | sed -n '3p')
[ -n "$repo" ] || repo=$pointer_repo
[ -n "$branch" ] || branch=$pointer_branch
[ -n "$repo" ] && [ -n "$branch" ] || fail durable_source_config
case "$active_sha" in *[!0-9a-fA-F]*|'') fail durable_source_sha ;; esac
[ "${#active_sha}" -eq 40 ] || fail durable_source_sha
[ -d "$repo/.git" ] || git -C "$repo" rev-parse --git-dir >/dev/null 2>&1 || fail durable_source_repo
[ -z "$(git -C "$repo" status --porcelain)" ] || fail durable_source_dirty
git -C "$repo" cat-file -e "$active_sha^{commit}" 2>/dev/null || fail durable_source_missing_commit
git -C "$repo" rev-parse --verify "$branch^{commit}" >/dev/null 2>&1 || fail durable_source_branch
git -C "$repo" merge-base --is-ancestor "$active_sha" "$branch" || fail durable_source_branch_history
[ -f "$repo/config/custom-runtime-capabilities.json" ] || fail durable_source_capabilities
[ -f "$repo/scripts/custom-runtime/custom-runtime-activate.sh" ] || fail durable_source_control_plane

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

git -C "$repo" worktree add -b "codex/runtime-update-$stamp" "$candidate" "$base_ref" || fail worktree
if ! git -C "$candidate" merge --no-ff --no-edit "$official_ref"; then
  git -C "$candidate" diff --binary > "$candidate/openclaw-update-merge-conflict.patch" || true
  git -C "$candidate" merge --abort || true
  fail merge_conflict
fi
git -C "$candidate" diff --check || fail merge_whitespace
pnpm -C "$candidate" install --frozen-lockfile || fail install
pnpm -C "$candidate" deps:shrinkwrap:generate || fail shrinkwrap_generate
git -C "$candidate" diff --quiet || fail generated_drift
pnpm -C "$candidate" check || fail check
pnpm -C "$candidate" ui:build || fail ui_build
pnpm -C "$candidate" build || fail build
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
pnpm -C "$candidate" ui:smoke:dashboard --artifact-profile release \
  --artifact-root "$candidate/.artifacts/custom-runtime-update" || fail dashboard_smoke
sha=$(git -C "$candidate" rev-parse HEAD)
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
python3 - "$receipt" "$runtime_home/pending-update.json" "$stamp" "$candidate" "$release" \
  "$official_ref" "$active_sha" "$sha" "$repo" "$branch" <<'PY'
import json, os, sys
receipt, pending, at, worktree, release, stable_ref, base_sha, source_sha, repo, branch = sys.argv[1:]
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
}
for target in (receipt, pending):
    temporary = target + ".tmp"
    with open(temporary, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2, sort_keys=True)
        f.write("\n")
    os.replace(temporary, target)
PY
printf '%s\n' "CUSTOM_RUNTIME_UPDATE_READY receipt=$receipt release=$(basename "$release")"
