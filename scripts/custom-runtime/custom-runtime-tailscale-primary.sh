#!/bin/sh
# Keeps the configured userspace Tailscale dashboard route independently healthy.
set -eu

operation=${1:-guard}
case "$operation" in guard|status) ;; *) printf '%s\n' 'usage: custom-runtime-tailscale-primary.sh [guard|status]' >&2; exit 64 ;; esac

runtime_home=${OPENCLAW_CUSTOM_RUNTIME_HOME:-"$HOME/.openclaw-custom-runtime"}
state_dir=${OPENCLAW_TAILSCALE_PRIMARY_STATE_DIR:-"$HOME/.local/share/tailscale-userspace"}
state_file="$state_dir/tailscaled.state"
socket=${OPENCLAW_TAILSCALE_PRIMARY_SOCKET:-"$state_dir/tailscaled.sock"}
tailscaled=${OPENCLAW_TAILSCALE_PRIMARY_DAEMON:-/opt/homebrew/bin/tailscaled}
tailscale=${OPENCLAW_TAILSCALE_PRIMARY_CLI:-/opt/homebrew/bin/tailscale}
launchctl=${OPENCLAW_TAILSCALE_PRIMARY_LAUNCHCTL:-launchctl}
plist=${OPENCLAW_TAILSCALE_PRIMARY_PLIST:-"$HOME/Library/LaunchAgents/com.openclaw.tailscale-userspace.plist"}
label=${OPENCLAW_TAILSCALE_PRIMARY_LABEL:-com.openclaw.tailscale-userspace}
expected_dns=${OPENCLAW_TAILSCALE_PRIMARY_EXPECTED_DNS:-}
wait_attempts=${OPENCLAW_TAILSCALE_PRIMARY_WAIT_ATTEMPTS:-45}
port=${OPENCLAW_GATEWAY_PORT:-18789}
case "$wait_attempts" in *[!0-9]*|'') printf '%s\n' 'wait attempts must be a positive integer' >&2; exit 64 ;; esac
[ "$wait_attempts" -gt 0 ] || { printf '%s\n' 'wait attempts must be a positive integer' >&2; exit 64; }
uid=$(id -u)
desired_plist="$runtime_home/tailscale-userspace.desired.plist"
receipts="$runtime_home/receipts"
backups="$runtime_home/backups"
locks="$runtime_home/locks"
stamp=$(date -u +%Y%m%dT%H%M%SZ)
run_id="$stamp-$$"
receipt="$receipts/tailscale-primary-$run_id.json"

configured=false
if [ -f "$state_file" ]; then configured=true; fi
if [ "$configured" = false ]; then
  [ "$operation" != status ] || printf '%s\n' '{"configured":false,"result":"not_configured"}'
  exit 0
fi

mkdir -p "$runtime_home" "$receipts" "$backups" "$locks" "$state_dir" "$(dirname "$plist")"

write_receipt() {
  python3 - "$receipt" "$stamp" "$1" "$2" "${3:-}" "${4:-}" "${5:-false}" <<'PY'
import json
import sys

path, at, result, repaired, backend, dns_name, serve_configured = sys.argv[1:]
payload = {
    "at": at,
    "result": result,
    "configRepaired": repaired == "true",
    "backend": backend or None,
    "dnsName": dns_name or None,
    "serveConfigured": serve_configured == "true",
}
with open(path + ".tmp", "w", encoding="utf-8") as f:
    json.dump(payload, f, indent=2, sort_keys=True)
    f.write("\n")
PY
  mv "$receipt.tmp" "$receipt"
}

if [ ! -x "$tailscaled" ] || [ ! -x "$tailscale" ]; then
  if [ "$operation" = status ]; then
    printf '%s\n' '{"configured":true,"dnsName":null,"healthy":false,"plistMatches":false,"result":"required_binary_missing","serveConfigured":false}'
    exit 1
  fi
  write_receipt required_binary_missing false
  exit 1
fi

desired_tmp="$desired_plist.candidate-$$"
status_file="$runtime_home/.tailscale-primary-status-$$.json"
serve_file="$runtime_home/.tailscale-primary-serve-$$.json"
cleanup_tmp() {
  rm -f \
    "$desired_tmp" \
    "$plist.candidate-$$" \
    "$status_file" "$status_file.tmp" \
    "$serve_file" "$serve_file.tmp"
}
trap cleanup_tmp EXIT INT TERM
python3 - "$desired_tmp" "$label" "$tailscaled" "$socket" "$state_dir" "$HOME" <<'PY'
import os
import plistlib
import sys

path, label, tailscaled, socket, state_dir, home = sys.argv[1:]
payload = {
    "Label": label,
    "ProgramArguments": [
        tailscaled,
        "--tun=userspace-networking",
        "--socket",
        socket,
        "--statedir",
        state_dir,
        "--socks5-server",
        "127.0.0.1:1055",
        "--outbound-http-proxy-listen",
        "127.0.0.1:1056",
    ],
    "RunAtLoad": True,
    "KeepAlive": True,
    "ThrottleInterval": 10,
    "ProcessType": "Background",
    "WorkingDirectory": state_dir,
    "EnvironmentVariables": {
        "HOME": home,
        "USER": os.environ.get("USER", "openclaw"),
        "LOGNAME": os.environ.get("LOGNAME", os.environ.get("USER", "openclaw")),
        "PATH": "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin",
    },
    "StandardOutPath": os.path.join(state_dir, "tailscaled.out.log"),
    "StandardErrorPath": os.path.join(state_dir, "tailscaled.err.log"),
}
with open(path, "wb") as f:
    plistlib.dump(payload, f, sort_keys=False)
os.chmod(path, 0o644)
PY
mv "$desired_tmp" "$desired_plist"

plist_matches=false
if [ -f "$plist" ] && python3 - "$plist" "$desired_plist" <<'PY'
import plistlib
import sys

try:
    with open(sys.argv[1], "rb") as f:
        current = plistlib.load(f)
    with open(sys.argv[2], "rb") as f:
        desired = plistlib.load(f)
except (OSError, plistlib.InvalidFileException):
    raise SystemExit(1)
raise SystemExit(0 if current == desired else 1)
PY
then
  plist_matches=true
fi

probe_status() {
  [ -S "$socket" ] || return 1
  "$tailscale" --socket "$socket" status --json > "$status_file.tmp" 2>/dev/null || return 1
  mv "$status_file.tmp" "$status_file"
  python3 - "$status_file" "$expected_dns" <<'PY'
import json
import sys

with open(sys.argv[1], encoding="utf-8") as f:
    status = json.load(f)
self_status = status.get("Self") or {}
expected_dns = sys.argv[2] if len(sys.argv) > 2 else ""
dns_name = self_status.get("DNSName") or ""
healthy = status.get("BackendState") == "Running" and self_status.get("Online") is True
if expected_dns:
    healthy = healthy and dns_name.rstrip(".").lower() == expected_dns.rstrip(".").lower()
raise SystemExit(0 if healthy else 1)
PY
}

probe_serve() {
  "$tailscale" --socket "$socket" serve status --json > "$serve_file.tmp" 2>/dev/null || return 1
  mv "$serve_file.tmp" "$serve_file"
  python3 - "$serve_file" "$port" <<'PY'
import json
import sys

with open(sys.argv[1], encoding="utf-8") as f:
    payload = json.load(f)
needle = ":" + sys.argv[2]

def contains_target(value):
    if isinstance(value, str):
        return needle in value and ("127.0.0.1" in value or "localhost" in value)
    if isinstance(value, dict):
        return any(contains_target(item) for item in value.values())
    if isinstance(value, list):
        return any(contains_target(item) for item in value)
    return False

raise SystemExit(0 if contains_target(payload) else 1)
PY
}

if [ "$operation" = status ]; then
  healthy=false
  serve_configured=false
  dns_name=
  if probe_status; then
    healthy=true
    dns_name=$(python3 - "$status_file" <<'PY'
import json
import sys

with open(sys.argv[1], encoding="utf-8") as f:
    status = json.load(f)
print(str((status.get("Self") or {}).get("DNSName") or ""))
PY
)
  fi
  if [ "$healthy" = true ] && probe_serve; then serve_configured=true; fi
  python3 - "$configured" "$plist_matches" "$healthy" "$serve_configured" "$dns_name" <<'PY'
import json
import sys

configured, plist_matches, healthy, serve = (value == "true" for value in sys.argv[1:5])
dns_name = sys.argv[5] or None
print(json.dumps({
    "configured": configured,
    "dnsName": dns_name,
    "plistMatches": plist_matches,
    "healthy": healthy,
    "serveConfigured": serve,
}, sort_keys=True))
PY
  if [ "$plist_matches" = true ] && [ "$healthy" = true ] && [ "$serve_configured" = true ]; then
    exit 0
  fi
  exit 1
fi

lock="$locks/tailscale-primary.lock"
if ! mkdir "$lock" 2>/dev/null; then exit 0; fi
trap 'cleanup_tmp; rmdir "$lock" 2>/dev/null || true' EXIT INT TERM

config_repaired=false
needs_restart=false
if [ "$plist_matches" = false ]; then
  if [ -f "$plist" ]; then cp -p "$plist" "$backups/tailscale-userspace-$run_id.plist"; fi
  install -m 644 "$desired_plist" "$plist.candidate-$$"
  python3 - "$plist.candidate-$$" <<'PY'
import plistlib
import sys
with open(sys.argv[1], "rb") as f:
    plistlib.load(f)
PY
  mv "$plist.candidate-$$" "$plist"
  config_repaired=true
  needs_restart=true
fi
if ! probe_status; then needs_restart=true; fi

if [ "$needs_restart" = true ]; then
  "$launchctl" bootout "gui/$uid/$label" 2>/dev/null || true
  if ! "$launchctl" bootstrap "gui/$uid" "$plist"; then
    write_receipt bootstrap_failed "$config_repaired"
    exit 1
  fi
  "$launchctl" kickstart -k "gui/$uid/$label" >/dev/null 2>&1 || true
  healthy=false
  for _ in $(seq 1 "$wait_attempts"); do
    if probe_status; then healthy=true; break; fi
    sleep 1
  done
  if [ "$healthy" != true ]; then
    write_receipt health_failed "$config_repaired"
    exit 1
  fi
fi

serve_configured=false
if probe_serve; then
  serve_configured=true
else
  if ! "$tailscale" --socket "$socket" serve --bg --yes --https=443 "http://127.0.0.1:$port" >/dev/null; then
    write_receipt serve_command_failed "$config_repaired"
    exit 1
  fi
  if probe_serve; then serve_configured=true; fi
fi
if [ "$serve_configured" != true ]; then
  write_receipt serve_failed "$config_repaired"
  exit 1
fi

identity=$(python3 - "$status_file" <<'PY'
import json
import sys
with open(sys.argv[1], encoding="utf-8") as f:
    status = json.load(f)
self_status = status.get("Self") or {}
print(status.get("BackendState") or "")
print(self_status.get("DNSName") or "")
PY
)
backend=$(printf '%s\n' "$identity" | sed -n '1p')
dns_name=$(printf '%s\n' "$identity" | sed -n '2p')
write_receipt healthy "$config_repaired" "$backend" "$dns_name" true
printf '%s\n' "TAILSCALE_PRIMARY_OK dns=${dns_name:-unknown}"
