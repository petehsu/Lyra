#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
node --import tsx "$ROOT_DIR/scripts/desktop/generate-app-icons.ts"
