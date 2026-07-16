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
