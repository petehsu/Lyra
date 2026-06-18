import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { spawnCommand } from "./spawn-command";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const desktopRoot = path.resolve(scriptDir, "../../apps/desktop");

const buildEnv = (): NodeJS.ProcessEnv => {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    LYRA_RENDERER_PORT: process.env.LYRA_RENDERER_PORT ?? "5173"
  };
  // Electron treats the variable as enabled whenever it exists, even when empty.
  delete env.ELECTRON_RUN_AS_NODE;
  const isLinuxWayland = process.platform === "linux"
    && (
      (env.XDG_SESSION_TYPE ?? "").toLowerCase() === "wayland"
      || (typeof env.WAYLAND_DISPLAY === "string" && env.WAYLAND_DISPLAY.length > 0)
    );
  if (isLinuxWayland) {
    env.ELECTRON_OZONE_PLATFORM_HINT = "wayland";
    env.DISPLAY = "";
  }
  if (process.platform === "darwin") {
    const devElectronDist = path.join(desktopRoot, ".dev-electron");
    if (existsSync(path.join(devElectronDist, "Electron.app"))) {
      env.ELECTRON_OVERRIDE_DIST_PATH = devElectronDist;
    }
  }
  return env;
};

const resolveElectronViteBin = (): string => {
  const binDir = path.join(desktopRoot, "node_modules", ".bin");
  return process.platform === "win32"
    ? path.join(binDir, "electron-vite.cmd")
    : path.join(binDir, "electron-vite");
};

const main = (): void => {
  const child = spawnCommand(resolveElectronViteBin(), ["dev"], {
    cwd: desktopRoot,
    stdio: "inherit",
    env: buildEnv()
  });
  child.once("exit", (code, signal) => {
    if (signal) {
      process.kill(process.pid, signal);
      return;
    }
    process.exit(code ?? 0);
  });
  child.once("error", (error) => {
    console.error(`[lyra-electron-vite] failed to start: ${error.message}`);
    process.exit(1);
  });
};

main();