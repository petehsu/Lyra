import { BrowserWindow, type WebContents } from "electron";
import { chmodSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { delimiter, isAbsolute, join, resolve } from "node:path";

import { WORKBENCH_BROWSER_LIVE_PROFILE_PARTITION } from "../shared/workbench-browser";
import { grantBrowserAuthorizeAct } from "./browser-authorize-grant";

export {
  grantBrowserAuthorizeAct,
  hasBrowserAuthorizeActGrant
} from "./browser-authorize-grant";

export const LYRA_OPEN_URL_FLAG = "--lyra-open-url";

type OpenInWorkbenchBindings = {
  readonly publishOpenTab: (url: string) => void;
  readonly focusMainWindow: () => void;
  readonly getMainWindow: () => BrowserWindow | null;
  readonly onAuthCallback: (url: string) => void;
};

let bindings: OpenInWorkbenchBindings | null = null;
let workbenchShellReady = false;
let installedHelperDir: string | null = null;
let fallbackWindow: BrowserWindow | null = null;
let lastConsumedInternalUrl = "";

export const bindOpenInWorkbench = (next: OpenInWorkbenchBindings): void => {
  bindings = next;
};

export const setWorkbenchShellReady = (ready: boolean): void => {
  workbenchShellReady = ready;
};

export const isHttpUrl = (value: string): boolean => {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
};

export const isLyraAuthCallbackUrl = (value: string): boolean => {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "lyra:" && parsed.hostname === "auth" && parsed.pathname === "/callback";
  } catch {
    return false;
  }
};

export const readHttpUrlFromLyraOpenProtocol = (value: string): string | undefined => {
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== "lyra:" || parsed.hostname !== "open") {
      return undefined;
    }
    const nested = parsed.searchParams.get("url") ?? parsed.pathname.replace(/^\//u, "");
    if (nested.length === 0 || isHttpUrl(nested) === false) {
      return undefined;
    }
    return nested;
  } catch {
    return undefined;
  }
};

export const readOpenHttpUrlFromArgs = (args: readonly string[]): string | undefined => {
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index] ?? "";
    if (arg === LYRA_OPEN_URL_FLAG) {
      const next = args[index + 1];
      return typeof next === "string" && isHttpUrl(next) ? next : undefined;
    }
    if (arg.startsWith(`${LYRA_OPEN_URL_FLAG}=`)) {
      const nested = arg.slice(`${LYRA_OPEN_URL_FLAG}=`.length);
      return isHttpUrl(nested) ? nested : undefined;
    }
    const fromProtocol = readHttpUrlFromLyraOpenProtocol(arg);
    if (fromProtocol !== undefined) {
      return fromProtocol;
    }
  }
  return undefined;
};

export const consumeLyraInternalUrl = (url: string): boolean => {
  const isAuth = isLyraAuthCallbackUrl(url);
  const nested = isAuth ? undefined : readHttpUrlFromLyraOpenProtocol(url);
  if (isAuth === false && nested === undefined) {
    return false;
  }
  if (url === lastConsumedInternalUrl) {
    return true;
  }
  lastConsumedInternalUrl = url;
  if (isAuth) {
    bindings?.onAuthCallback(url);
    dismissLyraBrowserFallback();
    return true;
  }
  if (nested !== undefined) {
    openHttpInLyraBrowser(nested);
  }
  return true;
};

export const attachLyraInternalNavigationGuard = (webContents: WebContents): void => {
  const handle = (event: { preventDefault: () => void }, url: string): void => {
    if (consumeLyraInternalUrl(url)) {
      event.preventDefault();
    }
  };
  webContents.on("will-navigate", handle);
  webContents.on("will-redirect", handle);
};

export const dismissLyraBrowserFallback = (): void => {
  if (fallbackWindow === null || fallbackWindow.isDestroyed()) {
    fallbackWindow = null;
    return;
  }
  fallbackWindow.close();
};

const openFallbackBrowserWindow = (url: string): void => {
  if (fallbackWindow !== null && fallbackWindow.isDestroyed() === false) {
    void fallbackWindow.loadURL(url);
    fallbackWindow.focus();
    return;
  }
  const parent = bindings?.getMainWindow() ?? undefined;
  const window = new BrowserWindow({
    parent: parent === null || parent?.isDestroyed() === true ? undefined : parent,
    width: 960,
    height: 740,
    autoHideMenuBar: true,
    title: "Lyra",
    webPreferences: {
      partition: WORKBENCH_BROWSER_LIVE_PROFILE_PARTITION,
      sandbox: true,
      nodeIntegration: false,
      contextIsolation: true
    }
  });
  fallbackWindow = window;
  attachLyraInternalNavigationGuard(window.webContents);
  window.webContents.on("did-fail-load", (_event, _code, _description, validatedUrl) => {
    consumeLyraInternalUrl(validatedUrl);
  });
  window.webContents.setWindowOpenHandler(({ url: nextUrl }) => {
    if (consumeLyraInternalUrl(nextUrl)) {
      return { action: "deny" };
    }
    if (isHttpUrl(nextUrl)) {
      void window.loadURL(nextUrl);
    }
    return { action: "deny" };
  });
  window.on("closed", () => {
    if (fallbackWindow === window) {
      fallbackWindow = null;
    }
  });
  void window.loadURL(url);
};

export const openHttpInLyraBrowser = (url: string): boolean => {
  if (isHttpUrl(url) === false) {
    return false;
  }
  grantBrowserAuthorizeAct(url);
  if (workbenchShellReady && bindings !== null) {
    bindings.publishOpenTab(url);
    bindings.focusMainWindow();
    return true;
  }
  openFallbackBrowserWindow(url);
  return true;
};

export const resolveElectronAppPathForLaunch = (
  candidate: string | undefined,
  cwd = process.cwd()
): string | undefined => {
  if (candidate === undefined) {
    return undefined;
  }
  const trimmed = candidate.trim();
  if (trimmed.length === 0) {
    return undefined;
  }
  return isAbsolute(trimmed) ? trimmed : resolve(cwd, trimmed);
};

const shQuote = (value: string): string => `'${value.replace(/'/g, `'\\''`)}'`;

const buildPosixHelperScript = (execPath: string, appPath: string | undefined): string => `#!/bin/sh
url="$1"
if [ -z "$url" ]; then
  exit 1
fi
ELECTRON="\${LYRA_ELECTRON_EXEC:-${shQuote(execPath)}}"
APP=${appPath === undefined ? '""' : shQuote(appPath)}
if [ -n "$APP" ]; then
  exec "$ELECTRON" "$APP" -- ${LYRA_OPEN_URL_FLAG} "$url"
fi
exec "$ELECTRON" -- ${LYRA_OPEN_URL_FLAG} "$url"
`;

const buildWindowsHelperScript = (execPath: string, appPath: string | undefined): string => `@echo off
set "URL=%~1"
if "%URL%"=="" exit /b 1
if not "%LYRA_ELECTRON_EXEC%"=="" (
  set "ELECTRON=%LYRA_ELECTRON_EXEC%"
) else (
  set "ELECTRON=${execPath}"
)
set "APP=${appPath ?? ""}"
if "%APP%"=="" (
  "%ELECTRON%" -- ${LYRA_OPEN_URL_FLAG} "%URL%"
) else (
  "%ELECTRON%" "%APP%" -- ${LYRA_OPEN_URL_FLAG} "%URL%"
)
`;

const posixXdgOpenScript = `#!/bin/sh
SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
BIN="$LYRA_OPEN_URL_BIN"
if [ -z "$BIN" ]; then
  BIN="$SCRIPT_DIR/lyra-open-url"
fi
expect_url=0
for arg in "$@"; do
  if [ "$expect_url" = 1 ]; then
    case "$arg" in
      http://*|https://*|lyra://*)
        exec "$BIN" "$arg"
        ;;
    esac
    expect_url=0
    continue
  fi
  case "$arg" in
    --)
      continue
      ;;
    -u|--url)
      expect_url=1
      continue
      ;;
    http://*|https://*|lyra://*)
      exec "$BIN" "$arg"
      ;;
  esac
done
if [ -n "$LYRA_SYSTEM_XDG_OPEN" ] && [ -x "$LYRA_SYSTEM_XDG_OPEN" ]; then
  exec "$LYRA_SYSTEM_XDG_OPEN" "$@"
fi
if [ -n "$LYRA_SYSTEM_OPEN" ] && [ -x "$LYRA_SYSTEM_OPEN" ]; then
  exec "$LYRA_SYSTEM_OPEN" "$@"
fi
exit 1
`;

const writeExecutable = (target: string, contents: string): void => {
  writeFileSync(target, contents, { encoding: "utf8" });
  if (process.platform !== "win32") {
    chmodSync(target, 0o755);
  }
};

const resolveSystemBinary = (name: string, helperDir: string): string => {
  const preferred = name === "open" ? "/usr/bin/open" : `/usr/bin/${name}`;
  if (existsSync(preferred)) {
    return preferred;
  }
  const pathValue = process.env.PATH ?? "";
  for (const directory of pathValue.split(delimiter)) {
    if (directory.length === 0 || directory === helperDir) {
      continue;
    }
    const candidate = join(directory, name);
    if (existsSync(candidate)) {
      return candidate;
    }
  }
  return preferred;
};

const LINUX_OPEN_WRAPPERS = [
  "xdg-open",
  "x-www-browser",
  "www-browser",
  "gnome-open",
  "sensible-browser"
] as const;

export const installLyraOpenUrlHelpers = (
  userDataDir: string,
  options: {
    readonly electronExecPath?: string;
    readonly electronAppPath?: string;
  } = {}
): string => {
  const helperDir = join(userDataDir, "browser-open");
  mkdirSync(helperDir, { recursive: true });
  const helperName = process.platform === "win32" ? "lyra-open-url.cmd" : "lyra-open-url";
  const helperPath = join(helperDir, helperName);
  const electronExecPath = options.electronExecPath ?? process.execPath;
  const electronAppPath = resolveElectronAppPathForLaunch(options.electronAppPath);
  writeExecutable(
    helperPath,
    process.platform === "win32"
      ? buildWindowsHelperScript(electronExecPath, electronAppPath)
      : buildPosixHelperScript(electronExecPath, electronAppPath)
  );
  if (process.platform === "linux") {
    for (const name of LINUX_OPEN_WRAPPERS) {
      writeExecutable(join(helperDir, name), posixXdgOpenScript);
    }
  }
  if (process.platform === "darwin") {
    writeExecutable(join(helperDir, "open"), posixXdgOpenScript);
  }
  installedHelperDir = helperDir;
  return helperDir;
};

export const applyLyraBrowserLaunchEnv = (
  env: NodeJS.ProcessEnv,
  helperDir: string,
  options: {
    readonly electronExecPath?: string;
    readonly electronAppPath?: string;
    readonly platform?: NodeJS.Platform;
  } = {}
): NodeJS.ProcessEnv => {
  const platform = options.platform ?? process.platform;
  const helperName = platform === "win32" ? "lyra-open-url.cmd" : "lyra-open-url";
  const helperPath = join(helperDir, helperName);
  const currentPath = env.PATH ?? "";
  const nextPath = currentPath.startsWith(`${helperDir}${delimiter}`)
    ? currentPath
    : currentPath.length === 0
      ? helperDir
      : `${helperDir}${delimiter}${currentPath}`;
  const electronAppPath = resolveElectronAppPathForLaunch(
    options.electronAppPath ?? env.LYRA_ELECTRON_APP_PATH
  );
  return {
    ...env,
    PATH: nextPath,
    BROWSER: helperPath,
    GH_BROWSER: helperPath,
    LYRA_OPEN_URL_BIN: helperPath,
    LYRA_ELECTRON_EXEC: options.electronExecPath ?? process.execPath,
    ...(electronAppPath === undefined ? {} : { LYRA_ELECTRON_APP_PATH: electronAppPath }),
    ...(platform === "linux"
      ? {
          LYRA_SYSTEM_XDG_OPEN:
            typeof env.LYRA_SYSTEM_XDG_OPEN === "string"
              && env.LYRA_SYSTEM_XDG_OPEN.startsWith(helperDir) === false
              && existsSync(env.LYRA_SYSTEM_XDG_OPEN)
              ? env.LYRA_SYSTEM_XDG_OPEN
              : resolveSystemBinary("xdg-open", helperDir)
        }
      : {}),
    ...(platform === "darwin"
      ? {
          LYRA_SYSTEM_OPEN:
            typeof env.LYRA_SYSTEM_OPEN === "string"
              && env.LYRA_SYSTEM_OPEN.startsWith(helperDir) === false
              && existsSync(env.LYRA_SYSTEM_OPEN)
              ? env.LYRA_SYSTEM_OPEN
              : resolveSystemBinary("open", helperDir)
        }
      : {})
  };
};

const resolveUnpackagedElectronAppPath = (): string | undefined => {
  if (process.defaultApp !== true) {
    return undefined;
  }
  for (let index = 1; index < process.argv.length; index += 1) {
    const arg = process.argv[index] ?? "";
    if (arg === "--") {
      break;
    }
    if (arg.startsWith("-")) {
      continue;
    }
    return resolveElectronAppPathForLaunch(arg);
  }
  return undefined;
};

export const applyLyraBrowserLaunchEnvToProcess = (
  userDataDir: string,
  options: { readonly electronAppPath?: string } = {}
): void => {
  const electronAppPath = resolveElectronAppPathForLaunch(
    options.electronAppPath ?? resolveUnpackagedElectronAppPath()
  );
  const helperDir = installLyraOpenUrlHelpers(userDataDir, {
    electronExecPath: process.execPath,
    electronAppPath
  });
  const next = applyLyraBrowserLaunchEnv(process.env, helperDir, {
    electronExecPath: process.execPath,
    electronAppPath
  });
  for (const [key, value] of Object.entries(next)) {
    if (typeof value === "string") {
      process.env[key] = value;
    }
  }
};

export const mergeLyraBrowserEnvPairs = (
  env: readonly { readonly key: string; readonly value: string }[] | undefined
): readonly { readonly key: string; readonly value: string }[] => {
  const helperDir = installedHelperDir;
  if (helperDir === null) {
    return env ?? [];
  }
  const merged = new Map<string, string>();
  for (const pair of env ?? []) {
    const key = pair.key.trim();
    if (key.length > 0) {
      merged.set(key, pair.value);
    }
  }
  const asEnv: NodeJS.ProcessEnv = {};
  for (const [key, value] of merged) {
    asEnv[key] = value;
  }
  if (typeof asEnv.PATH !== "string" || asEnv.PATH.length === 0) {
    asEnv.PATH = process.env.PATH ?? "";
  }
  const launched = applyLyraBrowserLaunchEnv(asEnv, helperDir, {
    electronExecPath: process.env.LYRA_ELECTRON_EXEC ?? process.execPath,
    electronAppPath: resolveElectronAppPathForLaunch(
      asEnv.LYRA_ELECTRON_APP_PATH
        ?? process.env.LYRA_ELECTRON_APP_PATH
        ?? resolveUnpackagedElectronAppPath()
    )
  });
  const pairs: { readonly key: string; readonly value: string }[] = [];
  for (const [key, value] of Object.entries(launched)) {
    if (typeof value === "string") {
      pairs.push({ key, value });
    }
  }
  return pairs;
};
