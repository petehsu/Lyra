export type DesktopPlatform = "darwin" | "linux" | "win32";

export type DesktopTargetSupportTier = "tier1" | "tier2" | "unsupported";

export type LinuxLibcFamily = "glibc" | "musl" | "unknown";

export type DesktopTargetId =
  | "darwin-x64"
  | "darwin-arm64"
  | "win32-x64"
  | "win32-arm64"
  | "win32-ia32"
  | "linux-x64"
  | "linux-arm64"
  | "linux-ia32"
  | "linux-arm"
  | "linux-riscv64";

export type DesktopTarget = {
  readonly id: DesktopTargetId | `${string}-${string}`;
  readonly platform: NodeJS.Platform;
  readonly arch: NodeJS.Architecture;
  readonly supportTier: DesktopTargetSupportTier;
  readonly resourceArch: string;
  readonly libc: LinuxLibcFamily | null;
  readonly rustTargetTriple: string | null;
  readonly notes: readonly string[];
};

type ProcessReportLike = {
  readonly getReport?: () => {
    readonly header?: {
      readonly glibcVersionRuntime?: string;
      readonly glibcVersionCompiler?: string;
    };
  };
};

const SUPPORTED_PLATFORMS = new Set<NodeJS.Platform>(["darwin", "linux", "win32"]);

const TIER1_TARGET_IDS = new Set<string>([
  "darwin-x64",
  "darwin-arm64",
  "win32-x64",
  "win32-arm64",
  "linux-x64",
  "linux-arm64",
]);

const TIER2_TARGET_IDS = new Set<string>([
  "win32-ia32",
  "linux-ia32",
  "linux-arm",
  "linux-riscv64",
]);

const normalizeResourceArch = (arch: NodeJS.Architecture): string => {
  if (arch === "x64" || arch === "arm64" || arch === "ia32" || arch === "arm" || arch === "riscv64") {
    return arch;
  }
  return arch;
};

const detectLinuxLibc = (
  platform: NodeJS.Platform,
  env: NodeJS.ProcessEnv,
  reportLike: ProcessReportLike
): LinuxLibcFamily | null => {
  if (platform !== "linux") {
    return null;
  }
  const explicit = env.LYRA_LINUX_LIBC?.trim().toLowerCase();
  if (explicit === "glibc" || explicit === "gnu") {
    return "glibc";
  }
  if (explicit === "musl") {
    return "musl";
  }
  try {
    const header = reportLike.getReport?.().header;
    if (
      typeof header?.glibcVersionRuntime === "string"
      || typeof header?.glibcVersionCompiler === "string"
    ) {
      return "glibc";
    }
  } catch {
    return "unknown";
  }
  return "unknown";
};

const rustTriple = (
  platform: NodeJS.Platform,
  arch: NodeJS.Architecture,
  libc: LinuxLibcFamily | null
): string | null => {
  if (platform === "darwin") {
    if (arch === "x64") {
      return "x86_64-apple-darwin";
    }
    if (arch === "arm64") {
      return "aarch64-apple-darwin";
    }
    return null;
  }
  if (platform === "win32") {
    if (arch === "x64") {
      return "x86_64-pc-windows-msvc";
    }
    if (arch === "arm64") {
      return "aarch64-pc-windows-msvc";
    }
    if (arch === "ia32") {
      return "i686-pc-windows-msvc";
    }
    return null;
  }
  if (platform === "linux") {
    const suffix = libc === "musl" ? "musl" : "gnu";
    if (arch === "x64") {
      return `x86_64-unknown-linux-${suffix}`;
    }
    if (arch === "arm64") {
      return `aarch64-unknown-linux-${suffix}`;
    }
    if (arch === "ia32" && suffix === "gnu") {
      return "i686-unknown-linux-gnu";
    }
    if (arch === "arm" && suffix === "gnu") {
      return "armv7-unknown-linux-gnueabihf";
    }
    if (arch === "riscv64" && suffix === "gnu") {
      return "riscv64gc-unknown-linux-gnu";
    }
  }
  return null;
};

export const resolveDesktopTarget = (input: {
  readonly platform: NodeJS.Platform;
  readonly arch: NodeJS.Architecture;
  readonly env?: NodeJS.ProcessEnv;
  readonly report?: ProcessReportLike;
}): DesktopTarget => {
  const resourceArch = normalizeResourceArch(input.arch);
  const id = `${input.platform}-${resourceArch}` as DesktopTarget["id"];
  const libc = detectLinuxLibc(
    input.platform,
    input.env ?? process.env,
    input.report ?? (process as ProcessReportLike)
  );
  const notes: string[] = [];
  if (input.platform === "linux" && libc !== "glibc") {
    notes.push(
      libc === "musl"
        ? "linux-musl-targets-are-best-effort"
        : "linux-libc-could-not-be-detected"
    );
  }
  if (SUPPORTED_PLATFORMS.has(input.platform) === false) {
    notes.push("electron-platform-unsupported");
  }
  const supportTier = TIER1_TARGET_IDS.has(id)
    ? (input.platform === "linux" && libc === "musl" ? "tier2" : "tier1")
    : TIER2_TARGET_IDS.has(id)
      ? "tier2"
      : "unsupported";
  return {
    id,
    platform: input.platform,
    arch: input.arch,
    supportTier,
    resourceArch,
    libc,
    rustTargetTriple: rustTriple(input.platform, input.arch, libc),
    notes,
  };
};

export const resolveCurrentDesktopTarget = (): DesktopTarget =>
  resolveDesktopTarget({
    platform: process.platform,
    arch: process.arch,
  });
