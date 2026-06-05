#!/usr/bin/env bash
set -euo pipefail

UNIT_PATH="/etc/systemd/system/lyra-performance-helper.service"
INSTALL_PATH="/usr/local/libexec/lyra/lyra-performance-helper"
SOCKET_PATH="/run/lyra-performance-helper.sock"

systemctl disable --now lyra-performance-helper.service >/dev/null 2>&1 || true
rm -f "${SOCKET_PATH}" "${UNIT_PATH}" "${INSTALL_PATH}"
systemctl daemon-reload

echo "uninstalled lyra-performance-helper.service"
