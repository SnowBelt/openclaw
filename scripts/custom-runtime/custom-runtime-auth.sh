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
}

# Certification leases serialize an exact active/candidate pair across long-running
# CI and review windows. Promotion still requires normal Release Governor approval;
# this contract can only further restrict an already-authorized mutation.
custom_runtime_certification_lease() {
  custom_runtime_lease_action=${1:-}
  custom_runtime_lease_home=${2:-}
  custom_runtime_lease_active_sha=${3:-}
  custom_runtime_lease_candidate_sha=${4:-}
  custom_runtime_lease_owner=${5:-}
  custom_runtime_lease_operation_class=${6:-}
  custom_runtime_lease_ttl_seconds=${7:-}
  python3 - "$custom_runtime_lease_action" "$custom_runtime_lease_home" \
    "$custom_runtime_lease_active_sha" "$custom_runtime_lease_candidate_sha" \
    "$custom_runtime_lease_owner" "$custom_runtime_lease_operation_class" \
    "$custom_runtime_lease_ttl_seconds" <<'PY'
import datetime as dt
import json
import os
import re
import sys

action, runtime_home, active_sha, candidate_sha, owner, operation_class, ttl_raw = sys.argv[1:]
lease_path = os.path.join(runtime_home, "certification-lease.json")
pointer_path = os.path.join(runtime_home, "active-runtime.json")
receipts_dir = os.path.join(runtime_home, "receipts")
sha_pattern = re.compile(r"(?:[0-9a-fA-F]{40}|[0-9a-fA-F]{64})")
owner_pattern = re.compile(r"[A-Za-z0-9._:@/+~-]{1,128}")
allowed_operation_classes = {"release-certification"}
now = dt.datetime.now(dt.timezone.utc).replace(microsecond=0)


def fail(message: str, code: int = 78) -> None:
    print(f"certification lease blocked: {message}", file=sys.stderr)
    raise SystemExit(code)


def parse_time(value: object, field: str) -> dt.datetime:
    if not isinstance(value, str) or not value.endswith("Z"):
        fail(f"{field} is missing or invalid")
    try:
        parsed = dt.datetime.fromisoformat(value[:-1] + "+00:00")
    except ValueError:
        fail(f"{field} is missing or invalid")
    if parsed.tzinfo is None:
        fail(f"{field} is missing or invalid")
    return parsed.astimezone(dt.timezone.utc)


def validate_binding(
    bound_active_sha: object,
    bound_candidate_sha: object,
    bound_owner: object,
    bound_operation_class: object,
) -> None:
    if not isinstance(bound_active_sha, str) or not sha_pattern.fullmatch(bound_active_sha):
        fail("active SHA is missing or invalid")
    if not isinstance(bound_candidate_sha, str) or not sha_pattern.fullmatch(bound_candidate_sha):
        fail("candidate SHA is missing or invalid")
    if not isinstance(bound_owner, str) or not owner_pattern.fullmatch(bound_owner):
        fail("owner is missing or invalid")
    if bound_operation_class not in allowed_operation_classes:
        fail("operation class is missing or invalid")


def load_lease() -> tuple[dict[str, object], dt.datetime, dt.datetime]:
    if not os.path.isfile(lease_path) or os.path.islink(lease_path):
        fail("lease is missing or unsafe")
    try:
        with open(lease_path, encoding="utf-8") as handle:
            lease = json.load(handle)
    except (OSError, json.JSONDecodeError):
        fail("lease is malformed")
    if not isinstance(lease, dict):
        fail("lease is malformed")
    if lease.get("schema") != "openclaw.custom-runtime-certification-lease.v1":
        fail("lease schema is invalid")
    validate_binding(
        lease.get("activeSha"),
        lease.get("candidateSha"),
        lease.get("owner"),
        lease.get("operationClass"),
    )
    created_at = parse_time(lease.get("createdAt"), "creation time")
    expires_at = parse_time(lease.get("expiresAt"), "expiration time")
    if expires_at <= created_at:
        fail("expiration must follow creation")
    return lease, created_at, expires_at


def require_requested_binding() -> None:
    validate_binding(active_sha, candidate_sha, owner, operation_class)


def require_exact_binding(lease: dict[str, object]) -> None:
    require_requested_binding()
    expected = {
        "activeSha": active_sha,
        "candidateSha": candidate_sha,
        "owner": owner,
        "operationClass": operation_class,
    }
    for field, expected_value in expected.items():
        if lease.get(field) != expected_value:
            fail(f"lease {field} does not match the requested binding")


def write_receipt(result: str, lease: dict[str, object]) -> str:
    os.makedirs(receipts_dir, mode=0o700, exist_ok=True)
    stamp = now.strftime("%Y%m%dT%H%M%SZ")
    target = os.path.join(
        receipts_dir,
        f"certification-lease-{result}-{candidate_sha[:12]}-{stamp}-{os.getpid()}.json",
    )
    payload = {
        "at": now.strftime("%Y-%m-%dT%H:%M:%SZ"),
        "lease": lease,
        "result": result,
        "schema": "openclaw.custom-runtime-certification-lease-receipt.v1",
    }
    temporary = f"{target}.tmp-{os.getpid()}"
    descriptor = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(descriptor, "w", encoding="utf-8") as handle:
        json.dump(payload, handle, indent=2, sort_keys=True)
        handle.write("\n")
    os.replace(temporary, target)
    return target


if action == "status":
    lease, _, expires_at = load_lease()
    output = dict(lease)
    output["state"] = "expired" if expires_at <= now else "active"
    print(json.dumps(output, sort_keys=True))
    raise SystemExit(0)

if action == "acquire":
    require_requested_binding()
    try:
        ttl_seconds = int(ttl_raw)
    except ValueError:
        fail("TTL is missing or invalid", 64)
    if ttl_seconds < 300 or ttl_seconds > 86400:
        fail("TTL must be between 300 and 86400 seconds", 64)
    if os.path.lexists(lease_path):
        _, _, expires_at = load_lease()
        state = "expired" if expires_at <= now else "unexpired"
        fail(f"{state} lease already exists; recover or release it explicitly", 75)
    if not os.path.isfile(pointer_path) or os.path.islink(pointer_path):
        fail("active runtime pointer is missing or unsafe")
    try:
        with open(pointer_path, encoding="utf-8") as handle:
            current_active_sha = json.load(handle).get("sourceSha")
    except (OSError, json.JSONDecodeError, AttributeError):
        fail("active runtime pointer is malformed")
    if current_active_sha != active_sha:
        fail("active runtime does not match the requested lease")
    lease = {
        "activeSha": active_sha,
        "candidateSha": candidate_sha,
        "createdAt": now.strftime("%Y-%m-%dT%H:%M:%SZ"),
        "expiresAt": (now + dt.timedelta(seconds=ttl_seconds)).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "operationClass": operation_class,
        "owner": owner,
        "schema": "openclaw.custom-runtime-certification-lease.v1",
    }
    temporary = f"{lease_path}.tmp-{os.getpid()}"
    descriptor = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(descriptor, "w", encoding="utf-8") as handle:
        json.dump(lease, handle, indent=2, sort_keys=True)
        handle.write("\n")
    os.replace(temporary, lease_path)
    print(lease_path)
    raise SystemExit(0)

if action in {"release", "recover-expired"}:
    lease, _, expires_at = load_lease()
    require_exact_binding(lease)
    if action == "release" and expires_at <= now:
        fail("lease is expired; use explicit expiration recovery")
    if action == "recover-expired" and expires_at > now:
        fail("unexpired lease cannot be recovered")
    result = "released" if action == "release" else "expired"
    receipt = write_receipt(result, lease)
    os.unlink(lease_path)
    print(receipt)
    raise SystemExit(0)

if action == "verify-promotion":
    if not os.path.lexists(lease_path):
        raise SystemExit(0)
    lease, _, expires_at = load_lease()
    if expires_at <= now:
        fail("lease is expired; recover it explicitly before promotion")
    if lease.get("activeSha") != active_sha:
        fail("active runtime changed after certification began")
    if lease.get("candidateSha") != candidate_sha:
        fail("another candidate owns the active certification lease", 75)
    if lease.get("operationClass") != "release-certification":
        fail("lease does not authorize the promotion operation class")
    raise SystemExit(0)

fail("unknown lease action", 64)
PY
}
