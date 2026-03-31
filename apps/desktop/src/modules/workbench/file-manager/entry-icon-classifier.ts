import type { FileManagerEntry, FileManagerTrashEntry } from "../../../shared/file-manager";

export type FileManagerEntryIconKind =
  | "directory-empty"
  | "directory-non-empty"
  | "package-manifest"
  | "dependency-lock"
  | "config"
  | "workflow"
  | "container"
  | "git-meta"
  | "secret"
  | "typescript"
  | "javascript"
  | "rust"
  | "python"
  | "shell"
  | "code-generic"
  | "json-data"
  | "database"
  | "spreadsheet"
  | "presentation"
  | "document"
  | "markdown"
  | "image"
  | "video"
  | "audio"
  | "archive"
  | "font"
  | "binary"
  | "certificate"
  | "diff"
  | "unknown";

type FileIconContext = {
  readonly name: string;
  readonly path: string;
  readonly extension: string;
};

type FileNamePrefixRule = {
  readonly prefix: string;
  readonly iconKind: FileManagerEntryIconKind;
};

type FileNameSuffixRule = {
  readonly suffix: string;
  readonly iconKind: FileManagerEntryIconKind;
};

type FileNameIncludesRule = {
  readonly needle: string;
  readonly iconKind: FileManagerEntryIconKind;
};

type PathRule = {
  readonly pattern: RegExp;
  readonly extension: string | null;
  readonly iconKind: FileManagerEntryIconKind;
};

const EXACT_FILE_NAME_RULES: Readonly<Record<string, FileManagerEntryIconKind>> = {
  "dockerfile": "container",
  "containerfile": "container",
  "docker-compose.yml": "container",
  "docker-compose.yaml": "container",
  "compose.yml": "container",
  "compose.yaml": "container",
  "makefile": "config",
  "cmakelists.txt": "config",
  "meson.build": "config",
  "justfile": "config",
  ".env": "secret",
  ".gitignore": "git-meta",
  ".gitattributes": "git-meta",
  ".gitmodules": "git-meta",
  "package.json": "package-manifest",
  "package-lock.json": "dependency-lock",
  "npm-shrinkwrap.json": "dependency-lock",
  "yarn.lock": "dependency-lock",
  "pnpm-lock.yaml": "dependency-lock",
  "bun.lockb": "dependency-lock",
  "cargo.lock": "dependency-lock",
  "cargo.toml": "package-manifest",
  "go.mod": "package-manifest",
  "go.sum": "dependency-lock",
  "pyproject.toml": "package-manifest",
  "pipfile": "package-manifest",
  "pipfile.lock": "dependency-lock",
  "poetry.lock": "dependency-lock",
  "gemfile": "package-manifest",
  "gemfile.lock": "dependency-lock",
  "composer.json": "package-manifest",
  "composer.lock": "dependency-lock",
  "podfile": "package-manifest",
  "podfile.lock": "dependency-lock",
  "requirements.txt": "package-manifest",
  "readme": "markdown",
  "readme.md": "markdown",
  "changelog": "markdown",
  "changelog.md": "markdown",
  "license": "document",
  "license.md": "document",
  "copying": "document",
  "notice": "document",
  "tsconfig.json": "config",
  "jsconfig.json": "config",
  "biome.json": "config",
  "deno.json": "config",
  "deno.jsonc": "config",
  "eslint.config.js": "config",
  "eslint.config.cjs": "config",
  "eslint.config.mjs": "config",
  "eslint.config.ts": "config",
  "prettier.config.js": "config",
  "prettier.config.cjs": "config",
  "prettier.config.mjs": "config",
  "prettier.config.ts": "config",
  "vitest.config.ts": "config",
  "vite.config.ts": "config",
  "webpack.config.js": "config",
  "rollup.config.js": "config",
  "tailwind.config.js": "config",
  "tailwind.config.ts": "config",
  "postcss.config.js": "config",
  "postcss.config.cjs": "config"
};

const FILE_NAME_PREFIX_RULES: readonly FileNamePrefixRule[] = [
  { prefix: ".env.", iconKind: "secret" },
  { prefix: "readme.", iconKind: "markdown" },
  { prefix: "changelog.", iconKind: "markdown" },
  { prefix: "license.", iconKind: "document" },
  { prefix: "dockerfile.", iconKind: "container" },
  { prefix: "compose.", iconKind: "container" },
  { prefix: "tsconfig.", iconKind: "config" },
  { prefix: "jsconfig.", iconKind: "config" },
  { prefix: "eslint.", iconKind: "config" },
  { prefix: "prettier.", iconKind: "config" }
];

const FILE_NAME_SUFFIX_RULES: readonly FileNameSuffixRule[] = [
  { suffix: ".config.ts", iconKind: "config" },
  { suffix: ".config.mts", iconKind: "config" },
  { suffix: ".config.cts", iconKind: "config" },
  { suffix: ".config.js", iconKind: "config" },
  { suffix: ".config.mjs", iconKind: "config" },
  { suffix: ".config.cjs", iconKind: "config" },
  { suffix: ".config.json", iconKind: "config" },
  { suffix: ".config.yaml", iconKind: "config" },
  { suffix: ".config.yml", iconKind: "config" },
  { suffix: ".schema.json", iconKind: "config" },
  { suffix: ".spec.ts", iconKind: "typescript" },
  { suffix: ".test.ts", iconKind: "typescript" },
  { suffix: ".spec.tsx", iconKind: "typescript" },
  { suffix: ".test.tsx", iconKind: "typescript" },
  { suffix: ".spec.js", iconKind: "javascript" },
  { suffix: ".test.js", iconKind: "javascript" },
  { suffix: ".d.ts", iconKind: "typescript" },
  { suffix: ".lock", iconKind: "dependency-lock" },
  { suffix: ".pem", iconKind: "certificate" },
  { suffix: ".crt", iconKind: "certificate" },
  { suffix: ".cer", iconKind: "certificate" },
  { suffix: ".key", iconKind: "secret" }
];

const FILE_NAME_INCLUDES_RULES: readonly FileNameIncludesRule[] = [
  { needle: "docker-compose", iconKind: "container" },
  { needle: "compose", iconKind: "container" },
  { needle: "workflow", iconKind: "workflow" },
  { needle: "migration", iconKind: "database" },
  { needle: "schema", iconKind: "database" },
  { needle: "seed", iconKind: "database" },
  { needle: "secret", iconKind: "secret" },
  { needle: "token", iconKind: "secret" },
  { needle: "credential", iconKind: "secret" }
];

const PATH_RULES: readonly PathRule[] = [
  { pattern: /\/\.github\/workflows\//, extension: "yml", iconKind: "workflow" },
  { pattern: /\/\.github\/workflows\//, extension: "yaml", iconKind: "workflow" },
  { pattern: /\/\.git\//, extension: null, iconKind: "git-meta" },
  { pattern: /\/migrations?\//, extension: "sql", iconKind: "database" },
  { pattern: /\/db\//, extension: "sql", iconKind: "database" },
  { pattern: /\/k8s\//, extension: "yml", iconKind: "container" },
  { pattern: /\/k8s\//, extension: "yaml", iconKind: "container" },
  { pattern: /\/kubernetes\//, extension: "yml", iconKind: "container" },
  { pattern: /\/kubernetes\//, extension: "yaml", iconKind: "container" }
];

const EXTENSION_ICON_RULES: Readonly<Record<string, FileManagerEntryIconKind>> = {
  ts: "typescript",
  tsx: "typescript",
  mts: "typescript",
  cts: "typescript",
  js: "javascript",
  jsx: "javascript",
  mjs: "javascript",
  cjs: "javascript",
  rs: "rust",
  py: "python",
  pyi: "python",
  ipynb: "python",
  go: "code-generic",
  java: "code-generic",
  kt: "code-generic",
  kts: "code-generic",
  swift: "code-generic",
  c: "code-generic",
  h: "code-generic",
  hh: "code-generic",
  hpp: "code-generic",
  hxx: "code-generic",
  cc: "code-generic",
  cpp: "code-generic",
  cxx: "code-generic",
  cs: "code-generic",
  fs: "code-generic",
  fsx: "code-generic",
  php: "code-generic",
  rb: "code-generic",
  lua: "code-generic",
  ex: "code-generic",
  exs: "code-generic",
  hs: "code-generic",
  zig: "code-generic",
  r: "code-generic",
  dart: "code-generic",
  ml: "code-generic",
  mli: "code-generic",
  sh: "shell",
  bash: "shell",
  zsh: "shell",
  fish: "shell",
  ksh: "shell",
  ps1: "shell",
  psm1: "shell",
  bat: "shell",
  cmd: "shell",
  sql: "database",
  sqlite: "database",
  sqlite3: "database",
  db: "database",
  db3: "database",
  duckdb: "database",
  parquet: "database",
  avro: "database",
  orc: "database",
  csv: "spreadsheet",
  tsv: "spreadsheet",
  xls: "spreadsheet",
  xlsx: "spreadsheet",
  ods: "spreadsheet",
  ppt: "presentation",
  pptx: "presentation",
  key: "presentation",
  md: "markdown",
  mdx: "markdown",
  rst: "markdown",
  adoc: "markdown",
  txt: "document",
  doc: "document",
  docx: "document",
  odt: "document",
  rtf: "document",
  pdf: "document",
  png: "image",
  jpg: "image",
  jpeg: "image",
  webp: "image",
  gif: "image",
  bmp: "image",
  tiff: "image",
  tif: "image",
  avif: "image",
  heic: "image",
  ico: "image",
  svg: "image",
  mp4: "video",
  m4v: "video",
  mkv: "video",
  webm: "video",
  mov: "video",
  avi: "video",
  wmv: "video",
  flv: "video",
  mp3: "audio",
  m4a: "audio",
  wav: "audio",
  flac: "audio",
  aac: "audio",
  ogg: "audio",
  opus: "audio",
  zip: "archive",
  rar: "archive",
  "7z": "archive",
  tar: "archive",
  gz: "archive",
  tgz: "archive",
  bz2: "archive",
  xz: "archive",
  zst: "archive",
  jar: "archive",
  war: "archive",
  ear: "archive",
  iso: "archive",
  woff: "font",
  woff2: "font",
  ttf: "font",
  otf: "font",
  eot: "font",
  json: "json-data",
  jsonc: "json-data",
  json5: "json-data",
  yaml: "config",
  yml: "config",
  toml: "config",
  ini: "config",
  cfg: "config",
  conf: "config",
  env: "secret",
  lock: "dependency-lock",
  pem: "certificate",
  crt: "certificate",
  cer: "certificate",
  p12: "certificate",
  pfx: "certificate",
  gpg: "certificate",
  asc: "certificate",
  sig: "certificate",
  exe: "binary",
  dll: "binary",
  so: "binary",
  dylib: "binary",
  a: "binary",
  o: "binary",
  obj: "binary",
  class: "binary",
  wasm: "binary",
  bin: "binary",
  out: "binary",
  appimage: "binary",
  deb: "binary",
  rpm: "binary",
  msi: "binary",
  dmg: "binary",
  patch: "diff",
  diff: "diff"
};

const normalizeName = (value: string | undefined): string =>
  value?.trim().toLowerCase() ?? "";

const normalizePath = (value: string | undefined): string =>
  (value?.trim().replaceAll("\\", "/").toLowerCase() ?? "");

const normalizeExtension = (value: string | undefined): string =>
  value?.trim().replace(/^\./, "").toLowerCase() ?? "";

const deriveExtensionFromName = (name: string): string => {
  if (name.startsWith(".") && name.indexOf(".", 1) === -1) {
    return "";
  }
  const dotIndex = name.lastIndexOf(".");
  if (dotIndex <= 0 || dotIndex === name.length - 1) {
    return "";
  }
  return name.slice(dotIndex + 1);
};

const resolveFileContext = (entry: FileManagerEntry | FileManagerTrashEntry): FileIconContext => {
  const name = normalizeName(entry.name);
  const path = normalizePath("path" in entry ? entry.path : entry.trashedPath ?? entry.originalPath ?? entry.name);
  const extension = normalizeExtension(entry.extension) || deriveExtensionFromName(name);
  return { name, path, extension };
};

const resolveByNameRules = (context: FileIconContext): FileManagerEntryIconKind | null => {
  const exactMatch = EXACT_FILE_NAME_RULES[context.name];
  if (exactMatch !== undefined) {
    return exactMatch;
  }

  for (const rule of FILE_NAME_PREFIX_RULES) {
    if (context.name.startsWith(rule.prefix)) {
      return rule.iconKind;
    }
  }

  for (const rule of FILE_NAME_SUFFIX_RULES) {
    if (context.name.endsWith(rule.suffix)) {
      return rule.iconKind;
    }
  }

  for (const rule of FILE_NAME_INCLUDES_RULES) {
    if (context.name.includes(rule.needle)) {
      return rule.iconKind;
    }
  }

  return null;
};

const resolveByPathRules = (context: FileIconContext): FileManagerEntryIconKind | null => {
  if (context.path.length === 0) {
    return null;
  }
  for (const rule of PATH_RULES) {
    if (rule.pattern.test(context.path) && (rule.extension === null || rule.extension === context.extension)) {
      return rule.iconKind;
    }
  }
  return null;
};

const resolveByExtensionRules = (context: FileIconContext): FileManagerEntryIconKind => {
  const extensionKind = EXTENSION_ICON_RULES[context.extension];
  if (extensionKind !== undefined) {
    return extensionKind;
  }
  return "unknown";
};

export const resolveFileManagerEntryIconKind = (
  entry: FileManagerEntry | FileManagerTrashEntry
): FileManagerEntryIconKind => {
  if (entry.kind === "directory") {
    const folderState = entry.folderState;
    return folderState === "empty"
      ? "directory-empty"
      : "directory-non-empty";
  }

  const context = resolveFileContext(entry);
  return (
    resolveByPathRules(context)
    ?? resolveByNameRules(context)
    ?? resolveByExtensionRules(context)
  );
};
