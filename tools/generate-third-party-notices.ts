import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

type NoticeItem = {
  readonly name: string;
  readonly version?: string;
  readonly ecosystem: string;
  readonly license: string;
  readonly source?: string;
  readonly repository?: string;
  readonly homepage?: string;
  readonly notes?: string;
  readonly licenseText?: string;
  readonly noticeText?: string;
};

type ManualNotice = NoticeItem & {
  readonly licensePath?: string;
  readonly noticePath?: string;
};

type PackageJson = {
  readonly name?: string;
  readonly version?: string;
  readonly license?: unknown;
  readonly licenses?: unknown;
  readonly repository?: unknown;
  readonly homepage?: unknown;
};

type PnpmDependencyNode = {
  readonly from?: string;
  readonly version?: string;
  readonly resolved?: string;
  readonly path?: string;
  readonly dependencies?: Record<string, PnpmDependencyNode>;
};

type CargoMetadata = {
  readonly packages: readonly {
    readonly id: string;
    readonly name: string;
    readonly version: string;
    readonly license: string | null;
    readonly license_file: string | null;
    readonly source: string | null;
    readonly manifest_path: string;
    readonly repository: string | null;
    readonly homepage: string | null;
  }[];
  readonly workspace_members: readonly string[];
  readonly workspace_root: string;
};

type GeneratedNoticesDocument = {
  readonly generatedAt?: unknown;
  readonly items?: unknown;
};

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, "..");
const outDir = path.join(repoRoot, "legal/generated");
const jsonOut = path.join(outDir, "third-party-notices.json");
const markdownOut = path.join(outDir, "THIRD-PARTY-NOTICES.md");
const nodeFilters = ["@lyra/desktop", "@lyra/markdown-render"] as const;

const runJson = (command: string, args: readonly string[]): unknown | null => {
  const result = spawnSync(command, [...args], {
    cwd: repoRoot,
    encoding: "utf8",
    maxBuffer: 512 * 1024 * 1024
  });
  if (result.status !== 0 || result.stdout.trim().length === 0) {
    return null;
  }
  return JSON.parse(result.stdout) as unknown;
};

const readJson = <T>(file: string): T | null => {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8")) as T;
  } catch (_error) {
    return null;
  }
};

const readText = (relativePath: string | undefined): string | undefined => {
  if (relativePath === undefined) return undefined;
  const fullPath = path.join(repoRoot, relativePath);
  return fs.existsSync(fullPath) ? fs.readFileSync(fullPath, "utf8") : undefined;
};

const readPackageLicenseText = (packagePath: string | undefined): string | undefined => {
  if (packagePath === undefined) return undefined;
  for (const filename of ["LICENSE", "LICENSE.md", "LICENSE.txt", "license", "COPYING"]) {
    const candidate = path.join(packagePath, filename);
    if (fs.existsSync(candidate)) {
      return fs.readFileSync(candidate, "utf8");
    }
  }
  return undefined;
};

const normalizeLicense = (value: unknown): string => {
  if (typeof value === "string" && value.trim().length > 0) return value.trim();
  if (Array.isArray(value)) {
    return value
      .map((entry) => normalizeLicense(entry))
      .filter((entry) => entry !== "UNKNOWN")
      .join(" OR ") || "UNKNOWN";
  }
  if (value !== null && typeof value === "object" && "type" in value) {
    return normalizeLicense((value as { readonly type?: unknown }).type);
  }
  return "UNKNOWN";
};

const normalizeRepository = (value: unknown): string | undefined => {
  if (typeof value === "string") return value;
  if (value !== null && typeof value === "object" && "url" in value) {
    const url = (value as { readonly url?: unknown }).url;
    return typeof url === "string" ? url : undefined;
  }
  return undefined;
};

const addItem = (items: Map<string, NoticeItem>, item: NoticeItem): void => {
  if (item.name.startsWith("@lyra/") || item.name.startsWith("lyra-")) return;
  const key = `${item.ecosystem}:${item.name}@${item.version ?? ""}`;
  items.set(key, item);
};

const collectPnpmNode = (
  items: Map<string, NoticeItem>,
  node: PnpmDependencyNode,
  seen: Set<string>
): void => {
  const name = node.from;
  const version = node.version;
  if (name === undefined || version === undefined) return;
  const key = `${name}@${version}`;
  if (seen.has(key)) return;
  seen.add(key);

  const packageJson = node.path === undefined
    ? null
    : readJson<PackageJson>(path.join(node.path, "package.json"));
  const license = normalizeLicense(packageJson?.license ?? packageJson?.licenses);
  const licenseText = readPackageLicenseText(node.path);
  addItem(items, {
    name,
    version,
    ecosystem: "npm",
    license: license === "UNKNOWN" && licenseText !== undefined ? "SEE LICENSE" : license,
    source: node.resolved,
    repository: normalizeRepository(packageJson?.repository),
    homepage: typeof packageJson?.homepage === "string" ? packageJson.homepage : undefined,
    licenseText: license === "UNKNOWN" ? licenseText : undefined
  });

  for (const child of Object.values(node.dependencies ?? {})) {
    collectPnpmNode(items, child, seen);
  }
};

const collectNodePackages = (items: Map<string, NoticeItem>): void => {
  const seen = new Set<string>();
  for (const filter of nodeFilters) {
    const payload = runJson("pnpm", [
      "--filter",
      filter,
      "list",
      "--prod",
      "--json",
      "--depth",
      "Infinity"
    ]);
    if (!Array.isArray(payload)) continue;
    for (const workspacePackage of payload) {
      const dependencies = (workspacePackage as { readonly dependencies?: unknown }).dependencies;
      if (dependencies === null || typeof dependencies !== "object") continue;
      for (const node of Object.values(dependencies as Record<string, PnpmDependencyNode>)) {
        collectPnpmNode(items, node, seen);
      }
    }
  }
};

const collectCargoPackages = (items: Map<string, NoticeItem>): void => {
  const metadata = runJson("cargo", ["metadata", "--locked", "--format-version", "1"]) as CargoMetadata | null;
  if (metadata === null) return;
  const workspaceMembers = new Set(metadata.workspace_members);
  for (const pkg of metadata.packages) {
    const manifestPath = path.resolve(pkg.manifest_path);
    const isWorkspaceMember = workspaceMembers.has(pkg.id);
    const isThirdPartyPath = manifestPath.startsWith(path.join(repoRoot, "third-party") + path.sep);
    if (isWorkspaceMember || (pkg.source === null && !isThirdPartyPath)) continue;
    addItem(items, {
      name: pkg.name,
      version: pkg.version,
      ecosystem: isThirdPartyPath ? "vendored-rust" : "cargo",
      license: pkg.license ?? (pkg.license_file === null ? "UNKNOWN" : `SEE ${path.basename(pkg.license_file)}`),
      source: pkg.source ?? path.relative(repoRoot, manifestPath),
      repository: pkg.repository ?? undefined,
      homepage: pkg.homepage ?? undefined
    });
  }
};

const collectManualPackages = (items: Map<string, NoticeItem>): void => {
  const manual = readJson<readonly ManualNotice[]>(path.join(repoRoot, "legal/manual-third-party.json")) ?? [];
  for (const entry of manual) {
    addItem(items, {
      name: entry.name,
      version: entry.version,
      ecosystem: entry.ecosystem,
      license: entry.license,
      source: entry.source,
      repository: entry.repository,
      homepage: entry.homepage,
      notes: entry.notes,
      licenseText: readText(entry.licensePath),
      noticeText: readText(entry.noticePath)
    });
  }
};

const sortItems = (items: Iterable<NoticeItem>): NoticeItem[] =>
  [...items].sort((a, b) =>
    `${a.ecosystem}:${a.name}:${a.version ?? ""}`.localeCompare(
      `${b.ecosystem}:${b.name}:${b.version ?? ""}`
    )
  );

const ecosystemSummary = (items: readonly NoticeItem[]): Record<string, number> => {
  const summary: Record<string, number> = {};
  for (const item of items) summary[item.ecosystem] = (summary[item.ecosystem] ?? 0) + 1;
  return summary;
};

const resolveGeneratedAt = (items: readonly NoticeItem[]): string => {
  const previous = readJson<GeneratedNoticesDocument>(jsonOut);
  if (
    typeof previous?.generatedAt === "string"
    && JSON.stringify(previous.items) === JSON.stringify(items)
  ) {
    return previous.generatedAt;
  }
  return new Date().toISOString();
};

const writeTextIfChanged = (file: string, content: string): void => {
  if (fs.existsSync(file) && fs.readFileSync(file, "utf8") === content) {
    return;
  }
  fs.writeFileSync(file, content);
};

const renderMarkdown = (items: readonly NoticeItem[], generatedAt: string): string => {
  const summary = ecosystemSummary(items);
  const lines = [
    "# Third-Party Notices",
    "",
    `Generated at: ${generatedAt}`,
    "",
    "This file is generated from package metadata plus `legal/manual-third-party.json`.",
    "",
    "## Summary",
    "",
    "| Ecosystem | Packages |",
    "| --- | ---: |",
    ...Object.entries(summary)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([ecosystem, count]) => `| ${ecosystem} | ${count} |`),
    "",
    "## Packages",
    ""
  ];

  for (const item of items) {
    lines.push(`### ${item.name}${item.version === undefined ? "" : ` ${item.version}`}`);
    lines.push("");
    lines.push(`- Ecosystem: ${item.ecosystem}`);
    lines.push(`- License: ${item.license}`);
    if (item.source !== undefined) lines.push(`- Source: ${item.source}`);
    if (item.repository !== undefined) lines.push(`- Repository: ${item.repository}`);
    if (item.homepage !== undefined) lines.push(`- Homepage: ${item.homepage}`);
    if (item.notes !== undefined) lines.push(`- Notes: ${item.notes}`);
    if (item.noticeText !== undefined) {
      lines.push("", "Notice:", "", "```text", item.noticeText.trim(), "```");
    }
    if (item.licenseText !== undefined) {
      lines.push("", "License text:", "", "```text", item.licenseText.trim(), "```");
    }
    lines.push("");
  }

  return `${lines.join("\n").trim()}\n`;
};

const main = (): void => {
  const items = new Map<string, NoticeItem>();
  collectNodePackages(items);
  collectCargoPackages(items);
  collectManualPackages(items);

  const sorted = sortItems(items.values());
  const generatedAt = resolveGeneratedAt(sorted);
  const markdown = renderMarkdown(sorted, generatedAt);
  const document = {
    schemaVersion: 1,
    generatedAt,
    packageCount: sorted.length,
    ecosystems: ecosystemSummary(sorted),
    items: sorted,
    markdown
  };

  fs.mkdirSync(outDir, { recursive: true });
  writeTextIfChanged(jsonOut, `${JSON.stringify(document, null, 2)}\n`);
  writeTextIfChanged(markdownOut, markdown);
  console.log(`[legal] generated ${sorted.length} notices`);
};

main();
