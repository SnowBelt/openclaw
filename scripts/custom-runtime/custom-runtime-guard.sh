#!/bin/sh
# Repairs launchd drift only when the Keychain prerequisite is available.
set -eu

runtime_home=${OPENCLAW_CUSTOM_RUNTIME_HOME:-"$HOME/.openclaw-custom-runtime"}
plist=${OPENCLAW_GATEWAY_PLIST:-"$HOME/Library/LaunchAgents/ai.openclaw.gateway.plist"}
label=${OPENCLAW_GATEWAY_LABEL:-ai.openclaw.gateway}
launcher="$runtime_home/bin/custom-runtime-launcher.sh"
desired_plist="$runtime_home/ai.openclaw.gateway.desired.plist"
provider=${OPENCLAW_SECRET_PROVIDER:-"$HOME/.openclaw/bin/patternlab-keychain-secret-provider"}
config_path=${OPENCLAW_CONFIG_PATH:-"$HOME/.openclaw/openclaw.director.json"}
port=${OPENCLAW_GATEWAY_PORT:-18789}
tailscale_primary_guard="$runtime_home/bin/custom-runtime-tailscale-primary.sh"
full_verification_ttl=900
uid=$(id -u)
auth_helper=$(dirname "$0")/custom-runtime-auth.sh
[ -f "$auth_helper" ] || { printf '%s\n' 'custom runtime Gateway auth helper is missing' >&2; exit 64; }
. "$auth_helper"
if ! custom_runtime_ensure_node_bin "$runtime_home"; then
  # The cheap identity path does not need Node, but any governed/full path must
  # fail closed through the resolver rather than falling back to PATH.
  OPENCLAW_NODE_BIN=
  export OPENCLAW_NODE_BIN
fi
case "$port" in ''|*[!0-9]*) exit 64 ;; esac
[ "$port" -ge 1 ] && [ "$port" -le 65535 ] || exit 64
process_probes_available=false
if custom_runtime_init_process_probes; then
  process_probes_available=true
fi
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
  receipt_path="$runtime_home/receipts/guard-$stamp.json"
  receipt_tmp=$(mktemp "$runtime_home/receipts/.guard-receipt.XXXXXX")
  printf '{"at":"%s","result":"%s"}\n' "$stamp" "$1" > "$receipt_tmp"
  chmod 600 "$receipt_tmp"
  mv -f "$receipt_tmp" "$receipt_path"
}

tailscale_primary_ok=true
tailnet_origin_ok=true
if [ -x "$tailscale_primary_guard" ]; then
  if ! "$tailscale_primary_guard" guard; then
    tailscale_primary_ok=false
  elif tailscale_status=$("$tailscale_primary_guard" status); then
    if ! python3 - "$tailscale_status" "$config_path" <<'PY'
import json
import os
import stat
import sys

status = json.loads(sys.argv[1])
if status.get("configured") is not True:
    raise SystemExit(0)
dns_name = str(status.get("dnsName") or "").strip().rstrip(".").lower()
if not dns_name:
    raise SystemExit(1)
config_path = sys.argv[2]
info = os.lstat(config_path)
if stat.S_ISLNK(info.st_mode) or not stat.S_ISREG(info.st_mode):
    raise SystemExit(1)
with open(config_path, encoding="utf-8") as f:
    config = json.load(f)
origins = ((config.get("gateway") or {}).get("controlUi") or {}).get("allowedOrigins")
if not isinstance(origins, list):
    raise SystemExit(1)
expected = f"https://{dns_name}"
normalized = {
    str(origin).strip().rstrip("/").lower()
    for origin in origins
    if isinstance(origin, str) and origin.strip()
}
raise SystemExit(0 if expected in normalized else 1)
PY
    then
      tailnet_origin_ok=false
    fi
  else
    tailscale_primary_ok=false
  fi
fi
complete_guard() {
  if [ "$tailscale_primary_ok" = true ] && [ "$tailnet_origin_ok" = true ]; then
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
provenance_sha=
provenance_record_sha=
provenance_migration_sha=
dashboard_manifest_sha=
provenance_invalid=false
[ -f "$runtime_home/active-runtime.json" ] && pointer_sha=$(shasum -a 256 "$runtime_home/active-runtime.json" | awk '{print $1}') || true
[ -f "$launcher" ] && launcher_sha=$(shasum -a 256 "$launcher" | awk '{print $1}') || true
[ -f "$plist" ] && plist_sha=$(shasum -a 256 "$plist" | awk '{print $1}') || true
provenance_path=
if [ -n "$runtime_root" ]; then
  provenance_path="$runtime_root/.openclaw-runtime-provenance.json"
fi
if [ -n "$provenance_path" ] && [ -e "$provenance_path" ]; then
  if [ -L "$provenance_path" ] || [ ! -f "$provenance_path" ]; then
    provenance_invalid=true
  else
    provenance_sha=$(shasum -a 256 "$provenance_path" | awk '{print $1}')
    if provenance_fields=$(python3 - "$provenance_path" "$runtime_home" "$runtime_source_sha" <<'PY'
import json
import os
import re
import stat
import sys

envelope_path, runtime_home, expected_sha = sys.argv[1:]
with open(envelope_path, encoding="utf-8") as handle:
    envelope = json.load(handle)
if envelope.get("schema") != "openclaw.custom-runtime-runtime-provenance.v1":
    raise SystemExit("invalid source provenance envelope schema")
if envelope.get("sourceSha") != expected_sha:
    raise SystemExit("source provenance source identity mismatch")
if not re.fullmatch(r"[a-f0-9]{40,64}", str(envelope.get("treeSha", ""))):
    raise SystemExit("source provenance tree identity is invalid")
if not re.fullmatch(r"[a-f0-9]{64}", str(envelope.get("recordSha256", ""))):
    raise SystemExit("source provenance record hash is invalid")
provenance_root = os.path.realpath(os.path.join(runtime_home, "source-provenance"))


def checked_path(value, label):
    if not isinstance(value, str) or not value:
        raise SystemExit(f"source provenance {label} path is missing")
    candidate = os.path.realpath(value)
    if os.path.commonpath((provenance_root, candidate)) != provenance_root:
        raise SystemExit(f"source provenance {label} path is outside the private root")
    info = os.lstat(value)
    if stat.S_ISLNK(info.st_mode) or not stat.S_ISREG(info.st_mode) or info.st_mode & 0o077:
        raise SystemExit(f"source provenance {label} path is unsafe")
    return candidate


record_path = checked_path(envelope.get("recordPath"), "record")
print(record_path)
print(envelope["recordSha256"])
migration_path = envelope.get("migrationPath", "")
if migration_path:
    if not re.fullmatch(r"[a-f0-9]{64}", str(envelope.get("migrationSha256", ""))):
        raise SystemExit("source provenance migration hash is invalid")
    print(checked_path(migration_path, "migration"))
    print(envelope["migrationSha256"])
else:
    print("")
    print("")
PY
    ); then
      provenance_record=$(printf '%s\n' "$provenance_fields" | sed -n '1p')
      declared_record_sha=$(printf '%s\n' "$provenance_fields" | sed -n '2p')
      provenance_migration=$(printf '%s\n' "$provenance_fields" | sed -n '3p')
      declared_migration_sha=$(printf '%s\n' "$provenance_fields" | sed -n '4p')
      if [ "$(shasum -a 256 "$provenance_record" | awk '{print $1}')" != "$declared_record_sha" ]; then
        provenance_invalid=true
      else
        provenance_record_sha=$declared_record_sha
      fi
      if [ -n "$provenance_migration" ]; then
        if [ "$(shasum -a 256 "$provenance_migration" | awk '{print $1}')" != "$declared_migration_sha" ]; then
          provenance_invalid=true
        else
          provenance_migration_sha=$declared_migration_sha
        fi
      fi
    else
      provenance_invalid=true
    fi
  fi
fi
dashboard_manifest=
if [ -n "$runtime_root" ]; then
  dashboard_manifest="$runtime_root/dist/control-ui/dashboard-surfaces.json"
fi
if [ -n "$dashboard_manifest" ] && [ -f "$dashboard_manifest" ] && [ ! -L "$dashboard_manifest" ]; then
  dashboard_manifest_sha=$(shasum -a 256 "$dashboard_manifest" | awk '{print $1}')
fi

dashboard_runtime_ok() {
  [ -n "$dashboard_manifest_sha" ] || return 1
  bootstrap=$(mktemp "$runtime_home/.guard-control-ui-config.XXXXXX") || return 1
  service_worker=$(mktemp "$runtime_home/.guard-service-worker.XXXXXX") || {
    rm -f "$bootstrap"
    return 1
  }
  chmod 600 "$bootstrap" "$service_worker"
  cleanup_dashboard_probe() { rm -f "$bootstrap" "$service_worker"; }
  if ! curl --silent --fail --max-time 3 -H 'Cache-Control: no-cache' \
    "http://127.0.0.1:$port/control-ui-config.json" > "$bootstrap" || \
     ! curl --silent --fail --max-time 3 -H 'Cache-Control: no-cache' \
    "http://127.0.0.1:$port/sw.js" > "$service_worker"; then
    cleanup_dashboard_probe
    return 1
  fi
  if ! python3 - "$bootstrap" "$service_worker" "$dashboard_manifest" "$runtime_root" <<'PY'
import json
import os
import sys

bootstrap_path, service_worker_path, manifest_path, expected_root = sys.argv[1:]
with open(bootstrap_path, encoding="utf-8") as f:
    bootstrap = json.load(f)
with open(manifest_path, encoding="utf-8") as f:
    manifest = json.load(f)
identity = bootstrap.get("runtimeIdentity")
build_id = manifest.get("buildId")
if not isinstance(identity, dict) or not isinstance(build_id, str) or not build_id:
    raise SystemExit("dashboard runtime identity is incomplete")
if os.path.realpath(str(identity.get("runtimeRoot", ""))) != os.path.realpath(expected_root):
    raise SystemExit("dashboard runtime root does not match the active pointer")
if identity.get("dashboardBuildId") != build_id:
    raise SystemExit("served Dashboard build does not match the active manifest")
with open(service_worker_path, encoding="utf-8") as f:
    service_worker = f.read()
if json.dumps(build_id) not in service_worker:
    raise SystemExit("served service worker does not match the Dashboard build")
PY
  then
    cleanup_dashboard_probe
    return 1
  fi
  cleanup_dashboard_probe
  return 0
}

# The cheap path is intentionally limited to identity, launcher, plist, and
# process checks. A hash-bound full verification receipt is trusted for at
# most fifteen minutes and only when every input hash is unchanged.
cache_valid=false
verification_receipt="$runtime_home/receipts/guard-verification-current.json"
if [ "$provenance_invalid" = false ] && [ "$plist_uses_launcher" = true ] && [ -n "$runtime_root" ] && [ -n "$runtime_source_sha" ] && \
  [ -n "$pointer_sha" ] && [ -n "$launcher_sha" ] && [ -n "$plist_sha" ] && \
  [ "$process_probes_available" = true ] && \
  custom_runtime_port_owner_pid "$port" "$runtime_root" >/dev/null 2>&1
then
  if python3 - "$verification_receipt" "$runtime_root" "$runtime_source_sha" "$pointer_sha" "$launcher_sha" "$plist_sha" "$provenance_sha" "$provenance_record_sha" "$provenance_migration_sha" "$dashboard_manifest_sha" "$full_verification_ttl" <<'PY'
import json
import os
import stat
import sys
import time

path, runtime_root, source_sha, pointer_sha, launcher_sha, plist_sha, provenance_sha, provenance_record_sha, provenance_migration_sha, dashboard_manifest_sha, ttl = sys.argv[1:]
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
        and value.get("provenanceSha256", "") == provenance_sha
        and value.get("provenanceRecordSha256", "") == provenance_record_sha
        and value.get("provenanceMigrationSha256", "") == provenance_migration_sha
        and value.get("dashboardManifestSha256", "") == dashboard_manifest_sha
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
if [ "$tailscale_primary_ok" = false ]; then
  receipt tailscale_primary_failed
  exit 1
fi
if [ "$tailnet_origin_ok" = false ]; then
  receipt tailnet_origin_failed
  exit 1
fi
if [ "$provenance_invalid" = false ] && [ "$plist_uses_launcher" = true ] && [ -n "$runtime_root" ] && \
  [ "$process_probes_available" = true ] && \
  custom_runtime_port_owner_pid "$port" "$runtime_root" >/dev/null 2>&1 && \
  "$launcher" --verify >/dev/null 2>&1 && dashboard_runtime_ok
then
  if python3 - "$verification_receipt" "$runtime_root" "$runtime_source_sha" "$pointer_sha" "$launcher_sha" "$plist_sha" "$provenance_sha" "$provenance_record_sha" "$provenance_migration_sha" "$dashboard_manifest_sha" <<'PY'
import json
import os
import sys
import tempfile
import time

target, runtime_root, source_sha, pointer_sha, launcher_sha, plist_sha, provenance_sha, provenance_record_sha, provenance_migration_sha, dashboard_manifest_sha = sys.argv[1:]
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
                "provenanceSha256": provenance_sha,
                "provenanceRecordSha256": provenance_record_sha,
                "provenanceMigrationSha256": provenance_migration_sha,
                "dashboardManifestSha256": dashboard_manifest_sha,
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
