import { execFileSync } from "node:child_process";

type CommandLine = Pick<Electron.CommandLine, "hasSwitch" | "appendSwitch">;
type BusMethod = "ListNames" | "ListActivatableNames";

// Keep Chromium's native choice on desktops it already supports. In particular,
// do not redirect KDE users to a second keyring and strand their existing keys.
const NATIVE_DESKTOPS = new Set([
  "Unity", "Deepin", "GNOME", "X-Cinnamon", "KDE", "Pantheon", "XFCE", "UKUI", "LXQt", "COSMIC"
]);

const hasNativeDesktop = (env: NodeJS.ProcessEnv): boolean => {
  if ((env.XDG_CURRENT_DESKTOP ?? "").split(":").some(value => NATIVE_DESKTOPS.has(value.trim()))) {
    return true;
  }
  const session = env.DESKTOP_SESSION ?? "";
  return ["deepin", "gnome", "mate", "kde4", "kde-plasma", "kde", "xubuntu", "ukui"].includes(session)
    || session.includes("xfce")
    || env.GNOME_DESKTOP_SESSION_ID !== undefined
    || env.KDE_FULL_SESSION !== undefined;
};

export const readSessionBusNames = (method: BusMethod): readonly string[] => {
  const commands = [
    ["dbus-send", ["--session", "--print-reply", "--reply-timeout=600", "--dest=org.freedesktop.DBus",
      "/org/freedesktop/DBus", `org.freedesktop.DBus.${method}`]],
    ["gdbus", ["call", "--session", "--dest", "org.freedesktop.DBus", "--object-path",
      "/org/freedesktop/DBus", "--method", `org.freedesktop.DBus.${method}`]]
  ] as const;
  for (const [command, args] of commands) {
    try {
      const output = execFileSync(command, [...args], {
        encoding: "utf8", timeout: 700, killSignal: "SIGKILL", maxBuffer: 64 * 1024,
        stdio: ["ignore", "pipe", "pipe"]
      });
      return [...output.matchAll(/["'](org\.[a-zA-Z0-9_.-]+)["']/gu)].map(match => match[1]!);
    } catch (error) {
      // A missing utility can use the other D-Bus client. A failed bus must not
      // cause another timeout, launch a daemon, or hold up the desktop.
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") return [];
    }
  }
  return [];
};

const backendForNames = (names: readonly string[]): string | undefined => {
  if (names.includes("org.freedesktop.secrets")) return "gnome-libsecret";
  for (const [name, backend] of [
    ["org.kde.kwalletd6", "kwallet6"],
    ["org.kde.kwalletd5", "kwallet5"],
    ["org.kde.kwalletd", "kwallet"]
  ] as const) {
    if (names.includes(name)) return backend;
  }
  return undefined;
};

/** Must run synchronously before app.ready, before Chromium caches its choice. */
export const configureLinuxSecretStore = (
  app: { readonly commandLine: CommandLine; readonly isReady: () => boolean },
  {
    platform = process.platform,
    env = process.env,
    readNames = readSessionBusNames
  }: {
    readonly platform?: NodeJS.Platform;
    readonly env?: NodeJS.ProcessEnv;
    readonly readNames?: (method: BusMethod) => readonly string[];
  } = {}
): string | undefined => {
  if (platform !== "linux" || app.isReady() || app.commandLine.hasSwitch("password-store") || hasNativeDesktop(env)) {
    return undefined;
  }
  // Enumerating names does not unlock a wallet or read any credentials. Prefer
  // an already running service over another wallet merely installed on disk.
  const backend = backendForNames(readNames("ListNames"))
    ?? backendForNames(readNames("ListActivatableNames"));
  if (backend !== undefined) app.commandLine.appendSwitch("password-store", backend);
  return backend;
};
