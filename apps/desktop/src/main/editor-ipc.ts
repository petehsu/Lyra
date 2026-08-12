import { app, ipcMain, shell } from "electron";
import { execFile, execSync } from "node:child_process";
import { existsSync } from "node:fs";
import { stat } from "node:fs/promises";
import { homedir, platform } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import {
  LYRA_CHANNELS,
  type DetectedEditor,
  type OpenInEditorRequest
} from "../shared/desktop-bridge";
import {
  KNOWN_EDITORS,
  openExternalUrl,
  openInKnownEditor,
  revealPathInFolder
} from "./editor-actions";

const execFileAsync = promisify(execFile);
const execFileHidden = (file: string, args: readonly string[]): Promise<unknown> =>
  execFileAsync(file, [...args], { windowsHide: true });

const detectEditors = async (): Promise<DetectedEditor[]> => {
  const currentPlatform = platform();
  const found = new Map<string, DetectedEditor>();
  const macAppDirs = currentPlatform === "darwin"
    ? ["/Applications", join(homedir(), "Applications")]
    : [];

  for (const editor of KNOWN_EDITORS) {
    if (found.has(editor.id)) {
      continue;
    }
    let detected = false;
    if (currentPlatform === "darwin" && editor.bundle !== undefined) {
      for (const directory of macAppDirs) {
        const appPath = join(directory, editor.bundle);
        if (!existsSync(appPath)) {
          continue;
        }
        let icon: string | undefined;
        try {
          icon = (await app.getFileIcon(appPath, { size: "small" })).toDataURL();
        } catch {
          // The editor remains usable when its icon cannot be read.
        }
        found.set(
          editor.id,
          icon === undefined
            ? { id: editor.id, label: editor.label }
            : { id: editor.id, label: editor.label, icon }
        );
        detected = true;
        break;
      }
    }
    if (detected || editor.cmd === undefined) {
      continue;
    }
    try {
      execSync(
        currentPlatform === "win32" ? `where ${editor.cmd}` : `which ${editor.cmd}`,
        { stdio: "ignore", windowsHide: true }
      );
      found.set(editor.id, { id: editor.id, label: editor.label });
    } catch {
      // Command is not installed.
    }
  }
  return [...found.values()];
};

export const registerEditorIpcHandlers = (): void => {
  ipcMain.handle(LYRA_CHANNELS.openExternal, async (_event, url: string): Promise<boolean> =>
    openExternalUrl(url, { openExternal: shell.openExternal })
  );
  ipcMain.handle(LYRA_CHANNELS.detectEditors, detectEditors);
  ipcMain.handle(
    LYRA_CHANNELS.openInEditor,
    async (_event, request: OpenInEditorRequest): Promise<boolean> =>
      openInKnownEditor(request, {
        execFile: execFileHidden,
        platform: platform(),
        stat
      })
  );
  ipcMain.handle(
    LYRA_CHANNELS.revealInFolder,
    async (_event, path: string): Promise<boolean> =>
      revealPathInFolder(path, {
        showItemInFolder: shell.showItemInFolder,
        stat
      })
  );
};
