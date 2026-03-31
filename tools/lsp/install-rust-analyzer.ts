import { createHash } from "node:crypto";
import fs from "node:fs";
import https from "node:https";
import path from "node:path";
import { Readable } from "node:stream";
import zlib from "node:zlib";

import {
  RUST_ANALYZER_BUNDLE_TARGETS,
  type LspBundleTargetId,
  type RustAnalyzerBundleTarget
} from "../../apps/desktop/src/main/lsp/runtime-paths";

type CliOptions = {
  readonly version: string;
  readonly resourcesRoot: string;
  readonly targets: readonly RustAnalyzerBundleTarget[];
  readonly dryRun: boolean;
};

type GithubReleaseAsset = {
  readonly name: string;
  readonly browser_download_url: string;
};

type GithubRelease = {
  readonly tag_name: string;
  readonly assets: readonly GithubReleaseAsset[];
};

type InstallRecord = {
  readonly id: LspBundleTargetId;
  readonly platform: NodeJS.Platform;
  readonly arch: NodeJS.Architecture;
  readonly assetName: string;
  readonly binaryFileName: string;
  readonly relativePath: string;
  readonly sha256: string;
  readonly sizeBytes: number;
};

type InstallManifest = {
  readonly schemaVersion: 1;
  readonly source: "rust-lang/rust-analyzer";
  readonly releaseTag: string;
  readonly generatedAt: string;
  readonly targets: readonly InstallRecord[];
};

const REPO_ROOT = path.resolve(__dirname, "../..");
const DEFAULT_RESOURCES_ROOT = path.resolve(
  REPO_ROOT,
  "apps/desktop/resources/lsp"
);

const printUsage = (): void => {
  console.info(
    [
      "Usage: tsx tools/lsp/install-rust-analyzer.ts [options]",
      "",
      "Options:",
      "  --all                   Install all platform targets (default)",
      "  --target=<id,id>        Install specific targets",
      "  --version=<tag|latest>  Release tag (default: latest)",
      "  --resources-root=<path> Override output root (default: apps/desktop/resources/lsp)",
      "  --dry-run               Print planned actions only"
    ].join("\n")
  );
};

const parseTargets = (value: string): readonly RustAnalyzerBundleTarget[] => {
  const ids = value
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0) as readonly LspBundleTargetId[];

  const resolved = ids.map((id) =>
    RUST_ANALYZER_BUNDLE_TARGETS.find((target) => target.id === id)
  );

  const missing = resolved.filter(
    (target): target is undefined => target === undefined
  );
  if (missing.length > 0) {
    throw new Error(`unknown target id(s): ${ids.join(", ")}`);
  }

  return resolved as readonly RustAnalyzerBundleTarget[];
};

const parseArgs = (argv: readonly string[]): CliOptions => {
  let version = "latest";
  let resourcesRoot = DEFAULT_RESOURCES_ROOT;
  let selectedTargets: readonly RustAnalyzerBundleTarget[] =
    RUST_ANALYZER_BUNDLE_TARGETS;
  let dryRun = false;

  for (const arg of argv) {
    if (arg === "--help" || arg === "-h") {
      printUsage();
      process.exit(0);
    }

    if (arg === "--all") {
      selectedTargets = RUST_ANALYZER_BUNDLE_TARGETS;
      continue;
    }

    if (arg === "--dry-run") {
      dryRun = true;
      continue;
    }

    if (arg.startsWith("--version=")) {
      const value = arg.slice("--version=".length).trim();
      if (value.length > 0) {
        version = value;
      }
      continue;
    }

    if (arg.startsWith("--resources-root=")) {
      const value = arg.slice("--resources-root=".length).trim();
      if (value.length === 0) {
        throw new Error("--resources-root cannot be empty");
      }
      resourcesRoot = path.resolve(process.cwd(), value);
      continue;
    }

    if (arg.startsWith("--target=")) {
      const value = arg.slice("--target=".length).trim();
      if (value.length === 0) {
        throw new Error("--target cannot be empty");
      }
      selectedTargets = parseTargets(value);
      continue;
    }

    throw new Error(`unknown argument: ${arg}`);
  }

  if (selectedTargets.length === 0) {
    throw new Error("no targets selected");
  }

  return {
    version,
    resourcesRoot,
    targets: selectedTargets,
    dryRun
  };
};

const fetchBuffer = async (
  requestUrl: string,
  redirectCount = 0
): Promise<Buffer> => {
  if (redirectCount > 5) {
    throw new Error(`too many redirects: ${requestUrl}`);
  }

  return await new Promise<Buffer>((resolve, reject) => {
    const request = https.get(
      requestUrl,
      {
        headers: {
          "user-agent": "lyra-lsp-installer/1.0",
          accept: "application/vnd.github+json"
        }
      },
      (response) => {
        const statusCode = response.statusCode ?? 0;
        const location = response.headers.location;
        if (
          statusCode >= 300 &&
          statusCode < 400 &&
          typeof location === "string" &&
          location.length > 0
        ) {
          response.resume();
          void fetchBuffer(location, redirectCount + 1)
            .then(resolve)
            .catch(reject);
          return;
        }

        if (statusCode < 200 || statusCode >= 300) {
          response.resume();
          reject(new Error(`request failed (${statusCode}) ${requestUrl}`));
          return;
        }

        const chunks: Buffer[] = [];
        response.on("data", (chunk) => {
          chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
        });
        response.on("end", () => {
          resolve(Buffer.concat(chunks));
        });
      }
    );

    request.on("error", (error) => {
      reject(error);
    });
  });
};

const fetchJson = async <T>(requestUrl: string): Promise<T> => {
  const raw = await fetchBuffer(requestUrl);
  try {
    return JSON.parse(raw.toString("utf8")) as T;
  } catch (error) {
    throw new Error(`failed to parse json from ${requestUrl}: ${String(error)}`);
  }
};

const resolveRelease = async (version: string): Promise<GithubRelease> => {
  const endpoint =
    version === "latest"
      ? "https://api.github.com/repos/rust-lang/rust-analyzer/releases/latest"
      : `https://api.github.com/repos/rust-lang/rust-analyzer/releases/tags/${encodeURIComponent(
          version
        )}`;

  const release = await fetchJson<GithubRelease>(endpoint);
  if (typeof release.tag_name !== "string" || !Array.isArray(release.assets)) {
    throw new Error(`invalid release payload from ${endpoint}`);
  }
  return release;
};

const ensureDir = (dirPath: string): void => {
  fs.mkdirSync(dirPath, { recursive: true });
};

const writeExecutable = (targetPath: string, content: Buffer): void => {
  fs.writeFileSync(targetPath, content);
  if (process.platform !== "win32") {
    fs.chmodSync(targetPath, 0o755);
  }
};

const sha256 = (buffer: Buffer): string =>
  createHash("sha256").update(buffer).digest("hex");

const readStreamToBuffer = async (stream: Readable): Promise<Buffer> =>
  await new Promise<Buffer>((resolve, reject) => {
    const chunks: Buffer[] = [];
    stream.on("data", (chunk) => {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    });
    stream.on("error", reject);
    stream.on("end", () => resolve(Buffer.concat(chunks)));
  });

const extractZipEntry = async (
  archive: Buffer,
  entryName: string
): Promise<Buffer> => {
  const yauzl = await import("yauzl");
  return await new Promise<Buffer>((resolve, reject) => {
    yauzl.fromBuffer(
      archive,
      { lazyEntries: true },
      (openError, zipFile) => {
        if (openError !== null || zipFile === undefined) {
          reject(openError ?? new Error("failed to open zip archive"));
          return;
        }

        let settled = false;

        const resolveOnce = (buffer: Buffer): void => {
          if (settled) {
            return;
          }
          settled = true;
          resolve(buffer);
        };

        const rejectOnce = (error: unknown): void => {
          if (settled) {
            return;
          }
          settled = true;
          reject(error);
        };

        const closeWithError = (error: unknown): void => {
          zipFile.close();
          rejectOnce(error);
        };

        zipFile.on("entry", (entry) => {
          if (entry.fileName.endsWith("/")) {
            zipFile.readEntry();
            return;
          }

          const normalized = entry.fileName.replaceAll("\\\\", "/");
          if (normalized.endsWith(`/${entryName}`) === false && normalized !== entryName) {
            zipFile.readEntry();
            return;
          }

          zipFile.openReadStream(entry, (streamError, readStream) => {
            if (streamError !== null || readStream === undefined) {
              closeWithError(streamError ?? new Error("failed to open zip entry stream"));
              return;
            }
            void readStreamToBuffer(readStream)
              .then((buffer) => {
                zipFile.close();
                resolveOnce(buffer);
              })
              .catch(closeWithError);
          });
        });

        zipFile.on("error", closeWithError);
        zipFile.on("end", () => {
          rejectOnce(new Error(`zip entry not found: ${entryName}`));
        });

        zipFile.readEntry();
      }
    );
  });
};

const decodeAssetPayload = async (
  assetName: string,
  payload: Buffer,
  binaryFileName: string
): Promise<Buffer> => {
  if (assetName.endsWith(".gz")) {
    return zlib.gunzipSync(payload);
  }
  if (assetName.endsWith(".zip")) {
    return await extractZipEntry(payload, binaryFileName);
  }
  throw new Error(`unsupported rust-analyzer asset archive: ${assetName}`);
};

const installTarget = async (
  release: GithubRelease,
  target: RustAnalyzerBundleTarget,
  resourcesRoot: string,
  dryRun: boolean
): Promise<InstallRecord> => {
  const asset = release.assets.find(
    (entry) => entry.name === target.releaseAssetName
  );

  if (asset === undefined) {
    throw new Error(
      `missing asset '${target.releaseAssetName}' in release ${release.tag_name}`
    );
  }

  const relativePath = path.join(target.id, target.binaryFileName);
  const outputPath = path.join(resourcesRoot, relativePath);

  if (dryRun) {
    console.info(
      `[dry-run] ${target.id}: ${asset.browser_download_url} -> ${outputPath}`
    );
    return {
      id: target.id,
      platform: target.platform,
      arch: target.arch,
      assetName: asset.name,
      binaryFileName: target.binaryFileName,
      relativePath,
      sha256: "",
      sizeBytes: 0
    };
  }

  const archive = await fetchBuffer(asset.browser_download_url);
  const binary = await decodeAssetPayload(
    asset.name,
    archive,
    target.binaryFileName
  );

  ensureDir(path.dirname(outputPath));
  writeExecutable(outputPath, binary);

  console.info(
    `[installed] ${target.id} ${target.binaryFileName} (${binary.byteLength} bytes)`
  );

  return {
    id: target.id,
    platform: target.platform,
    arch: target.arch,
    assetName: asset.name,
    binaryFileName: target.binaryFileName,
    relativePath,
    sha256: sha256(binary),
    sizeBytes: binary.byteLength
  };
};

const writeManifest = (
  resourcesRoot: string,
  releaseTag: string,
  records: readonly InstallRecord[],
  dryRun: boolean
): void => {
  const manifest: InstallManifest = {
    schemaVersion: 1,
    source: "rust-lang/rust-analyzer",
    releaseTag,
    generatedAt: new Date().toISOString(),
    targets: records
  };

  const outputPath = path.join(resourcesRoot, "manifest-rust-analyzer.json");
  if (dryRun) {
    console.info(`[dry-run] write manifest ${outputPath}`);
    return;
  }
  ensureDir(resourcesRoot);
  fs.writeFileSync(outputPath, JSON.stringify(manifest, null, 2), "utf8");
  console.info(`[manifest] ${outputPath}`);
};

const main = async (): Promise<void> => {
  const options = parseArgs(process.argv.slice(2));
  console.info(
    `[lyra-lsp] installing rust-analyzer ${options.version} -> ${options.resourcesRoot}`
  );

  const release = await resolveRelease(options.version);
  console.info(`[lyra-lsp] resolved release ${release.tag_name}`);

  const records: InstallRecord[] = [];
  for (const target of options.targets) {
    const record = await installTarget(
      release,
      target,
      options.resourcesRoot,
      options.dryRun
    );
    records.push(record);
  }

  writeManifest(options.resourcesRoot, release.tag_name, records, options.dryRun);

  if (options.dryRun) {
    console.info("[lyra-lsp] dry-run completed");
  } else {
    console.info("[lyra-lsp] rust-analyzer bundle install completed");
  }
};

void main().catch((error) => {
  console.error(`[lyra-lsp] install failed: ${String(error)}`);
  process.exitCode = 1;
});
