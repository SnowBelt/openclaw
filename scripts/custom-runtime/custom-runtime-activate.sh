#!/bin/sh
# Stages one candidate, installs its control plane transactionally, and promotes it.
set -eu

runtime_home=${OPENCLAW_CUSTOM_RUNTIME_HOME:-"$HOME/.openclaw-custom-runtime"}
releases_dir=${OPENCLAW_CUSTOM_RUNTIME_RELEASES:-"$HOME/.openclaw-runtime-releases"}
plist=${OPENCLAW_GATEWAY_PLIST:-"$HOME/Library/LaunchAgents/ai.openclaw.gateway.plist"}
label=${OPENCLAW_GATEWAY_LABEL:-ai.openclaw.gateway}
uid=$(id -u)
managed_files='custom-runtime-activate.sh custom-runtime-guard.sh custom-runtime-launcher.sh custom-runtime-promote.sh custom-runtime-restart.sh custom-runtime-rollback.sh custom-runtime-stage.sh custom-runtime-updater.sh copy_stage_state.py'

usage() {
  printf '%s\n' 'usage: custom-runtime-activate.sh --release PATH --source-sha SHA [--stage-port 18790] [--port 18789] [--enable-sig-background]' >&2
  exit 64
}

release= source_sha= stage_port=18790 port=18789 enable_sig_background=false
while [ $# -gt 0 ]; do
  case "$1" in
    --release) release=${2:-}; shift 2 ;;
    --source-sha) source_sha=${2:-}; shift 2 ;;
    --stage-port) stage_port=${2:-}; shift 2 ;;
    --port) port=${2:-}; shift 2 ;;
    --enable-sig-background) enable_sig_background=true; shift ;;
    *) usage ;;
  esac
done
[ -n "$release" ] && [ -n "$source_sha" ] || usage
case "$source_sha" in *[!0-9a-fA-F]*|'') usage ;; esac
release=$(cd "$release" && pwd -P)
releases_dir=$(cd "$releases_dir" && pwd -P)
case "$release" in "$releases_dir"/*) ;; *) printf '%s\n' 'release must be under the immutable releases root' >&2; exit 64 ;; esac

control_source="$release/scripts/custom-runtime"
for file in $managed_files; do
  [ -f "$control_source/$file" ] || {
    printf '%s\n' "candidate control-plane file is missing: $file" >&2
    exit 64
  }
  case "$file" in
    *.sh) sh -n "$control_source/$file" ;;
    *.py)
      python3 - "$control_source/$file" <<'PY'
from pathlib import Path
import sys

path = Path(sys.argv[1])
compile(path.read_text(), str(path), "exec")
PY
      ;;
  esac
done
stamp_file="$release/.openclaw-production-sha"
[ -f "$stamp_file" ] && [ "$(tr -d '[:space:]' < "$stamp_file")" = "$source_sha" ] || {
  printf '%s\n' 'candidate release source stamp mismatch' >&2
  exit 64
}

mkdir -p "$runtime_home/backups" "$runtime_home/bin" "$runtime_home/locks" "$runtime_home/receipts"
activation_lock="$runtime_home/locks/activation.lock"
if ! mkdir "$activation_lock" 2>/dev/null; then
  printf '%s\n' 'another custom-runtime activation is already active' >&2
  exit 75
fi

stamp=$(date -u +%Y%m%dT%H%M%SZ)
backup="$runtime_home/backups/control-plane-$stamp"
mkdir "$backup"
control_installed=false
committed=false
rollback_attempted=false

restore_control_plane() {
  for file in $managed_files; do
    if [ -f "$backup/$file" ]; then
      install -m 700 "$backup/$file" "$runtime_home/bin/.$file.restore-$$"
      mv "$runtime_home/bin/.$file.restore-$$" "$runtime_home/bin/$file"
    else
      rm -f "$runtime_home/bin/$file"
    fi
  done
}

restart_restored_gateway() {
  launchctl bootout "gui/$uid/$label" 2>/dev/null || true
  for _ in $(seq 1 15); do
    launchctl print "gui/$uid/$label" >/dev/null 2>&1 || break
    sleep 1
  done
  launchctl bootstrap "gui/$uid" "$plist" || return 1
  for _ in $(seq 1 45); do
    if curl --silent --fail --max-time 3 "http://127.0.0.1:$port/health" | grep -q '"ok":true'; then
      "$runtime_home/bin/custom-runtime-launcher.sh" --verify >/dev/null 2>&1
      return $?
    fi
    sleep 2
  done
  return 1
}

rollback_activation() {
  rollback_attempted=true
  restore_control_plane
  if restart_restored_gateway; then
    printf '{"at":"%s","result":"rolled_back_verified","release":"%s"}\n' \
      "$stamp" "$(basename "$release")" > "$runtime_home/receipts/activation-$stamp.json"
    return 0
  fi
  printf '{"at":"%s","result":"rollback_failed","release":"%s"}\n' \
    "$stamp" "$(basename "$release")" > "$runtime_home/receipts/activation-$stamp.json"
  return 1
}

cleanup() {
  status=$?
  trap - EXIT INT TERM
  if [ "$status" -ne 0 ] && [ "$control_installed" = true ] && \
     [ "$committed" = false ] && [ "$rollback_attempted" = false ]; then
    rollback_activation || status=1
  fi
  rmdir "$activation_lock" 2>/dev/null || true
  exit "$status"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

OPENCLAW_CUSTOM_RUNTIME_LAUNCHER="$control_source/custom-runtime-launcher.sh" \
  "$control_source/custom-runtime-stage.sh" \
  --release "$release" --source-sha "$source_sha" --port "$stage_port"

for file in $managed_files; do
  [ ! -f "$runtime_home/bin/$file" ] || cp -p "$runtime_home/bin/$file" "$backup/$file"
done
control_installed=true
for file in $managed_files; do
  install -m 700 "$control_source/$file" "$runtime_home/bin/.$file.candidate-$$"
  mv "$runtime_home/bin/.$file.candidate-$$" "$runtime_home/bin/$file"
done

rollback_launcher=
[ ! -f "$backup/custom-runtime-launcher.sh" ] || rollback_launcher="$backup/custom-runtime-launcher.sh"
if [ "$enable_sig_background" = true ]; then
  OPENCLAW_CUSTOM_RUNTIME_ROLLBACK_LAUNCHER="$rollback_launcher" \
    "$runtime_home/bin/custom-runtime-promote.sh" \
    --release "$release" --source-sha "$source_sha" --port "$port" \
    --enable-sig-background || exit 1
else
  OPENCLAW_CUSTOM_RUNTIME_ROLLBACK_LAUNCHER="$rollback_launcher" \
    "$runtime_home/bin/custom-runtime-promote.sh" \
    --release "$release" --source-sha "$source_sha" --port "$port" || exit 1
fi

committed=true
printf '{"at":"%s","result":"activated","release":"%s","sourceSha":"%s","sigBackgroundEnabled":%s}\n' \
  "$stamp" "$(basename "$release")" "$source_sha" "$enable_sig_background" > "$runtime_home/receipts/activation-$stamp.json"
printf '%s\n' "CUSTOM_RUNTIME_ACTIVATED release=$(basename "$release")"
