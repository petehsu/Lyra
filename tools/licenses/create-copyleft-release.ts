import { createHash } from "node:crypto";
import {
  cp,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readlink,
  readdir,
  writeFile
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";

type AriaManifest = {
  readonly bundleVersion: string;
  readonly target: string;
  readonly binary: string;
  readonly packages: readonly string[];
  readonly files: readonly { readonly path: string; readonly sha256: string }[];
};

type PackageRecord = {
  readonly archive: string;
  readonly archiveSha256: string;
  readonly archiveUrl: string;
  readonly name: string;
  readonly version: string;
  readonly build: string;
  readonly license: string;
  readonly feedstockUrl: string | null;
  readonly feedstockCommit: string | null;
  readonly source: SourceRecord | null;
};

type SourceRecord = {
  readonly archive: string;
  readonly sha256: string;
  readonly recipePath: string;
  readonly url: string;
};

const COPYLEFT_PACKAGES = new Set(["aria2", "gmp", "libiconv"]);
const CONDA_SUBDIRS: Readonly<Record<string, string>> = {
  "darwin-x64": "osx-64",
  "darwin-arm64": "osx-arm64",
  "linux-x64": "linux-64",
  "linux-arm64": "linux-aarch64"
};

const argument = (name: string): string => {
  const index = process.argv.indexOf(name);
  const value = index < 0 ? undefined : process.argv[index + 1];
  if (value === undefined || value.startsWith("--")) {
    throw new Error(`Missing required argument: ${name}`);
  }
  return value;
};

const optionalArgument = (name: string): string | null => {
  const index = process.argv.indexOf(name);
  const value = index < 0 ? undefined : process.argv[index + 1];
  return value === undefined || value.startsWith("--") ? null : value;
};

const sha256 = (bytes: Uint8Array): string =>
  createHash("sha256").update(bytes).digest("hex");

const writeDownloadedFile = async (
  url: string,
  output: string,
  proxy: string | null
): Promise<Uint8Array> => {
  await mkdir(path.dirname(output), { recursive: true });
  const proxyArguments = proxy === null ? [] : ["--proxy", proxy];
  execFileSync(
    "curl",
    [
      "--fail",
      "--location",
      "--retry",
      "4",
      "--retry-all-errors",
      ...proxyArguments,
      "--output",
      output,
      url
    ],
    { stdio: "inherit" }
  );
  return readFile(output);
};

const walk = async (root: string): Promise<string[]> => {
  const files: string[] = [];
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const candidate = path.join(root, entry.name);
    if (entry.isDirectory()) files.push(...(await walk(candidate)));
    else files.push(candidate);
  }
  return files;
};

const extractCondaInfo = async (archive: string, root: string): Promise<string> => {
  const envelope = path.join(root, "envelope");
  const extracted = path.join(root, "extracted");
  await mkdir(envelope, { recursive: true });
  await mkdir(extracted, { recursive: true });
  execFileSync("bsdtar", ["-xf", archive, "-C", envelope], { stdio: "inherit" });
  const infoArchive = (await readdir(envelope)).find(
    (entry) => entry.startsWith("info-") && entry.endsWith(".tar.zst")
  );
  if (infoArchive === undefined) {
    throw new Error(`Conda package has no info archive: ${path.basename(archive)}`);
  }
  execFileSync("bsdtar", ["-xf", path.join(envelope, infoArchive), "-C", extracted], {
    stdio: "inherit"
  });
  return extracted;
};

const sourceFromRecipe = async (
  recipeRoot: string
): Promise<{ readonly url: string; readonly sha256: string; readonly recipePath: string }> => {
  const candidates = ["rendered_recipe.yaml", "meta.yaml", "recipe.yaml"];
  for (const name of candidates) {
    const candidate = path.join(recipeRoot, name);
    let text: string;
    try {
      text = await readFile(candidate, "utf8");
    } catch {
      continue;
    }
    const lines = text.split(/\r?\n/);
    const sourceIndex = lines.findIndex((line) => line.trim() === "source:");
    if (sourceIndex < 0) continue;
    const sourceIndent = lines[sourceIndex]?.match(/^\s*/u)?.[0].length ?? 0;
    const sourceLines: string[] = [];
    for (const line of lines.slice(sourceIndex + 1)) {
      const trimmed = line.trim();
      const indent = line.match(/^\s*/u)?.[0].length ?? 0;
      if (trimmed !== "" && indent <= sourceIndent && !trimmed.startsWith("-")) break;
      sourceLines.push(line);
    }
    const section = sourceLines.join("\n");
    const digest = section.match(/sha256:\s*([a-f0-9]{64})/iu)?.[1]?.toLowerCase();
    const urls = [...section.matchAll(/https?:\/\/[^\s'"\]}]+/giu)]
      .map((match) => match[0])
      .filter((url) => !url.includes("{{"));
    if (digest !== undefined && urls.length > 0) {
      const url = urls[0]!.replace(/^http:\/\/ftp\.gnu\.org\//u, "https://ftp.gnu.org/");
      return { url, sha256: digest, recipePath: name };
    }
  }
  throw new Error(`Unable to resolve a fixed source URL and SHA-256 from ${recipeRoot}`);
};

const condaDistribution = async (
  name: string,
  version: string,
  subdir: string,
  archive: string
): Promise<{ readonly sha256: string; readonly url: string }> => {
  const response = await fetch(
    `https://api.anaconda.org/release/conda-forge/${encodeURIComponent(name)}/${encodeURIComponent(version)}`
  );
  if (!response.ok) {
    throw new Error(`Unable to inspect conda-forge release ${name} ${version}: HTTP ${response.status}`);
  }
  const release = (await response.json()) as {
    readonly distributions?: readonly {
      readonly basename?: string;
      readonly download_url?: string;
      readonly sha256?: string;
    }[];
  };
  const distribution = release.distributions?.find(
    (entry) => entry.basename === `${subdir}/${archive}`
  );
  if (distribution?.sha256 === undefined || distribution.download_url === undefined) {
    throw new Error(`Conda-forge metadata does not contain ${subdir}/${archive}`);
  }
  const url = distribution.download_url.startsWith("//")
    ? `https:${distribution.download_url}`
    : distribution.download_url;
  return { sha256: distribution.sha256.toLowerCase(), url };
};

const archiveDirectory = (root: string, output: string): void => {
  execFileSync("bsdtar", ["--zstd", "-cf", output, "-C", root, "."], {
    env: { ...process.env, COPYFILE_DISABLE: "1" },
    stdio: "inherit"
  });
};

const renderRelinkingReport = async (bundleRoot: string): Promise<string> => {
  const entries = [path.join(bundleRoot, "bin", "aria2c")];
  const libRoot = path.join(bundleRoot, "lib");
  for (const entry of await readdir(libRoot)) entries.push(path.join(libRoot, entry));
  const sections: string[] = [];
  for (const entry of entries.sort()) {
    const metadata = await lstat(entry);
    if (metadata.isSymbolicLink()) {
      sections.push(`${path.relative(bundleRoot, entry)} -> ${await readlink(entry)}`);
      continue;
    }
    if (!metadata.isFile()) continue;
    const output = execFileSync("otool", ["-L", entry], { encoding: "utf8" });
    sections.push(output.trim());
  }
  const symlinks = execFileSync("find", [bundleRoot, "-type", "l", "-exec", "ls", "-l", "{}", ";"], {
    encoding: "utf8"
  });
  return `# macOS dynamic-link and relinking evidence\n\nGenerated from the exact staged darwin-x64 bundle. aria2 is executed as a separate process by Lyra. The conveyed GMP and libiconv libraries are dynamically linked and the bundle preserves their replacement symlinks.\n\n## otool -L\n\n\`\`\`text\n${sections.join("\n\n")}\n\`\`\`\n\n## Preserved symlinks\n\n\`\`\`text\n${symlinks.trim()}\n\`\`\`\n`;
};

const main = async (): Promise<void> => {
  const repository = path.resolve(argument("--repository"));
  const target = argument("--target");
  const releaseVersion = argument("--release-version");
  const releaseTag = argument("--release-tag");
  const output = path.resolve(argument("--out"));
  const proxy = optionalArgument("--proxy");
  const subdir = CONDA_SUBDIRS[target];
  if (subdir === undefined) throw new Error(`Unsupported conda target: ${target}`);

  const bundleRoot = path.join(repository, "apps", "desktop", "resources", "aria2", target);
  const manifestPath = path.join(bundleRoot, "manifest.json");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as AriaManifest;
  if (manifest.target !== target || !manifest.packages?.length) {
    throw new Error(`The frozen aria2 manifest does not match ${target}`);
  }

  const temporary = await mkdtemp(path.join(os.tmpdir(), `lyra-copyleft-${target}-`));
  const evidenceRoot = path.join(temporary, "package-evidence");
  const sourceRoot = path.join(temporary, "corresponding-source");
  await mkdir(path.join(evidenceRoot, "packages"), { recursive: true });
  await mkdir(path.join(evidenceRoot, "info"), { recursive: true });
  await mkdir(path.join(sourceRoot, "sources"), { recursive: true });
  await mkdir(path.join(sourceRoot, "recipes"), { recursive: true });
  await cp(manifestPath, path.join(evidenceRoot, "aria2-manifest.json"));
  await cp(manifestPath, path.join(sourceRoot, "aria2-manifest.json"));

  const records: PackageRecord[] = [];
  for (const archiveName of manifest.packages) {
    const directUrl = `https://conda.anaconda.org/conda-forge/${subdir}/${archiveName}`;
    const downloaded = path.join(temporary, "downloads", archiveName);
    const bytes = await writeDownloadedFile(directUrl, downloaded, proxy);
    const infoRoot = await extractCondaInfo(downloaded, path.join(temporary, "extract", archiveName));
    const index = JSON.parse(await readFile(path.join(infoRoot, "info", "index.json"), "utf8")) as {
      readonly name: string;
      readonly version: string;
      readonly build: string;
      readonly license?: string;
    };
    const about = JSON.parse(await readFile(path.join(infoRoot, "info", "about.json"), "utf8")) as {
      readonly license?: string;
      readonly extra?: { readonly remote_url?: string; readonly sha?: string };
    };
    const distribution = await condaDistribution(index.name, index.version, subdir, archiveName);
    const packageDigest = sha256(bytes);
    if (packageDigest !== distribution.sha256) {
      throw new Error(`SHA-256 mismatch for ${archiveName}`);
    }
    await cp(downloaded, path.join(evidenceRoot, "packages", archiveName));
    await cp(path.join(infoRoot, "info"), path.join(evidenceRoot, "info", archiveName), {
      recursive: true
    });

    let source: SourceRecord | null = null;
    if (COPYLEFT_PACKAGES.has(index.name)) {
      const recipeRoot = path.join(infoRoot, "info", "recipe");
      const fixedSource = await sourceFromRecipe(recipeRoot);
      const sourceName = path.basename(new URL(fixedSource.url).pathname);
      const sourceBytes = await writeDownloadedFile(
        fixedSource.url,
        path.join(sourceRoot, "sources", sourceName),
        proxy
      );
      if (sha256(sourceBytes) !== fixedSource.sha256) {
        throw new Error(`Source SHA-256 mismatch for ${index.name}`);
      }
      await cp(recipeRoot, path.join(sourceRoot, "recipes", archiveName), { recursive: true });
      source = {
        archive: sourceName,
        sha256: fixedSource.sha256,
        recipePath: `recipes/${archiveName}/${fixedSource.recipePath}`,
        url: fixedSource.url
      };
    }
    records.push({
      archive: archiveName,
      archiveSha256: packageDigest,
      archiveUrl: distribution.url,
      name: index.name,
      version: index.version,
      build: index.build,
      license: about.license ?? index.license ?? "unknown",
      feedstockUrl: about.extra?.remote_url ?? null,
      feedstockCommit: about.extra?.sha ?? null,
      source
    });
  }

  const mapping = {
    schemaVersion: 1,
    releaseVersion,
    target,
    bundleVersion: manifest.bundleVersion,
    generatedAt: new Date().toISOString(),
    packages: records
  };
  await writeFile(path.join(evidenceRoot, "mapping.v1.json"), `${JSON.stringify(mapping, null, 2)}\n`);
  await writeFile(path.join(sourceRoot, "mapping.v1.json"), `${JSON.stringify(mapping, null, 2)}\n`);
  await writeFile(path.join(sourceRoot, "RELINKING.md"), await renderRelinkingReport(bundleRoot));
  await writeFile(
    path.join(sourceRoot, "REBUILD.md"),
    `# Rebuild and replacement instructions\n\nThis archive corresponds to Lyra Desktop ${releaseVersion} for ${target}. It contains the exact upstream source archives, hashes, and conda-forge recipes for aria2, GMP, and libiconv conveyed by the frozen aria2 bundle.\n\n1. Verify every source and package digest against \`mapping.v1.json\`.\n2. Rebuild each package with the recipe and target/toolchain recorded under \`recipes/\`; the extracted package evidence archive contains the complete rendered recipe, build script, variant configuration, patches, licenses, and dependency solution.\n3. Install the rebuilt dynamic libraries under the bundle's \`lib/\` directory while preserving the install names and symlink names listed in \`RELINKING.md\`.\n4. Run \`otool -L bin/aria2c lib/*.dylib\` and \`aria2c --version\` before use.\n\nLyra starts aria2 as a separate executable and communicates through aria2's RPC/command boundary. Lyra proprietary source is not required to rebuild or replace these separately conveyed components.\n`
  );

  await mkdir(output, { recursive: true });
  const sourceArchive = `lyra-copyleft-source-${releaseVersion}-${target}.tar.zst`;
  const evidenceArchive = `lyra-package-evidence-${releaseVersion}-${target}.tar.zst`;
  archiveDirectory(sourceRoot, path.join(output, sourceArchive));
  archiveDirectory(evidenceRoot, path.join(output, evidenceArchive));

  const releaseBase = `https://github.com/petehsu/lyra-releases/releases/download/${releaseTag}`;
  const offerName = `SOURCE-OFFER-${releaseVersion}-${target}.md`;
  await writeFile(
    path.join(output, offerName),
    `# Lyra ${releaseVersion} ${target} corresponding source\n\nThe Lyra installer for this target conveys aria2 1.37.0 and dynamically linked third-party libraries. Exact corresponding source, conda package evidence, recipes, patches, license texts, hashes, and relinking instructions are available without charge beside the binary release:\n\n- [Corresponding source](${releaseBase}/${sourceArchive})\n- [Exact package and license evidence](${releaseBase}/${evidenceArchive})\n- [Canonical third-party notices](${releaseBase}/Lyra-${target}-THIRD-PARTY-NOTICES.md)\n\nThese assets correspond only to Lyra Desktop ${releaseVersion} for ${target}. They do not grant a license to Lyra's proprietary code. For source-access problems, contact x13102306563@gmail.com or another personal contact method listed at https://lyra.ltd/.\n`
  );

  const checksumName = `COPYLEFT-SHA256SUMS-${releaseVersion}-${target}`;
  const publicFiles = [sourceArchive, evidenceArchive, offerName];
  const checksumLines: string[] = [];
  for (const name of publicFiles.sort()) {
    checksumLines.push(`${sha256(await readFile(path.join(output, name)))}  ${name}`);
  }
  await writeFile(path.join(output, checksumName), `${checksumLines.join("\n")}\n`);
  process.stdout.write(
    `${JSON.stringify({ output, sourceArchive, evidenceArchive, offerName, checksumName, packages: records.length }, null, 2)}\n`
  );
};

main().catch((error: unknown) => {
  process.stderr.write(
    `lyra-copyleft-release: ${error instanceof Error ? error.stack ?? error.message : String(error)}\n`
  );
  process.exitCode = 1;
});
