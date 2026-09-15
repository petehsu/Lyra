import { type ChildProcess, type SpawnOptions } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import { dirname, join, resolve } from "node:path";

import {
  spawnManagedChildProcess,
  terminateManagedChildProcess
} from "../process-lifecycle";
import { resolveGitBashPath } from "../shell/git-runtime";

const DEFAULT_SEARCH_URL = "http://127.0.0.1:8888/search";
const HEALTH_POLL_MS = 15_000;
const STARTING_POLL_MS = 400;
const RETRY_MIN_MS = 1_000;
const RETRY_MAX_MS = 15_000;
const PROBE_TIMEOUT_MS = 1_200;

export type SearxngSupervisor = {
  readonly dispose: () => void;
};

export type SearxngSupervisorHooks = {
  readonly probe?: (endpoint: string) => Promise<boolean>;
  readonly spawn?: (
    command: string,
    args: readonly string[],
    options: SpawnOptions
  ) => ChildProcess;
  readonly terminate?: (child: ChildProcess) => void;
  readonly existsSync?: (filePath: string) => boolean;
  readonly mkdirSync?: (dirPath: string) => void;
  readonly openLog?: (filePath: string) => number | "ignore";
  readonly closeLog?: (fd: number) => void;
  readonly resolveBash?: () => Promise<string | null>;
  readonly schedule?: (callback: () => void, delayMs: number) => { readonly clear: () => void };
  readonly log?: (message: string) => void;
  readonly warn?: (message: string) => void;
};

export const resolveSearxngSearchUrl = (env: NodeJS.ProcessEnv): string => {
  const raw = env.LYRA_SEARXNG_URL?.trim() || DEFAULT_SEARCH_URL;
  const trimmed = raw.replace(/\/+$/u, "");
  return trimmed.endsWith("/search") ? trimmed : `${trimmed}/search`;
};

export const bindSearxngRuntimeEnv = (env: NodeJS.ProcessEnv): string => {
  const endpoint = resolveSearxngSearchUrl(env);
  env.LYRA_SEARXNG_URL = endpoint;
  return endpoint;
};

export const isLocalSearxngEndpoint = (endpoint: string): boolean => {
  try {
    const host = new URL(endpoint).hostname;
    return host === "127.0.0.1" || host === "localhost" || host === "::1";
  } catch {
    return true;
  }
};

export const isSearxngSupervisorEnabled = (env: NodeJS.ProcessEnv): boolean => {
  const flag = env.LYRA_SEARXNG_SUPERVISOR?.trim().toLowerCase();
  if (flag === "0" || flag === "false") {
    return false;
  }
  if (env.VITEST === "true" && flag !== "1") {
    return false;
  }
  return true;
};

export const resolveSearxngStartScript = ({
  cwd,
  resourcesPath,
  env,
  existsSync
}: {
  readonly cwd: string;
  readonly resourcesPath: string;
  readonly env: NodeJS.ProcessEnv;
  readonly existsSync: (filePath: string) => boolean;
}): string | null => {
  const explicit = env.LYRA_SEARXNG_START?.trim();
  const candidates = [
    explicit === undefined || explicit.length === 0 ? undefined : explicit,
    join(resourcesPath, "searxng", "start.sh"),
    join(cwd, "tools", "searxng", "start.sh"),
    resolve(cwd, "..", "tools", "searxng", "start.sh"),
    resolve(cwd, "..", "..", "tools", "searxng", "start.sh")
  ];
  for (const candidate of candidates) {
    if (candidate !== undefined && existsSync(candidate)) {
      return candidate;
    }
  }
  return null;
};

export const probeSearxngEndpoint = (
  endpoint: string,
  timeoutMs = PROBE_TIMEOUT_MS
): Promise<boolean> =>
  new Promise((resolveProbe) => {
    let settled = false;
    const finish = (ok: boolean): void => {
      if (settled) {
        return;
      }
      settled = true;
      resolveProbe(ok);
    };
    try {
      const url = new URL(endpoint);
      url.searchParams.set("q", "lyra");
      url.searchParams.set("format", "json");
      const request = http.get(url, { timeout: timeoutMs }, (response) => {
        response.resume();
        finish(response.statusCode !== undefined && response.statusCode < 500);
      });
      request.on("error", () => finish(false));
      request.on("timeout", () => {
        request.destroy();
        finish(false);
      });
    } catch {
      finish(false);
    }
  });

const defaultSchedule = (
  callback: () => void,
  delayMs: number
): { readonly clear: () => void } => {
  const timer = setTimeout(callback, delayMs);
  return {
    clear: () => clearTimeout(timer)
  };
};

const resolveSearxngPort = (endpoint: string, env: NodeJS.ProcessEnv): string => {
  const explicit = env.LYRA_SEARXNG_PORT?.trim();
  if (explicit !== undefined && explicit.length > 0) {
    return explicit;
  }
  try {
    const port = new URL(endpoint).port;
    return port.length > 0 ? port : "8888";
  } catch {
    return "8888";
  }
};

const resolveSearxngHome = (lyraRoot: string, env: NodeJS.ProcessEnv): string => {
  const explicit = env.LYRA_SEARXNG_HOME?.trim();
  return explicit !== undefined && explicit.length > 0
    ? explicit
    : join(lyraRoot, "searxng");
};

const resolveSearxngRepoRoot = (
  startScript: string,
  existsSync: (filePath: string) => boolean
): string | undefined => {
  const repoRoot = resolve(dirname(startScript), "..", "..");
  return existsSync(join(repoRoot, "參考", "searxng", "searx")) ? repoRoot : undefined;
};

const nextBackoffMs = (current: number): number =>
  Math.min(RETRY_MAX_MS, Math.max(RETRY_MIN_MS, current * 2));

export const startSearxngSupervisor = ({
  lyraRoot,
  resourcesPath,
  cwd = process.cwd(),
  env = process.env,
  enabled,
  hooks = {}
}: {
  readonly lyraRoot: string;
  readonly resourcesPath: string;
  readonly cwd?: string;
  readonly env?: NodeJS.ProcessEnv;
  readonly enabled?: boolean;
  readonly hooks?: SearxngSupervisorHooks;
}): SearxngSupervisor => {
  const endpoint = bindSearxngRuntimeEnv(env);
  const existsSync = hooks.existsSync ?? ((filePath: string) => fs.existsSync(filePath));
  const mkdirSync = hooks.mkdirSync ?? ((dirPath: string) => {
    fs.mkdirSync(dirPath, { recursive: true });
  });
  const probe = hooks.probe ?? probeSearxngEndpoint;
  const spawnChild = hooks.spawn ?? ((
    command: string,
    args: readonly string[],
    options: SpawnOptions
  ) => spawnManagedChildProcess(command, args, options));
  const terminate = hooks.terminate ?? terminateManagedChildProcess;
  const schedule = hooks.schedule ?? defaultSchedule;
  const log = hooks.log ?? ((message: string) => console.info(`[lyra-searxng] ${message}`));
  const warn = hooks.warn ?? ((message: string) => console.warn(`[lyra-searxng] ${message}`));
  const resolveBash = hooks.resolveBash ?? (async (): Promise<string | null> => {
    if (process.platform !== "win32") {
      return existsSync("/bin/bash") ? "/bin/bash" : "bash";
    }
    const fromEnv = env.LYRA_GIT_BASH_PATH?.trim();
    if (fromEnv !== undefined && fromEnv.length > 0 && existsSync(fromEnv)) {
      return fromEnv;
    }
    const resolved = await resolveGitBashPath({ resourcesPath, cwd });
    return resolved?.bashPath ?? null;
  });

  let disposed = false;
  let child: ChildProcess | null = null;
  let delay: { readonly clear: () => void } | null = null;
  let backoffMs = RETRY_MIN_MS;
  let announcedExisting = false;
  let announcedReady = false;
  let tickGeneration = 0;

  const clearDelay = (): void => {
    delay?.clear();
    delay = null;
  };

  const requestTick = (delayMs: number): void => {
    if (disposed) {
      return;
    }
    clearDelay();
    const generation = tickGeneration;
    delay = schedule(() => {
      if (disposed || generation !== tickGeneration) {
        return;
      }
      void runTick();
    }, delayMs);
  };

  const stopChild = (): void => {
    if (child === null) {
      return;
    }
    const current = child;
    child = null;
    terminate(current);
  };

  const runTick = async (): Promise<void> => {
    const generation = tickGeneration;
    const isCurrent = (): boolean => disposed === false && generation === tickGeneration;
    if (isCurrent() === false) {
      return;
    }
    if (await probe(endpoint)) {
      if (isCurrent() === false) {
        return;
      }
      backoffMs = RETRY_MIN_MS;
      if (child === null && announcedExisting === false) {
        announcedExisting = true;
        log(`using existing instance at ${endpoint}`);
      } else if (child !== null && announcedReady === false) {
        announcedReady = true;
        log(`ready at ${endpoint}`);
      }
      requestTick(HEALTH_POLL_MS);
      return;
    }
    if (isCurrent() === false) {
      return;
    }
    if (child !== null) {
      requestTick(STARTING_POLL_MS);
      return;
    }
    const startScript = resolveSearxngStartScript({
      cwd,
      resourcesPath,
      env,
      existsSync
    });
    if (startScript === null) {
      warn("start script missing; retrying");
      backoffMs = nextBackoffMs(backoffMs);
      requestTick(backoffMs);
      return;
    }
    const bashPath = await resolveBash();
    if (isCurrent() === false) {
      return;
    }
    if (bashPath === null) {
      warn("bash is unavailable; retrying");
      backoffMs = nextBackoffMs(backoffMs);
      requestTick(backoffMs);
      return;
    }
    const home = resolveSearxngHome(lyraRoot, env);
    mkdirSync(home);
    const logFile = join(home, "searxng.log");
    const logFd = hooks.openLog === undefined
      ? fs.openSync(logFile, "a")
      : hooks.openLog(logFile);
    const closeFd = (): void => {
      if (typeof logFd === "number") {
        (hooks.closeLog ?? ((fd: number) => fs.closeSync(fd)))(logFd);
      }
    };
    const repoRoot = resolveSearxngRepoRoot(startScript, existsSync);
    const childEnv: NodeJS.ProcessEnv = {
      ...env,
      LYRA_SEARXNG_HOME: home,
      LYRA_SEARXNG_PORT: resolveSearxngPort(endpoint, env),
      LYRA_SEARXNG_FOREGROUND: "1",
      LYRA_SEARXNG_SETTINGS: join(dirname(startScript), "settings.yml"),
      PYTHONUNBUFFERED: "1"
    };
    if (repoRoot !== undefined) {
      childEnv.LYRA_SEARXNG_REPO = repoRoot;
    }
    try {
      const spawned = spawnChild(bashPath, [startScript], {
        env: childEnv,
        cwd: home,
        stdio: typeof logFd === "number"
          ? ["ignore", logFd, logFd]
          : ["ignore", "ignore", "ignore"]
      });
      closeFd();
      child = spawned;
      announcedExisting = false;
      log(`starting local instance via ${startScript}`);
      spawned.once("exit", () => {
        if (child !== spawned) {
          return;
        }
        child = null;
        announcedReady = false;
        if (disposed) {
          return;
        }
        tickGeneration += 1;
        requestTick(0);
      });
      spawned.once("error", (error) => {
        warn(`spawn failed: ${error instanceof Error ? error.message : String(error)}`);
        if (child !== spawned) {
          return;
        }
        child = null;
        if (disposed) {
          return;
        }
        tickGeneration += 1;
        backoffMs = nextBackoffMs(backoffMs);
        requestTick(backoffMs);
      });
      requestTick(STARTING_POLL_MS);
    } catch (error) {
      closeFd();
      warn(`spawn failed: ${error instanceof Error ? error.message : String(error)}`);
      backoffMs = nextBackoffMs(backoffMs);
      requestTick(backoffMs);
    }
  };

  if (
    (enabled ?? isSearxngSupervisorEnabled(env))
    && isLocalSearxngEndpoint(endpoint)
  ) {
    requestTick(0);
  } else if (isLocalSearxngEndpoint(endpoint) === false) {
    log(`remote URL ${endpoint}; not supervising a local instance`);
  }

  return {
    dispose: () => {
      disposed = true;
      tickGeneration += 1;
      clearDelay();
      stopChild();
    }
  };
};
