import {
  copyFileSync,
  existsSync,
  mkdirSync
} from "node:fs";
import path from "node:path";

const sanitizePartialFileName = (value: string): string => {
  const trimmed = value.trim().replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_");
  return trimmed.replace(/[. ]+$/g, "").slice(0, 180);
};

export const resolveBrowserPartialFileName = (
  partialFilePath: string,
  fallbackFileName: string
): string => {
  const baseName = path.basename(partialFilePath);
  const lowerName = baseName.toLowerCase();
  const browserSuffix = [
    ".crdownload",
    ".download",
    ".part"
  ].find((suffix) => lowerName.endsWith(suffix)) ?? "";
  const candidate = browserSuffix.length === 0
    ? baseName
    : baseName.slice(0, -browserSuffix.length);
  const sanitized = sanitizePartialFileName(candidate);
  if (sanitized.length === 0 || /^unconfirmed\b/iu.test(sanitized)) {
    return fallbackFileName;
  }
  return sanitized;
};

export const materializeBrowserPartialFileForResume = (
  partialFilePath: string | undefined,
  savePath: string
): void => {
  if (partialFilePath === undefined) {
    return;
  }
  if (existsSync(partialFilePath) === false) {
    throw new Error(`Partial file does not exist: ${partialFilePath}`);
  }
  mkdirSync(path.dirname(savePath), { recursive: true });
  if (path.resolve(partialFilePath) === path.resolve(savePath) || existsSync(savePath)) {
    return;
  }
  copyFileSync(partialFilePath, savePath);
};
