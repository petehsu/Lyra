export type DownloadPlatform = "macos" | "windows" | "linux";
export type DownloadArchitecture = "x64" | "arm64";
export type DownloadFormat = "dmg" | "exe" | "AppImage" | "deb" | "rpm" | "pkg.tar.zst" | "flatpak";

export type DetectedDesktop = {
  readonly platform: DownloadPlatform;
  readonly architecture?: DownloadArchitecture;
};

export type DownloadVariant = {
  readonly platform: DownloadPlatform;
  readonly architecture: DownloadArchitecture;
  readonly format: DownloadFormat;
  readonly label: string;
  readonly href: string;
};

const RELEASE_TAG = "v0.1.0-preview.12";
const RELEASE_BASE = `https://github.com/petehsu/lyra-releases/releases/download/${RELEASE_TAG}`;

const asset = (
  platform: DownloadPlatform,
  architecture: DownloadArchitecture,
  format: DownloadFormat,
  label: string
): DownloadVariant => ({
  platform,
  architecture,
  format,
  label,
  href: `${RELEASE_BASE}/Lyra-Online-${platform === "macos" ? "darwin" : platform}-${architecture}.${format}`
});

export const DOWNLOAD_VARIANTS: readonly DownloadVariant[] = [
  asset("macos", "arm64", "dmg", "Apple Silicon · DMG"),
  asset("macos", "x64", "dmg", "Intel x86_64 · DMG"),
  asset("windows", "arm64", "exe", "ARM64 · EXE"),
  asset("windows", "x64", "exe", "x86_64 · EXE"),
  ...(["AppImage", "deb", "rpm", "pkg.tar.zst", "flatpak"] as const).flatMap((format) => [
    asset("linux", "x64", format, `x86_64 · ${format}`),
    asset("linux", "arm64", format, `ARM64 · ${format}`)
  ])
];

export const variantsFor = (platform: DownloadPlatform): readonly DownloadVariant[] =>
  DOWNLOAD_VARIANTS.filter((variant) => variant.platform === platform);

export const recommendedVariant = (
  detected: DetectedDesktop | null,
  platform: DownloadPlatform
): DownloadVariant | null => {
  if (detected?.platform !== platform || detected.architecture === undefined) return null;
  const preferredFormat: DownloadFormat = platform === "macos"
    ? "dmg"
    : platform === "windows"
      ? "exe"
      : "AppImage";
  return DOWNLOAD_VARIANTS.find((variant) =>
    variant.platform === platform
    && variant.architecture === detected.architecture
    && variant.format === preferredFormat
  ) ?? null;
};

type NavigatorLike = {
  readonly userAgent?: string;
  readonly platform?: string;
  readonly userAgentData?: {
    getHighEntropyValues?: (hints: readonly string[]) => Promise<{
      readonly architecture?: string;
      readonly bitness?: string;
      readonly wow64?: boolean;
      readonly platform?: string;
    }>;
  };
};

const detectPlatform = (value: string): DownloadPlatform | null => {
  const normalized = value.toLowerCase();
  if (/windows|win32|win64/u.test(normalized)) return "windows";
  if (/macintosh|mac os|macintel/u.test(normalized)) return "macos";
  if (/linux|x11/u.test(normalized) && !/android/u.test(normalized)) return "linux";
  return null;
};

const detectArchitecture = (
  architecture: string,
  bitness = "",
  wow64 = false
): DownloadArchitecture | undefined => {
  const normalized = `${architecture} ${bitness}`.toLowerCase();
  if (/arm64|aarch64/u.test(normalized) || (/\barm\b/u.test(normalized) && bitness === "64")) {
    return "arm64";
  }
  if (/x86_64|amd64|\bx64\b/u.test(normalized)) return "x64";
  if (/\bx86\b/u.test(normalized) && (bitness === "64" || wow64)) return "x64";
  return undefined;
};

export const detectDesktop = async (navigatorLike: NavigatorLike): Promise<DetectedDesktop | null> => {
  const userAgent = navigatorLike.userAgent ?? "";
  const legacyPlatform = navigatorLike.platform ?? "";
  let highEntropy: Awaited<ReturnType<NonNullable<NonNullable<NavigatorLike["userAgentData"]>["getHighEntropyValues"]>>> | null = null;
  try {
    highEntropy = await navigatorLike.userAgentData?.getHighEntropyValues?.([
      "architecture",
      "bitness",
      "wow64"
    ]) ?? null;
  } catch {
    highEntropy = null;
  }
  const platform = detectPlatform(highEntropy?.platform ?? "")
    ?? detectPlatform(`${userAgent} ${legacyPlatform}`);
  if (platform === null) return null;
  const architecture = detectArchitecture(
    highEntropy?.architecture ?? "",
    highEntropy?.bitness ?? "",
    highEntropy?.wow64 ?? false
  ) ?? detectArchitecture(`${userAgent} ${legacyPlatform}`);
  return { platform, ...(architecture === undefined ? {} : { architecture }) };
};

