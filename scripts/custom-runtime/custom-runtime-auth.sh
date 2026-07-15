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
