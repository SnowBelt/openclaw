#!/bin/sh
# Repairs launchd drift only when the Keychain prerequisite is available.
set -eu

verify_only=false
case "$#" in
  0) ;;
  1) [ "$1" = --verify-only ] || exit 64; verify_only=true ;;
  *) exit 64 ;;
esac

runtime_home=${OPENCLAW_CUSTOM_RUNTIME_HOME:-"$HOME/.openclaw-custom-runtime"}
plist=${OPENCLAW_GATEWAY_PLIST:-"$HOME/Library/LaunchAgents/ai.openclaw.gateway.plist"}
label=${OPENCLAW_GATEWAY_LABEL:-ai.openclaw.gateway}
guard_plist=${OPENCLAW_CUSTOM_RUNTIME_GUARD_PLIST:-"$HOME/Library/LaunchAgents/ai.openclaw.custom-runtime.guard.plist"}
guard_label=${OPENCLAW_CUSTOM_RUNTIME_GUARD_LABEL:-ai.openclaw.custom-runtime.guard}
launcher="$runtime_home/bin/custom-runtime-launcher.sh"
guard_executable="$runtime_home/bin/custom-runtime-guard.sh"
gateway_env_wrapper=${OPENCLAW_GATEWAY_ENV_WRAPPER:-"$HOME/.openclaw-director-state/service-env/ai.openclaw.gateway-env-wrapper.sh"}
gateway_env_file=${OPENCLAW_GATEWAY_ENV_FILE:-"$HOME/.openclaw-director-state/service-env/ai.openclaw.gateway.env"}
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
verification_receipt="$runtime_home/receipts/guard-verification-current.json"
if custom_runtime_lifecycle_begin "$runtime_home" guard "" ""; then
  :
else
  lifecycle_status=$?
  [ "$lifecycle_status" -eq 75 ] && exit 75
  rm -f "$verification_receipt" || true
  exit "$lifecycle_status"
fi
lifecycle_result=guard-failed
cleanup_guard() {
  status=$?
  trap - EXIT INT TERM
  if [ "$status" -ne 0 ]; then
    rm -f "$verification_receipt" || status=1
  fi
  if ! custom_runtime_lifecycle_finish "$runtime_home" "$lifecycle_result" "$status"; then
    status=1
    rm -f "$verification_receipt" || true
  fi
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

# The active pointer is input, not authority. Prove the immutable release with
# the trusted control-plane launcher before importing any code from that root.
runtime_release_verified=false
if [ -n "$runtime_root" ] && [ -x "$launcher" ] && [ ! -L "$launcher" ] && \
  "$launcher" --verify >/dev/null 2>&1
then
  OPENCLAW_VERIFIED_RUNTIME_ROOT=$runtime_root
  export OPENCLAW_VERIFIED_RUNTIME_ROOT
  runtime_release_verified=true
fi

tailscale_primary_ok=true
tailnet_origin_ok=true
gateway_config_sha=
gateway_auth_config=
control_ui_config=
if [ "$runtime_release_verified" = true ] && \
  gateway_auth_config=$(custom_runtime_read_effective_gateway_section \
    "$config_path" "$runtime_root" auth) && \
  control_ui_config=$(custom_runtime_read_effective_gateway_section \
    "$config_path" "$runtime_root" controlUi)
then
  gateway_config_sha=$(printf '%s\n%s\n' "$gateway_auth_config" "$control_ui_config" | shasum -a 256 | awk '{print $1}')
else
  tailnet_origin_ok=false
fi
if [ -x "$tailscale_primary_guard" ]; then
  if [ "$verify_only" = true ]; then
    tailscale_command=status
  else
    tailscale_command=guard
  fi
  if ! "$tailscale_primary_guard" "$tailscale_command" >/dev/null; then
    tailscale_primary_ok=false
  elif tailscale_status=$("$tailscale_primary_guard" status); then
    if ! printf '%s' "$control_ui_config" | python3 -c '
import json
import sys

status = json.loads(sys.argv[1])
if status.get("configured") is not True:
    raise SystemExit(0)
dns_name = str(status.get("dnsName") or "").strip().rstrip(".").lower()
if not dns_name:
    raise SystemExit(1)
control_ui = json.load(sys.stdin)
if not isinstance(control_ui, dict):
    raise SystemExit(1)
origins = control_ui.get("allowedOrigins")
if not isinstance(origins, list):
    raise SystemExit(1)
expected = f"https://{dns_name}"
normalized = {
    str(origin).strip().rstrip("/").lower()
    for origin in origins
    if isinstance(origin, str) and origin.strip()
}
raise SystemExit(0 if expected in normalized else 1)
' "$tailscale_status"
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
guard_plist_sha=
guard_executable_sha=
gateway_env_wrapper_sha=
gateway_env_file_sha=
guard_definition_ok=false
provenance_sha=
provenance_record_sha=
provenance_migration_sha=
dashboard_manifest_sha=
provenance_invalid=false
[ -f "$runtime_home/active-runtime.json" ] && pointer_sha=$(shasum -a 256 "$runtime_home/active-runtime.json" | awk '{print $1}') || true
[ -f "$launcher" ] && launcher_sha=$(shasum -a 256 "$launcher" | awk '{print $1}') || true
[ -f "$plist" ] && plist_sha=$(shasum -a 256 "$plist" | awk '{print $1}') || true
[ -f "$guard_plist" ] && [ ! -L "$guard_plist" ] && \
  guard_plist_sha=$(shasum -a 256 "$guard_plist" | awk '{print $1}') || true
[ -f "$guard_executable" ] && [ ! -L "$guard_executable" ] && \
  guard_executable_sha=$(shasum -a 256 "$guard_executable" | awk '{print $1}') || true
[ -f "$gateway_env_wrapper" ] && [ ! -L "$gateway_env_wrapper" ] && \
  [ -x "$gateway_env_wrapper" ] && \
  gateway_env_wrapper_sha=$(shasum -a 256 "$gateway_env_wrapper" | awk '{print $1}') || true
[ -f "$gateway_env_file" ] && [ ! -L "$gateway_env_file" ] && \
  gateway_env_file_sha=$(shasum -a 256 "$gateway_env_file" | awk '{print $1}') || true
if [ -n "$guard_plist_sha" ] && [ -n "$guard_executable_sha" ] && \
  [ -n "$gateway_env_wrapper_sha" ] && [ -n "$gateway_env_file_sha" ] && \
  python3 - "$guard_plist" "$guard_label" "$gateway_env_wrapper" \
    "$gateway_env_file" "$guard_executable" <<'PY'
import os
import plistlib
import sys

plist_path, expected_label, wrapper, env_file, guard = sys.argv[1:]
try:
    with open(plist_path, "rb") as handle:
        value = plistlib.load(handle)
except (OSError, plistlib.InvalidFileException):
    raise SystemExit(1)
arguments = value.get("ProgramArguments")
expected = [os.path.realpath(wrapper), os.path.realpath(env_file), os.path.realpath(guard)]
actual = [os.path.realpath(item) for item in arguments] if isinstance(arguments, list) and all(isinstance(item, str) and item for item in arguments) else []
raise SystemExit(0 if value.get("Label") == expected_label and actual == expected else 1)
PY
then
  guard_definition_ok=true
fi
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
  custom_runtime_export_gateway_auth "$config_path" "$runtime_root" || return 1
  control_ui_config=$(custom_runtime_read_effective_gateway_section \
    "$config_path" "$runtime_root" controlUi) || return 1
  control_ui_base_path=$(printf '%s' "$control_ui_config" | python3 -c '
import json
import sys

control_ui = json.load(sys.stdin)
if not isinstance(control_ui, dict):
    raise SystemExit("gateway.controlUi must be an object")
base_path = control_ui.get("basePath")
if base_path is None:
    print("")
    raise SystemExit(0)
if not isinstance(base_path, str):
    raise SystemExit("gateway.controlUi.basePath must be a string")
normalized = base_path.strip()
if not normalized:
    print("")
    raise SystemExit(0)
if not normalized.startswith("/"):
    normalized = f"/{normalized}"
if normalized == "/":
    normalized = ""
elif normalized.endswith("/"):
    normalized = normalized[:-1]
print(normalized)
') || return 1
  bootstrap=$(mktemp "$runtime_home/.guard-control-ui-config.XXXXXX") || return 1
  service_worker=$(mktemp "$runtime_home/.guard-service-worker.XXXXXX") || {
    rm -f "$bootstrap"
    return 1
  }
  curl_config=$(mktemp "$runtime_home/.guard-curl-config.XXXXXX") || {
    rm -f "$bootstrap" "$service_worker"
    return 1
  }
  chmod 600 "$bootstrap" "$service_worker" "$curl_config"
  if ! python3 - "$curl_config" <<'PY'
import os
import sys

secret = os.environ.get("OPENCLAW_GATEWAY_TOKEN") or os.environ.get("OPENCLAW_GATEWAY_PASSWORD")
if not secret or "\n" in secret or "\r" in secret:
    raise SystemExit("Gateway auth secret is unavailable")
escaped = secret.replace("\\", "\\\\").replace('"', '\\"')
with open(sys.argv[1], "w", encoding="utf-8") as f:
    f.write(f'header = "Authorization: Bearer {escaped}"\n')
PY
  then
    rm -f "$bootstrap" "$service_worker" "$curl_config"
    return 1
  fi
  cleanup_dashboard_probe() { rm -f "$bootstrap" "$service_worker" "$curl_config"; }
  if ! curl --config "$curl_config" --silent --fail --max-time 3 -H 'Cache-Control: no-cache' \
    "http://127.0.0.1:$port${control_ui_base_path}/control-ui-config.json" > "$bootstrap" || \
     ! curl --config "$curl_config" --silent --fail --max-time 3 -H 'Cache-Control: no-cache' \
    "http://127.0.0.1:$port${control_ui_base_path}/sw.js" > "$service_worker"; then
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
if [ "$runtime_release_verified" = true ] && \
  [ "$provenance_invalid" = false ] && [ "$plist_uses_launcher" = true ] && \
  [ "$guard_definition_ok" = true ] && [ -n "$runtime_root" ] && [ -n "$runtime_source_sha" ] && \
  [ -n "$pointer_sha" ] && [ -n "$launcher_sha" ] && [ -n "$plist_sha" ] && \
  [ -n "$guard_plist_sha" ] && [ -n "$guard_executable_sha" ] && \
  [ -n "$gateway_env_wrapper_sha" ] && [ -n "$gateway_env_file_sha" ] && \
  [ -n "$dashboard_manifest_sha" ] && [ -n "$gateway_config_sha" ] && \
  [ "$process_probes_available" = true ] && \
  custom_runtime_port_owner_pid "$port" "$runtime_root" >/dev/null 2>&1
then
  if python3 - "$verification_receipt" "$runtime_root" "$runtime_source_sha" "$pointer_sha" "$launcher_sha" "$plist_sha" "$guard_plist" "$guard_plist_sha" "$guard_executable" "$guard_executable_sha" "$guard_label" "$gateway_env_wrapper" "$gateway_env_wrapper_sha" "$gateway_env_file" "$gateway_env_file_sha" "$provenance_sha" "$provenance_record_sha" "$provenance_migration_sha" "$dashboard_manifest_sha" "$gateway_config_sha" "$full_verification_ttl" <<'PY'
import json
import os
import stat
import sys
import time

path, runtime_root, source_sha, pointer_sha, launcher_sha, plist_sha, guard_plist, guard_plist_sha, guard_executable, guard_executable_sha, guard_label, gateway_env_wrapper, gateway_env_wrapper_sha, gateway_env_file, gateway_env_file_sha, provenance_sha, provenance_record_sha, provenance_migration_sha, dashboard_manifest_sha, gateway_config_sha, ttl = sys.argv[1:]
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
        and value.get("guardPlistPath") == os.path.realpath(guard_plist)
        and value.get("guardPlistSha256") == guard_plist_sha
        and value.get("guardExecutablePath") == os.path.realpath(guard_executable)
        and value.get("guardExecutableSha256") == guard_executable_sha
        and value.get("guardLabel") == guard_label
        and value.get("gatewayEnvWrapperPath") == os.path.realpath(gateway_env_wrapper)
        and value.get("gatewayEnvWrapperSha256") == gateway_env_wrapper_sha
        and value.get("gatewayEnvFilePath") == os.path.realpath(gateway_env_file)
        and value.get("gatewayEnvFileSha256") == gateway_env_file_sha
        and value.get("guardProgramArguments") == [
            os.path.realpath(gateway_env_wrapper),
            os.path.realpath(gateway_env_file),
            os.path.realpath(guard_executable),
        ]
        and value.get("provenanceSha256", "") == provenance_sha
        and value.get("provenanceRecordSha256", "") == provenance_record_sha
        and value.get("provenanceMigrationSha256", "") == provenance_migration_sha
        and value.get("dashboardManifestSha256", "") == dashboard_manifest_sha
        and value.get("gatewayConfigSha256", "") == gateway_config_sha
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
if [ "$runtime_release_verified" = true ] && \
  [ "$provenance_invalid" = false ] && [ "$plist_uses_launcher" = true ] && \
  [ "$guard_definition_ok" = true ] && [ -n "$runtime_root" ] && \
  [ "$process_probes_available" = true ] && \
  custom_runtime_port_owner_pid "$port" "$runtime_root" >/dev/null 2>&1 && dashboard_runtime_ok
then
  if python3 - "$verification_receipt" "$runtime_root" "$runtime_source_sha" "$pointer_sha" "$launcher_sha" "$plist_sha" "$guard_plist" "$guard_plist_sha" "$guard_executable" "$guard_executable_sha" "$guard_label" "$gateway_env_wrapper" "$gateway_env_wrapper_sha" "$gateway_env_file" "$gateway_env_file_sha" "$provenance_sha" "$provenance_record_sha" "$provenance_migration_sha" "$dashboard_manifest_sha" "$gateway_config_sha" <<'PY'
import json
import os
import sys
import tempfile
import time

target, runtime_root, source_sha, pointer_sha, launcher_sha, plist_sha, guard_plist, guard_plist_sha, guard_executable, guard_executable_sha, guard_label, gateway_env_wrapper, gateway_env_wrapper_sha, gateway_env_file, gateway_env_file_sha, provenance_sha, provenance_record_sha, provenance_migration_sha, dashboard_manifest_sha, gateway_config_sha = sys.argv[1:]
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
                "guardPlistPath": os.path.realpath(guard_plist),
                "guardPlistSha256": guard_plist_sha,
                "guardExecutablePath": os.path.realpath(guard_executable),
                "guardExecutableSha256": guard_executable_sha,
                "guardLabel": guard_label,
                "gatewayEnvWrapperPath": os.path.realpath(gateway_env_wrapper),
                "gatewayEnvWrapperSha256": gateway_env_wrapper_sha,
                "gatewayEnvFilePath": os.path.realpath(gateway_env_file),
                "gatewayEnvFileSha256": gateway_env_file_sha,
                "guardProgramArguments": [
                    os.path.realpath(gateway_env_wrapper),
                    os.path.realpath(gateway_env_file),
                    os.path.realpath(guard_executable),
                ],
                "provenanceSha256": provenance_sha,
                "provenanceRecordSha256": provenance_record_sha,
                "provenanceMigrationSha256": provenance_migration_sha,
                "dashboardManifestSha256": dashboard_manifest_sha,
                "gatewayConfigSha256": gateway_config_sha,
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

if [ "$verify_only" = true ]; then
  receipt verification_failed
  exit 1
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
