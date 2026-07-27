#!/bin/sh
# Resolve local Gateway verification credentials without exposing them in argv.

custom_runtime_export_gateway_auth() {
  auth_config=${1:-}
  if [ -n "${OPENCLAW_GATEWAY_TOKEN:-}" ] || [ -n "${OPENCLAW_GATEWAY_PASSWORD:-}" ]; then
    return 0
  fi
  [ -n "$auth_config" ] && [ -f "$auth_config" ] || return 1

  auth_record=$(python3 - "$auth_config" <<'PY'
import json
import sys

with open(sys.argv[1], encoding="utf-8") as f:
    config = json.load(f)
auth = config.get("gateway", {}).get("auth", {})
if not isinstance(auth, dict):
    raise SystemExit("gateway.auth must be an object")
mode = auth.get("mode")
field = "token" if mode == "token" else "password" if mode == "password" else None
if field is None:
    raise SystemExit("custom runtime verification requires token or password Gateway auth")
value = auth.get(field)
if not isinstance(value, str) or not value or "\n" in value or "\r" in value:
    raise SystemExit(f"gateway.auth.{field} must resolve to a direct single-line string")
print(mode)
print(value)
PY
  ) || return 1

  auth_kind=$(printf '%s\n' "$auth_record" | sed -n '1p')
  auth_value=$(printf '%s\n' "$auth_record" | sed -n '2p')
  [ -n "$auth_value" ] || return 1
  case "$auth_kind" in
    token)
      OPENCLAW_GATEWAY_TOKEN=$auth_value
      export OPENCLAW_GATEWAY_TOKEN
      ;;
    password)
      OPENCLAW_GATEWAY_PASSWORD=$auth_value
      export OPENCLAW_GATEWAY_PASSWORD
      ;;
    *) return 1 ;;
  esac
}

# Health can become ready before dashboard routes finish initializing. Verify the
# complete route set repeatedly so promotion, restart, and rollback share the
# same bounded readiness contract instead of failing on a transient response.
custom_runtime_wait_for_routes() {
  custom_runtime_route_port=${1:-}
  shift || return 1

  custom_runtime_route_attempt=1
  custom_runtime_failed_route=
  while [ "$custom_runtime_route_attempt" -le 15 ]; do
    custom_runtime_failed_route=
    for custom_runtime_route in "$@"; do
      custom_runtime_route_code=$(
        curl --silent --output /dev/null --write-out '%{http_code}' --max-time 3 \
          "http://127.0.0.1:$custom_runtime_route_port/$custom_runtime_route" \
          2>/dev/null || true
      )
      if [ "$custom_runtime_route_code" != 200 ]; then
        custom_runtime_failed_route=$custom_runtime_route
        break
      fi
    done
    [ -z "$custom_runtime_failed_route" ] && return 0
    [ "$custom_runtime_route_attempt" -ge 15 ] && break
    custom_runtime_route_attempt=$((custom_runtime_route_attempt + 1))
    sleep 2
  done
  return 1
}

# Resolve the governor from the active immutable runtime whenever possible. A
# candidate governor is used only for first-install bootstrap; its evidence must
# still carry an exact policy-authorized decision bound to the candidate SHA.
custom_runtime_release_governor_cli() {
  custom_runtime_governor_release=${1:-}
  custom_runtime_governor_home=${OPENCLAW_CUSTOM_RUNTIME_HOME:-"$HOME/.openclaw-custom-runtime"}
  custom_runtime_governor_pointer="$custom_runtime_governor_home/active-runtime.json"
  custom_runtime_governor_active_root=
  if [ -f "$custom_runtime_governor_pointer" ] && [ ! -L "$custom_runtime_governor_pointer" ]; then
    custom_runtime_governor_active_root=$(python3 - "$custom_runtime_governor_pointer" <<'PY'
import json, sys
with open(sys.argv[1], encoding="utf-8") as f:
    value = json.load(f)
root = value.get("runtimeRoot")
if isinstance(root, str) and root:
    print(root)
PY
    ) || return 1
  fi
  for custom_runtime_governor_root in "$custom_runtime_governor_active_root" "$custom_runtime_governor_release"; do
    [ -n "$custom_runtime_governor_root" ] || continue
    [ -d "$custom_runtime_governor_root" ] && [ ! -L "$custom_runtime_governor_root" ] || continue
    custom_runtime_governor_cli="$custom_runtime_governor_root/dist/release-governor.js"
    custom_runtime_governor_policy="$custom_runtime_governor_root/config/release-governor-policy.json"
    if [ -f "$custom_runtime_governor_cli" ] && [ ! -L "$custom_runtime_governor_cli" ] && \
      [ -f "$custom_runtime_governor_policy" ] && [ ! -L "$custom_runtime_governor_policy" ]; then
      printf '%s\n%s\n' "$custom_runtime_governor_cli" "$custom_runtime_governor_policy"
      return 0
    fi
  done
  return 1
}

# Every mutating lifecycle command calls this same fail-closed boundary. The
# supplied bundle is immutable, hash-bound, operation-specific, and exact-SHA.
custom_runtime_require_release_governance() {
  custom_runtime_governor_operation=${1:-}
  custom_runtime_governor_candidate_sha=${2:-}
  custom_runtime_governor_release=${3:-}
  custom_runtime_governor_bundle_root=${OPENCLAW_RELEASE_GOVERNANCE_BUNDLE_DIR:-}
  [ -n "$custom_runtime_governor_operation" ] && [ -n "$custom_runtime_governor_candidate_sha" ] || return 64
  case "$custom_runtime_governor_operation" in
    stage|promotion|restart|rollback|finalize) ;;
    *) return 64 ;;
  esac
  case "$custom_runtime_governor_candidate_sha" in
    *[!0-9a-fA-F]*|'') return 64 ;;
  esac
  [ "${#custom_runtime_governor_candidate_sha}" -ge 40 ] && \
    [ "${#custom_runtime_governor_candidate_sha}" -le 64 ] || return 64
  [ -d "$custom_runtime_governor_release" ] && [ ! -L "$custom_runtime_governor_release" ] || {
    printf '%s\n' 'release governance blocked: candidate release root is missing or unsafe' >&2
    return 78
  }
  if [ -z "$custom_runtime_governor_bundle_root" ] || [ ! -d "$custom_runtime_governor_bundle_root" ] || \
    [ -L "$custom_runtime_governor_bundle_root" ]; then
    printf '%s\n' 'release governance blocked: private evidence bundle directory is missing or unsafe' >&2
    return 78
  fi
  custom_runtime_governor_bundle_directory="$custom_runtime_governor_bundle_root/$custom_runtime_governor_candidate_sha"
  if [ ! -d "$custom_runtime_governor_bundle_directory" ] || [ -L "$custom_runtime_governor_bundle_directory" ]; then
    printf '%s\n' "release governance blocked: exact evidence directory is missing or unsafe for $custom_runtime_governor_candidate_sha" >&2
    return 78
  fi
  custom_runtime_governor_bundle="$custom_runtime_governor_bundle_directory/$custom_runtime_governor_operation.json"
  if [ ! -f "$custom_runtime_governor_bundle" ] || [ -L "$custom_runtime_governor_bundle" ]; then
    printf '%s\n' "release governance blocked: exact evidence bundle is missing for $custom_runtime_governor_operation at $custom_runtime_governor_candidate_sha" >&2
    return 78
  fi
  custom_runtime_governor_resolution=$(custom_runtime_release_governor_cli "$custom_runtime_governor_release") || {
    printf '%s\n' 'release governance blocked: trusted Release Governor is unavailable' >&2
    return 78
  }
  custom_runtime_governor_cli=$(printf '%s\n' "$custom_runtime_governor_resolution" | sed -n '1p')
  custom_runtime_governor_policy=$(printf '%s\n' "$custom_runtime_governor_resolution" | sed -n '2p')
  ${OPENCLAW_NODE_BIN:-node} "$custom_runtime_governor_cli" verify \
    --bundle "$custom_runtime_governor_bundle" \
    --operation "$custom_runtime_governor_operation" \
    --candidate-sha "$custom_runtime_governor_candidate_sha" \
    --release "$custom_runtime_governor_release" \
    --policy "$custom_runtime_governor_policy" \
    --no-record >/dev/null || {
      printf '%s\n' "release governance blocked: policy denied $custom_runtime_governor_operation for $custom_runtime_governor_candidate_sha" >&2
      return 78
    }
  if [ -z "${OPENCLAW_RELEASE_GOVERNANCE_APPROVAL_ID:-}" ]; then
    custom_runtime_governor_bundle_sha=$(shasum -a 256 "$custom_runtime_governor_bundle" | awk '{print $1}')
    custom_runtime_governor_bundle_id=$(printf '%s' "$custom_runtime_governor_bundle_sha" | cut -c1-16)
    OPENCLAW_RELEASE_GOVERNANCE_APPROVAL_ID="release-governor:$custom_runtime_governor_operation:$custom_runtime_governor_bundle_id"
    export OPENCLAW_RELEASE_GOVERNANCE_APPROVAL_ID
  fi
  if [ -z "${OPENCLAW_CUSTOM_RUNTIME_OPERATION_ID:-}" ]; then
    OPENCLAW_CUSTOM_RUNTIME_OPERATION_ID="custom-runtime:$custom_runtime_governor_operation"
    export OPENCLAW_CUSTOM_RUNTIME_OPERATION_ID
  fi
}

# One private lifecycle lock serializes every managed-runtime mutation. Nested
# activation -> promotion and guard -> rollback calls borrow the same invocation
# instead of deadlocking or opening a second mutation lane.
custom_runtime_lifecycle_begin() {
  custom_runtime_lifecycle_home=${1:-}
  custom_runtime_lifecycle_operation=${2:-}
  custom_runtime_lifecycle_active_sha=${3:-}
  custom_runtime_lifecycle_candidate_sha=${4:-}
  custom_runtime_lifecycle_resolution=$(python3 - \
    "$custom_runtime_lifecycle_home" "$custom_runtime_lifecycle_operation" \
    "$custom_runtime_lifecycle_active_sha" "$custom_runtime_lifecycle_candidate_sha" \
    "${OPENCLAW_CUSTOM_RUNTIME_LIFECYCLE_ACTOR:-}" \
    "${OPENCLAW_RELEASE_GOVERNANCE_APPROVAL_ID:-}" \
    "${OPENCLAW_CUSTOM_RUNTIME_OPERATION_ID:-}" \
    "${OPENCLAW_CUSTOM_RUNTIME_LIFECYCLE_INVOCATION_ID:-}" "$$" <<'PY'
import datetime as dt
import errno
import getpass
import json
import os
import re
import secrets
import sys

runtime_home, operation, active_sha, candidate_sha, actor, approval_id, operation_id, invocation_id, caller_pid_raw = sys.argv[1:]
locks_dir = os.path.join(runtime_home, "locks")
lock_path = os.path.join(locks_dir, "lifecycle.lock")
owner_path = os.path.join(lock_path, "owner.json")
receipts_dir = os.path.join(runtime_home, "receipts")
pointer_path = os.path.join(runtime_home, "active-runtime.json")
lease_path = os.path.join(runtime_home, "certification-lease.json")
now = dt.datetime.now(dt.timezone.utc).replace(microsecond=0)
sha_pattern = re.compile(r"(?:[0-9a-fA-F]{40}|[0-9a-fA-F]{64})")
identity_pattern = re.compile(r"[A-Za-z0-9._:@/+~-]{1,160}")
allowed_operations = {"activation", "certification-lease", "guard", "promotion", "restart", "rollback"}


def fail(message, code=78):
    print(f"custom runtime lifecycle blocked: {message}", file=sys.stderr)
    raise SystemExit(code)


def parse_time(value, field):
    if not isinstance(value, str) or not value.endswith("Z"):
        fail(f"{field} is missing or invalid")
    try:
        parsed = dt.datetime.fromisoformat(value[:-1] + "+00:00")
    except ValueError:
        fail(f"{field} is missing or invalid")
    return parsed.astimezone(dt.timezone.utc)


def read_json(path, description):
    if not os.path.isfile(path) or os.path.islink(path):
        fail(f"{description} is missing or unsafe")
    try:
        with open(path, encoding="utf-8") as handle:
            value = json.load(handle)
    except (OSError, json.JSONDecodeError):
        fail(f"{description} is malformed")
    if not isinstance(value, dict):
        fail(f"{description} is malformed")
    return value


def resolve_sha(value, source_path, field):
    if value:
        if not sha_pattern.fullmatch(value):
            fail(f"{field} is invalid", 64)
        return value
    if not os.path.isfile(source_path) or os.path.islink(source_path):
        return None
    document = read_json(source_path, field)
    resolved = document.get("sourceSha" if field == "active runtime pointer" else "candidateSha")
    if resolved is None:
        return None
    if not isinstance(resolved, str) or not sha_pattern.fullmatch(resolved):
        fail(f"{field} SHA is invalid")
    return resolved


def write_json(path, payload):
    temporary = f"{path}.tmp-{os.getpid()}-{secrets.token_hex(4)}"
    descriptor = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(descriptor, "w", encoding="utf-8") as handle:
        json.dump(payload, handle, indent=2, sort_keys=True)
        handle.write("\n")
    os.replace(temporary, path)


def process_is_alive(pid):
    try:
        os.kill(pid, 0)
    except ProcessLookupError:
        return False
    except PermissionError:
        return True
    return True


if operation not in allowed_operations:
    fail("operation is invalid", 64)
os.makedirs(locks_dir, mode=0o700, exist_ok=True)
os.makedirs(receipts_dir, mode=0o700, exist_ok=True)
if os.path.islink(locks_dir) or os.path.islink(receipts_dir):
    fail("private lifecycle directories are unsafe")
os.chmod(locks_dir, 0o700)
os.chmod(receipts_dir, 0o700)

resolved_active_sha = resolve_sha(active_sha, pointer_path, "active runtime pointer")
resolved_candidate_sha = resolve_sha(candidate_sha, lease_path, "certification lease")
actor = actor or getpass.getuser()
approval_id = approval_id or (
    "not-required:guard-health"
    if operation == "guard"
    else "pending:release-governor-verification"
)
operation_id = operation_id or f"custom-runtime:{operation}"
invocation_id = invocation_id or f"{operation}-{secrets.token_hex(16)}"
try:
    caller_pid = int(caller_pid_raw)
except ValueError:
    fail("caller PID is invalid", 64)
if caller_pid <= 0:
    fail("caller PID is invalid", 64)
for field, value in (
    ("actor", actor),
    ("approval identity", approval_id),
    ("operation identity", operation_id),
    ("invocation identity", invocation_id),
):
    if not identity_pattern.fullmatch(value):
        fail(f"{field} is invalid", 64)

for _ in range(2):
    try:
        os.mkdir(lock_path, 0o700)
    except FileExistsError:
        if os.path.islink(lock_path) or not os.path.isdir(lock_path):
            fail("global lifecycle lock is unsafe")
        owner = read_json(owner_path, "global lifecycle lock owner")
        if owner.get("schema") != "openclaw.custom-runtime-lifecycle-lock.v1":
            fail("global lifecycle lock schema is invalid")
        lock_invocation = owner.get("invocationId")
        if lock_invocation == invocation_id:
            print(invocation_id)
            print("borrowed")
            raise SystemExit(0)
        lock_pid = owner.get("pid")
        if not isinstance(lock_pid, int) or lock_pid <= 0:
            fail("global lifecycle lock PID is invalid")
        created_at = parse_time(owner.get("createdAt"), "global lifecycle lock creation time")
        if created_at > now + dt.timedelta(seconds=60):
            fail("global lifecycle lock creation time is in the future")
        age = (now - created_at).total_seconds()
        lock_is_alive = process_is_alive(lock_pid)
        if lock_is_alive and age > 14400:
            fail("global lifecycle lock duration exceeds the maximum")
        if lock_is_alive or age < 900:
            fail(f"another {owner.get('operation', 'unknown')} lifecycle operation is active", 75)
        recovered = os.path.join(
            locks_dir,
            f"lifecycle.recovered-{now.strftime('%Y%m%dT%H%M%SZ')}-{secrets.token_hex(4)}",
        )
        try:
            os.rename(lock_path, recovered)
        except OSError as error:
            if error.errno in {errno.ENOENT, errno.EEXIST}:
                continue
            fail("stale lifecycle lock could not be recovered", 75)
        recovery_receipt = {
            "actor": actor,
            "approvalId": approval_id,
            "at": now.strftime("%Y-%m-%dT%H:%M:%SZ"),
            "candidateSha": resolved_candidate_sha,
            "invocationId": invocation_id,
            "operationId": operation_id,
            "previousLock": owner,
            "result": "stale-lifecycle-lock-recovered",
            "schema": "openclaw.custom-runtime-lifecycle-receipt.v1",
        }
        write_json(
            os.path.join(receipts_dir, f"lifecycle-lock-recovered-{now.strftime('%Y%m%dT%H%M%SZ')}-{os.getpid()}.json"),
            recovery_receipt,
        )
        continue
    owner = {
        "activeSha": resolved_active_sha,
        "actor": actor,
        "approvalId": approval_id,
        "candidateSha": resolved_candidate_sha,
        "createdAt": now.strftime("%Y-%m-%dT%H:%M:%SZ"),
        "invocationId": invocation_id,
        "operation": operation,
        "operationId": operation_id,
        "pid": caller_pid,
        "schema": "openclaw.custom-runtime-lifecycle-lock.v1",
    }
    try:
        write_json(owner_path, owner)
    except BaseException:
        try:
            os.rmdir(lock_path)
        except OSError:
            pass
        raise
    print(invocation_id)
    print("owned")
    raise SystemExit(0)
fail("global lifecycle lock acquisition raced repeatedly", 75)
PY
  ) || return $?
  custom_runtime_lifecycle_invocation_id=$(printf '%s\n' "$custom_runtime_lifecycle_resolution" | sed -n '1p')
  custom_runtime_lifecycle_lock_mode=$(printf '%s\n' "$custom_runtime_lifecycle_resolution" | sed -n '2p')
  [ -n "$custom_runtime_lifecycle_invocation_id" ] || return 78
  OPENCLAW_CUSTOM_RUNTIME_LIFECYCLE_INVOCATION_ID=$custom_runtime_lifecycle_invocation_id
  export OPENCLAW_CUSTOM_RUNTIME_LIFECYCLE_INVOCATION_ID
}

custom_runtime_lifecycle_finish() {
  custom_runtime_lifecycle_home=${1:-}
  custom_runtime_lifecycle_result=${2:-unknown}
  custom_runtime_lifecycle_exit_code=${3:-1}
  [ "${custom_runtime_lifecycle_lock_mode:-}" = owned ] || return 0
  python3 - "$custom_runtime_lifecycle_home" \
    "$OPENCLAW_CUSTOM_RUNTIME_LIFECYCLE_INVOCATION_ID" \
    "$custom_runtime_lifecycle_result" "$custom_runtime_lifecycle_exit_code" <<'PY'
import datetime as dt
import json
import os
import re
import secrets
import sys

runtime_home, invocation_id, result, exit_code_raw = sys.argv[1:]
lock_path = os.path.join(runtime_home, "locks", "lifecycle.lock")
owner_path = os.path.join(lock_path, "owner.json")
receipts_dir = os.path.join(runtime_home, "receipts")
identity_pattern = re.compile(r"[A-Za-z0-9._:@/+~-]{1,160}")
if not identity_pattern.fullmatch(result):
    result = "invalid-result"
try:
    exit_code = int(exit_code_raw)
except ValueError:
    exit_code = 1
if not os.path.isfile(owner_path) or os.path.islink(owner_path):
    raise SystemExit("custom runtime lifecycle finish blocked: lock owner is missing or unsafe")
with open(owner_path, encoding="utf-8") as handle:
    owner = json.load(handle)
if not isinstance(owner, dict) or owner.get("invocationId") != invocation_id:
    raise SystemExit("custom runtime lifecycle finish blocked: invocation identity mismatch")
now = dt.datetime.now(dt.timezone.utc).replace(microsecond=0)
payload = {
    **owner,
    "exitCode": exit_code,
    "finishedAt": now.strftime("%Y-%m-%dT%H:%M:%SZ"),
    "result": result,
    "schema": "openclaw.custom-runtime-lifecycle-receipt.v1",
}
target = os.path.join(
    receipts_dir,
    f"lifecycle-{owner.get('operation', 'unknown')}-{now.strftime('%Y%m%dT%H%M%SZ')}-{owner.get('pid')}.json",
)
temporary = f"{target}.tmp-{os.getpid()}-{secrets.token_hex(4)}"
descriptor = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
with os.fdopen(descriptor, "w", encoding="utf-8") as handle:
    json.dump(payload, handle, indent=2, sort_keys=True)
    handle.write("\n")
os.replace(temporary, target)
os.unlink(owner_path)
os.rmdir(lock_path)
PY
}

custom_runtime_lifecycle_refresh_provenance() {
  custom_runtime_lifecycle_home=${1:-}
  custom_runtime_lifecycle_active_sha=${2:-}
  custom_runtime_lifecycle_candidate_sha=${3:-}
  [ -n "${OPENCLAW_CUSTOM_RUNTIME_LIFECYCLE_INVOCATION_ID:-}" ] || return 78
  python3 - "$custom_runtime_lifecycle_home" \
    "$OPENCLAW_CUSTOM_RUNTIME_LIFECYCLE_INVOCATION_ID" \
    "$custom_runtime_lifecycle_active_sha" "$custom_runtime_lifecycle_candidate_sha" \
    "${OPENCLAW_CUSTOM_RUNTIME_LIFECYCLE_ACTOR:-}" \
    "${OPENCLAW_RELEASE_GOVERNANCE_APPROVAL_ID:-}" \
    "${OPENCLAW_CUSTOM_RUNTIME_OPERATION_ID:-}" <<'PY'
import getpass
import json
import os
import re
import secrets
import sys

runtime_home, invocation_id, active_sha, candidate_sha, actor, approval_id, operation_id = sys.argv[1:]
owner_path = os.path.join(runtime_home, "locks", "lifecycle.lock", "owner.json")
identity_pattern = re.compile(r"[A-Za-z0-9._:@/+~-]{1,160}")
sha_pattern = re.compile(r"(?:[0-9a-fA-F]{40}|[0-9a-fA-F]{64})")
if not os.path.isfile(owner_path) or os.path.islink(owner_path):
    raise SystemExit("custom runtime lifecycle provenance blocked: lock owner is missing or unsafe")
with open(owner_path, encoding="utf-8") as handle:
    owner = json.load(handle)
if not isinstance(owner, dict) or owner.get("invocationId") != invocation_id:
    raise SystemExit("custom runtime lifecycle provenance blocked: invocation identity mismatch")
actor = actor or getpass.getuser()
for field, value in (
    ("actor", actor),
    ("approval identity", approval_id),
    ("operation identity", operation_id),
):
    if not identity_pattern.fullmatch(value):
        raise SystemExit(f"custom runtime lifecycle provenance blocked: {field} is invalid")
for field, value in (("activeSha", active_sha), ("candidateSha", candidate_sha)):
    if value:
        if not sha_pattern.fullmatch(value):
            raise SystemExit(f"custom runtime lifecycle provenance blocked: {field} is invalid")
        owner[field] = value
owner["actor"] = actor
owner["approvalId"] = approval_id
owner["operationId"] = operation_id
temporary = f"{owner_path}.tmp-{os.getpid()}-{secrets.token_hex(4)}"
descriptor = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
with os.fdopen(descriptor, "w", encoding="utf-8") as handle:
    json.dump(owner, handle, indent=2, sort_keys=True)
    handle.write("\n")
os.replace(temporary, owner_path)
PY
}

# Certification leases freeze an exact active/candidate pair across CI, review,
# landing, activation, and soak. They only restrict lifecycle operations; every
# mutation still crosses the normal Release Governor verification boundary.
custom_runtime_certification_lease() {
  custom_runtime_lease_action=${1:-}
  custom_runtime_lease_home=${2:-}
  custom_runtime_lease_active_sha=${3:-}
  custom_runtime_lease_candidate_sha=${4:-}
  custom_runtime_lease_owner=${5:-}
  custom_runtime_lease_operation_class=${6:-}
  custom_runtime_lease_ttl_seconds=${7:-}
  custom_runtime_lease_approval_id=${8:-}
  custom_runtime_lease_operation_id=${9:-}
  custom_runtime_lease_invocation_id=${10:-${OPENCLAW_CUSTOM_RUNTIME_LIFECYCLE_INVOCATION_ID:-}}
  custom_runtime_lease_reason=${11:-}
  python3 - "$custom_runtime_lease_action" "$custom_runtime_lease_home" \
    "$custom_runtime_lease_active_sha" "$custom_runtime_lease_candidate_sha" \
    "$custom_runtime_lease_owner" "$custom_runtime_lease_operation_class" \
    "$custom_runtime_lease_ttl_seconds" "$custom_runtime_lease_approval_id" \
    "$custom_runtime_lease_operation_id" "$custom_runtime_lease_invocation_id" \
    "$custom_runtime_lease_reason" "${OPENCLAW_CUSTOM_RUNTIME_LIFECYCLE_ACTOR:-}" "$$" <<'PY'
import datetime as dt
import getpass
import json
import os
import re
import secrets
import stat
import sys

(
    action,
    runtime_home,
    active_sha,
    candidate_sha,
    owner,
    operation_class,
    ttl_raw,
    approval_id,
    operation_id,
    invocation_id,
    reason,
    actor,
    caller_pid_raw,
) = sys.argv[1:]
lease_path = os.path.join(runtime_home, "certification-lease.json")
pointer_path = os.path.join(runtime_home, "active-runtime.json")
receipts_dir = os.path.join(runtime_home, "receipts")
sha_pattern = re.compile(r"(?:[0-9a-fA-F]{40}|[0-9a-fA-F]{64})")
identity_pattern = re.compile(r"[A-Za-z0-9._:@/+~-]{1,160}")
reason_pattern = re.compile(r"[A-Za-z0-9._:@/+~-]{1,160}")
allowed_operation_classes = {"release-certification"}
allowed_states = {"acquired", "promotion-authorized", "promoted"}
max_ttl_seconds = 86400
now = dt.datetime.now(dt.timezone.utc).replace(microsecond=0)
actor = actor or getpass.getuser()
try:
    caller_pid = int(caller_pid_raw)
except ValueError:
    raise SystemExit("certification lease blocked: caller PID is invalid")
if caller_pid <= 0:
    raise SystemExit("certification lease blocked: caller PID is invalid")


def fail(message, code=78):
    print(f"certification lease blocked: {message}", file=sys.stderr)
    raise SystemExit(code)


def parse_time(value, field):
    if not isinstance(value, str) or not value.endswith("Z"):
        fail(f"{field} is missing or invalid")
    try:
        parsed = dt.datetime.fromisoformat(value[:-1] + "+00:00")
    except ValueError:
        fail(f"{field} is missing or invalid")
    if parsed.tzinfo is None:
        fail(f"{field} is missing or invalid")
    return parsed.astimezone(dt.timezone.utc)


def validate_identity(value, field):
    if not isinstance(value, str) or not identity_pattern.fullmatch(value):
        fail(f"{field} is missing or invalid")


def validate_binding(
    bound_active_sha,
    bound_candidate_sha,
    bound_owner,
    bound_operation_class,
):
    if not isinstance(bound_active_sha, str) or not sha_pattern.fullmatch(bound_active_sha):
        fail("active SHA is missing or invalid")
    if not isinstance(bound_candidate_sha, str) or not sha_pattern.fullmatch(bound_candidate_sha):
        fail("candidate SHA is missing or invalid")
    validate_identity(bound_owner, "owner")
    if bound_operation_class not in allowed_operation_classes:
        fail("operation class is missing or invalid")


def write_json(path, payload):
    temporary = f"{path}.tmp-{os.getpid()}-{secrets.token_hex(4)}"
    descriptor = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(descriptor, "w", encoding="utf-8") as handle:
        json.dump(payload, handle, indent=2, sort_keys=True)
        handle.write("\n")
    os.replace(temporary, path)


def load_pointer_sha():
    if not os.path.isfile(pointer_path) or os.path.islink(pointer_path):
        fail("active runtime pointer is missing or unsafe")
    try:
        with open(pointer_path, encoding="utf-8") as handle:
            pointer = json.load(handle)
    except (OSError, json.JSONDecodeError):
        fail("active runtime pointer is malformed")
    if not isinstance(pointer, dict):
        fail("active runtime pointer is malformed")
    source_sha = pointer.get("sourceSha")
    if not isinstance(source_sha, str) or not sha_pattern.fullmatch(source_sha):
        fail("active runtime pointer SHA is missing or invalid")
    return source_sha


def load_lease():
    if not os.path.isfile(lease_path) or os.path.islink(lease_path):
        fail("lease is missing or unsafe")
    if stat.S_IMODE(os.stat(lease_path).st_mode) & 0o077:
        fail("lease permissions are unsafe")
    try:
        with open(lease_path, encoding="utf-8") as handle:
            lease = json.load(handle)
    except (OSError, json.JSONDecodeError):
        fail("lease is malformed")
    if not isinstance(lease, dict):
        fail("lease is malformed")
    if lease.get("schema") != "openclaw.custom-runtime-certification-lease.v2":
        fail("lease schema is invalid")
    validate_binding(
        lease.get("activeSha"),
        lease.get("candidateSha"),
        lease.get("owner"),
        lease.get("operationClass"),
    )
    for field in ("actor", "approvalId", "operationId", "invocationId"):
        validate_identity(lease.get(field), field)
    pid = lease.get("pid")
    if not isinstance(pid, int) or pid <= 0:
        fail("lease PID is missing or invalid")
    state = lease.get("state")
    if state not in allowed_states:
        fail("lease state is missing or invalid")
    created_at = parse_time(lease.get("createdAt"), "creation time")
    expires_at = parse_time(lease.get("expiresAt"), "expiration time")
    if created_at > now + dt.timedelta(seconds=60):
        fail("creation time is in the future")
    if expires_at <= created_at:
        fail("expiration must follow creation")
    if (expires_at - created_at).total_seconds() > max_ttl_seconds:
        fail("lease duration exceeds the maximum")
    return lease, created_at, expires_at


def require_live(lease, expires_at):
    if expires_at <= now:
        fail("lease is expired; recover it explicitly")
    pointer_sha = load_pointer_sha()
    expected_sha = lease["candidateSha"] if lease["state"] == "promoted" else lease["activeSha"]
    if pointer_sha != expected_sha:
        fail("active runtime conflicts with the certification state")


def require_requested_binding():
    validate_binding(active_sha, candidate_sha, owner, operation_class)
    for field, value in (
        ("approvalId", approval_id),
        ("operationId", operation_id),
        ("invocationId", invocation_id),
    ):
        validate_identity(value, field)


def require_exact_binding(lease):
    require_requested_binding()
    if lease.get("actor") != actor:
        fail("lease actor does not match the requesting actor")
    expected = {
        "activeSha": active_sha,
        "approvalId": approval_id,
        "candidateSha": candidate_sha,
        "invocationId": invocation_id,
        "operationClass": operation_class,
        "operationId": operation_id,
        "owner": owner,
    }
    for field, expected_value in expected.items():
        if lease.get(field) != expected_value:
            fail(f"lease {field} does not match the requested binding")


def write_receipt(result, lease, receipt_reason=None):
    os.makedirs(receipts_dir, mode=0o700, exist_ok=True)
    stamp = now.strftime("%Y%m%dT%H%M%SZ")
    target = os.path.join(
        receipts_dir,
        f"certification-lease-{result}-{str(lease['candidateSha'])[:12]}-{stamp}-{os.getpid()}.json",
    )
    payload = {
        "activeSha": lease["activeSha"],
        "actor": actor,
        "approvalId": lease["approvalId"],
        "at": now.strftime("%Y-%m-%dT%H:%M:%SZ"),
        "candidateSha": lease["candidateSha"],
        "invocationId": lease["invocationId"],
        "lease": lease,
        "operationId": lease["operationId"],
        "pid": caller_pid,
        "result": result,
        "schema": "openclaw.custom-runtime-certification-lease-receipt.v2",
    }
    if receipt_reason is not None:
        payload["reason"] = receipt_reason
    write_json(target, payload)
    return target


def replace_lease(lease):
    write_json(lease_path, lease)


if action == "status":
    lease, _, expires_at = load_lease()
    output = dict(lease)
    output["validity"] = "expired" if expires_at <= now else "active"
    print(json.dumps(output, sort_keys=True))
    raise SystemExit(0)

if action == "acquire":
    require_requested_binding()
    try:
        ttl_seconds = int(ttl_raw)
    except ValueError:
        fail("TTL is missing or invalid", 64)
    if ttl_seconds < 300 or ttl_seconds > max_ttl_seconds:
        fail("TTL must be between 300 and 86400 seconds", 64)
    if os.path.lexists(lease_path):
        _, _, expires_at = load_lease()
        validity = "expired" if expires_at <= now else "unexpired"
        fail(f"{validity} lease already exists; recover or release it explicitly", 75)
    if load_pointer_sha() != active_sha:
        fail("active runtime does not match the requested lease")
    lease = {
        "activeSha": active_sha,
        "actor": actor,
        "approvalId": approval_id,
        "candidateSha": candidate_sha,
        "createdAt": now.strftime("%Y-%m-%dT%H:%M:%SZ"),
        "expiresAt": (now + dt.timedelta(seconds=ttl_seconds)).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "invocationId": invocation_id,
        "operationClass": operation_class,
        "operationId": operation_id,
        "owner": owner,
        "pid": caller_pid,
        "schema": "openclaw.custom-runtime-certification-lease.v2",
        "state": "acquired",
    }
    replace_lease(lease)
    write_receipt("acquired", lease)
    print(lease_path)
    raise SystemExit(0)

if action in {"authorize-promotion", "release", "recover-expired"}:
    lease, _, expires_at = load_lease()
    require_exact_binding(lease)
    if action == "recover-expired":
        if expires_at > now:
            fail("unexpired lease cannot be recovered")
        receipt = write_receipt("expired-recovered", lease)
        os.unlink(lease_path)
        print(receipt)
        raise SystemExit(0)
    require_live(lease, expires_at)
    if action == "authorize-promotion":
        if lease["state"] != "acquired":
            fail("promotion authorization requires an acquired lease")
        lease["promotionAuthorizedAt"] = now.strftime("%Y-%m-%dT%H:%M:%SZ")
        lease["state"] = "promotion-authorized"
        replace_lease(lease)
        print(write_receipt("promotion-authorized", lease))
        raise SystemExit(0)
    print(write_receipt("released", lease))
    os.unlink(lease_path)
    raise SystemExit(0)

if not os.path.lexists(lease_path):
    if action in {
        "break-emergency",
        "record-promoted",
        "verify-activation",
        "verify-guard-mutation",
        "verify-promotion",
        "verify-restart",
        "verify-rollback",
    }:
        raise SystemExit(0)
    fail("lease is missing")

lease, _, expires_at = load_lease()
if expires_at <= now:
    fail("lease is expired; recover it explicitly")

if action in {"verify-activation", "verify-promotion"}:
    require_live(lease, expires_at)
    if lease["activeSha"] != active_sha:
        fail("active runtime changed after certification began")
    if lease["candidateSha"] != candidate_sha:
        fail("another candidate owns the active certification lease", 75)
    if lease["state"] != "promotion-authorized":
        fail("same-candidate promotion is not owner-authorized yet", 75)
    raise SystemExit(0)

if action == "record-promoted":
    if lease["state"] != "promotion-authorized":
        fail("promotion completion requires an authorized lease")
    if lease["candidateSha"] != candidate_sha or load_pointer_sha() != candidate_sha:
        fail("promoted runtime does not match the certified candidate")
    lease["promotedAt"] = now.strftime("%Y-%m-%dT%H:%M:%SZ")
    lease["state"] = "promoted"
    replace_lease(lease)
    print(write_receipt("promoted", lease))
    raise SystemExit(0)

if action == "verify-restart":
    require_live(lease, expires_at)
    if lease["state"] != "promoted" or lease["candidateSha"] != active_sha:
        fail("restart is frozen until the certified candidate is promoted", 75)
    raise SystemExit(0)

if action in {"verify-rollback", "verify-guard-mutation"}:
    require_live(lease, expires_at)
    fail("managed-runtime mutation is frozen by active certification", 75)

if action == "break-emergency":
    if not reason_pattern.fullmatch(reason):
        fail("emergency reason is missing or invalid", 64)
    approval = os.environ.get("OPENCLAW_RELEASE_GOVERNANCE_APPROVAL_ID", "")
    if not identity_pattern.fullmatch(approval):
        fail("emergency Release Governor approval identity is missing or invalid", 78)
    lease["invalidatedAt"] = now.strftime("%Y-%m-%dT%H:%M:%SZ")
    lease["invalidatedByApprovalId"] = approval
    receipt = write_receipt("certification-invalidated", lease, reason)
    os.unlink(lease_path)
    print(receipt)
    raise SystemExit(0)

fail("unknown lease action", 64)
PY
}
