#!/usr/bin/env bash
set -euo pipefail

HELPER_SOURCE="${1:-target/release/lyra-performance-helper}"
LABEL="dev.lyra.performance-helper"
INSTALL_PATH="/Library/PrivilegedHelperTools/${LABEL}"
PLIST_PATH="/Library/LaunchDaemons/${LABEL}.plist"
SOCKET_PATH="/var/run/lyra-performance-helper.sock"

if [[ ! -x "${HELPER_SOURCE}" ]]; then
  echo "helper binary not found or not executable: ${HELPER_SOURCE}" >&2
  echo "build it with: cargo build --release -p lyra-performance-core --bin lyra-performance-helper" >&2
  exit 1
fi

install -d -o root -g wheel -m 755 /Library/PrivilegedHelperTools
install -o root -g wheel -m 755 "${HELPER_SOURCE}" "${INSTALL_PATH}"

cat > "${PLIST_PATH}" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${INSTALL_PATH}</string>
    <string>--serve-unix</string>
    <string>${SOCKET_PATH}</string>
  </array>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>StandardErrorPath</key>
  <string>/var/log/${LABEL}.err.log</string>
  <key>StandardOutPath</key>
  <string>/var/log/${LABEL}.out.log</string>
</dict>
</plist>
EOF

chown root:wheel "${PLIST_PATH}"
chmod 644 "${PLIST_PATH}"
launchctl bootout system "${PLIST_PATH}" >/dev/null 2>&1 || true
rm -f "${SOCKET_PATH}"
launchctl bootstrap system "${PLIST_PATH}"
launchctl enable "system/${LABEL}"
launchctl kickstart -k "system/${LABEL}"

echo "installed ${LABEL}"
echo "socket: ${SOCKET_PATH}"
