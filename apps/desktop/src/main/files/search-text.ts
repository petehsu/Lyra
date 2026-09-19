import { spawn } from "node:child_process";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";

import type {
  FileSearchTextHit,
  FileSearchTextRequest,
  FileSearchTextResult
} from "../../shared/file-manager";
import type { FilesNativeBindings } from "./types";

const MAX_FILE_BYTES = 2 * 1024 * 1024;
const DEFAULT_LIMIT = 200;
const MAX_LIMIT = 500;
const SKIP_EXTENSIONS = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
  ".svg",
  ".ico",
  ".bmp",
  ".avif",
  ".woff",
  ".woff2",
  ".ttf",
  ".otf",
  ".eot",
  ".mp3",
  ".mp4",
  ".wav",
  ".zip",
  ".gz",
  ".br",
  ".wasm",
  ".pdf",
  ".exe",
  ".dll",
  ".so",
  ".dylib",
  ".o",
  ".a",
  ".class",
  ".jar"
]);

const RIPGREP_TIMEOUT_MS = 8_000;

type RipgrepJsonMatch = {
  readonly type?: string;
  readonly data?: {
    readonly path?: { readonly text?: string };
    readonly lines?: { readonly text?: string };
    readonly line_number?: number;
    readonly submatches?: ReadonlyArray<{
      readonly start?: number;
      readonly match?: { readonly text?: string };
    }>;
  };
};

export const parseRipgrepJsonLine = (line: string): FileSearchTextHit | null => {
  const trimmed = line.trim();
  if (trimmed.length === 0) {
    return null;
  }
  try {
    const parsed = JSON.parse(trimmed) as RipgrepJsonMatch;
    if (parsed.type !== "match" || parsed.data === undefined) {
      return null;
    }
    const filePath = parsed.data.path?.text?.trim() ?? "";
    const lineNumber = parsed.data.line_number;
    if (filePath.length === 0 || lineNumber === undefined || lineNumber < 1) {
      return null;
    }
    const lineText = parsed.data.lines?.text ?? "";
    const matchText = parsed.data.submatches?.[0]?.match?.text;
    const start = parsed.data.submatches?.[0]?.start;
    const fromText = matchText === undefined ? -1 : lineText.indexOf(matchText);
    const column = fromText >= 0
      ? fromText + 1
      : typeof start === "number"
        ? start + 1
        : 1;
    return {
      filePath,
      line: lineNumber,
      column,
      preview: lineText.replace(/\r?\n$/u, "").trim().slice(0, 200)
    };
  } catch {
    return null;
  }
};

const searchWithRipgrep = (
  rootPath: string,
  query: string,
  limit: number
): Promise<FileSearchTextResult | null> =>
  new Promise((resolve) => {
    let settled = false;
    const finish = (value: FileSearchTextResult | null): void => {
      if (settled) {
        return;
      }
      settled = true;
      resolve(value);
    };

    const hits: FileSearchTextHit[] = [];
    let truncated = false;
    let stdout = "";
    // Copy VS Code/Zed find-in-files: literal, case-insensitive, gitignore on,
    // hidden files included, skip huge files. Fallback walker if rg is missing.
    const child = spawn(
      "rg",
      [
        "--json",
        "--fixed-strings",
        "--ignore-case",
        "--hidden",
        "--no-config",
        "--max-filesize",
        "2M",
        "--glob",
        "!.git/**",
        "--glob",
        "!node_modules/**",
        "--",
        query,
        rootPath
      ],
      {
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true
      }
    );

    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      finish({
        hits: hits.slice(0, limit),
        truncated: true
      });
    }, RIPGREP_TIMEOUT_MS);

    const ingest = (chunk: string): void => {
      stdout += chunk;
      const lines = stdout.split("\n");
      stdout = lines.pop() ?? "";
      for (const jsonLine of lines) {
        if (hits.length >= limit) {
          truncated = true;
          child.kill("SIGTERM");
          break;
        }
        const hit = parseRipgrepJsonLine(jsonLine);
        if (hit !== null) {
          hits.push(hit);
        }
      }
    };

    child.stderr?.resume();
    child.stdout?.on("data", (chunk: Buffer | string) => {
      ingest(typeof chunk === "string" ? chunk : chunk.toString("utf8"));
    });
    child.on("error", (error: NodeJS.ErrnoException) => {
      clearTimeout(timer);
      finish(error.code === "ENOENT" ? null : {
        hits: hits.slice(0, limit),
        truncated: truncated || hits.length >= limit
      });
    });
    child.on("close", () => {
      clearTimeout(timer);
      if (stdout.length > 0 && hits.length < limit) {
        const hit = parseRipgrepJsonLine(stdout);
        if (hit !== null) {
          hits.push(hit);
        }
      }
      finish({
        hits: hits.slice(0, limit),
        truncated: truncated || hits.length >= limit
      });
    });
  });

export const collectLineHits = (
  filePath: string,
  content: string,
  query: string,
  remaining: number
): { readonly hits: FileSearchTextHit[]; readonly remaining: number } => {
  if (remaining <= 0 || query.length === 0 || content.includes("\0")) {
    return { hits: [], remaining };
  }
  const needle = query.toLowerCase();
  const hits: FileSearchTextHit[] = [];
  let left = remaining;
  const lines = content.split(/\r?\n/u);
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    const column = line.toLowerCase().indexOf(needle);
    if (column < 0) {
      continue;
    }
    hits.push({
      filePath,
      line: index + 1,
      column: column + 1,
      preview: line.trim().slice(0, 200)
    });
    left -= 1;
    if (left <= 0) {
      break;
    }
  }
  return { hits, remaining: left };
};

export const searchWorkbenchText = async (
  bindings: FilesNativeBindings,
  request: FileSearchTextRequest
): Promise<FileSearchTextResult> => {
  const query = request.query.trim();
  const rootPath = request.rootPath.trim();
  const limit = Math.min(Math.max(request.limit ?? DEFAULT_LIMIT, 1), MAX_LIMIT);
  if (query.length === 0 || rootPath.length === 0) {
    return { hits: [], truncated: false };
  }

  const ripgrep = await searchWithRipgrep(rootPath, query, limit);
  if (ripgrep !== null) {
    return ripgrep;
  }

  const collected = await bindings.collectWorkbenchFilePaths({
    rootPath,
    basePath: rootPath
  });
  const hits: FileSearchTextHit[] = [];
  let remaining = limit;
  for (const entry of collected) {
    if (remaining <= 0) {
      break;
    }
    const relative = entry.path.trim();
    if (relative.length === 0) {
      continue;
    }
    const abs = path.isAbsolute(relative) ? relative : path.join(rootPath, relative);
    if (SKIP_EXTENSIONS.has(path.extname(abs).toLowerCase())) {
      continue;
    }
    try {
      const info = await stat(abs);
      if (info.isFile() === false || info.size > MAX_FILE_BYTES) {
        continue;
      }
      const content = await readFile(abs, "utf8");
      const next = collectLineHits(abs, content, query, remaining);
      hits.push(...next.hits);
      remaining = next.remaining;
    } catch {
      continue;
    }
  }
  return { hits, truncated: remaining <= 0 };
};
