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
const licenseIndexOut = path.join(outDir, "third-party-license-index.json");
const markdownOut = path.join(outDir, "THIRD-PARTY-NOTICES.md");
const nodeFilters = [
  "@lyra/desktop",
  "@lyra/markdown-render",
  "@lyra/site",
  "@lyra/docs-web"
] as const;
const checkOnly = process.argv.includes("--check");
const minimumEcosystemCounts = {
  npm: 50,
  cargo: 100
} as const;

const runJson = (command: string, args: readonly string[]): unknown => {
  const result = spawnSync(command, [...args], {
    cwd: repoRoot,
    encoding: "utf8",
    maxBuffer: 512 * 1024 * 1024
  });
  const invocation = [command, ...args].join(" ");
  if (result.error !== undefined) {
    throw new Error(`[legal] failed to run ${invocation}: ${result.error.message}`);
  }
  if (result.status !== 0) {
    const detail = result.stderr.trim() || result.stdout.trim() || "no command output";
    throw new Error(
      `[legal] ${invocation} exited with status ${result.status}: ${detail}`
    );
  }
  if (result.stdout.trim().length === 0) {
    throw new Error(`[legal] ${invocation} returned empty output`);
  }
  try {
    return JSON.parse(result.stdout) as unknown;
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`[legal] ${invocation} returned invalid JSON: ${detail}`);
  }
};

const readJson = <T>(file: string): T | null => {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8")) as T;
  } catch (_error) {
    return null;
  }
};

const normalizeLegalText = (text: string): string =>
  text
    .replace(/\r\n?/gu, "\n")
    .split("\n")
    .map((line) => line.trimEnd())
    .join("\n")
    .trim();

const readText = (relativePath: string | undefined): string | undefined => {
  if (relativePath === undefined) return undefined;
  const fullPath = path.join(repoRoot, relativePath);
  return fs.existsSync(fullPath)
    ? normalizeLegalText(fs.readFileSync(fullPath, "utf8"))
    : undefined;
};

const readPackageLegalFiles = (
  packagePath: string | undefined
): Pick<NoticeItem, "licenseText" | "noticeText"> => {
  if (packagePath === undefined || !fs.existsSync(packagePath)) return {};

  const files = fs.readdirSync(packagePath, { withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name)
    .sort((a, b) => a.localeCompare(b));
  const readFiles = (names: readonly string[]): string | undefined => {
    if (names.length === 0) return undefined;
    return names
      .map((name) => {
        const text = normalizeLegalText(fs.readFileSync(path.join(packagePath, name), "utf8"));
        return names.length === 1 ? text : `${name}\n\n${text}`;
      })
      .join("\n\n---\n\n");
  };

  return {
    licenseText: readFiles(files.filter((name) =>
      /^(?:licen[cs]e|copying|unlicense)(?:$|[._-])/iu.test(name)
    )),
    noticeText: readFiles(files.filter((name) =>
      /^(?:notice|copyright)(?:$|[._-])/iu.test(name)
    ))
  };
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

const noticeKey = (item: NoticeItem): string =>
  `${item.ecosystem}:${item.name}@${item.version ?? ""}`;

const isNoticeItem = (value: unknown): value is NoticeItem =>
  value !== null
  && typeof value === "object"
  && !Array.isArray(value)
  && typeof (value as Partial<NoticeItem>).name === "string"
  && typeof (value as Partial<NoticeItem>).ecosystem === "string"
  && typeof (value as Partial<NoticeItem>).license === "string";

const previousNoticeItems = (): NoticeItem[] => {
  const previous = readJson<GeneratedNoticesDocument>(jsonOut);
  return Array.isArray(previous?.items) && previous.items.every(isNoticeItem)
    ? previous.items
    : [];
};

const mergeCanonicalItems = (
  previous: readonly NoticeItem[],
  current: readonly NoticeItem[]
): NoticeItem[] => {
  const merged = new Map<string, NoticeItem>();
  for (const item of previous) merged.set(noticeKey(item), item);
  for (const item of current) merged.set(noticeKey(item), item);
  return sortItems(merged.values());
};

const assertCanonicalCoverage = (
  canonical: readonly NoticeItem[],
  current: readonly NoticeItem[]
): void => {
  const canonicalByKey = new Map(canonical.map((item) => [noticeKey(item), item]));
  const missing: string[] = [];
  const changed: string[] = [];
  for (const item of current) {
    const key = noticeKey(item);
    const existing = canonicalByKey.get(key);
    if (existing === undefined) {
      missing.push(key);
    } else if (JSON.stringify(existing) !== JSON.stringify(item)) {
      changed.push(key);
    }
  }
  if (missing.length === 0 && changed.length === 0) return;
  const describe = (label: string, entries: readonly string[]): void => {
    if (entries.length === 0) return;
    console.error(`[legal] canonical notices ${label} (${entries.length}):`);
    for (const entry of entries.slice(0, 30)) console.error(`  - ${entry}`);
    if (entries.length > 30) console.error(`  - ... and ${entries.length - 30} more`);
  };
  describe("missing current-platform dependencies", missing);
  describe("contain stale metadata for current-platform dependencies", changed);
  console.error("[legal] run pnpm legal:generate on this platform and commit the merged canonical notices");
  process.exitCode = 1;
};

const collectPnpmNode = (
  items: Map<string, NoticeItem>,
  node: PnpmDependencyNode,
  seen: Set<string>
): void => {
  if (node === null || typeof node !== "object" || Array.isArray(node)) {
    throw new Error("[legal] pnpm dependency tree contains a non-object node");
  }
  const name = node.from;
  const version = node.version;
  if (
    typeof name !== "string" ||
    name.trim().length === 0 ||
    typeof version !== "string" ||
    version.trim().length === 0
  ) {
    throw new Error(
      "[legal] pnpm dependency tree contains a node without a package name or version"
    );
  }
  if (
    node.dependencies !== undefined &&
    (
      node.dependencies === null ||
      typeof node.dependencies !== "object" ||
      Array.isArray(node.dependencies)
    )
  ) {
    throw new Error(
      `[legal] pnpm dependency tree for ${name}@${version} has an invalid dependencies map`
    );
  }
  const key = `${name}@${version}`;
  if (seen.has(key)) return;
  seen.add(key);

  const packageJson = node.path === undefined
    ? null
    : readJson<PackageJson>(path.join(node.path, "package.json"));
  const license = normalizeLicense(packageJson?.license ?? packageJson?.licenses);
  const legalFiles = readPackageLegalFiles(node.path);
  addItem(items, {
    name,
    version,
    ecosystem: "npm",
    license: license === "UNKNOWN" && legalFiles.licenseText !== undefined ? "SEE LICENSE" : license,
    source: node.resolved,
    repository: normalizeRepository(packageJson?.repository),
    homepage: typeof packageJson?.homepage === "string" ? packageJson.homepage : undefined,
    ...legalFiles
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
    if (!Array.isArray(payload) || payload.length === 0) {
      throw new Error(
        `[legal] pnpm dependency payload for ${filter} must be a non-empty array`
      );
    }
    let dependencyRoots = 0;
    for (const workspacePackage of payload) {
      if (
        workspacePackage === null ||
        typeof workspacePackage !== "object" ||
        Array.isArray(workspacePackage)
      ) {
        throw new Error(
          `[legal] pnpm dependency payload for ${filter} contains a non-object workspace entry`
        );
      }
      const dependencies = (workspacePackage as { readonly dependencies?: unknown }).dependencies;
      if (
        dependencies === null ||
        typeof dependencies !== "object" ||
        Array.isArray(dependencies)
      ) {
        throw new Error(
          `[legal] pnpm dependency payload for ${filter} is missing an object dependencies map`
        );
      }
      dependencyRoots += Object.keys(dependencies).length;
      for (const node of Object.values(dependencies as Record<string, PnpmDependencyNode>)) {
        collectPnpmNode(items, node, seen);
      }
    }
    if (dependencyRoots === 0) {
      throw new Error(
        `[legal] pnpm dependency payload for ${filter} contains no production dependencies`
      );
    }
  }
};

const collectCargoPackages = (items: Map<string, NoticeItem>): void => {
  const payload = runJson("cargo", [
    "metadata",
    "--locked",
    "--format-version",
    "1"
  ]);
  if (
    payload === null ||
    typeof payload !== "object" ||
    Array.isArray(payload) ||
    !Array.isArray((payload as Partial<CargoMetadata>).packages) ||
    !Array.isArray((payload as Partial<CargoMetadata>).workspace_members) ||
    typeof (payload as Partial<CargoMetadata>).workspace_root !== "string"
  ) {
    throw new Error(
      "[legal] cargo metadata payload is missing packages, workspace_members, or workspace_root"
    );
  }
  const metadata = payload as CargoMetadata;
  if (
    metadata.packages.length === 0 ||
    metadata.workspace_members.length === 0 ||
    metadata.workspace_root.trim().length === 0 ||
    metadata.workspace_members.some(
      (member) => typeof member !== "string" || member.trim().length === 0
    ) ||
    metadata.packages.some(
      (pkg) =>
        pkg === null ||
        typeof pkg !== "object" ||
        typeof pkg.id !== "string" ||
        pkg.id.trim().length === 0 ||
        typeof pkg.name !== "string" ||
        pkg.name.trim().length === 0 ||
        typeof pkg.version !== "string" ||
        pkg.version.trim().length === 0 ||
        typeof pkg.manifest_path !== "string" ||
        pkg.manifest_path.trim().length === 0 ||
        (pkg.license !== null && typeof pkg.license !== "string") ||
        (pkg.license_file !== null && typeof pkg.license_file !== "string") ||
        (pkg.source !== null && typeof pkg.source !== "string") ||
        (pkg.repository !== null && typeof pkg.repository !== "string") ||
        (pkg.homepage !== null && typeof pkg.homepage !== "string")
    )
  ) {
    throw new Error(
      "[legal] cargo metadata payload contains no packages/workspace members or has malformed package entries"
    );
  }
  const workspaceMembers = new Set(metadata.workspace_members);
  for (const pkg of metadata.packages) {
    const manifestPath = path.resolve(pkg.manifest_path);
    const isWorkspaceMember = workspaceMembers.has(pkg.id);
    const isThirdPartyPath = manifestPath.startsWith(path.join(repoRoot, "third-party") + path.sep);
    if (isWorkspaceMember || (pkg.source === null && !isThirdPartyPath)) continue;
    const legalFiles = readPackageLegalFiles(path.dirname(manifestPath));
    addItem(items, {
      name: pkg.name,
      version: pkg.version,
      ecosystem: isThirdPartyPath ? "vendored-rust" : "cargo",
      license: pkg.license ?? (pkg.license_file === null ? "UNKNOWN" : `SEE ${path.basename(pkg.license_file)}`),
      source: pkg.source ?? path.relative(repoRoot, manifestPath),
      repository: pkg.repository ?? undefined,
      homepage: pkg.homepage ?? undefined,
      ...legalFiles
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
    `${a.name}:${a.version ?? ""}:${a.ecosystem}`.localeCompare(
      `${b.name}:${b.version ?? ""}:${b.ecosystem}`
    )
  );

const ecosystemSummary = (items: readonly NoticeItem[]): Record<string, number> => {
  const summary: Record<string, number> = {};
  for (const item of items) summary[item.ecosystem] = (summary[item.ecosystem] ?? 0) + 1;
  return summary;
};

const assertEcosystemCompleteness = (items: readonly NoticeItem[]): void => {
  const summary = ecosystemSummary(items);
  for (const [ecosystem, minimum] of Object.entries(minimumEcosystemCounts)) {
    const actual = summary[ecosystem] ?? 0;
    if (actual < minimum) {
      throw new Error(
        `[legal] ${ecosystem} notice inventory is implausibly small: ${actual} < ${minimum}`
      );
    }
  }
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

const assertTextIsCurrent = (file: string, expected: string): void => {
  if (!fs.existsSync(file) || fs.readFileSync(file, "utf8") !== expected) {
    console.error(
      `[legal] ${path.relative(repoRoot, file)} is stale; run pnpm legal:generate`
    );
    process.exitCode = 1;
  }
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

const renderLicenseIndex = (
  items: readonly NoticeItem[],
  generatedAt: string
): string => {
  const grouped = new Map<
    string,
    Array<Pick<NoticeItem, "name" | "version" | "ecosystem">>
  >();

  for (const item of items) {
    const license = item.license.trim() || "UNKNOWN";
    const group = grouped.get(license) ?? [];
    group.push({
      name: item.name,
      version: item.version,
      ecosystem: item.ecosystem
    });
    grouped.set(license, group);
  }

  return `${JSON.stringify({
    schemaVersion: 1,
    generatedAt,
    packageCount: items.length,
    groups: [...grouped.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([license, groupItems]) => ({ license, items: groupItems }))
  }, null, 2)}\n`;
};

const main = (): void => {
  const items = new Map<string, NoticeItem>();
  collectNodePackages(items);
  collectCargoPackages(items);
  collectManualPackages(items);

  const current = sortItems(items.values());
  assertEcosystemCompleteness(current);
  const previous = previousNoticeItems();
  const sorted = checkOnly && previous.length > 0
    ? sortItems(previous)
    : mergeCanonicalItems(previous, current);
  if (checkOnly) assertCanonicalCoverage(sorted, current);
  const generatedAt = resolveGeneratedAt(sorted);
  const markdown = renderMarkdown(sorted, generatedAt);
  const licenseIndex = renderLicenseIndex(sorted, generatedAt);
  const document = {
    schemaVersion: 1,
    generatedAt,
    packageCount: sorted.length,
    ecosystems: ecosystemSummary(sorted),
    items: sorted,
    markdown
  };
  const json = `${JSON.stringify(document, null, 2)}\n`;

  if (checkOnly) {
    assertTextIsCurrent(jsonOut, json);
    assertTextIsCurrent(licenseIndexOut, licenseIndex);
    assertTextIsCurrent(markdownOut, markdown);
    if (process.exitCode === undefined) {
      console.log(`[legal] ${sorted.length} notices are current`);
    }
    return;
  }

  fs.mkdirSync(outDir, { recursive: true });
  writeTextIfChanged(jsonOut, json);
  writeTextIfChanged(licenseIndexOut, licenseIndex);
  writeTextIfChanged(markdownOut, markdown);
  console.log(`[legal] generated ${sorted.length} canonical notices`);
};

main();
