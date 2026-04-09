#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
ICON_SRC="$ROOT_DIR/apps/desktop/src/renderer/assets/logo.png"
ICON_DIR="$ROOT_DIR/apps/desktop/resources/icons/macos"
ICONSET_DIR="$ICON_DIR/lyra.iconset"
ICNS_OUT="$ICON_DIR/lyra.icns"

if [[ ! -f "$ICON_SRC" ]]; then
  echo "logo source not found: $ICON_SRC" >&2
  exit 1
fi

mkdir -p "$ICONSET_DIR"

sips -z 16 16 "$ICON_SRC" --out "$ICONSET_DIR/icon_16x16.png" >/dev/null
sips -z 32 32 "$ICON_SRC" --out "$ICONSET_DIR/icon_16x16@2x.png" >/dev/null
sips -z 32 32 "$ICON_SRC" --out "$ICONSET_DIR/icon_32x32.png" >/dev/null
sips -z 64 64 "$ICON_SRC" --out "$ICONSET_DIR/icon_32x32@2x.png" >/dev/null
sips -z 128 128 "$ICON_SRC" --out "$ICONSET_DIR/icon_128x128.png" >/dev/null
sips -z 256 256 "$ICON_SRC" --out "$ICONSET_DIR/icon_128x128@2x.png" >/dev/null
sips -z 256 256 "$ICON_SRC" --out "$ICONSET_DIR/icon_256x256.png" >/dev/null
sips -z 512 512 "$ICON_SRC" --out "$ICONSET_DIR/icon_256x256@2x.png" >/dev/null
sips -z 512 512 "$ICON_SRC" --out "$ICONSET_DIR/icon_512x512.png" >/dev/null
sips -z 1024 1024 "$ICON_SRC" --out "$ICONSET_DIR/icon_512x512@2x.png" >/dev/null

iconutil -c icns "$ICONSET_DIR" -o "$ICNS_OUT"
echo "generated macOS icon assets:"
echo "  iconset: $ICONSET_DIR"
echo "  icns:    $ICNS_OUT"
