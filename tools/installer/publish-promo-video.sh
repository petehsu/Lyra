#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
VIDEO="${1:-}"

if [[ -z "$VIDEO" ]]; then
  echo "usage: bash tools/installer/publish-promo-video.sh /path/to/video.mp4" >&2
  exit 1
fi

looks_like_key() {
  [[ "$1" == eyJ* || "$1" == sb_secret* ]]
}

if ! looks_like_key "${SUPABASE_SERVICE_ROLE_KEY:-}"; then
  echo "Paste the Secret key (sb_secret_...) then press Enter. It will not be shown." >&2
  IFS= read -r -s SUPABASE_SERVICE_ROLE_KEY
  echo >&2
  if ! looks_like_key "${SUPABASE_SERVICE_ROLE_KEY:-}"; then
    echo "That was not a service_role secret." >&2
    exit 1
  fi
fi

export SUPABASE_SERVICE_ROLE_KEY
cd "$ROOT"
exec ./node_modules/.bin/tsx tools/installer/publish-promo-video.ts "$VIDEO"
