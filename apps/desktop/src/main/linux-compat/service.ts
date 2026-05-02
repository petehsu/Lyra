import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import type {
  LinuxCompatBridge,
  LinuxCompatExportResponse,
  LinuxCompatPlan,
  LinuxCompatStatus,
  LinuxCompatWarning,
  LinuxEnvironmentFacts,
  LinuxGpuMode,
  LinuxGraphicsBackend,
  LinuxSessionType,
  LinuxStrategySource
} from "./types";

const SAFE_MODE_ARGS = new Set(["--safe-mode", "--lyra-safe-mode"]);
const SOFTWARE_GPU_ARGS = new Set(["--disable-gpu", "--disable-gpu-compositing", "--lyra-software-gpu"]);

const parseTruthy = (value: string | undefined): boolean => {
  if (typeof value !== "string") {
    return false;
  }
  const normalized = value.trim().toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes" || normalized === "on";
};

const parseBackendValue = (value: string | undefined): LinuxGraphicsBackend | null => {
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value.trim().toLowerCase();
  if (normalized === "wayland") {
    return "wayland";
  }
  if (normalized === "x11") {
    return "x11";
  }
  return null;
};

const parseBackendFromArgv = (argv: readonly string[]): LinuxGraphicsBackend | null => {
  for (const argument of argv) {
    if (argument.startsWith("--lyra-backend=") === false) {
      continue;
    }
    return parseBackendValue(argument.slice("--lyra-backend=".length));
  }
  return null;
};

const parseGpuModeFromArgv = (argv: readonly string[]): LinuxGpuMode | null => {
  for (const argument of argv) {
    if (argument.startsWith("--lyra-gpu=") === false) {
      continue;
    }
    const value = argument.slice("--lyra-gpu=".length).trim().toLowerCase();
    if (value === "software") {
      return "software";
    }
    if (value === "hardware") {
      return "hardware";
    }
  }
  return null;
};

const hasAnyArg = (argv: readonly string[], candidates: ReadonlySet<string>): boolean =>
  argv.some((argument) => candidates.has(argument));

const toSessionType = (
  sessionTypeRaw: string | undefined,
  waylandDisplay: string | undefined,
  x11Display: string | undefined
): LinuxSessionType => {
  const normalizedSession = sessionTypeRaw?.trim().toLowerCase();
  if (normalizedSession === "wayland") {
    return "wayland";
  }
  if (normalizedSession === "x11") {
    return "x11";
  }
  if (typeof waylandDisplay === "string" && waylandDisplay.length > 0) {
    return "wayland";
  }
  if (typeof x11Display === "string" && x11Display.length > 0) {
    return "x11";
  }
  return "unknown";
};

const parseOsRelease = (
  osReleaseText: string | null
): {
  readonly distributionId: string | null;
  readonly distributionVersion: string | null;
  readonly distributionLike: readonly string[];
} => {
  if (osReleaseText === null) {
    return {
      distributionId: null,
      distributionVersion: null,
      distributionLike: [],
    };
  }
  const values = new Map<string, string>();
  for (const line of osReleaseText.split(/\r?\n/u)) {
    const match = /^([A-Z0-9_]+)=(.*)$/u.exec(line.trim());
    if (match === null) {
      continue;
    }
    const rawValue = match[2] ?? "";
    const value = rawValue.replace(/^"|"$/gu, "").replace(/\\"/gu, "\"").trim();
    values.set(match[1] ?? "", value);
  }
  const distributionLike = (values.get("ID_LIKE") ?? "")
    .split(/\s+/u)
    .map((value) => value.trim().toLowerCase())
    .filter((value) => value.length > 0);
  return {
    distributionId: values.get("ID")?.toLowerCase() ?? null,
    distributionVersion: values.get("VERSION_ID") ?? null,
    distributionLike,
  };
};

const readOsReleaseText = (): string | null => {
  try {
    return readFileSync("/etc/os-release", "utf8");
  } catch {
    return null;
  }
};

const detectEnvironmentFacts = (
  env: NodeJS.ProcessEnv,
  osReleaseText: string | null
): LinuxEnvironmentFacts => {
  const desktopRaw = env.XDG_CURRENT_DESKTOP ?? env.DESKTOP_SESSION ?? "unknown";
  const desktop = desktopRaw.trim().length > 0 ? desktopRaw : "unknown";
  const waylandDisplay = env.WAYLAND_DISPLAY?.trim();
  const x11Display = env.DISPLAY?.trim();
  const osRelease = parseOsRelease(osReleaseText);
  return {
    sessionType: toSessionType(env.XDG_SESSION_TYPE, waylandDisplay, x11Display),
    desktop,
    distributionId: osRelease.distributionId,
    distributionVersion: osRelease.distributionVersion,
    distributionLike: osRelease.distributionLike,
    waylandDisplay: waylandDisplay !== undefined && waylandDisplay.length > 0 ? waylandDisplay : null,
    x11Display: x11Display !== undefined && x11Display.length > 0 ? x11Display : null,
    isRoot: typeof process.getuid === "function" ? process.getuid() === 0 : false
  };
};

const resolveWarnings = (
  facts: LinuxEnvironmentFacts,
  backend: LinuxGraphicsBackend
): readonly LinuxCompatWarning[] => {
  const warnings: LinuxCompatWarning[] = [];
  if (facts.waylandDisplay !== null && facts.x11Display !== null) {
    warnings.push({
      code: "both-display-servers-detected",
      message: "Detected both WAYLAND_DISPLAY and DISPLAY. Lyra forced one backend to avoid unstable rendering."
    });
  }
  if (facts.sessionType === "unknown") {
    warnings.push({
      code: "unknown-session",
      message: "Could not determine Linux session type from environment variables."
    });
  }
  if (
    (facts.sessionType === "wayland" && backend === "x11")
    || (facts.sessionType === "x11" && backend === "wayland")
  ) {
    warnings.push({
      code: "session-env-mismatch",
      message: "Effective graphics backend differs from session type due to explicit override or safety fallback."
    });
  }
  if (facts.desktop === "unknown") {
    warnings.push({
      code: "unknown-desktop",
      message: "Desktop environment could not be identified; running in generic compatibility mode."
    });
  }
  return warnings;
};

const shouldEnableSafeMode = (argv: readonly string[], env: NodeJS.ProcessEnv): boolean =>
  hasAnyArg(argv, SAFE_MODE_ARGS) || parseTruthy(env.LYRA_SAFE_MODE);

const resolveBackend = (
  argv: readonly string[],
  env: NodeJS.ProcessEnv,
  facts: LinuxEnvironmentFacts
): { readonly backend: LinuxGraphicsBackend; readonly source: LinuxStrategySource } => {
  const cliValue = parseBackendFromArgv(argv);
  if (cliValue !== null) {
    return { backend: cliValue, source: "cli" };
  }
  const envValue = parseBackendValue(env.LYRA_LINUX_BACKEND);
  if (envValue !== null) {
    return { backend: envValue, source: "env" };
  }
  if (facts.sessionType === "wayland") {
    return { backend: "wayland", source: "auto" };
  }
  return { backend: "x11", source: "auto" };
};

const resolveGpuMode = (
  argv: readonly string[],
  env: NodeJS.ProcessEnv,
  safeMode: boolean
): { readonly gpuMode: LinuxGpuMode; readonly source: LinuxStrategySource } => {
  if (safeMode) {
    return { gpuMode: "software", source: "cli" };
  }
  const cliValue = parseGpuModeFromArgv(argv);
  if (cliValue !== null) {
    return { gpuMode: cliValue, source: "cli" };
  }
  if (hasAnyArg(argv, SOFTWARE_GPU_ARGS)) {
    return { gpuMode: "software", source: "cli" };
  }
  if (parseTruthy(env.LYRA_SOFTWARE_GPU)) {
    return { gpuMode: "software", source: "env" };
  }
  return { gpuMode: "hardware", source: "auto" };
};

const toAppliedEnv = (
  backend: LinuxGraphicsBackend
): Readonly<Record<string, string>> => {
  if (backend === "wayland") {
    return {
      ELECTRON_OZONE_PLATFORM_HINT: "wayland",
      DISPLAY: ""
    };
  }
  return {
    ELECTRON_OZONE_PLATFORM_HINT: "x11",
    WAYLAND_DISPLAY: ""
  };
};

const toAppliedSwitches = (
  backend: LinuxGraphicsBackend,
  gpuMode: LinuxGpuMode,
  hasExplicitOzoneOverride: boolean
): Readonly<Record<string, string>> => {
  const result: Record<string, string> = {};
  const enabledFeatures = [
    "OverlayScrollbar",
    "OverlayScrollbarFlashAfterAnyScrollUpdate",
    "OverlayScrollbarFlashWhenMouseEnter"
  ];

  if (hasExplicitOzoneOverride === false) {
    enabledFeatures.unshift("UseOzonePlatform", "WaylandWindowDecorations");
    result["ozone-platform"] = backend;
  }
  result["enable-features"] = enabledFeatures.join(",");

  if (gpuMode === "software") {
    result["disable-gpu"] = "true";
    result["disable-gpu-compositing"] = "true";
  }
  return result;
};

export const resolveLinuxCompatPlan = (input: {
  readonly platform: NodeJS.Platform;
  readonly argv: readonly string[];
  readonly env: NodeJS.ProcessEnv;
  readonly osReleaseText?: string | null;
}): LinuxCompatPlan => {
  const facts = detectEnvironmentFacts(
    input.env,
    input.platform === "linux" ? input.osReleaseText ?? readOsReleaseText() : null
  );
  if (input.platform !== "linux") {
    return {
      enabled: false,
      safeMode: false,
      backend: "x11",
      gpuMode: "hardware",
      backendSource: "auto",
      gpuSource: "auto",
      warnings: [],
      notes: ["linux-compat is disabled on non-linux platforms"],
      appliedEnv: {},
      appliedSwitches: {},
      disableHardwareAcceleration: false,
      facts
    };
  }

  const safeMode = shouldEnableSafeMode(input.argv, input.env);
  const backendResolved = resolveBackend(input.argv, input.env, facts);
  const gpuResolved = resolveGpuMode(input.argv, input.env, safeMode);
  const hasExplicitOzoneOverride = input.argv.some(
    (argument) =>
      argument.startsWith("--ozone-platform")
      || argument.startsWith("--ozone-platform-hint")
  );
  const warnings = resolveWarnings(facts, backendResolved.backend);
  const notes: string[] = [];
  if (safeMode) {
    notes.push("safe mode enabled: forcing software rendering for startup stability");
  }
  if (hasExplicitOzoneOverride) {
    notes.push("detected explicit ozone override; linux-compat skipped automatic ozone switches");
  }
  if (facts.isRoot) {
    notes.push("running as root: sandbox/runtime characteristics may differ from normal user sessions");
  }

  return {
    enabled: true,
    safeMode,
    backend: backendResolved.backend,
    gpuMode: gpuResolved.gpuMode,
    backendSource: backendResolved.source,
    gpuSource: gpuResolved.source,
    warnings,
    notes,
    appliedEnv: toAppliedEnv(backendResolved.backend),
    appliedSwitches: toAppliedSwitches(
      backendResolved.backend,
      gpuResolved.gpuMode,
      hasExplicitOzoneOverride
    ),
    disableHardwareAcceleration: gpuResolved.gpuMode === "software",
    facts
  };
};

const applySwitches = (app: Electron.App, switches: Readonly<Record<string, string>>): void => {
  for (const [name, value] of Object.entries(switches)) {
    if (name === "disable-gpu" || name === "disable-gpu-compositing") {
      app.commandLine.appendSwitch(name);
      continue;
    }
    app.commandLine.appendSwitch(name, value);
  }
};

const writeJsonFile = (targetPath: string, payload: unknown): void => {
  mkdirSync(path.dirname(targetPath), { recursive: true });
  writeFileSync(targetPath, JSON.stringify(payload, null, 2), "utf-8");
};

const buildStatus = (
  platform: NodeJS.Platform,
  plan: LinuxCompatPlan
): LinuxCompatStatus => ({
  platform,
  enabled: plan.enabled,
  safeMode: plan.safeMode,
  backend: plan.backend,
  gpuMode: plan.gpuMode,
  backendSource: plan.backendSource,
  gpuSource: plan.gpuSource,
  warnings: plan.warnings,
  notes: plan.notes,
  appliedEnv: plan.appliedEnv,
  appliedSwitches: plan.appliedSwitches,
  facts: plan.facts,
  generatedAt: new Date().toISOString()
});

const exportSnapshot = (
  snapshot: LinuxCompatStatus,
  storageRoot: string
): LinuxCompatExportResponse => {
  try {
    const timestamp = snapshot.generatedAt.replaceAll(":", "-");
    const outputPath = path.join(
      storageRoot,
      "diagnostics",
      `linux-compat-${timestamp}.json`
    );
    writeJsonFile(outputPath, snapshot);
    return {
      ok: true,
      filePath: outputPath
    };
  } catch (error: unknown) {
    return {
      ok: false,
      error: String(error)
    };
  }
};

export const createLinuxCompatBridge = (input: {
  readonly platform: NodeJS.Platform;
  readonly argv: readonly string[];
  readonly env: NodeJS.ProcessEnv;
}): LinuxCompatBridge => {
  const plan = resolveLinuxCompatPlan(input);
  const status = buildStatus(input.platform, plan);

  return {
    status,
    applyToProcessEnv: () => {
      if (plan.enabled === false) {
        return;
      }
      for (const [name, value] of Object.entries(plan.appliedEnv)) {
        process.env[name] = value;
      }
    },
    applyToElectronApp: (app: Electron.App) => {
      if (plan.enabled === false) {
        return;
      }
      applySwitches(app, plan.appliedSwitches);
      if (plan.disableHardwareAcceleration) {
        app.disableHardwareAcceleration();
      }
    },
    persistStatusSnapshot: (storageRoot: string) => {
      const targetPath = path.join(storageRoot, "last-status.json");
      writeJsonFile(targetPath, status);
    },
    exportDiagnosticsSnapshot: (storageRoot: string) =>
      exportSnapshot(status, storageRoot)
  };
};
