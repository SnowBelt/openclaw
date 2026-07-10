#!/bin/sh
# Weekly stable update pipeline. It preserves failed worktrees and never mutates production before all gates pass.
set -eu

PATH=/opt/homebrew/opt/node/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin
export PATH

repo=${OPENCLAW_CUSTOM_RUNTIME_REPO:-"$HOME/OpenClaw-pcc-unified-v2-20260710"}
branch=${OPENCLAW_CUSTOM_RUNTIME_BRANCH:-codex/pcc-unified-v2-20260710}
official_ref=${OPENCLAW_CUSTOM_RUNTIME_OFFICIAL_REF:-SnowBelt/main}
worktrees=${OPENCLAW_CUSTOM_RUNTIME_UPDATE_WORKTREES:-"$HOME/OpenClaw-runtime-updates"}
receipts=${OPENCLAW_CUSTOM_RUNTIME_HOME:-"$HOME/.openclaw-custom-runtime"}/receipts
runtime_home=${OPENCLAW_CUSTOM_RUNTIME_HOME:-"$HOME/.openclaw-custom-runtime"}
releases=${OPENCLAW_CUSTOM_RUNTIME_RELEASES:-"$HOME/.openclaw-runtime-releases"}
mkdir -p "$worktrees" "$receipts"
stamp=$(date -u +%Y%m%dT%H%M%SZ)
candidate="$worktrees/$stamp"
receipt="$receipts/update-$stamp.json"
fail() { printf '{"at":"%s","result":"failed","stage":"%s","worktree":"%s"}\n' "$stamp" "$1" "$candidate" > "$receipt"; exit 1; }

git -C "$repo" fetch --prune SnowBelt || fail fetch
git -C "$repo" worktree add -b "codex/runtime-update-$stamp" "$candidate" "$branch" || fail worktree
if ! git -C "$candidate" merge --no-commit --no-ff "$official_ref"; then
  git -C "$candidate" merge --abort || true
  fail merge_conflict
fi
pnpm -C "$candidate" install --frozen-lockfile || fail install
pnpm -C "$candidate" check || fail check
pnpm -C "$candidate" ui:build || fail ui_build
pnpm -C "$candidate" build || fail build
pnpm -C "$candidate" ui:smoke:dashboard || fail dashboard_smoke
sha=$(git -C "$candidate" rev-parse HEAD)
release="$releases/$stamp-${sha%?????????????????????????????????}"
[ ! -e "$release" ] || fail release_exists
rsync -a --exclude '.git' --exclude '.artifacts' "$candidate/" "$release/" || fail snapshot
printf '%s\n' "$sha" > "$release/.openclaw-production-sha"
"$runtime_home/bin/custom-runtime-stage.sh" --release "$release" --source-sha "$sha" --port 18790 || fail stage
"$runtime_home/bin/custom-runtime-promote.sh" --release "$release" --source-sha "$sha" --port 18789 || fail promote
printf '{"at":"%s","result":"promoted","worktree":"%s"}\n' "$stamp" "$candidate" > "$receipt"
