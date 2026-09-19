import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";

import type { LspDiagnostic } from "../../shared/desktop-bridge";

type TsMessageChain = {
  readonly messageText: unknown;
};

type TsSourceFile = {
  readonly fileName: string;
  readonly text: string;
  readonly isDeclarationFile?: boolean;
};

type TsDiagnostic = {
  readonly code?: number;
  readonly category?: number;
  readonly start?: number;
  readonly length?: number;
  readonly file?: TsSourceFile;
  readonly messageText: unknown;
};

type TsProgram = {
  readonly getOptionsDiagnostics: () => readonly TsDiagnostic[];
  readonly getSyntacticDiagnostics: (file?: TsSourceFile) => readonly TsDiagnostic[];
  readonly getSemanticDiagnostics: (file?: TsSourceFile) => readonly TsDiagnostic[];
};

type TsParsedCommandLine = {
  readonly options: unknown;
  readonly fileNames: readonly string[];
  readonly errors?: readonly TsDiagnostic[];
  readonly projectReferences?: unknown;
};

type TsModule = {
  readonly sys: {
    readonly readFile: (fileName: string, encoding?: string) => string | undefined;
  };
  readonly getParsedCommandLineOfConfigFile: (
    fileName: string,
    existing: undefined,
    host: unknown
  ) => TsParsedCommandLine | undefined;
  readonly createProgram: (root: {
    readonly rootNames: readonly string[];
    readonly options: unknown;
    readonly projectReferences?: unknown;
  }) => TsProgram;
};

export const offsetToPosition = (
  text: string,
  offset: number
): { readonly line: number; readonly character: number } => {
  const end = Math.max(0, Math.min(offset, text.length));
  let line = 0;
  let character = 0;
  for (let index = 0; index < end; index += 1) {
    if (text.charCodeAt(index) === 10) {
      line += 1;
      character = 0;
      continue;
    }
    character += 1;
  }
  return { line, character };
};

export const mapTsCategoryToLspSeverity = (category: number | undefined): number => {
  if (category === 0) {
    return 2;
  }
  if (category === 2) {
    return 4;
  }
  if (category === 3) {
    return 3;
  }
  return 1;
};

const primaryMessage = (messageText: unknown): string => {
  if (typeof messageText === "string") {
    return messageText;
  }
  if (messageText !== null && typeof messageText === "object" && "messageText" in messageText) {
    return primaryMessage((messageText as TsMessageChain).messageText);
  }
  return String(messageText ?? "");
};

const loadTypescript = (tsserverPath: string): TsModule | null => {
  const trimmed = tsserverPath.trim();
  if (trimmed.length === 0 || fs.existsSync(trimmed) === false) {
    return null;
  }
  const packageJson = path.join(path.dirname(path.dirname(trimmed)), "package.json");
  if (fs.existsSync(packageJson) === false) {
    return null;
  }
  try {
    return createRequire(packageJson)("typescript") as TsModule;
  } catch {
    return null;
  }
};

const isNodeModulesPath = (filePath: string): boolean =>
  filePath.replaceAll("\\", "/").includes("/node_modules/");

const parseTypeScriptConfig = (
  filePath: string,
  content: string,
  ts: TsModule
): TsParsedCommandLine | undefined => {
  const resolvedConfig = path.resolve(filePath);
  return ts.getParsedCommandLineOfConfigFile(resolvedConfig, undefined, {
    ...ts.sys,
    readFile: (candidate: string, encoding?: string) => {
      if (path.resolve(candidate) === resolvedConfig) {
        return content;
      }
      return ts.sys.readFile(candidate, encoding);
    },
    onUnRecoverableConfigFileDiagnostic: () => undefined
  });
};

const toLspDiagnostic = (
  filePath: string,
  content: string,
  diagnostic: TsDiagnostic
): LspDiagnostic => {
  const startOffset = diagnostic.start ?? 0;
  const endOffset = startOffset + Math.max(0, diagnostic.length ?? 0);
  const start = offsetToPosition(content, startOffset);
  const end = offsetToPosition(content, Math.max(startOffset, endOffset));
  const code = diagnostic.code;
  return {
    filePath: diagnostic.file?.fileName ?? filePath,
    severity: mapTsCategoryToLspSeverity(diagnostic.category),
    message: primaryMessage(diagnostic.messageText),
    source: "ts",
    ...(code === undefined ? {} : { code: String(code) }),
    startLine: start.line,
    startCharacter: start.character,
    endLine: end.line,
    endCharacter: Math.max(start.character, end.character)
  };
};

export const collectTypeScriptConfigOptionDiagnostics = (
  filePath: string,
  content: string,
  tsserverPath: string | undefined
): readonly LspDiagnostic[] => {
  // ponytail: TLS 5.1.3 drops tsserver configFileDiag, so option errors never become publishDiagnostics. This uses the same tsserver.js via createProgram({ rootNames: [] }). Ceiling: include/file-not-found config diags stay missing until TLS onTsEvent forwards configFileDiag (body.configFile) and this collector can go.
  if (typeof tsserverPath !== "string") {
    return [];
  }
  const ts = loadTypescript(tsserverPath);
  if (ts === null) {
    return [];
  }
  const resolvedConfig = path.resolve(filePath);
  try {
    const parsed = parseTypeScriptConfig(filePath, content, ts);
    if (parsed === undefined) {
      return [];
    }
    const program = ts.createProgram({
      rootNames: [],
      options: parsed.options
    });
    const seen = new Set<string>();
    const items: LspDiagnostic[] = [];
    for (const diagnostic of [...(parsed.errors ?? []), ...program.getOptionsDiagnostics()]) {
      const mapped = toLspDiagnostic(resolvedConfig, content, diagnostic);
      const key = `${mapped.code}:${mapped.startLine}:${mapped.startCharacter}:${mapped.message}`;
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      items.push(mapped);
    }
    return items;
  } catch {
    return [];
  }
};

export type TypeScriptProjectFileDiagnostics = {
  readonly filePath: string;
  readonly diagnostics: readonly LspDiagnostic[];
};

const MAX_PROJECT_FILES = 2_500;

export const collectTypeScriptProjectFileDiagnostics = (
  filePath: string,
  content: string,
  tsserverPath: string | undefined
): readonly TypeScriptProjectFileDiagnostics[] => {
  // ponytail: TLS 5.1.3 hardcodes geterrForProject off, so VS Code's project-diagnostics mode cannot go through typescript-language-server. Same tsserver.js createProgram in a worker. Ceiling: 2500 files/config, full semantic check cost; upgrade to tsserver geterrForProject when TLS forwards it.
  if (typeof tsserverPath !== "string") {
    return [];
  }
  const ts = loadTypescript(tsserverPath);
  if (ts === null) {
    return [];
  }
  try {
    const parsed = parseTypeScriptConfig(filePath, content, ts);
    if (parsed === undefined) {
      return [];
    }
    const rootNames = parsed.fileNames
      .filter((name) => isNodeModulesPath(name) === false)
      .slice(0, MAX_PROJECT_FILES);
    if (rootNames.length === 0) {
      return [];
    }
    const program = ts.createProgram({
      rootNames,
      options: parsed.options,
      ...(parsed.projectReferences === undefined ? {} : { projectReferences: parsed.projectReferences })
    });
    const grouped = new Map<string, LspDiagnostic[]>();
    const seen = new Set<string>();
    for (const diagnostic of [...program.getSyntacticDiagnostics(), ...program.getSemanticDiagnostics()]) {
      const sourceFile = diagnostic.file;
      if (sourceFile === undefined || isNodeModulesPath(sourceFile.fileName)) {
        continue;
      }
      const mapped = toLspDiagnostic(sourceFile.fileName, sourceFile.text, diagnostic);
      const key = `${mapped.filePath}\0${mapped.code}:${mapped.startLine}:${mapped.startCharacter}:${mapped.message}`;
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      const bucket = grouped.get(mapped.filePath);
      if (bucket === undefined) {
        grouped.set(mapped.filePath, [mapped]);
      } else {
        bucket.push(mapped);
      }
    }
    return [...grouped.entries()].map(([groupPath, diagnostics]) => ({
      filePath: groupPath,
      diagnostics
    }));
  } catch {
    return [];
  }
};
