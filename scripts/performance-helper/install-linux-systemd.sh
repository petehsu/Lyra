#!/usr/bin/env bash
set -euo pipefail

HELPER_SOURCE="${1:-target/release/lyra-performance-helper}"
INSTALL_DIR="/usr/local/libexec/lyra"
INSTALL_PATH="${INSTALL_DIR}/lyra-performance-helper"
UNIT_PATH="/etc/systemd/system/lyra-performance-helper.service"
SOCKET_PATH="/run/lyra-performance-helper.sock"

if [[ ! -x "${HELPER_SOURCE}" ]]; then
  echo "helper binary not found or not executable: ${HELPER_SOURCE}" >&2
  echo "build it with: cargo build --release -p lyra-performance-core --bin lyra-performance-helper" >&2
  exit 1
fi

install -d -o root -g root -m 755 "${INSTALL_DIR}"
install -o root -g root -m 755 "${HELPER_SOURCE}" "${INSTALL_PATH}"

cat > "${UNIT_PATH}" <<EOF
[Unit]
Description=Lyra Performance Scheduling Helper
After=multi-user.target

[Service]
Type=simple
ExecStart=${INSTALL_PATH} --serve-unix ${SOCKET_PATH}
Restart=always
RestartSec=2
User=root
Group=root

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable lyra-performance-helper.service
rm -f "${SOCKET_PATH}"
systemctl restart lyra-performance-helper.service

echo "installed lyra-performance-helper.service"
echo "socket: ${SOCKET_PATH}"
