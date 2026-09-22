import { existsSync, watch, type FSWatcher } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { resolveCurrentDesktopTarget } from "../../apps/desktop/src/main/platform-target";
import {
  LYRA_DEV_REPLACE_RUNTIME_ENV,
  stopRuntimeDaemon
} from "../../apps/desktop/src/main/runtime-client";
import { resolveLyraStorageRoots } from "../../apps/desktop/src/main/storage/roots";
import {
  collectNewestMtime,
  shouldSkipNativeCargo
} from "./native-dev";
import { spawnCommand } from "./spawn-command";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const desktopRoot = path.join(repoRoot, "apps/desktop");
const SOURCE_ROOTS = [
  path.join(repoRoot, "crates"),
  path.join(repoRoot, "Cargo.toml"),
  path.join(repoRoot, "Cargo.lock"),
  path.join(repoRoot, "third-party/rust")
] as const;
const WATCH_DEBOUNCE_MS = 400;

const stagedNativeDir = (): string => {
  const target = resolveCurrentDesktopTarget();
  return path.join(desktopRoot, "native", target.id);
};

const nativesAreStaged = (): boolean => {
  const dir = stagedNativeDir();
  const binary = process.platform === "win32" ? "lyrad.exe" : "lyrad";
  return existsSync(path.join(dir, binary));
};

const sourcesNeedRebuild = async (): Promise<boolean> => {
  if (nativesAreStaged() === false) {
    return true;
  }
  const sourceNewest = await collectNewestMtime(SOURCE_ROOTS);
  const stagedNewest = await collectNewestMtime([stagedNativeDir()]);
  return shouldSkipNativeCargo(sourceNewest, stagedNewest === 0 ? null : stagedNewest) === false;
};

const runNpmScript = (
  script: string,
  extraEnv: NodeJS.ProcessEnv = {}
): ReturnType<typeof spawnCommand> =>
  spawnCommand("npm", ["run", script], {
    cwd: desktopRoot,
    stdio: "inherit",
    env: {
      ...process.env,
      ...extraEnv
    }
  });

const runNativeBuild = (): Promise<void> =>
  new Promise((resolve, reject) => {
    const child = runNpmScript("native:build", { CARGO_INCREMENTAL: "1" });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`native:build failed (${signal ?? code ?? "unknown"})`));
    });
  });

const startElectronVite = (): ReturnType<typeof spawnCommand> => {
  const child = runNpmScript("dev:electron-vite", {
    [LYRA_DEV_REPLACE_RUNTIME_ENV]: "1"
  });
  child.once("error", (error) => {
    console.error(`[lyra-dev] electron-vite failed: ${error.message}`);
    process.exit(1);
  });
  child.once("exit", (code, signal) => {
    if (signal) {
      process.kill(process.pid, signal);
      return;
    }
    process.exit(code ?? 0);
  });
  return child;
};

const watchNativeSources = (onChange: () => void): readonly FSWatcher[] => {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const schedule = (): void => {
    if (timer !== null) {
      clearTimeout(timer);
    }
    timer = setTimeout(() => {
      timer = null;
      onChange();
    }, WATCH_DEBOUNCE_MS);
  };
  return SOURCE_ROOTS.filter((root) => existsSync(root)).map((root) => {
    const watcher = watch(root, { recursive: true }, schedule);
    watcher.on("error", (error) => {
      console.warn(`[lyra-dev] native watch error: ${error.message}`);
    });
    return watcher;
  });
};

const main = async (): Promise<void> => {
  let nativeRunning = false;
  let nativeQueued = false;
  const rebuildNative = async (reason: string): Promise<boolean> => {
    if (nativeRunning) {
      nativeQueued = true;
      return false;
    }
    nativeRunning = true;
    console.info(`[lyra-dev] ${reason}`);
    let ok = false;
    try {
      await runNativeBuild();
      ok = true;
    } catch (error) {
      console.error(`[lyra-dev] ${error instanceof Error ? error.message : String(error)}`);
    }
    nativeRunning = false;
    if (nativeQueued) {
      nativeQueued = false;
      return rebuildNative("native sources changed again; rebuilding");
    }
    return ok;
  };

  const needsNative = await sourcesNeedRebuild();
  if (needsNative) {
    const reason = nativesAreStaged()
      ? "Rust sources are newer than staged natives; building before Electron starts"
      : "no staged natives; building before Electron starts";
    const ok = await rebuildNative(reason);
    if (ok === false) {
      process.exit(1);
    }
  } else {
    console.info("[lyra-dev] staged natives are current; skipping cargo");
  }

  const runtimeRoot = resolveLyraStorageRoots({ isPackaged: false }).modules.runtime;
  await stopRuntimeDaemon(runtimeRoot);
  console.info("[lyra-dev] stopped any lyrad still bound to the dev socket");

  startElectronVite();
  watchNativeSources(() => {
    void rebuildNative(
      "Rust sources changed; incremental cargo then restage (this dev session's next desktop start replaces lyrad)"
    );
  });
};

void main().catch((error: unknown) => {
  console.error(`[lyra-dev] ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
