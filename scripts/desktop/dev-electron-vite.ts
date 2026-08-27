import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { spawnCommand } from "./spawn-command";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const desktopRoot = path.resolve(scriptDir, "../../apps/desktop");

const loadDotEnv = (filePath: string): Record<string, string> => {
  if (!existsSync(filePath)) return {};
  const out: Record<string, string> = {};
  for (const line of readFileSync(filePath, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (trimmed.length === 0 || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq < 1) continue;
    out[trimmed.slice(0, eq).trim()] = trimmed.slice(eq + 1).trim();
  }
  return out;
};

const buildEnv = (): NodeJS.ProcessEnv => {
  const env: NodeJS.ProcessEnv = {
    ...loadDotEnv(path.join(desktopRoot, ".env")),
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

const resolveElectronViteEntry = (): string => {
  // Run the JS entry directly with node instead of going through the .cmd
  // shim via cmd.exe. The desktop root may contain spaces (e.g.
  // C:\Users\<name with space>\...), and cmd.exe /S quote-stripping truncates
  // such paths at the first space ("'C:\Users\Xu' is not recognized").
  // Executing node + the JS entry as structured argv avoids the shell layer
  // entirely.
  return path.join(desktopRoot, "node_modules", "electron-vite", "bin", "electron-vite.js");
};

const main = (): void => {
  const child = spawnCommand(process.execPath, [resolveElectronViteEntry(), "dev"], {
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