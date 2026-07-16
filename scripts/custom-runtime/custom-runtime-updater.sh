#!/bin/sh
# Weekly stable update pipeline. It preserves failed worktrees and never mutates production before all gates pass.
set -eu

PATH=/opt/homebrew/opt/node/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin
export PATH

repo=${OPENCLAW_CUSTOM_RUNTIME_REPO:-"$HOME/OpenClaw"}
branch=${OPENCLAW_CUSTOM_RUNTIME_BRANCH:-main}
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

if [ -z "$official_ref" ]; then
  stable_version=$(npm view openclaw dist-tags.latest 2>/dev/null | tr -d '[:space:]') || fail stable_version_lookup
  case "$stable_version" in ''|*[!0-9.]*) fail stable_version_invalid ;; esac
  official_ref="v$stable_version"
fi
git -C "$repo" fetch --prune --tags "$official_remote" || fail fetch
git -C "$repo" rev-parse --verify "$official_ref^{commit}" >/dev/null 2>&1 || fail stable_ref

base_ref=$branch
active_pointer="$runtime_home/active-runtime.json"
active_sha=$(python3 - "$active_pointer" <<'PY'
import json, sys
try:
    value = json.load(open(sys.argv[1], encoding="utf-8")).get("sourceSha", "")
except Exception:
    value = ""
print(value if isinstance(value, str) else "")
PY
)
if [ -n "$active_sha" ] && git -C "$repo" cat-file -e "$active_sha^{commit}" 2>/dev/null; then
  base_ref=$active_sha
fi
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
# Prefer the already-active control plane so a candidate cannot select its own
# policy verifier. Candidate bootstrap is permitted only before the first
# Release Governor-capable runtime exists.
active_auth_helper="$runtime_home/bin/custom-runtime-auth.sh"
candidate_auth_helper="$candidate/scripts/custom-runtime/custom-runtime-auth.sh"
if [ -f "$active_auth_helper" ]; then
  . "$active_auth_helper"
fi
if ! command -v custom_runtime_require_release_governance >/dev/null 2>&1; then
  [ -f "$candidate_auth_helper" ] || fail release_governor_missing
  . "$candidate_auth_helper"
fi
command -v custom_runtime_require_release_governance >/dev/null 2>&1 || fail release_governor_missing
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
custom_runtime_require_release_governance stage "$sha" "$release" || fail release_governor_stage
custom_runtime_require_release_governance promotion "$sha" "$release" || fail release_governor_promotion
"$release/scripts/custom-runtime/custom-runtime-activate.sh" \
  --release "$release" --source-sha "$sha" --stage-port 18790 --port 18789 || fail activate
printf '{"at":"%s","result":"promoted","worktree":"%s","release":"%s","stableRef":"%s"}\n' \
  "$stamp" "$candidate" "$release" "$official_ref" > "$receipt"
