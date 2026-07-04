import type { Stats } from "node:fs";

import { isSafeExternalUrl } from "./security";
import type { OpenInEditorRequest } from "../shared/desktop-bridge";

export type KnownEditor = {
  readonly id: string;
  readonly label: string;
  readonly bundle?: string;
  readonly cmd?: string;
};

export const KNOWN_EDITORS: readonly KnownEditor[] = [
  { id: "vscode", label: "VS Code", bundle: "Visual Studio Code.app", cmd: "code" },
  { id: "vscode-insiders", label: "VS Code Insiders", bundle: "VS Code - Insiders.app", cmd: "code-insiders" },
  { id: "cursor", label: "Cursor", bundle: "Cursor.app", cmd: "cursor" },
  { id: "windsurf", label: "Windsurf", bundle: "Windsurf.app", cmd: "windsurf" },
  { id: "zed", label: "Zed", bundle: "Zed.app", cmd: "zed" },
  { id: "sublime", label: "Sublime Text", bundle: "Sublime Text.app", cmd: "subl" },
  { id: "xcode", label: "Xcode", bundle: "Xcode.app" },
  { id: "nova", label: "Nova", bundle: "Nova.app" },
  { id: "webstorm", label: "WebStorm", bundle: "WebStorm.app", cmd: "webstorm" },
  { id: "intellij", label: "IntelliJ IDEA", bundle: "IntelliJ IDEA.app", cmd: "idea" },
  { id: "goland", label: "GoLand", bundle: "GoLand.app", cmd: "goland" },
  { id: "pycharm", label: "PyCharm", bundle: "PyCharm.app", cmd: "pycharm" },
  { id: "phpstorm", label: "PhpStorm", bundle: "PhpStorm.app", cmd: "phpstorm" },
  { id: "android-studio", label: "Android Studio", bundle: "Android Studio.app", cmd: "studio" },
  { id: "coderunner", label: "CodeRunner", bundle: "CodeRunner.app" },
];

type StatFn = (targetPath: string) => Promise<Stats | unknown>;
type ExecFileFn = (file: string, args: readonly string[]) => Promise<unknown>;

export type OpenExternalDeps = {
  readonly openExternal: (url: string) => Promise<unknown>;
};

export type OpenInEditorDeps = {
  readonly execFile: ExecFileFn;
  readonly platform: NodeJS.Platform;
  readonly stat: StatFn;
};

export type RevealInFolderDeps = {
  readonly showItemInFolder: (targetPath: string) => void;
  readonly stat: StatFn;
};

export const openExternalUrl = async (
  url: string,
  deps: OpenExternalDeps
): Promise<boolean> => {
  if (typeof url !== "string" || url.length === 0 || isSafeExternalUrl(url) === false) {
    return false;
  }
  try {
    await deps.openExternal(url);
    return true;
  } catch (_error) {
    return false;
  }
};

export const openInKnownEditor = async (
  request: OpenInEditorRequest,
  deps: OpenInEditorDeps
): Promise<boolean> => {
  if (!request || typeof request.editorId !== "string" || typeof request.path !== "string") {
    return false;
  }
  const targetPath = request.path.trim();
  if (targetPath.length === 0) {
    return false;
  }
  const editor = KNOWN_EDITORS.find((entry) => entry.id === request.editorId);
  if (editor === undefined) {
    return false;
  }
  try {
    await deps.stat(targetPath);
    if (deps.platform === "darwin" && editor.bundle !== undefined) {
      await deps.execFile("open", ["-a", editor.bundle.replace(/\.app$/u, ""), targetPath]);
      return true;
    }
    if (editor.cmd !== undefined) {
      await deps.execFile(editor.cmd, [targetPath]);
      return true;
    }
    return false;
  } catch (_error) {
    return false;
  }
};

export const revealPathInFolder = async (
  value: string,
  deps: RevealInFolderDeps
): Promise<boolean> => {
  const targetPath = typeof value === "string" ? value.trim() : "";
  if (targetPath.length === 0) {
    return false;
  }
  try {
    await deps.stat(targetPath);
    deps.showItemInFolder(targetPath);
    return true;
  } catch (_error) {
    return false;
  }
};
