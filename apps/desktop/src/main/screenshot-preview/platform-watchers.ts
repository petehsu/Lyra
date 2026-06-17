import { clipboard, nativeImage } from "electron";
import { watch, type FSWatcher } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, join } from "node:path";

const SCREENSHOT_FILE_PATTERN =
  /^(screen(?: |-)?shot|screenshot|截屏|屏幕快照|屏幕截图|スクリーンショット)/i;
const IMAGE_EXTENSION_PATTERN = /\.(png|jpe?g|webp)$/i;
const FILE_SETTLE_MS = 280;
const CLIPBOARD_POLL_MS = 900;
const CLIPBOARD_MIN_IMAGE_BYTES = 12_000;

export type ScreenshotWatcherSnapshot = {
  readonly imageBase64: string;
  readonly mimeType: "image/png" | "image/jpeg";
  readonly label: string;
  readonly source: string;
};

type ScreenshotWatcherHost = {
  readonly onScreenshot: (snapshot: ScreenshotWatcherSnapshot) => void;
  readonly suppressClipboardUntil: () => number;
};

const isLikelyScreenshotFilename = (fileName: string): boolean =>
  SCREENSHOT_FILE_PATTERN.test(fileName) && IMAGE_EXTENSION_PATTERN.test(fileName);

const uniqueExistingDirectories = (directories: readonly string[]): readonly string[] => {
  const seen = new Set<string>();
  const next: string[] = [];
  for (const directory of directories) {
    const normalized = directory.trim();
    if (normalized.length === 0 || seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    next.push(normalized);
  }
  return next;
};

const resolveScreenshotDirectories = (): readonly string[] => {
  const home = homedir();
  const directories = [
    join(home, "Desktop"),
    join(home, "Pictures"),
    join(home, "Pictures", "Screenshots"),
    join(home, "OneDrive", "Pictures", "Screenshots")
  ];
  if (process.platform === "win32") {
    const userProfile = process.env.USERPROFILE?.trim();
    if (userProfile !== undefined && userProfile.length > 0) {
      directories.push(join(userProfile, "Pictures", "Screenshots"));
    }
  }
  if (process.platform === "linux") {
    const xdgPictures = process.env.XDG_PICTURES_DIR?.trim();
    if (xdgPictures !== undefined && xdgPictures.length > 0) {
      directories.push(xdgPictures, join(xdgPictures, "Screenshots"));
    }
  }
  return uniqueExistingDirectories(directories);
};

const mediaTypeFromFileName = (fileName: string): "image/png" | "image/jpeg" => {
  return /\.jpe?g$/i.test(fileName) ? "image/jpeg" : "image/png";
};

const readScreenshotFile = async (
  filePath: string
): Promise<ScreenshotWatcherSnapshot | null> => {
  const fileName = basename(filePath);
  if (isLikelyScreenshotFilename(fileName) === false) {
    return null;
  }
  try {
    const fileStat = await stat(filePath);
    if (!fileStat.isFile() || fileStat.size < 1024) {
      return null;
    }
    const bytes = await readFile(filePath);
    if (bytes.byteLength < 1024) {
      return null;
    }
    return {
      imageBase64: bytes.toString("base64"),
      mimeType: mediaTypeFromFileName(fileName),
      label: fileName,
      source: "system-screenshot"
    };
  } catch {
    return null;
  }
};

export const createScreenshotPlatformWatchers = ({
  onScreenshot,
  suppressClipboardUntil
}: ScreenshotWatcherHost) => {
  const directoryWatchers: FSWatcher[] = [];
  const pendingFileReads = new Map<string, ReturnType<typeof setTimeout>>();
  let clipboardTimer: ReturnType<typeof setInterval> | null = null;
  let lastClipboardSignature = "";
  let disposed = false;

  const scheduleFileRead = (filePath: string): void => {
    const existing = pendingFileReads.get(filePath);
    if (existing !== undefined) {
      clearTimeout(existing);
    }
    const timer = setTimeout(() => {
      pendingFileReads.delete(filePath);
      void readScreenshotFile(filePath).then((snapshot) => {
        if (snapshot === null || disposed) {
          return;
        }
        onScreenshot(snapshot);
      });
    }, FILE_SETTLE_MS);
    pendingFileReads.set(filePath, timer);
  };

  const startDirectoryWatchers = (): void => {
    for (const directory of resolveScreenshotDirectories()) {
      try {
        const watcher = watch(directory, (_eventType, fileName) => {
          if (typeof fileName !== "string" || fileName.length === 0) {
            return;
          }
          if (isLikelyScreenshotFilename(fileName) === false) {
            return;
          }
          scheduleFileRead(join(directory, fileName));
        });
        directoryWatchers.push(watcher);
      } catch {
        // Directory may not exist on this machine.
      }
    }
  };

  const readClipboardScreenshot = (): ScreenshotWatcherSnapshot | null => {
    if (Date.now() < suppressClipboardUntil()) {
      return null;
    }
    const image = clipboard.readImage();
    if (image.isEmpty()) {
      return null;
    }
    const png = image.toPNG();
    if (png.byteLength < CLIPBOARD_MIN_IMAGE_BYTES) {
      return null;
    }
    const signature = `${png.byteLength}:${png.subarray(0, 24).toString("base64")}`;
    if (signature === lastClipboardSignature) {
      return null;
    }
    lastClipboardSignature = signature;
    const size = image.getSize();
    return {
      imageBase64: png.toString("base64"),
      mimeType: "image/png",
      label: "Screenshot",
      source: "system-screenshot-clipboard"
    };
  };

  const startClipboardWatcher = (): void => {
    if (process.platform === "darwin") {
      // macOS also writes files for most screenshot modes; clipboard polling is a fallback.
    }
    clipboardTimer = setInterval(() => {
      const snapshot = readClipboardScreenshot();
      if (snapshot === null || disposed) {
        return;
      }
      onScreenshot(snapshot);
    }, CLIPBOARD_POLL_MS);
  };

  const start = (): void => {
    startDirectoryWatchers();
    startClipboardWatcher();
  };

  const dispose = (): void => {
    disposed = true;
    for (const timer of pendingFileReads.values()) {
      clearTimeout(timer);
    }
    pendingFileReads.clear();
    for (const watcher of directoryWatchers) {
      watcher.close();
    }
    directoryWatchers.length = 0;
    if (clipboardTimer !== null) {
      clearInterval(clipboardTimer);
      clipboardTimer = null;
    }
  };

  return {
    start,
    dispose
  };
};

export const nativeImageFromBase64 = (
  imageBase64: string,
  mimeType: "image/png" | "image/jpeg"
): Electron.NativeImage => {
  const buffer = Buffer.from(imageBase64, "base64");
  if (mimeType === "image/jpeg") {
    return nativeImage.createFromBuffer(buffer, { scaleFactor: 1.0 });
  }
  return nativeImage.createFromBuffer(buffer);
};