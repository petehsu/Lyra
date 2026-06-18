import { spawn, type ChildProcess } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

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
  return env;
};

const resolveElectronViteBin = (): string => {
  const binDir = path.join(desktopRoot, "node_modules", ".bin");
  return process.platform === "win32"
    ? path.join(binDir, "electron-vite.cmd")
    : path.join(binDir, "electron-vite");
};

const spawnCommand = (
  command: string,
  args: readonly string[],
  options: Parameters<typeof spawn>[2] = {}
): ChildProcess => {
  if (process.platform === "win32") {
    return spawn("cmd.exe", ["/d", "/s", "/c", command, ...args], {
      ...options,
      windowsVerbatimArguments: false
    });
  }
  return spawn(command, [...args], options);
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