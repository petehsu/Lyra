const EXTENSION_LANGUAGE: Record<string, string> = {
  bash: "shell",
  bat: "bat",
  c: "c",
  cc: "cpp",
  clj: "clojure",
  cpp: "cpp",
  cs: "csharp",
  css: "css",
  cxx: "cpp",
  dart: "dart",
  diff: "diff",
  ex: "elixir",
  exs: "elixir",
  fish: "shell",
  go: "go",
  graphql: "graphql",
  gql: "graphql",
  h: "c",
  hpp: "cpp",
  htm: "html",
  html: "html",
  ini: "ini",
  java: "java",
  js: "javascript",
  json: "json",
  jsonc: "json",
  jsx: "javascript",
  kt: "kotlin",
  kts: "kotlin",
  less: "less",
  lua: "lua",
  md: "markdown",
  mdx: "mdx",
  mjs: "javascript",
  cjs: "javascript",
  patch: "diff",
  php: "php",
  proto: "protobuf",
  ps1: "powershell",
  py: "python",
  r: "r",
  rb: "ruby",
  rs: "rust",
  scss: "scss",
  sh: "shell",
  sol: "solidity",
  sql: "sql",
  svg: "xml",
  swift: "swift",
  toml: "toml",
  ts: "typescript",
  tsx: "typescript",
  mts: "typescript",
  cts: "typescript",
  xml: "xml",
  yaml: "yaml",
  yml: "yaml",
  zsh: "shell",
  astro: "astro",
  prisma: "prisma",
  zig: "zig",
  zon: "zig",
  gleam: "gleam",
  nix: "nix",
  hs: "haskell",
  lhs: "haskell",
  jl: "julia",
  typ: "typst",
  tex: "latex",
  sty: "latex",
  fs: "fsharp",
  fsi: "fsharp",
  fsx: "fsharp",
  tf: "terraform",
  tfvars: "terraform",
  vue: "vue",
  svelte: "svelte",
  wgsl: "wgsl"
};

export const languageFromPath = (filePath: string): string => {
  const base = (filePath.replaceAll("\\", "/").split("/").pop() ?? "").toLowerCase();
  if (base === "dockerfile" || base.startsWith("dockerfile.")) {
    return "dockerfile";
  }
  const dot = base.lastIndexOf(".");
  if (dot <= 0) {
    return "plaintext";
  }
  return EXTENSION_LANGUAGE[base.slice(dot + 1)] ?? "plaintext";
};

/** True when the file itself is a unified diff, not a source file that merely quotes one. */
export const looksLikeUnifiedDiff = (text: string): boolean => {
  const body = text.replace(/\r\n/g, "\n").trimStart();
  if (body.length === 0) {
    return false;
  }
  const firstLines = body.split("\n", 8);
  const hasFileHeader = firstLines.some(
    (line) => line.startsWith("--- ") || line.startsWith("+++ ") || line.startsWith("diff ")
  );
  return hasFileHeader && /(?:^|\n)@@ -\d+/u.test(body);
};

export const languageFromPathAndContent = (filePath: string, content: string): string => {
  const fromPath = languageFromPath(filePath);
  if (fromPath !== "plaintext") {
    return fromPath;
  }
  return looksLikeUnifiedDiff(content) ? "diff" : fromPath;
};
