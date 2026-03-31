#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
if command -v pnpm >/dev/null 2>&1; then
  pnpm exec tsx tools/verify-boundaries.ts
  exit 0
fi

if command -v npx >/dev/null 2>&1; then
  npx -y tsx tools/verify-boundaries.ts
  exit 0
fi

echo "Neither pnpm nor npx found. Cannot run structure guard." >&2
exit 1
