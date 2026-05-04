const fs = require("node:fs");
const path = require("node:path");

const createLauncher = (binaryName) => `#!/usr/bin/env bash
set -u

APP_DIR="$(cd "$(dirname "\${BASH_SOURCE[0]}")" && pwd)"
REAL_BINARY="$APP_DIR/${binaryName}.bin"
LAUNCH_ID="\${LYRA_LINUX_LAUNCH_ID:-$(date +%s)-$$}"
LYRA_HOME="\${HOME:-$APP_DIR}"
HEALTH_FILE="$LYRA_HOME/.lyra/modules/linux-compat/launch-health.json"

if [ -n "\${APPIMAGE:-}" ]; then
  export LYRA_LINUX_PACKAGE_TYPE="\${LYRA_LINUX_PACKAGE_TYPE:-appimage}"
else
  export LYRA_LINUX_PACKAGE_TYPE="\${LYRA_LINUX_PACKAGE_TYPE:-unknown}"
fi
export LYRA_LINUX_LAUNCH_ID="$LAUNCH_ID"

"$REAL_BINARY" "$@"
EXIT_CODE=$?

if [ "$EXIT_CODE" -ne 0 ] && [ -z "\${LYRA_LINUX_RECOVERY:-}" ]; then
  if [ ! -f "$HEALTH_FILE" ] || ! grep -Fq "$LAUNCH_ID" "$HEALTH_FILE"; then
    export LYRA_LINUX_RECOVERY=1
    export LYRA_LINUX_AUTO_RESTART=1
    "$REAL_BINARY" "$@"
    exit $?
  fi
fi

exit "$EXIT_CODE"
`;

module.exports = async (context) => {
  if (context.electronPlatformName !== "linux") {
    return;
  }

  const executableName =
    context.packager.executableName ||
    context.packager.appInfo.productFilename ||
    context.packager.appInfo.productName;
  const executablePath = path.join(context.appOutDir, executableName);
  const realExecutablePath = `${executablePath}.bin`;

  if (!fs.existsSync(executablePath) || fs.existsSync(realExecutablePath)) {
    return;
  }

  fs.renameSync(executablePath, realExecutablePath);
  fs.writeFileSync(executablePath, createLauncher(executableName), "utf8");
  fs.chmodSync(executablePath, 0o755);
  fs.chmodSync(realExecutablePath, 0o755);
};
