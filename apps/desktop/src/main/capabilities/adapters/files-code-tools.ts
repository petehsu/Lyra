import fs from "node:fs/promises";
import path from "node:path";

import type { FileReadResult, FileWriteResult } from "../../../shared/file-manager";
import type { FilesNativeBindings } from "../../files/types";

const DEFAULT_GLOB_LIMIT = 80;
const DEFAULT_SEARCH_LIMIT = 40;
const MAX_RESULT_LIMIT = 400;
const MAX_DRAFT_PREVIEW_CHARS = 4000;
const MAX_EXCERPT_CHARS = 240;
const SKIPPED_DIRECTORY_NAMES = new Set([
  ".git",
  "node_modules",
  "dist",
  "build",
  "target",
  ".next",
  "coverage",
  ".turbo"
]);

export type FileGlobCapabilityRequest = {
  readonly pattern: string;
  readonly rootPath: string;
  readonly limit?: number;
};

export type FileGlobCapabilityResult = {
  readonly rootPath: string;
  readonly pattern: string;
  readonly truncated: boolean;
  readonly matches: readonly {
    readonly path: string;
    readonly relativePath: string;
    readonly kind: "file" | "directory";
  }[];
};

export type FileSearchCapabilityRequest = {
  readonly pattern: string;
  readonly path: string;
  readonly glob?: string;
  readonly limit?: number;
  readonly caseSensitive?: boolean;
};

export type FileSearchCapabilityResult = {
  readonly rootPath: string;
  readonly pattern: string;
  readonly caseSensitive: boolean;
  readonly truncated: boolean;
  readonly matches: readonly {
    readonly path: string;
    readonly relativePath: string;
    readonly line: number;
    readonly excerpt: string;
  }[];
};

export type FileReadRangeCapabilityRequest = {
  readonly path: string;
  readonly startLine: number;
  readonly endLine: number;
};

export type FileReadRangeCapabilityResult =
  | {
      readonly kind: "unsupported";
      readonly path: string;
      readonly reason: string;
      readonly readOnly: boolean;
      readonly sizeBytes: number;
      readonly requestedStartLine: number;
      readonly requestedEndLine: number;
      readonly actualStartLine: number;
      readonly actualEndLine: number;
      readonly totalLines: number;
    }
  | {
      readonly kind: "text";
      readonly path: string;
      readonly revision: string;
      readonly encoding: "utf8" | "utf8-bom";
      readonly readOnly: boolean;
      readonly sizeBytes: number;
      readonly requestedStartLine: number;
      readonly requestedEndLine: number;
      readonly actualStartLine: number;
      readonly actualEndLine: number;
      readonly totalLines: number;
      readonly content: string;
    };

export type FileApplyPatchCapabilityRequest = {
  readonly path: string;
  readonly patch: string;
  readonly expectedRevision?: string;
};

export type FileEditCapabilityRequest = {
  readonly path: string;
  readonly oldText: string;
  readonly newText: string;
  readonly expectedRevision?: string;
  readonly replaceAll?: boolean;
};

export type FileMultiEditCapabilityRequest = {
  readonly path: string;
  readonly edits: readonly {
    readonly oldText: string;
    readonly newText: string;
    readonly replaceAll?: boolean;
  }[];
  readonly expectedRevision?: string;
};

export type FilePreparedMutationResult =
  | {
      readonly ok: true;
      readonly path: string;
      readonly revision: string;
      readonly encoding: "utf8" | "utf8-bom";
      readonly nextContent: string;
      readonly addedLines: number;
      readonly removedLines: number;
      readonly patchSummary: string;
      readonly draftPreview: string;
      readonly baselineContent: string;
      readonly firstChangedLine: number;
      readonly expectedRevision?: string;
    }
  | {
      readonly ok: false;
      readonly kind: "unsupported" | "patch-conflict" | "patch-invalid" | "edit-conflict" | "edit-invalid";
      readonly path: string;
      readonly message: string;
      readonly expectedRevision?: string;
      readonly currentRevision?: string;
      readonly addedLines: number;
      readonly removedLines: number;
      readonly patchSummary?: string;
      readonly draftPreview?: string;
      readonly baselineContent?: string;
      readonly firstChangedLine?: number;
    };

export type FileApplyPatchCapabilityResult =
  | (FileWriteResult & {
      readonly addedLines: number;
      readonly removedLines: number;
      readonly patchSummary: string;
      readonly draftPreview?: string;
      readonly baselineContent: string;
      readonly firstChangedLine: number;
    })
  | {
      readonly ok: false;
      readonly kind: "unsupported" | "patch-conflict" | "patch-invalid";
      readonly path: string;
      readonly message: string;
      readonly expectedRevision?: string;
      readonly currentRevision?: string;
      readonly addedLines: number;
      readonly removedLines: number;
      readonly patchSummary?: string;
      readonly draftPreview?: string;
      readonly baselineContent?: string;
      readonly firstChangedLine?: number;
    };

type DirectoryCandidate = {
  readonly absolutePath: string;
  readonly relativePath: string;
  readonly kind: "file" | "directory";
};

type ParsedPatchLine = {
  readonly kind: "context" | "add" | "remove";
  readonly text: string;
};

type ParsedPatchHunk = {
  readonly lines: readonly ParsedPatchLine[];
};

const toComparablePath = (value: string): string => value.replaceAll("\\", "/");

const normalizePattern = (value: string): string => {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    throw new Error("pattern is required");
  }
  return toComparablePath(trimmed);
};

const clampLimit = (value: number | undefined, fallback: number): number => {
  if (typeof value !== "number" || Number.isFinite(value) === false) {
    return fallback;
  }
  return Math.max(1, Math.min(MAX_RESULT_LIMIT, Math.round(value)));
};

const fileNameFromPath = (filePath: string): string => {
  const normalized = toComparablePath(filePath);
  const segments = normalized.split("/").filter((segment) => segment.length > 0);
  return segments[segments.length - 1] ?? normalized;
};

const matchesGlobPattern = (candidatePath: string, pattern: string): boolean => {
  if (path.matchesGlob(candidatePath, pattern)) {
    return true;
  }
  if (pattern.includes("/") || pattern.includes("\\")) {
    return false;
  }
  return path.matchesGlob(fileNameFromPath(candidatePath), pattern);
};

const clipPreview = (value: string, maxChars: number): string =>
  value.length <= maxChars ? value : `${value.slice(0, maxChars)}\n…`;

const countLogicalLines = (value: string): number => splitLogicalLines(value).length;

const splitLogicalLines = (content: string): string[] => {
  if (content.length === 0) {
    return [];
  }
  const normalized = content.replaceAll("\r\n", "\n");
  const lines = normalized.split("\n");
  if (normalized.endsWith("\n") && lines[lines.length - 1] === "") {
    lines.pop();
  }
  return lines;
};

const shouldSkipDirectory = (entryName: string): boolean =>
  SKIPPED_DIRECTORY_NAMES.has(entryName);

const resolveDirectoryCandidates = async (
  rootPath: string,
  limit: number
): Promise<readonly DirectoryCandidate[]> => {
  const rootStats = await fs.stat(rootPath);
  const normalizedRoot = path.resolve(rootPath);

  if (rootStats.isFile()) {
    return [
      {
        absolutePath: normalizedRoot,
        relativePath: fileNameFromPath(normalizedRoot),
        kind: "file"
      }
    ];
  }

  const queue: string[] = [normalizedRoot];
  const collected: DirectoryCandidate[] = [];

  while (queue.length > 0 && collected.length < limit) {
    const currentPath = queue.shift()!;
    const entries = await fs.readdir(currentPath, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name));

    for (const entry of entries) {
      if (collected.length >= limit) {
        break;
      }
      if (entry.isSymbolicLink()) {
        continue;
      }
      if (entry.isDirectory() && shouldSkipDirectory(entry.name)) {
        continue;
      }

      const absolutePath = path.join(currentPath, entry.name);
      const relativePath = toComparablePath(path.relative(normalizedRoot, absolutePath));
      if (relativePath.length === 0) {
        continue;
      }

      if (entry.isDirectory()) {
        collected.push({
          absolutePath,
          relativePath,
          kind: "directory"
        });
        queue.push(absolutePath);
        continue;
      }

      if (entry.isFile()) {
        collected.push({
          absolutePath,
          relativePath,
          kind: "file"
        });
      }
    }
  }

  return collected;
};

const readTextResultContent = (
  readResult: FileReadResult
): readResult is Extract<FileReadResult, { readonly kind: "text" }> => readResult.kind === "text";

const excerptForLine = (value: string): string => {
  const normalized = value.trim();
  if (normalized.length <= MAX_EXCERPT_CHARS) {
    return normalized;
  }
  return `${normalized.slice(0, MAX_EXCERPT_CHARS)}…`;
};

const parsePatchTargetPath = (line: string): string | null => {
  const match = /^\*\*\* Update File:\s+(.+)$/.exec(line.trim());
  return match?.[1]?.trim() ?? null;
};

const parseSingleFilePatch = (
  patchText: string,
  filePath: string
): readonly ParsedPatchHunk[] => {
  const normalizedPatch = patchText.replaceAll("\r\n", "\n").trim();
  if (normalizedPatch.length === 0) {
    throw new Error("patch is required");
  }

  const normalizedTarget = toComparablePath(filePath);
  const lines = normalizedPatch.split("\n");
  const hunks: ParsedPatchHunk[] = [];
  let currentLines: ParsedPatchLine[] | null = null;

  const flushCurrent = (): void => {
    if (currentLines === null) {
      return;
    }
    if (currentLines.length === 0) {
      throw new Error("patch hunk is empty");
    }
    hunks.push({ lines: currentLines });
    currentLines = null;
  };

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.length === 0 && currentLines === null) {
      continue;
    }
    if (trimmed === "*** Begin Patch" || trimmed === "*** End Patch") {
      continue;
    }
    if (trimmed === "*** End of File") {
      continue;
    }

    const patchTargetPath = parsePatchTargetPath(line);
    if (patchTargetPath !== null) {
      const comparablePatchTarget = toComparablePath(patchTargetPath);
      if (
        normalizedTarget !== comparablePatchTarget
        && normalizedTarget.endsWith(`/${comparablePatchTarget}`) === false
      ) {
        throw new Error("patch target does not match the requested path");
      }
      continue;
    }

    if (trimmed.startsWith("*** Add File:") || trimmed.startsWith("*** Delete File:")) {
      throw new Error("filesystem.apply_patch only supports updating an existing file");
    }

    if (trimmed.startsWith("@@")) {
      flushCurrent();
      currentLines = [];
      continue;
    }

    const prefix = line[0];
    if (prefix === " " || prefix === "+" || prefix === "-") {
      if (currentLines === null) {
        currentLines = [];
      }
      currentLines.push({
        kind:
          prefix === " "
            ? "context"
            : prefix === "+"
              ? "add"
              : "remove",
        text: line.slice(1)
      });
      continue;
    }

    throw new Error(`unsupported patch line: ${line}`);
  }

  flushCurrent();

  if (hunks.length === 0) {
    throw new Error("patch contains no hunks");
  }

  return hunks;
};

const findChunkIndex = (
  haystack: readonly string[],
  needle: readonly string[],
  preferredStart: number
): number => {
  if (needle.length === 0) {
    return Math.min(preferredStart, haystack.length);
  }

  const search = (fromIndex: number): number => {
    for (let index = Math.max(0, fromIndex); index <= haystack.length - needle.length; index += 1) {
      let matches = true;
      for (let offset = 0; offset < needle.length; offset += 1) {
        if (haystack[index + offset] !== needle[offset]) {
          matches = false;
          break;
        }
      }
      if (matches) {
        return index;
      }
    }
    return -1;
  };

  const preferred = search(preferredStart);
  if (preferred >= 0) {
    return preferred;
  }
  return search(0);
};

const applyPatchToContent = (
  currentContent: string,
  patchText: string,
  filePath: string
): {
  readonly nextContent: string;
  readonly addedLines: number;
  readonly removedLines: number;
  readonly patchSummary: string;
  readonly firstChangedLine: number;
} => {
  const hunks = parseSingleFilePatch(patchText, filePath);
  const normalizedContent = currentContent.replaceAll("\r\n", "\n");
  const hadTrailingNewline = normalizedContent.endsWith("\n");
  const lines = splitLogicalLines(normalizedContent);

  let cursor = 0;
  let addedLines = 0;
  let removedLines = 0;
  let firstChangedLine = Number.POSITIVE_INFINITY;

  for (const hunk of hunks) {
    const expectedChunk = hunk.lines
      .filter((line) => line.kind !== "add")
      .map((line) => line.text);
    const replacementChunk = hunk.lines
      .filter((line) => line.kind !== "remove")
      .map((line) => line.text);
    const startIndex = findChunkIndex(lines, expectedChunk, cursor);
    if (startIndex < 0) {
      throw new Error("patch hunk does not match the current file content");
    }

    lines.splice(startIndex, expectedChunk.length, ...replacementChunk);
    cursor = startIndex + replacementChunk.length;
    addedLines += hunk.lines.filter((line) => line.kind === "add").length;
    removedLines += hunk.lines.filter((line) => line.kind === "remove").length;
    firstChangedLine = Math.min(firstChangedLine, startIndex + 1);
  }

  let nextContent = lines.join("\n");
  if (hadTrailingNewline && nextContent.length > 0) {
    nextContent = `${nextContent}\n`;
  }
  const patchSummary = `Applied ${hunks.length} ${hunks.length === 1 ? "hunk" : "hunks"} (+${addedLines} -${removedLines})`;
  return {
    nextContent,
    addedLines,
    removedLines,
    patchSummary,
    firstChangedLine: Number.isFinite(firstChangedLine) ? firstChangedLine : 1
  };
};

const findAllExactMatches = (haystack: string, needle: string): readonly number[] => {
  const indices: number[] = [];
  if (needle.length === 0) {
    return indices;
  }
  let cursor = 0;
  while (cursor <= haystack.length - needle.length) {
    const index = haystack.indexOf(needle, cursor);
    if (index < 0) {
      break;
    }
    indices.push(index);
    cursor = index + needle.length;
  }
  return indices;
};

const lineNumberFromOffset = (content: string, offset: number): number =>
  content.slice(0, Math.max(0, offset)).split("\n").length;

const applyTextReplacement = (
  currentContent: string,
  oldText: string,
  newText: string,
  replaceAll: boolean
): {
  readonly nextContent: string;
  readonly matchCount: number;
  readonly firstChangedLine: number;
  readonly addedLines: number;
  readonly removedLines: number;
} => {
  if (oldText.length === 0) {
    throw new Error("oldText is required");
  }
  const matches = findAllExactMatches(currentContent, oldText);
  if (matches.length === 0) {
    throw new Error("oldText was not found in the current file content");
  }
  if (matches.length > 1 && replaceAll !== true) {
    throw new Error("oldText matched multiple locations; provide more context or set replaceAll");
  }

  const targetMatches = replaceAll ? matches : [matches[0]!];
  let nextContent = "";
  let cursor = 0;
  for (const index of targetMatches) {
    nextContent += currentContent.slice(cursor, index);
    nextContent += newText;
    cursor = index + oldText.length;
  }
  nextContent += currentContent.slice(cursor);

  const firstChangedLine = lineNumberFromOffset(currentContent, targetMatches[0] ?? 0);
  const addedLines = Math.max(
    0,
    targetMatches.length * countLogicalLines(newText) - targetMatches.length * countLogicalLines(oldText)
  );
  const removedLines = Math.max(
    0,
    targetMatches.length * countLogicalLines(oldText) - targetMatches.length * countLogicalLines(newText)
  );

  return {
    nextContent,
    matchCount: targetMatches.length,
    firstChangedLine,
    addedLines,
    removedLines
  };
};

const buildPreparedMutationSuccess = (
  readResult: Extract<FileReadResult, { readonly kind: "text" }>,
  nextContent: string,
  addedLines: number,
  removedLines: number,
  patchSummary: string,
  firstChangedLine: number,
  expectedRevision?: string
): Extract<FilePreparedMutationResult, { readonly ok: true }> => ({
  ok: true,
  path: readResult.path,
  revision: readResult.revision,
  encoding: readResult.encoding,
  nextContent,
  addedLines,
  removedLines,
  patchSummary,
  draftPreview: clipPreview(nextContent, MAX_DRAFT_PREVIEW_CHARS),
  baselineContent: readResult.content,
  firstChangedLine,
  ...(expectedRevision === undefined ? {} : { expectedRevision })
});

const buildPreparedMutationFailure = (
  path: string,
  kind: Extract<FilePreparedMutationResult, { readonly ok: false }>["kind"],
  message: string,
  options?: {
    readonly expectedRevision?: string;
    readonly currentRevision?: string;
    readonly addedLines?: number;
    readonly removedLines?: number;
    readonly patchSummary?: string;
    readonly draftPreview?: string;
    readonly baselineContent?: string;
    readonly firstChangedLine?: number;
  }
): Extract<FilePreparedMutationResult, { readonly ok: false }> => ({
  ok: false,
  kind,
  path,
  message,
  addedLines: options?.addedLines ?? 0,
  removedLines: options?.removedLines ?? 0,
  ...(options?.expectedRevision === undefined ? {} : { expectedRevision: options.expectedRevision }),
  ...(options?.currentRevision === undefined ? {} : { currentRevision: options.currentRevision }),
  ...(options?.patchSummary === undefined ? {} : { patchSummary: options.patchSummary }),
  ...(options?.draftPreview === undefined ? {} : { draftPreview: options.draftPreview }),
  ...(options?.baselineContent === undefined ? {} : { baselineContent: options.baselineContent }),
  ...(options?.firstChangedLine === undefined ? {} : { firstChangedLine: options.firstChangedLine })
});

export const runFilesystemGlob = async ({
  pattern,
  rootPath,
  limit
}: FileGlobCapabilityRequest): Promise<FileGlobCapabilityResult> => {
  const normalizedPattern = normalizePattern(pattern);
  const normalizedRootPath = path.resolve(rootPath);
  const safeLimit = clampLimit(limit, DEFAULT_GLOB_LIMIT);
  const candidates = await resolveDirectoryCandidates(normalizedRootPath, safeLimit * 4);
  const matches = candidates
    .filter((candidate) => matchesGlobPattern(candidate.relativePath, normalizedPattern))
    .slice(0, safeLimit)
    .map((candidate) => ({
      path: candidate.absolutePath,
      relativePath: candidate.relativePath,
      kind: candidate.kind
    }));

  return {
    rootPath: normalizedRootPath,
    pattern: normalizedPattern,
    truncated: matches.length < candidates.filter((candidate) =>
      matchesGlobPattern(candidate.relativePath, normalizedPattern)
    ).length,
    matches
  };
};

export const runFilesystemSearch = async (
  bindings: FilesNativeBindings,
  {
    pattern,
    path: searchPath,
    glob,
    limit,
    caseSensitive
  }: FileSearchCapabilityRequest
): Promise<FileSearchCapabilityResult> => {
  const normalizedPattern = pattern.trim();
  if (normalizedPattern.length === 0) {
    throw new Error("pattern is required");
  }

  const normalizedRootPath = path.resolve(searchPath);
  const safeLimit = clampLimit(limit, DEFAULT_SEARCH_LIMIT);
  const rootStats = await fs.stat(normalizedRootPath);
  const globPattern = typeof glob === "string" && glob.trim().length > 0
    ? normalizePattern(glob)
    : null;
  const exactCase = caseSensitive === true;

  const candidates = rootStats.isFile()
    ? [
        {
          absolutePath: normalizedRootPath,
          relativePath: fileNameFromPath(normalizedRootPath),
          kind: "file" as const
        }
      ]
    : (await resolveDirectoryCandidates(normalizedRootPath, MAX_RESULT_LIMIT * 4))
        .filter((candidate) => candidate.kind === "file");

  const matches: Array<{
    readonly path: string;
    readonly relativePath: string;
    readonly line: number;
    readonly excerpt: string;
  }> = [];

  const normalizedNeedle = exactCase ? normalizedPattern : normalizedPattern.toLowerCase();

  for (const candidate of candidates) {
    if (matches.length >= safeLimit) {
      break;
    }
    if (globPattern !== null && matchesGlobPattern(candidate.relativePath, globPattern) === false) {
      continue;
    }

    const readResult = bindings.readTextFile({ path: candidate.absolutePath });
    if (readTextResultContent(readResult) === false) {
      continue;
    }

    const lines = splitLogicalLines(readResult.content);
    for (let index = 0; index < lines.length; index += 1) {
      if (matches.length >= safeLimit) {
        break;
      }
      const line = lines[index] ?? "";
      const haystack = exactCase ? line : line.toLowerCase();
      if (haystack.includes(normalizedNeedle) === false) {
        continue;
      }
      matches.push({
        path: candidate.absolutePath,
        relativePath: candidate.relativePath,
        line: index + 1,
        excerpt: excerptForLine(line)
      });
    }
  }

  return {
    rootPath: normalizedRootPath,
    pattern: normalizedPattern,
    caseSensitive: exactCase,
    truncated: matches.length >= safeLimit,
    matches
  };
};

export const runFilesystemReadRange = (
  bindings: FilesNativeBindings,
  {
    path: filePath,
    startLine,
    endLine
  }: FileReadRangeCapabilityRequest
): FileReadRangeCapabilityResult => {
  const requestedStartLine = Math.max(1, Math.round(startLine));
  const requestedEndLine = Math.max(requestedStartLine, Math.round(endLine));
  const readResult = bindings.readTextFile({ path: filePath });

  if (readTextResultContent(readResult) === false) {
    return {
      kind: "unsupported",
      path: readResult.path,
      reason: readResult.reason,
      readOnly: readResult.readOnly,
      sizeBytes: readResult.sizeBytes,
      requestedStartLine,
      requestedEndLine,
      actualStartLine: 0,
      actualEndLine: 0,
      totalLines: 0
    };
  }

  const lines = splitLogicalLines(readResult.content);
  const totalLines = lines.length;
  if (totalLines === 0) {
    return {
      kind: "text",
      path: readResult.path,
      revision: readResult.revision,
      encoding: readResult.encoding,
      readOnly: readResult.readOnly,
      sizeBytes: readResult.sizeBytes,
      requestedStartLine,
      requestedEndLine,
      actualStartLine: 0,
      actualEndLine: 0,
      totalLines: 0,
      content: ""
    };
  }

  const actualStartLine = Math.min(requestedStartLine, totalLines);
  const actualEndLine = Math.min(requestedEndLine, totalLines);
  const content = lines.slice(actualStartLine - 1, actualEndLine).join("\n");

  return {
    kind: "text",
    path: readResult.path,
    revision: readResult.revision,
    encoding: readResult.encoding,
    readOnly: readResult.readOnly,
    sizeBytes: readResult.sizeBytes,
    requestedStartLine,
    requestedEndLine,
    actualStartLine,
    actualEndLine,
    totalLines,
    content
  };
};

export const runFilesystemApplyPatch = (
  bindings: FilesNativeBindings,
  {
    path: filePath,
    patch,
    expectedRevision
  }: FileApplyPatchCapabilityRequest
): FileApplyPatchCapabilityResult => {
  const preview = previewFilesystemApplyPatch(bindings, {
    path: filePath,
    patch,
    ...(expectedRevision === undefined ? {} : { expectedRevision })
  });
  if (preview.ok === false) {
    return preview as FileApplyPatchCapabilityResult;
  }

  const writeResult = bindings.writeTextFile({
    path: preview.path,
    content: preview.nextContent,
    expectedRevision: preview.expectedRevision ?? preview.revision,
    encoding: preview.encoding
  });

  if (writeResult.ok === false) {
    return {
      ...writeResult,
      addedLines: preview.addedLines,
      removedLines: preview.removedLines,
      patchSummary: preview.patchSummary,
      draftPreview: preview.draftPreview,
      baselineContent: preview.baselineContent,
      firstChangedLine: preview.firstChangedLine
    };
  }

  return {
    ...writeResult,
    addedLines: preview.addedLines,
    removedLines: preview.removedLines,
    patchSummary: preview.patchSummary,
    draftPreview: preview.draftPreview,
    baselineContent: preview.baselineContent,
    firstChangedLine: preview.firstChangedLine
  };
};

export const previewFilesystemApplyPatch = (
  bindings: FilesNativeBindings,
  {
    path: filePath,
    patch,
    expectedRevision
  }: FileApplyPatchCapabilityRequest
): FilePreparedMutationResult => {
  const readResult = bindings.readTextFile({ path: filePath });
  if (readTextResultContent(readResult) === false) {
    return buildPreparedMutationFailure(readResult.path, "unsupported", readResult.reason, {
      baselineContent: "",
      firstChangedLine: 1
    });
  }

  if (readResult.readOnly) {
    return buildPreparedMutationFailure(readResult.path, "unsupported", "file is read-only", {
      currentRevision: readResult.revision,
      baselineContent: readResult.content,
      firstChangedLine: 1,
      ...(expectedRevision === undefined ? {} : { expectedRevision })
    });
  }

  let patchOutcome: ReturnType<typeof applyPatchToContent>;
  try {
    patchOutcome = applyPatchToContent(readResult.content, patch, readResult.path);
  } catch (error) {
    return buildPreparedMutationFailure(
      readResult.path,
      error instanceof Error && error.message.includes("does not match")
        ? "patch-conflict"
        : "patch-invalid",
      error instanceof Error ? error.message : String(error),
      {
        currentRevision: readResult.revision,
        baselineContent: readResult.content,
        firstChangedLine: 1,
        ...(expectedRevision === undefined ? {} : { expectedRevision })
      }
    );
  }

  return buildPreparedMutationSuccess(
    readResult,
    patchOutcome.nextContent,
    patchOutcome.addedLines,
    patchOutcome.removedLines,
    patchOutcome.patchSummary,
    patchOutcome.firstChangedLine,
    expectedRevision ?? readResult.revision
  );
};

export const previewFilesystemEdit = (
  bindings: FilesNativeBindings,
  request: FileEditCapabilityRequest
): FilePreparedMutationResult => {
  const readResult = bindings.readTextFile({ path: request.path });
  if (readTextResultContent(readResult) === false) {
    return buildPreparedMutationFailure(readResult.path, "unsupported", readResult.reason, {
      baselineContent: "",
      firstChangedLine: 1
    });
  }
  if (readResult.readOnly) {
    return buildPreparedMutationFailure(readResult.path, "unsupported", "file is read-only", {
      currentRevision: readResult.revision,
      baselineContent: readResult.content,
      firstChangedLine: 1,
      ...(request.expectedRevision === undefined ? {} : { expectedRevision: request.expectedRevision })
    });
  }

  try {
    const replacement = applyTextReplacement(
      readResult.content,
      request.oldText,
      request.newText,
      request.replaceAll === true
    );
    return buildPreparedMutationSuccess(
      readResult,
      replacement.nextContent,
      replacement.addedLines,
      replacement.removedLines,
      `Replaced ${replacement.matchCount} ${replacement.matchCount === 1 ? "match" : "matches"}`,
      replacement.firstChangedLine,
      request.expectedRevision ?? readResult.revision
    );
  } catch (error) {
    return buildPreparedMutationFailure(
      readResult.path,
      error instanceof Error && error.message.includes("multiple")
        ? "edit-conflict"
        : "edit-invalid",
      error instanceof Error ? error.message : String(error),
      {
        currentRevision: readResult.revision,
        baselineContent: readResult.content,
        firstChangedLine: 1,
        ...(request.expectedRevision === undefined ? {} : { expectedRevision: request.expectedRevision })
      }
    );
  }
};

export const previewFilesystemMultiEdit = (
  bindings: FilesNativeBindings,
  request: FileMultiEditCapabilityRequest
): FilePreparedMutationResult => {
  const readResult = bindings.readTextFile({ path: request.path });
  if (readTextResultContent(readResult) === false) {
    return buildPreparedMutationFailure(readResult.path, "unsupported", readResult.reason, {
      baselineContent: "",
      firstChangedLine: 1
    });
  }
  if (readResult.readOnly) {
    return buildPreparedMutationFailure(readResult.path, "unsupported", "file is read-only", {
      currentRevision: readResult.revision,
      baselineContent: readResult.content,
      firstChangedLine: 1,
      ...(request.expectedRevision === undefined ? {} : { expectedRevision: request.expectedRevision })
    });
  }
  if (request.edits.length === 0) {
    return buildPreparedMutationFailure(readResult.path, "edit-invalid", "edits is required", {
      currentRevision: readResult.revision,
      baselineContent: readResult.content,
      firstChangedLine: 1,
      ...(request.expectedRevision === undefined ? {} : { expectedRevision: request.expectedRevision })
    });
  }

  let nextContent = readResult.content;
  let firstChangedLine = Number.POSITIVE_INFINITY;
  let addedLines = 0;
  let removedLines = 0;
  let replacementCount = 0;

  try {
    for (const edit of request.edits) {
      const replacement = applyTextReplacement(
        nextContent,
        edit.oldText,
        edit.newText,
        edit.replaceAll === true
      );
      nextContent = replacement.nextContent;
      firstChangedLine = Math.min(firstChangedLine, replacement.firstChangedLine);
      addedLines += replacement.addedLines;
      removedLines += replacement.removedLines;
      replacementCount += replacement.matchCount;
    }
  } catch (error) {
    return buildPreparedMutationFailure(
      readResult.path,
      error instanceof Error && error.message.includes("multiple")
        ? "edit-conflict"
        : "edit-invalid",
      error instanceof Error ? error.message : String(error),
      {
        currentRevision: readResult.revision,
        baselineContent: readResult.content,
        firstChangedLine: 1,
        ...(request.expectedRevision === undefined ? {} : { expectedRevision: request.expectedRevision })
      }
    );
  }

  return buildPreparedMutationSuccess(
    readResult,
    nextContent,
    addedLines,
    removedLines,
    `Applied ${request.edits.length} edits across ${replacementCount} ${replacementCount === 1 ? "match" : "matches"}`,
    Number.isFinite(firstChangedLine) ? firstChangedLine : 1,
    request.expectedRevision ?? readResult.revision
  );
};
