import path from "node:path";

export type LspBundleTargetId =
  | "linux-x64"
  | "linux-arm64"
  | "darwin-x64"
  | "darwin-arm64"
  | "win32-x64"
  | "win32-arm64";

export type RustAnalyzerBundleTarget = {
  readonly id: LspBundleTargetId;
  readonly platform: NodeJS.Platform;
  readonly arch: NodeJS.Architecture;
  readonly releaseAssetName: string;
  readonly binaryFileName: string;
};

export const RUST_ANALYZER_BUNDLE_TARGETS: readonly RustAnalyzerBundleTarget[] = [
  {
    id: "linux-x64",
    platform: "linux",
    arch: "x64",
    releaseAssetName: "rust-analyzer-x86_64-unknown-linux-gnu.gz",
    binaryFileName: "rust-analyzer"
  },
  {
    id: "linux-arm64",
    platform: "linux",
    arch: "arm64",
    releaseAssetName: "rust-analyzer-aarch64-unknown-linux-gnu.gz",
    binaryFileName: "rust-analyzer"
  },
  {
    id: "darwin-x64",
    platform: "darwin",
    arch: "x64",
    releaseAssetName: "rust-analyzer-x86_64-apple-darwin.gz",
    binaryFileName: "rust-analyzer"
  },
  {
    id: "darwin-arm64",
    platform: "darwin",
    arch: "arm64",
    releaseAssetName: "rust-analyzer-aarch64-apple-darwin.gz",
    binaryFileName: "rust-analyzer"
  },
  {
    id: "win32-x64",
    platform: "win32",
    arch: "x64",
    releaseAssetName: "rust-analyzer-x86_64-pc-windows-msvc.zip",
    binaryFileName: "rust-analyzer.exe"
  },
  {
    id: "win32-arm64",
    platform: "win32",
    arch: "arm64",
    releaseAssetName: "rust-analyzer-aarch64-pc-windows-msvc.zip",
    binaryFileName: "rust-analyzer.exe"
  }
] as const;

export const resolveCurrentRustAnalyzerTarget = (
  platform: NodeJS.Platform,
  arch: NodeJS.Architecture
): RustAnalyzerBundleTarget | null =>
  RUST_ANALYZER_BUNDLE_TARGETS.find(
    (target) => target.platform === platform && target.arch === arch
  ) ?? null;

export const resolveBundledRustAnalyzerCandidates = (
  roots: readonly string[],
  platform: NodeJS.Platform,
  arch: NodeJS.Architecture
): readonly string[] => {
  const target = resolveCurrentRustAnalyzerTarget(platform, arch);
  if (target === null) {
    return [];
  }

  const candidates: string[] = [];
  for (const root of roots) {
    candidates.push(path.resolve(root, "lsp", target.id, target.binaryFileName));
    candidates.push(path.resolve(root, "resources", "lsp", target.id, target.binaryFileName));
    candidates.push(path.resolve(root, "lsp", target.binaryFileName));
    candidates.push(path.resolve(root, "resources", "lsp", target.binaryFileName));
    candidates.push(
      path.resolve(
        root,
        "apps",
        "desktop",
        "resources",
        "lsp",
        target.id,
        target.binaryFileName
      )
    );
  }

  return Array.from(new Set(candidates));
};
