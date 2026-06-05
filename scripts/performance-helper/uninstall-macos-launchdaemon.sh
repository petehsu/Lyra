#!/usr/bin/env bash
set -euo pipefail

LABEL="dev.lyra.performance-helper"
INSTALL_PATH="/Library/PrivilegedHelperTools/${LABEL}"
PLIST_PATH="/Library/LaunchDaemons/${LABEL}.plist"
SOCKET_PATH="/var/run/lyra-performance-helper.sock"

launchctl bootout system "${PLIST_PATH}" >/dev/null 2>&1 || true
rm -f "${SOCKET_PATH}" "${PLIST_PATH}" "${INSTALL_PATH}"

echo "uninstalled ${LABEL}"
