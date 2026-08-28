#!/bin/sh
# Repairs launchd drift only when the Keychain prerequisite is available.
set -eu

runtime_home=${OPENCLAW_CUSTOM_RUNTIME_HOME:-"$HOME/.openclaw-custom-runtime"}
plist=${OPENCLAW_GATEWAY_PLIST:-"$HOME/Library/LaunchAgents/ai.openclaw.gateway.plist"}
label=${OPENCLAW_GATEWAY_LABEL:-ai.openclaw.gateway}
launcher="$runtime_home/bin/custom-runtime-launcher.sh"
desired_plist="$runtime_home/ai.openclaw.gateway.desired.plist"
provider=${OPENCLAW_SECRET_PROVIDER:-"$HOME/.openclaw/bin/patternlab-keychain-secret-provider"}
port=${OPENCLAW_GATEWAY_PORT:-18789}
tailscale_primary_guard="$runtime_home/bin/custom-runtime-tailscale-primary.sh"
full_verification_ttl=900
uid=$(id -u)
auth_helper=$(dirname "$0")/custom-runtime-auth.sh
[ -f "$auth_helper" ] || { printf '%s\n' 'custom runtime Gateway auth helper is missing' >&2; exit 64; }
. "$auth_helper"
mkdir -p "$runtime_home/receipts" "$runtime_home/locks"
if custom_runtime_lifecycle_begin "$runtime_home" guard "" ""; then
  :
else
  lifecycle_status=$?
  [ "$lifecycle_status" -eq 75 ] && exit 0
  exit "$lifecycle_status"
fi
lifecycle_result=guard-failed
cleanup_guard() {
  status=$?
  trap - EXIT INT TERM
  custom_runtime_lifecycle_finish "$runtime_home" "$lifecycle_result" "$status" || status=1
  exit "$status"
}
trap cleanup_guard EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
stamp=$(date -u +%Y%m%dT%H%M%SZ)
receipt() {
  lifecycle_result=$1
  printf '{"at":"%s","result":"%s"}\n' "$stamp" "$1" > "$runtime_home/receipts/guard-$stamp.json"
}

tailscale_primary_ok=true
if [ -x "$tailscale_primary_guard" ] && ! "$tailscale_primary_guard" guard; then
  tailscale_primary_ok=false
fi
complete_guard() {
  if [ "$tailscale_primary_ok" = true ]; then
    [ "$lifecycle_result" != guard-failed ] || lifecycle_result=guard-healthy
    exit 0
  fi
  lifecycle_result=guard-tailscale-failed
  exit 1
}

runtime_identity=$(python3 - "$runtime_home/active-runtime.json" <<'PY'
import json, sys
try:
    pointer = json.load(open(sys.argv[1]))
    print(pointer.get("runtimeRoot", ""))
    print(pointer.get("sourceSha", ""))
except Exception:
    pass
PY
)
runtime_root=$(printf '%s\n' "$runtime_identity" | sed -n '1p')
runtime_source_sha=$(printf '%s\n' "$runtime_identity" | sed -n '2p')
plist_uses_launcher=false
if [ -f "$plist" ] && python3 - "$plist" "$launcher" <<'PY'
import plistlib, sys
try:
    with open(sys.argv[1], "rb") as f:
        args = plistlib.load(f).get("ProgramArguments", [])
except (OSError, plistlib.InvalidFileException):
    raise SystemExit(1)
raise SystemExit(0 if sys.argv[2] in args else 1)
PY
then
  plist_uses_launcher=true
fi
pointer_sha=
launcher_sha=
plist_sha=
[ -f "$runtime_home/active-runtime.json" ] && pointer_sha=$(shasum -a 256 "$runtime_home/active-runtime.json" | awk '{print $1}') || true
[ -f "$launcher" ] && launcher_sha=$(shasum -a 256 "$launcher" | awk '{print $1}') || true
[ -f "$plist" ] && plist_sha=$(shasum -a 256 "$plist" | awk '{print $1}') || true

# The cheap path is intentionally limited to identity, launcher, plist, and
# process checks. A hash-bound full verification receipt is trusted for at
# most fifteen minutes and only when every input hash is unchanged.
cache_valid=false
verification_receipt="$runtime_home/receipts/guard-verification-current.json"
if [ "$plist_uses_launcher" = true ] && [ -n "$runtime_root" ] && [ -n "$runtime_source_sha" ] && \
  [ -n "$pointer_sha" ] && [ -n "$launcher_sha" ] && [ -n "$plist_sha" ] && \
  pgrep -f "$runtime_root/dist/index.js gateway" >/dev/null 2>&1
then
  if python3 - "$verification_receipt" "$runtime_root" "$runtime_source_sha" "$pointer_sha" "$launcher_sha" "$plist_sha" "$full_verification_ttl" <<'PY'
import json
import os
import stat
import sys
import time

path, runtime_root, source_sha, pointer_sha, launcher_sha, plist_sha, ttl = sys.argv[1:]
try:
    info = os.lstat(path)
    if not stat.S_ISREG(info.st_mode) or stat.S_ISLNK(info.st_mode) or info.st_mode & 0o077:
        raise OSError("unsafe verification receipt")
    with open(path, encoding="utf-8") as handle:
        value = json.load(handle)
    valid = (
        value.get("schema") == "openclaw.custom-runtime-guard-verification.v1"
        and value.get("result") == "passed"
        and value.get("runtimeRoot") == runtime_root
        and value.get("sourceSha") == source_sha
        and value.get("pointerSha256") == pointer_sha
        and value.get("launcherSha256") == launcher_sha
        and value.get("plistSha256") == plist_sha
        and isinstance(value.get("verifiedAt"), int)
        and not isinstance(value.get("verifiedAt"), bool)
        and 0 <= time.time() - value["verifiedAt"] <= int(ttl)
    )
except (OSError, ValueError, TypeError, json.JSONDecodeError):
    valid = False
raise SystemExit(0 if valid else 1)
PY
  then
    cache_valid=true
  fi
fi
if [ "$cache_valid" = true ]; then
  complete_guard
fi
if [ "$plist_uses_launcher" = true ] && [ -n "$runtime_root" ] && \
  pgrep -f "$runtime_root/dist/index.js gateway" >/dev/null 2>&1 && \
  "$launcher" --verify >/dev/null 2>&1
then
  if python3 - "$verification_receipt" "$runtime_root" "$runtime_source_sha" "$pointer_sha" "$launcher_sha" "$plist_sha" <<'PY'
import json
import os
import sys
import tempfile
import time

target, runtime_root, source_sha, pointer_sha, launcher_sha, plist_sha = sys.argv[1:]
directory = os.path.dirname(target)
temporary = None
try:
    descriptor, temporary = tempfile.mkstemp(prefix=".guard-verification-", dir=directory, text=True)
    with os.fdopen(descriptor, "w", encoding="utf-8") as handle:
        json.dump(
            {
                "schema": "openclaw.custom-runtime-guard-verification.v1",
                "result": "passed",
                "verifiedAt": int(time.time()),
                "runtimeRoot": runtime_root,
                "sourceSha": source_sha,
                "pointerSha256": pointer_sha,
                "launcherSha256": launcher_sha,
                "plistSha256": plist_sha,
            },
            handle,
            separators=(",", ":"),
        )
        handle.write("\n")
        handle.flush()
        os.fsync(handle.fileno())
    os.chmod(temporary, 0o600)
    os.replace(temporary, target)
    os.chmod(target, 0o600)
except Exception:
    if temporary:
        try:
            os.unlink(temporary)
        except FileNotFoundError:
            pass
    raise
PY
  then
    complete_guard
  fi
fi

# Never restart into a configuration that cannot retrieve its required secret.
if ! printf '%s' '{"ids":["discord/bot-token"]}' | "$provider" | python3 -c 'import json,sys; d=json.load(sys.stdin); raise SystemExit(0 if d.get("values",{}).get("discord/bot-token") else 1)' 2>/dev/null; then
  receipt repair_deferred_keychain
  exit 75
fi
registered_rollback="$runtime_home/active-rollback.json"
rollback_script="$runtime_home/bin/custom-runtime-rollback.sh"
if [ -f "$registered_rollback" ] && [ -x "$rollback_script" ]; then
  rollback_identity=$(python3 - "$registered_rollback" <<'PY'
import json
import sys

with open(sys.argv[1], encoding="utf-8") as f:
    registration = json.load(f)
for key in ("candidateRuntimeReleaseId", "rollbackReleaseId"):
    value = registration.get(key)
    if not isinstance(value, str) or not value:
        raise SystemExit("registered rollback identity is incomplete")
    print(value)
PY
  ) || { receipt registered_rollback_invalid; exit 1; }
  candidate_runtime_release=$(printf '%s\n' "$rollback_identity" | sed -n '1p')
  rollback_release=$(printf '%s\n' "$rollback_identity" | sed -n '2p')
  now=$(date +%s)
  last=$(cat "$runtime_home/last-restart.epoch" 2>/dev/null || printf 0)
  if [ $((now - last)) -lt 600 ]; then receipt repair_rate_limited; exit 75; fi
  printf '%s\n' "$now" > "$runtime_home/last-restart.epoch"
  if "$rollback_script" \
    --candidate-runtime-release "$candidate_runtime_release" \
    --rollback-release "$rollback_release" \
    --port "$port" \
    --emergency --reason guard-registered-rollback; then
    receipt repaired_by_registered_rollback
    complete_guard
  fi
  receipt registered_rollback_failed
  exit 1
fi
[ -f "$runtime_home/last-known-good.json" ] || { receipt repair_unavailable_no_last_good; exit 1; }
[ -f "$desired_plist" ] || { receipt repair_unavailable_no_desired_plist; exit 1; }
[ -n "$runtime_root" ] && [ -n "$runtime_source_sha" ] || {
  receipt repair_unavailable_runtime_identity
  exit 1
}
custom_runtime_require_release_governance rollback "$runtime_source_sha" "$runtime_root"
custom_runtime_lifecycle_refresh_provenance "$runtime_home" \
  "$runtime_source_sha" "$runtime_source_sha"
custom_runtime_certification_lease break-emergency "$runtime_home" \
  "" "" "" "" "" "" "" "" "guard-last-known-good-recovery" >/dev/null
python3 - "$desired_plist" "$launcher" <<'PY'
import plistlib, sys
with open(sys.argv[1], "rb") as f: args = plistlib.load(f).get("ProgramArguments", [])
raise SystemExit(0 if sys.argv[2] in args else 1)
PY
now=$(date +%s)
last=$(cat "$runtime_home/last-restart.epoch" 2>/dev/null || printf 0)
if [ $((now - last)) -lt 600 ]; then receipt repair_rate_limited; exit 75; fi
previous_plist="$runtime_home/backups/guard-gateway-$stamp.plist"
mkdir -p "$runtime_home/backups"
cp -p "$plist" "$previous_plist"
rollback() {
  cp -p "$previous_plist" "$plist"
  launchctl bootout "gui/$uid/$label" 2>/dev/null || true
  for _ in $(seq 1 15); do
    launchctl print "gui/$uid/$label" >/dev/null 2>&1 || break
    sleep 1
  done
  launchctl bootstrap "gui/$uid" "$plist" 2>/dev/null || true
}
cp -p "$runtime_home/last-known-good.json" "$runtime_home/active-runtime.json"
cp -p "$desired_plist" "$plist"
printf '%s\n' "$now" > "$runtime_home/last-restart.epoch"
launchctl bootout "gui/$uid/$label" 2>/dev/null || true
for _ in $(seq 1 15); do
  launchctl print "gui/$uid/$label" >/dev/null 2>&1 || break
  sleep 1
done
if ! launchctl bootstrap "gui/$uid" "$plist"; then
  rollback
  receipt repair_rolled_back_bootstrap
  exit 1
fi
for _ in $(seq 1 45); do
  if curl --silent --fail --max-time 3 "http://127.0.0.1:$port/health" | grep -q '"ok":true'; then
    receipt repaired
    complete_guard
  fi
  sleep 2
done
rollback
receipt repair_rolled_back_health
exit 1
