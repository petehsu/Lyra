import associations from "./file-type-associations.json";
import { VSCODE_ICON_NAMES } from "./vscode-icon-names";

export type FileTypeIconKind = "file" | "folder" | "folder-open";

const FILE_NAME_ICONS: Readonly<Record<string, string>> = associations.names;
const FILE_EXTENSION_ICONS: Readonly<Record<string, string>> = associations.extensions;

// vscode-icons names, expanded with the language extensions from the
// reference VS Code tree. Seti picks an icon by language id; this table
// stores the same extensions under an icon we actually ship.
// These extensions stay on a specific mark instead of the generic one.
const PRODUCT_EXTENSIONS: Readonly<Record<string, string>> = {
  csv: "file-type-excel",
  jsx: "file-type-reactjs",
  mdc: "file-type-markdown",
  tsv: "file-type-excel",
  // The shipped set has no Premiere / Resolve / Maya-scene glyph.
  // ponytail: reuse the nearest mark. A dedicated logo would be a new svg.
  aep: "file-type-video",
  aepx: "file-type-video",
  drp: "file-type-video",
  fcpxml: "file-type-video",
  kdenlive: "file-type-video",
  m2ts: "file-type-video",
  mogrt: "file-type-video",
  mxf: "file-type-video",
  ppj: "file-type-video",
  prproj: "file-type-video",
  veg: "file-type-video",
  aif: "file-type-audio",
  als: "file-type-audio",
  aup: "file-type-audio",
  aup3: "file-type-audio",
  caf: "file-type-audio",
  cpr: "file-type-audio",
  flp: "file-type-audio",
  mid: "file-type-audio",
  midi: "file-type-audio",
  mka: "file-type-audio",
  rpp: "file-type-audio",
  sesx: "file-type-audio",
  arw: "file-type-image",
  cr2: "file-type-image",
  cr3: "file-type-image",
  dds: "file-type-image",
  dng: "file-type-image",
  exr: "file-type-image",
  hdr: "file-type-image",
  heif: "file-type-image",
  jfif: "file-type-image",
  jpe: "file-type-image",
  nef: "file-type-image",
  orf: "file-type-image",
  psb: "file-type-photoshop",
  psdt: "file-type-photoshop",
  raf: "file-type-image",
  rw2: "file-type-image",
  tga: "file-type-image",
  tif: "file-type-image",
  ma: "file-type-maya",
  mb: "file-type-maya",
  otf: "file-type-font"
};

const hasIcon = (name: string): boolean => VSCODE_ICON_NAMES.has(name);

const firstAvailable = (candidates: readonly string[], fallback: string): string => {
  for (const candidate of candidates) {
    if (hasIcon(candidate)) {
      return `vscode-icons:${candidate}`;
    }
  }
  return `vscode-icons:${fallback}`;
};

const knownIcon = (name: string | undefined): string | undefined =>
  name !== undefined && hasIcon(name) ? name : undefined;

const basenameOf = (input: string): string => {
  const trimmed = input.trim();
  if (trimmed.length === 0) {
    return "";
  }
  const parts = trimmed.split(/[\\/]/u);
  return (parts.at(-1) ?? trimmed).toLocaleLowerCase();
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

const officialIcon = (
  fileName: string
): { readonly icon: string; readonly matched: string } | undefined => {
  const named = knownIcon(FILE_NAME_ICONS[fileName]);
  if (named !== undefined) {
    return { icon: named, matched: fileName };
  }
  for (let index = 0; index < fileName.length; index += 1) {
    if (fileName[index] !== ".") {
      continue;
    }
    const ext = fileName.slice(index + 1);
    const icon = knownIcon(FILE_EXTENSION_ICONS[ext]);
    if (icon !== undefined) {
      return { icon, matched: ext };
    }
  }
  return undefined;
};

const associatedIcon = (fileName: string): string | undefined => {
  const found = officialIcon(fileName);
  const dot = fileName.lastIndexOf(".");
  const last = dot > 0 ? fileName.slice(dot + 1) : "";
  const stem = dot > 0 ? fileName.slice(0, dot) : "";
  const product = knownIcon(PRODUCT_EXTENSIONS[last]);
  if (product !== undefined) {
    return product;
  }
  // ponytail: a trailing .tpl is a template of the inner file (run.sh.tpl). A bare view.tpl stays PHP/Smarty. Ceiling: only the suffix "tpl".
  if (found !== undefined && found.matched === last && last === "tpl" && stem.length > 0) {
    const inner = associatedIcon(stem);
    if (inner !== undefined) {
      return inner;
    }
  }
  if (found !== undefined) {
    return found.icon;
  }
  if (stem.length > 0) {
    return associatedIcon(stem);
  }
  if (dot < 0) {
    return knownIcon(FILE_EXTENSION_ICONS[fileName]);
  }
  return undefined;
};

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
  const associated = associatedIcon(fileName);
  if (associated !== undefined) {
    return `vscode-icons:${associated}`;
  }
  const extension = extensionOf(fileName);
  return firstAvailable(
    extension.length > 0
      ? [`file-type-${extension}`, `file-type-${extension}2`]
      : [`file-type-${fileName}`],
    "default-file"
  );
};
