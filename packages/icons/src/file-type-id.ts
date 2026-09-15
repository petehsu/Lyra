import { VSCODE_ICON_NAMES } from "./vscode-icon-names";

export type FileTypeIconKind = "file" | "folder" | "folder-open";

const hasIcon = (name: string): boolean => VSCODE_ICON_NAMES.has(name);

const firstAvailable = (candidates: readonly string[], fallback: string): string => {
  for (const candidate of candidates) {
    if (hasIcon(candidate)) {
      return `vscode-icons:${candidate}`;
    }
  }
  return `vscode-icons:${fallback}`;
};

const basenameOf = (input: string): string => {
  const trimmed = input.trim();
  if (trimmed.length === 0) {
    return "";
  }
  const parts = trimmed.split(/[\\/]/u);
  return (parts.at(-1) ?? trimmed).toLocaleLowerCase();
};

const FILE_TYPE_BY_KEY = (() => {
  const map = new Map<string, string>();
  for (const name of VSCODE_ICON_NAMES) {
    if (!name.startsWith("file-type-")) {
      continue;
    }
    const key = name
      .slice("file-type-".length)
      .replace(/_light$/u, "")
      .replace(/\d+$/u, "");
    if (key.length > 0 && map.has(key) === false) {
      map.set(key, name);
    }
  }
  return map;
})();

const EXTENSION_ALIASES: Readonly<Record<string, readonly string[]>> = {
  "7z": ["file-type-zip"],
  aac: ["file-type-audio"],
  avi: ["file-type-video"],
  avif: ["file-type-image"],
  bash: ["file-type-shell"],
  bat: ["file-type-bat"],
  bmp: ["file-type-image"],
  bz2: ["file-type-zip"],
  c: ["file-type-c"],
  cc: ["file-type-cpp"],
  cjs: ["file-type-js", "file-type-node"],
  cmd: ["file-type-bat"],
  conf: ["file-type-config"],
  cpp: ["file-type-cpp"],
  cs: ["file-type-csharp"],
  csv: ["file-type-excel"],
  cts: ["file-type-typescript", "file-type-ts"],
  cxx: ["file-type-cpp"],
  dart: ["file-type-dartlang"],
  doc: ["file-type-word"],
  docx: ["file-type-word"],
  eot: ["file-type-font"],
  erl: ["file-type-erlang"],
  ex: ["file-type-elixir"],
  exs: ["file-type-elixir"],
  flac: ["file-type-audio"],
  fs: ["file-type-fsharp"],
  gif: ["file-type-image"],
  gitattributes: ["file-type-git"],
  gitignore: ["file-type-git"],
  gitmodules: ["file-type-git"],
  gql: ["file-type-graphql"],
  gz: ["file-type-zip"],
  h: ["file-type-cheader", "file-type-c"],
  hpp: ["file-type-cppheader", "file-type-cpp"],
  hs: ["file-type-haskell"],
  ico: ["file-type-image"],
  ini: ["file-type-ini"],
  jpeg: ["file-type-image"],
  jpg: ["file-type-image"],
  jsx: ["file-type-reactjs", "file-type-js"],
  kt: ["file-type-kotlin"],
  kts: ["file-type-kotlin"],
  less: ["file-type-less"],
  log: ["file-type-log"],
  m4a: ["file-type-audio"],
  md: ["file-type-markdown"],
  mdc: ["file-type-markdown"],
  markdown: ["file-type-markdown"],
  mjs: ["file-type-js", "file-type-node"],
  mkv: ["file-type-video"],
  mov: ["file-type-video"],
  mp3: ["file-type-audio"],
  mp4: ["file-type-video"],
  mts: ["file-type-typescript", "file-type-ts"],
  nix: ["file-type-nix"],
  ogg: ["file-type-audio"],
  otf: ["file-type-font"],
  png: ["file-type-image"],
  ppt: ["file-type-powerpoint"],
  pptx: ["file-type-powerpoint"],
  proto: ["file-type-protobuf"],
  ps1: ["file-type-powershell"],
  psd1: ["file-type-powershell-psd", "file-type-powershell"],
  psm1: ["file-type-powershell-psm", "file-type-powershell"],
  py: ["file-type-python"],
  rar: ["file-type-zip"],
  rb: ["file-type-ruby"],
  rs: ["file-type-rust"],
  sass: ["file-type-sass"],
  scss: ["file-type-scss", "file-type-sass"],
  sh: ["file-type-shell"],
  styl: ["file-type-stylus"],
  tar: ["file-type-zip"],
  tf: ["file-type-terraform"],
  tgz: ["file-type-zip"],
  ts: ["file-type-typescript"],
  tsx: ["file-type-reactts", "file-type-typescript"],
  ttf: ["file-type-font"],
  txt: ["file-type-text"],
  wasm: ["file-type-binary"],
  xls: ["file-type-excel"],
  xlsx: ["file-type-excel"],
  wav: ["file-type-audio"],
  webm: ["file-type-video"],
  webp: ["file-type-image"],
  woff: ["file-type-font"],
  woff2: ["file-type-font"],
  yml: ["file-type-yaml"],
  zip: ["file-type-zip"],
  zsh: ["file-type-shell"]
};

const EXACT_FILE_NAMES: Readonly<Record<string, readonly string[]>> = {
  ".dockerignore": ["file-type-docker", "file-type-docker2"],
  ".editorconfig": ["file-type-editorconfig"],
  ".env": ["file-type-env"],
  ".eslintrc": ["file-type-eslint"],
  ".eslintrc.cjs": ["file-type-eslint"],
  ".eslintrc.js": ["file-type-eslint"],
  ".eslintrc.json": ["file-type-eslint"],
  ".gitattributes": ["file-type-git"],
  ".gitignore": ["file-type-git"],
  ".gitmodules": ["file-type-git"],
  ".npmrc": ["file-type-npm"],
  ".prettierrc": ["file-type-prettier"],
  ".prettierrc.json": ["file-type-prettier"],
  "cargo.lock": ["file-type-cargo", "file-type-rust"],
  "cargo.toml": ["file-type-cargo", "file-type-rust"],
  cmakelists: ["file-type-cmake"],
  "cmakelists.txt": ["file-type-cmake"],
  dockerfile: ["file-type-docker2", "file-type-docker"],
  gemfile: ["file-type-ruby"],
  "go.mod": ["file-type-go"],
  "go.sum": ["file-type-go"],
  makefile: ["file-type-makefile"],
  "package-lock.json": ["file-type-npm"],
  "package.json": ["file-type-npm"],
  "pnpm-lock.yaml": ["file-type-pnpm", "file-type-pnpm_light"],
  "pnpm-workspace.yaml": ["file-type-pnpm", "file-type-pnpm_light"],
  procfile: ["file-type-procfile"],
  "pyproject.toml": ["file-type-python"],
  "requirements.txt": ["file-type-python"],
  "tsconfig.json": ["file-type-tsconfig", "file-type-typescript"],
  "vite.config.ts": ["file-type-vite", "file-type-typescript"],
  "yarn.lock": ["file-type-yarn"]
};

const SUFFIX_ALIASES: ReadonlyArray<readonly [string, readonly string[]]> = [
  [".d.ts", ["file-type-typescriptdef", "file-type-typescript"]],
  [".d.cts", ["file-type-typescriptdef", "file-type-typescript"]],
  [".d.mts", ["file-type-typescriptdef", "file-type-typescript"]],
  [".module.css", ["file-type-css"]],
  [".module.scss", ["file-type-sass", "file-type-scss"]],
  [".test.ts", ["file-type-testts", "file-type-typescript"]],
  [".test.tsx", ["file-type-testts", "file-type-reactts"]],
  [".spec.ts", ["file-type-testts", "file-type-typescript"]],
  [".spec.tsx", ["file-type-testts", "file-type-reactts"]],
  [".config.ts", ["file-type-typescript"]],
  [".config.js", ["file-type-js"]]
];

const FOLDER_NAME_ALIASES: Readonly<Record<string, string>> = {
  ".git": "git",
  ".github": "github",
  ".gitlab": "gitlab",
  ".vscode": "vscode",
  android: "android",
  app: "app",
  apps: "app",
  assets: "asset",
  bin: "binary",
  build: "dist",
  components: "component",
  config: "config",
  crates: "lib",
  css: "css",
  dist: "dist",
  docs: "docs",
  fonts: "fonts",
  hooks: "hook",
  i18n: "locale",
  images: "images",
  include: "include",
  ios: "ios",
  lib: "lib",
  locale: "locale",
  locales: "locale",
  node_modules: "node",
  out: "dist",
  packages: "package",
  public: "public",
  scripts: "scripts",
  services: "server",
  shared: "shared",
  src: "src",
  styles: "style",
  test: "test",
  tests: "test",
  tmp: "temp",
  tools: "tools",
  web: "www"
};

const extensionOf = (fileName: string): string => {
  if (!fileName.includes(".")) {
    return "";
  }
  if (fileName.startsWith(".") && fileName.lastIndexOf(".") === 0) {
    return fileName.slice(1);
  }
  return fileName.slice(fileName.lastIndexOf(".") + 1);
};

const fileCandidates = (fileName: string): string[] => {
  const candidates: string[] = [];
  const push = (name: string): void => {
    if (name.length > 0 && candidates.includes(name) === false) {
      candidates.push(name);
    }
  };

  const exact = EXACT_FILE_NAMES[fileName];
  if (exact !== undefined) {
    for (const name of exact) {
      push(name);
    }
  }

  for (const [suffix, names] of SUFFIX_ALIASES) {
    if (fileName.endsWith(suffix)) {
      for (const name of names) {
        push(name);
      }
    }
  }

  const extension = extensionOf(fileName);
  if (extension.length > 0) {
    push(`file-type-${extension}`);
    push(`file-type-${extension}2`);
    const aliases = EXTENSION_ALIASES[extension];
    if (aliases !== undefined) {
      for (const name of aliases) {
        push(name);
      }
    }
    const indexed = FILE_TYPE_BY_KEY.get(extension);
    if (indexed !== undefined) {
      push(indexed);
    }
  }

  const stem = fileName.replace(/^\./u, "").replace(/\.[^.]+$/u, "");
  if (stem.length > 0 && stem !== fileName) {
    push(`file-type-${stem}`);
  } else if (extension.length === 0 && fileName.length > 0) {
    push(`file-type-${fileName}`);
  }

  return candidates;
};

const folderCandidates = (folderName: string, opened: boolean): string[] => {
  const suffix = opened ? "-opened" : "";
  const mapped = FOLDER_NAME_ALIASES[folderName] ?? folderName.replace(/^\./u, "");
  return [
    `folder-type-${mapped}${suffix}`,
    `folder-type-${mapped}`,
    `folder-type-${folderName}${suffix}`,
    `default-folder${opened ? "-opened" : ""}`
  ];
};

export const resolveFileTypeIconId = (
  name: string,
  kind: FileTypeIconKind = "file"
): string => {
  const fileName = basenameOf(name);
  if (kind === "folder" || kind === "folder-open") {
    const opened = kind === "folder-open";
    return firstAvailable(
      folderCandidates(fileName, opened),
      opened ? "default-folder-opened" : "default-folder"
    );
  }
  return firstAvailable(fileCandidates(fileName), "default-file");
};
