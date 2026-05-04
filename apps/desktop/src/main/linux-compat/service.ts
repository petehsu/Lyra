import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import os from "node:os";
import path from "node:path";

import { resolveDesktopTarget } from "../platform-target";
import type {
  LinuxCompatBridge,
  LinuxCompatConfig,
  LinuxCompatExportResponse,
  LinuxCompatPlan,
  LinuxCompatProfile,
  LinuxCompatRecoveryStatus,
  LinuxCompatRestartRequest,
  LinuxCompatRestartResponse,
  LinuxCompatStatus,
  LinuxCompatUpdateConfigRequest,
  LinuxCompatUpdateConfigResponse,
  LinuxCompatWarning,
  LinuxEnvironmentFacts,
  LinuxGpuFacts,
  LinuxGpuMode,
  LinuxGpuVendor,
  LinuxGraphicsBackend,
  LinuxPackageType,
  LinuxSessionType,
  LinuxStrategySource
} from "./types";

const CONFIG_FILE = "config.v1.json";
const RUNTIME_STATE_FILE = "runtime-state.v1.json";
const HEALTH_FILE = "launch-health.json";

const SAFE_MODE_ARGS = new Set(["--safe-mode", "--lyra-safe-mode"]);
const SOFTWARE_GPU_ARGS = new Set(["--disable-gpu", "--disable-gpu-compositing", "--lyra-software-gpu"]);
const RECOVERY_ARGS = new Set(["--lyra-linux-recovery"]);
const DEFAULT_CONFIG: LinuxCompatConfig = {
  version: 1,
  profile: "reliable",
  updatedAt: "1970-01-01T00:00:00.000Z"
};

type RuntimeState = {
  readonly version: 1;
  readonly lastFailureReason?: string;
  readonly lastFailureAt?: string;
  readonly lastFailureLaunchId?: string;
  readonly lastRecoveryAt?: string;
  readonly lastRestartReason?: string;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const nowIso = (): string => new Date().toISOString();

const parseTruthy = (value: string | undefined): boolean => {
  if (typeof value !== "string") {
    return false;
  }
  const normalized = value.trim().toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes" || normalized === "on";
};

const readTextFile = (filePath: string): string | null => {
  try {
    return readFileSync(filePath, "utf8");
  } catch {
    return null;
  }
};

const readOsReleaseText = (): string | null => readTextFile("/etc/os-release");

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

const parseProfileValue = (value: unknown): LinuxCompatProfile | null => {
  if (value === "reliable" || value === "native" || value === "performance") {
    return value;
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

const parseProfileFromArgv = (argv: readonly string[]): LinuxCompatProfile | null => {
  for (const argument of argv) {
    if (argument.startsWith("--lyra-linux-profile=") === false) {
      continue;
    }
    return parseProfileValue(argument.slice("--lyra-linux-profile=".length));
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

const normalizeDesktop = (desktopRaw: string): string => {
  const normalized = desktopRaw.trim().toLowerCase();
  if (normalized.length === 0 || normalized === "unknown") {
    return "unknown";
  }
  if (normalized.includes("gnome")) return "gnome";
  if (normalized.includes("kde") || normalized.includes("plasma")) return "kde";
  if (normalized.includes("hyprland")) return "hyprland";
  if (normalized.includes("sway")) return "sway";
  if (normalized.includes("xfce")) return "xfce";
  if (normalized.includes("cinnamon")) return "cinnamon";
  if (normalized.includes("mate")) return "mate";
  if (normalized.includes("lxqt")) return "lxqt";
  if (normalized.includes("cosmic")) return "cosmic";
  return normalized.split(/[:;]/u)[0] ?? normalized;
};

const detectPackageType = (env: NodeJS.ProcessEnv): LinuxPackageType => {
  const explicit = env.LYRA_LINUX_PACKAGE_TYPE?.trim().toLowerCase();
  if (
    explicit === "appimage" ||
    explicit === "deb" ||
    explicit === "rpm" ||
    explicit === "tar" ||
    explicit === "snap" ||
    explicit === "flatpak" ||
    explicit === "dev"
  ) {
    return explicit;
  }
  if (typeof env.APPIMAGE === "string" && env.APPIMAGE.length > 0) return "appimage";
  if (typeof env.SNAP === "string" && env.SNAP.length > 0) return "snap";
  if (typeof env.FLATPAK_ID === "string" && env.FLATPAK_ID.length > 0) return "flatpak";
  if (typeof env.ELECTRON_RENDERER_URL === "string" && env.ELECTRON_RENDERER_URL.length > 0) return "dev";
  return "unknown";
};

const detectContainer = (env: NodeJS.ProcessEnv): boolean =>
  typeof env.container === "string" ||
  typeof env.CONTAINER === "string" ||
  existsSync("/.dockerenv");

const readGpuVendorsFromSysfs = (): readonly LinuxGpuVendor[] => {
  const vendors = new Set<LinuxGpuVendor>();
  let entries: readonly string[] = [];
  try {
    entries = readdirSync("/sys/class/drm");
  } catch {
    return [];
  }

  for (const entry of entries) {
    if (/^card\d+$/u.test(entry) === false) {
      continue;
    }
    const vendorId = readTextFile(path.join("/sys/class/drm", entry, "device", "vendor"))
      ?.trim()
      .toLowerCase();
    if (vendorId === "0x10de") {
      vendors.add("nvidia");
    } else if (vendorId === "0x1002" || vendorId === "0x1022") {
      vendors.add("amd");
    } else if (vendorId === "0x8086") {
      vendors.add("intel");
    } else if (vendorId === "0x1af4" || vendorId === "0x1b36") {
      vendors.add("virtio");
    }
  }
  return [...vendors];
};

const detectGpuFacts = (env: NodeJS.ProcessEnv): LinuxGpuFacts => {
  const sysfsVendors = readGpuVendorsFromSysfs();
  const driverHint =
    parseTruthy(env.LIBGL_ALWAYS_SOFTWARE) || parseTruthy(env.LLVMPIPE)
      ? "software"
      : typeof env.NVIDIA_VISIBLE_DEVICES === "string" && env.NVIDIA_VISIBLE_DEVICES.length > 0
        ? "nvidia"
        : typeof env.__NV_PRIME_RENDER_OFFLOAD === "string" && env.__NV_PRIME_RENDER_OFFLOAD.length > 0
          ? "nvidia-prime"
          : typeof env.DRI_PRIME === "string" && env.DRI_PRIME.length > 0
            ? "dri-prime"
            : null;
  const vendor: LinuxGpuVendor =
    driverHint === "software"
      ? "software"
      : sysfsVendors.includes("nvidia")
        ? "nvidia"
        : sysfsVendors.includes("amd")
          ? "amd"
          : sysfsVendors.includes("intel")
            ? "intel"
            : sysfsVendors.includes("virtio")
              ? "virtio"
              : driverHint?.startsWith("nvidia") === true
                ? "nvidia"
                : "unknown";
  return {
    vendor,
    deviceCount: sysfsVendors.length,
    hasDiscreteGpu: sysfsVendors.includes("nvidia") || sysfsVendors.includes("amd"),
    driverHint,
    hardwareAccelerationEnabled: null,
    featureStatus: null
  };
};

const withGpuSnapshot = (
  facts: LinuxEnvironmentFacts,
  gpu: Partial<Pick<LinuxGpuFacts, "featureStatus" | "hardwareAccelerationEnabled">>
): LinuxEnvironmentFacts => ({
  ...facts,
  gpu: {
    ...facts.gpu,
    ...gpu
  }
});

const detectEnvironmentFacts = (input: {
  readonly platform: NodeJS.Platform;
  readonly arch: NodeJS.Architecture;
  readonly env: NodeJS.ProcessEnv;
  readonly osReleaseText: string | null;
  readonly kernelRelease: string;
  readonly report?: Parameters<typeof resolveDesktopTarget>[0]["report"];
}): LinuxEnvironmentFacts => {
  const desktopRaw = input.env.XDG_CURRENT_DESKTOP ?? input.env.DESKTOP_SESSION ?? "unknown";
  const desktop = normalizeDesktop(desktopRaw);
  const waylandDisplay = input.env.WAYLAND_DISPLAY?.trim();
  const x11Display = input.env.DISPLAY?.trim();
  const osRelease = parseOsRelease(input.osReleaseText);
  const target = resolveDesktopTarget({
    platform: input.platform,
    arch: input.arch,
    env: input.env,
    ...(input.report === undefined ? {} : { report: input.report })
  });
  return {
    sessionType: toSessionType(input.env.XDG_SESSION_TYPE, waylandDisplay, x11Display),
    architecture: input.arch,
    kernelRelease: input.kernelRelease,
    libc: target.libc,
    desktop,
    desktopRaw: desktopRaw.trim().length > 0 ? desktopRaw : "unknown",
    distributionId: osRelease.distributionId,
    distributionVersion: osRelease.distributionVersion,
    distributionLike: osRelease.distributionLike,
    packageType: detectPackageType(input.env),
    waylandDisplay: waylandDisplay !== undefined && waylandDisplay.length > 0 ? waylandDisplay : null,
    x11Display: x11Display !== undefined && x11Display.length > 0 ? x11Display : null,
    isContainer: detectContainer(input.env),
    isRoot: typeof process.getuid === "function" ? process.getuid() === 0 : false,
    gpu: detectGpuFacts(input.env)
  };
};

const readJsonFile = <T>(filePath: string, normalize: (value: unknown) => T | null): T | null => {
  const raw = readTextFile(filePath);
  if (raw === null) {
    return null;
  }
  try {
    return normalize(JSON.parse(raw) as unknown);
  } catch {
    return null;
  }
};

const writeJsonFile = (targetPath: string, payload: unknown): void => {
  mkdirSync(path.dirname(targetPath), { recursive: true });
  writeFileSync(targetPath, JSON.stringify(payload, null, 2), "utf-8");
};

const normalizeConfig = (value: unknown): LinuxCompatConfig | null => {
  if (isRecord(value) === false || value.version !== 1) {
    return null;
  }
  const profile = parseProfileValue(value.profile);
  if (profile === null) {
    return null;
  }
  return {
    version: 1,
    profile,
    updatedAt: typeof value.updatedAt === "string" ? value.updatedAt : DEFAULT_CONFIG.updatedAt
  };
};

const normalizeRuntimeState = (value: unknown): RuntimeState | null => {
  if (isRecord(value) === false || value.version !== 1) {
    return null;
  }
  return {
    version: 1,
    ...(typeof value.lastFailureReason === "string" ? { lastFailureReason: value.lastFailureReason } : {}),
    ...(typeof value.lastFailureAt === "string" ? { lastFailureAt: value.lastFailureAt } : {}),
    ...(typeof value.lastFailureLaunchId === "string" ? { lastFailureLaunchId: value.lastFailureLaunchId } : {}),
    ...(typeof value.lastRecoveryAt === "string" ? { lastRecoveryAt: value.lastRecoveryAt } : {}),
    ...(typeof value.lastRestartReason === "string" ? { lastRestartReason: value.lastRestartReason } : {})
  };
};

const resolveStorageFile = (storageRoot: string | undefined, fileName: string): string | null =>
  storageRoot === undefined ? null : path.join(storageRoot, fileName);

export const readLinuxCompatConfig = (storageRoot: string | undefined): LinuxCompatConfig => {
  const configPath = resolveStorageFile(storageRoot, CONFIG_FILE);
  if (configPath === null) {
    return DEFAULT_CONFIG;
  }
  return readJsonFile(configPath, normalizeConfig) ?? DEFAULT_CONFIG;
};

const writeLinuxCompatConfig = (
  storageRoot: string,
  profile: LinuxCompatProfile
): LinuxCompatConfig => {
  const config: LinuxCompatConfig = {
    version: 1,
    profile,
    updatedAt: nowIso()
  };
  writeJsonFile(path.join(storageRoot, CONFIG_FILE), config);
  return config;
};

const readRuntimeState = (storageRoot: string | undefined): RuntimeState => {
  const statePath = resolveStorageFile(storageRoot, RUNTIME_STATE_FILE);
  if (statePath === null) {
    return { version: 1 };
  }
  return readJsonFile(statePath, normalizeRuntimeState) ?? { version: 1 };
};

const writeRuntimeState = (storageRoot: string | undefined, state: RuntimeState): void => {
  if (storageRoot === undefined) {
    return;
  }
  writeJsonFile(path.join(storageRoot, RUNTIME_STATE_FILE), state);
};

const resolveRecoveryStatus = (
  argv: readonly string[],
  env: NodeJS.ProcessEnv,
  runtimeState: RuntimeState
): LinuxCompatRecoveryStatus => {
  const launchId = env.LYRA_LINUX_LAUNCH_ID?.trim() || randomUUID();
  const active =
    parseTruthy(env.LYRA_LINUX_RECOVERY) ||
    parseTruthy(env.LYRA_LINUX_AUTO_RESTART) ||
    hasAnyArg(argv, RECOVERY_ARGS);
  return {
    active,
    autoRestarted: parseTruthy(env.LYRA_LINUX_AUTO_RESTART),
    launchId,
    previousFailureReason: runtimeState.lastFailureReason ?? null
  };
};

const shouldEnableSafeMode = (
  argv: readonly string[],
  env: NodeJS.ProcessEnv,
  recovery: LinuxCompatRecoveryStatus
): boolean =>
  recovery.active || hasAnyArg(argv, SAFE_MODE_ARGS) || parseTruthy(env.LYRA_SAFE_MODE);

const resolveProfile = (
  argv: readonly string[],
  env: NodeJS.ProcessEnv,
  config: LinuxCompatConfig,
  recovery: LinuxCompatRecoveryStatus
): { readonly profile: LinuxCompatProfile; readonly source: LinuxStrategySource } => {
  if (recovery.active) {
    return { profile: "reliable", source: "recovery" };
  }
  const cliValue = parseProfileFromArgv(argv);
  if (cliValue !== null) {
    return { profile: cliValue, source: "cli" };
  }
  const envValue = parseProfileValue(env.LYRA_LINUX_PROFILE);
  if (envValue !== null) {
    return { profile: envValue, source: "env" };
  }
  return { profile: config.profile, source: "config" };
};

const recommendedProfileForFacts = (facts: LinuxEnvironmentFacts): LinuxCompatProfile => {
  if (facts.sessionType === "unknown" || facts.desktop === "unknown" || facts.gpu.vendor === "unknown") {
    return "reliable";
  }
  if (facts.sessionType === "wayland" && facts.gpu.vendor !== "nvidia") {
    return "native";
  }
  return "reliable";
};

const resolveBackend = (
  argv: readonly string[],
  env: NodeJS.ProcessEnv,
  facts: LinuxEnvironmentFacts,
  profile: LinuxCompatProfile,
  recovery: LinuxCompatRecoveryStatus
): { readonly backend: LinuxGraphicsBackend; readonly source: LinuxStrategySource } => {
  const cliValue = parseBackendFromArgv(argv);
  if (cliValue !== null) {
    return { backend: cliValue, source: "cli" };
  }
  const envValue = parseBackendValue(env.LYRA_LINUX_BACKEND);
  if (envValue !== null) {
    return { backend: envValue, source: "env" };
  }
  if (recovery.active && facts.x11Display !== null) {
    return { backend: "x11", source: "recovery" };
  }
  if (profile === "reliable") {
    if (facts.x11Display !== null) {
      return {
        backend: "x11",
        source: recovery.previousFailureReason === null ? "auto" : "history"
      };
    }
    if (facts.waylandDisplay !== null) {
      return { backend: "wayland", source: "auto" };
    }
    return { backend: "x11", source: "auto" };
  }
  if (profile === "native") {
    if (facts.sessionType === "wayland" || facts.waylandDisplay !== null) {
      return { backend: "wayland", source: "auto" };
    }
    return { backend: "x11", source: "auto" };
  }
  if (facts.sessionType === "wayland" || facts.waylandDisplay !== null) {
    return { backend: "wayland", source: "auto" };
  }
  return { backend: "x11", source: "auto" };
};

const shouldUseSoftwareGpuByDefault = (
  facts: LinuxEnvironmentFacts,
  profile: LinuxCompatProfile,
  backend: LinuxGraphicsBackend,
  safeMode: boolean,
  recovery: LinuxCompatRecoveryStatus
): boolean => {
  if (safeMode || recovery.active) {
    return true;
  }
  if (facts.gpu.vendor === "software") {
    return true;
  }
  if (profile === "performance") {
    return false;
  }
  if (profile === "native") {
    return false;
  }
  if (facts.gpu.vendor === "virtio" || facts.gpu.vendor === "unknown") {
    return true;
  }
  return backend === "wayland" && facts.gpu.vendor === "nvidia";
};

const resolveGpuMode = (
  argv: readonly string[],
  env: NodeJS.ProcessEnv,
  facts: LinuxEnvironmentFacts,
  profile: LinuxCompatProfile,
  backend: LinuxGraphicsBackend,
  safeMode: boolean,
  recovery: LinuxCompatRecoveryStatus
): { readonly gpuMode: LinuxGpuMode; readonly source: LinuxStrategySource } => {
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
  if (shouldUseSoftwareGpuByDefault(facts, profile, backend, safeMode, recovery)) {
    return {
      gpuMode: "software",
      source: recovery.active ? "recovery" : "auto"
    };
  }
  return { gpuMode: "hardware", source: "auto" };
};

const resolveWarnings = (
  facts: LinuxEnvironmentFacts,
  backend: LinuxGraphicsBackend,
  gpuMode: LinuxGpuMode,
  recovery: LinuxCompatRecoveryStatus
): readonly LinuxCompatWarning[] => {
  const warnings: LinuxCompatWarning[] = [];
  if (recovery.active) {
    warnings.push({
      code: "recovery-mode",
      message: "Lyra is running in Linux recovery mode after a failed launch or explicit recovery request."
    });
  }
  if (recovery.previousFailureReason !== null) {
    warnings.push({
      code: "previous-launch-failed",
      message: `Previous Linux launch failure: ${recovery.previousFailureReason}`
    });
  }
  if (facts.waylandDisplay !== null && facts.x11Display !== null) {
    warnings.push({
      code: "both-display-servers-detected",
      message: "Detected both WAYLAND_DISPLAY and DISPLAY. Lyra selected one backend to avoid unstable rendering."
    });
  }
  if (facts.waylandDisplay === null && facts.x11Display === null) {
    warnings.push({
      code: "missing-display-server",
      message: "No Wayland or X11 display variable was detected before startup."
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
  if (gpuMode === "software" && facts.gpu.vendor !== "software") {
    warnings.push({
      code: "gpu-compat-fallback",
      message: "Lyra selected software rendering for Linux startup stability."
    });
  }
  return warnings;
};

const toAppliedEnv = (
  recovery: LinuxCompatRecoveryStatus,
  facts: LinuxEnvironmentFacts
): Readonly<Record<string, string>> => {
  const result: Record<string, string> = {
    LYRA_LINUX_LAUNCH_ID: recovery.launchId,
    LYRA_LINUX_PACKAGE_TYPE: facts.packageType
  };
  if (recovery.active) {
    result.LYRA_LINUX_RECOVERY = "1";
  }
  return result;
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
    result["ozone-platform"] = backend;
    if (backend === "wayland") {
      enabledFeatures.unshift("UseOzonePlatform", "WaylandWindowDecorations");
    }
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
  readonly arch?: NodeJS.Architecture;
  readonly config?: LinuxCompatConfig;
  readonly runtimeState?: RuntimeState;
  readonly osReleaseText?: string | null;
  readonly kernelRelease?: string;
  readonly report?: Parameters<typeof resolveDesktopTarget>[0]["report"];
}): LinuxCompatPlan => {
  const arch = input.arch ?? process.arch;
  const config = input.config ?? DEFAULT_CONFIG;
  const runtimeState = input.runtimeState ?? { version: 1 };
  const facts = detectEnvironmentFacts({
    platform: input.platform,
    arch,
    env: input.env,
    osReleaseText: input.platform === "linux" ? input.osReleaseText ?? readOsReleaseText() : null,
    kernelRelease: input.kernelRelease ?? os.release(),
    report: input.report
  });
  const recovery = resolveRecoveryStatus(input.argv, input.env, runtimeState);

  if (input.platform !== "linux") {
    return {
      enabled: false,
      profile: "reliable",
      recommendedProfile: "reliable",
      safeMode: false,
      backend: "x11",
      gpuMode: "hardware",
      profileSource: "auto",
      backendSource: "auto",
      gpuSource: "auto",
      warnings: [],
      notes: ["linux-compat is disabled on non-linux platforms"],
      appliedEnv: {},
      appliedSwitches: {},
      disableHardwareAcceleration: false,
      facts,
      recovery
    };
  }

  const profileResolved = resolveProfile(input.argv, input.env, config, recovery);
  const safeMode = shouldEnableSafeMode(input.argv, input.env, recovery);
  const backendResolved = resolveBackend(
    input.argv,
    input.env,
    facts,
    profileResolved.profile,
    recovery
  );
  const gpuResolved = resolveGpuMode(
    input.argv,
    input.env,
    facts,
    profileResolved.profile,
    backendResolved.backend,
    safeMode,
    recovery
  );
  const hasExplicitOzoneOverride = input.argv.some(
    (argument) =>
      argument.startsWith("--ozone-platform")
      || argument.startsWith("--ozone-platform-hint")
  );
  const warnings = resolveWarnings(facts, backendResolved.backend, gpuResolved.gpuMode, recovery);
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
  if (facts.isContainer) {
    notes.push("containerized runtime detected; desktop integration may depend on host portals");
  }

  return {
    enabled: true,
    profile: profileResolved.profile,
    recommendedProfile: recommendedProfileForFacts(facts),
    safeMode,
    backend: backendResolved.backend,
    gpuMode: gpuResolved.gpuMode,
    profileSource: profileResolved.source,
    backendSource: backendResolved.source,
    gpuSource: gpuResolved.source,
    warnings,
    notes,
    appliedEnv: toAppliedEnv(recovery, facts),
    appliedSwitches: toAppliedSwitches(
      backendResolved.backend,
      gpuResolved.gpuMode,
      hasExplicitOzoneOverride
    ),
    disableHardwareAcceleration: gpuResolved.gpuMode === "software",
    facts,
    recovery
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

const buildStatus = (
  platform: NodeJS.Platform,
  plan: LinuxCompatPlan
): LinuxCompatStatus => ({
  platform,
  enabled: plan.enabled,
  profile: plan.profile,
  recommendedProfile: plan.recommendedProfile,
  safeMode: plan.safeMode,
  backend: plan.backend,
  gpuMode: plan.gpuMode,
  profileSource: plan.profileSource,
  backendSource: plan.backendSource,
  gpuSource: plan.gpuSource,
  warnings: plan.warnings,
  notes: plan.notes,
  appliedEnv: plan.appliedEnv,
  appliedSwitches: plan.appliedSwitches,
  facts: plan.facts,
  recovery: plan.recovery,
  generatedAt: nowIso()
});

const exportSnapshot = (
  snapshot: LinuxCompatStatus,
  config: LinuxCompatConfig,
  storageRoot: string
): LinuxCompatExportResponse => {
  try {
    const timestamp = snapshot.generatedAt.replaceAll(":", "-");
    const outputPath = path.join(
      storageRoot,
      "diagnostics",
      `linux-compat-${timestamp}.json`
    );
    writeJsonFile(outputPath, { status: snapshot, config });
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

const isRendererFailure = (details: Electron.RenderProcessGoneDetails): boolean =>
  details.reason === "crashed" ||
  details.reason === "oom" ||
  details.reason === "launch-failed" ||
  details.reason === "integrity-failure";

const isChildFailure = (details: Electron.Details): boolean =>
  details.type === "GPU" && (
    details.reason === "crashed" ||
    details.reason === "oom" ||
    details.reason === "launch-failed" ||
    details.reason === "integrity-failure"
  );

const createRelaunchArgs = (
  argv: readonly string[],
  reason: string | undefined,
  recovery: boolean
): string[] => {
  const filtered = argv
    .slice(1)
    .filter((argument) =>
      argument !== "--lyra-linux-recovery" &&
      argument.startsWith("--lyra-linux-profile=") === false &&
      argument.startsWith("--lyra-linux-restart-reason=") === false
    );
  return [
    ...filtered,
    ...(recovery ? ["--lyra-linux-recovery"] : []),
    ...(reason === undefined ? [] : [`--lyra-linux-restart-reason=${encodeURIComponent(reason)}`])
  ];
};

export const createLinuxCompatBridge = (input: {
  readonly platform: NodeJS.Platform;
  readonly argv: readonly string[];
  readonly env: NodeJS.ProcessEnv;
  readonly storageRoot?: string;
}): LinuxCompatBridge => {
  let config = readLinuxCompatConfig(input.storageRoot);
  const runtimeState = readRuntimeState(input.storageRoot);
  const plan = resolveLinuxCompatPlan({
    platform: input.platform,
    argv: input.argv,
    env: input.env,
    config,
    runtimeState
  });
  let status = buildStatus(input.platform, plan);

  const refreshStatusFacts = (facts: LinuxEnvironmentFacts): void => {
    status = {
      ...status,
      facts,
      generatedAt: nowIso()
    };
  };

  const recordFailure = (reason: string): void => {
    if (plan.enabled === false) {
      return;
    }
    writeRuntimeState(input.storageRoot, {
      ...readRuntimeState(input.storageRoot),
      version: 1,
      lastFailureReason: reason,
      lastFailureAt: nowIso(),
      lastFailureLaunchId: plan.recovery.launchId
    });
  };

  return {
    get status() {
      return status;
    },
    readConfig: () => config,
    updateConfig: (request: LinuxCompatUpdateConfigRequest): LinuxCompatUpdateConfigResponse => {
      if (input.storageRoot === undefined) {
        return {
          ok: false,
          error: "linux-compat storage root is unavailable"
        };
      }
      const profile = parseProfileValue(request.profile);
      if (profile === null) {
        return {
          ok: false,
          error: `unsupported linux compatibility profile: ${String(request.profile)}`
        };
      }
      try {
        config = writeLinuxCompatConfig(input.storageRoot, profile);
        return {
          ok: true,
          config
        };
      } catch (error: unknown) {
        return {
          ok: false,
          error: String(error)
        };
      }
    },
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
    markWindowReady: () => {
      if (plan.enabled === false || input.storageRoot === undefined) {
        return;
      }
      writeJsonFile(path.join(input.storageRoot, HEALTH_FILE), {
        version: 1,
        launchId: plan.recovery.launchId,
        readyAt: nowIso(),
        profile: status.profile,
        backend: status.backend,
        gpuMode: status.gpuMode
      });
      if (plan.recovery.active) {
        writeRuntimeState(input.storageRoot, {
          version: 1,
          lastRecoveryAt: nowIso()
        });
      }
    },
    recordRendererGone: (details: Electron.RenderProcessGoneDetails) => {
      if (isRendererFailure(details)) {
        recordFailure(`renderer-${details.reason}-${details.exitCode}`);
      }
    },
    recordChildProcessGone: (details: Electron.Details) => {
      if (isChildFailure(details)) {
        recordFailure(`gpu-${details.reason}-${details.exitCode}`);
      }
    },
    captureGpuSnapshot: async (app: Electron.App) => {
      if (plan.enabled === false) {
        return;
      }
      try {
        const featureStatus = app.getGPUFeatureStatus() as unknown as Readonly<Record<string, unknown>>;
        refreshStatusFacts(withGpuSnapshot(status.facts, {
          featureStatus,
          hardwareAccelerationEnabled: app.isHardwareAccelerationEnabled()
        }));
        await app.getGPUInfo("basic");
      } catch (error: unknown) {
        recordFailure(`gpu-info-${String(error)}`);
      }
    },
    requestRestart: (app: Electron.App, request?: LinuxCompatRestartRequest): LinuxCompatRestartResponse => {
      try {
        const recovery = request?.recovery === true;
        if (recovery) {
          process.env.LYRA_LINUX_RECOVERY = "1";
          process.env.LYRA_LINUX_AUTO_RESTART = "1";
        } else {
          delete process.env.LYRA_LINUX_RECOVERY;
          delete process.env.LYRA_LINUX_AUTO_RESTART;
        }
        if (input.storageRoot !== undefined) {
          writeRuntimeState(input.storageRoot, {
            ...readRuntimeState(input.storageRoot),
            version: 1,
            lastRestartReason: request?.reason ?? "linux-compat"
          });
        }
        app.relaunch({
          args: createRelaunchArgs(input.argv, request?.reason, recovery)
        });
        app.exit(0);
        return { ok: true };
      } catch (error: unknown) {
        return {
          ok: false,
          error: String(error)
        };
      }
    },
    persistStatusSnapshot: (storageRoot: string) => {
      const targetPath = path.join(storageRoot, "last-status.json");
      writeJsonFile(targetPath, status);
    },
    exportDiagnosticsSnapshot: (storageRoot: string) =>
      exportSnapshot(status, config, storageRoot)
  };
};
