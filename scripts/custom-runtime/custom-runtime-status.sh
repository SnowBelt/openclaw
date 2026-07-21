#!/bin/sh
# Inspect the active runtime directly. Never invoke a package manager in a release tree.
set -eu

runtime_home=${OPENCLAW_CUSTOM_RUNTIME_HOME:-"$HOME/.openclaw-custom-runtime"}
launcher="$runtime_home/bin/custom-runtime-launcher.sh"
[ -x "$launcher" ] || {
  printf '%s\n' 'custom runtime status blocked: managed launcher is unavailable' >&2
  exit 64
}

exec "$launcher" gateway status "$@"
