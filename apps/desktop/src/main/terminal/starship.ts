import { app } from "electron";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import {
  isTerminalThemePresetId,
  type TerminalThemePresetId
} from "../../shared/terminal-theme";
import {
  resolvePromptGlyphs,
  resolvePromptPalette,
  resolvePromptStyle
} from "./prompt-theme";
import { createFallbackPromptCommand } from "./fallback-prompt";
const DEFAULT_TERMINAL_THEME_PRESET: TerminalThemePresetId = "glacier-blocks";
const DEFAULT_UI_THEME_ID = "one-dark";
type ShellFamily = "bash" | "zsh" | "powershell";
export type StarshipRuntimeStatus = {
  readonly available: boolean;
  readonly source: "embedded" | "path" | "missing";
  readonly binaryPath?: string;
  readonly reason?: string;
};
export type StarshipPromptInjection = {
  readonly applied: boolean;
  readonly deferred: boolean;
  readonly presetId: TerminalThemePresetId;
  readonly command?: string;
  readonly reason?: string;
};
type StarshipRuntime = {
  readonly binaryPath: string | null;
  readonly source: "embedded" | "path" | "missing";
  readonly reason?: string;
  readonly configDir: string;
};
const resolveBinaryName = (): string =>
  process.platform === "win32" ? "starship.exe" : "starship";
const resolveEmbeddedCandidates = (): readonly string[] => {
  const binaryName = resolveBinaryName();
  const appPath = app.getAppPath();
  const cwd = process.cwd();
  const resourcesPath = process.resourcesPath;
  return Array.from(
    new Set([
      path.join(resourcesPath, "starship", binaryName),
      path.join(resourcesPath, "bin", binaryName),
      path.join(appPath, "resources", "starship", binaryName),
      path.join(appPath, "resources", "bin", binaryName),
      path.join(cwd, "apps/desktop/resources/starship", binaryName),
      path.join(cwd, "apps/desktop/resources/starship", process.platform, binaryName)
    ])
  );
};
const isExecutableFile = (candidatePath: string): boolean => {
  try {
    const stat = fs.statSync(candidatePath);
    if (!stat.isFile()) {
      return false;
    }
    if (process.platform === "win32") {
      return true;
    }
    fs.accessSync(candidatePath, fs.constants.X_OK);
    return true;
  } catch (_error) {
    return false;
  }
};
const resolveBinaryFromPath = (): string | null => {
  const command = process.platform === "win32" ? "where" : "which";
  const result = spawnSync(command, ["starship"], { encoding: "utf8" });
  if (result.status !== 0) {
    return null;
  }
  const firstLine = result.stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line.length > 0);
  if (firstLine === undefined || firstLine.length === 0) {
    return null;
  }
  return firstLine;
};

const isUsableBinary = (binaryPath: string): boolean => {
  const probe = spawnSync(binaryPath, ["--version"], {
    encoding: "utf8",
    timeout: 1500
  });
  return probe.status === 0;
};

const ensureDir = (dirPath: string): void => {
  fs.mkdirSync(dirPath, { recursive: true });
};
const normalizePresetId = (value: unknown): TerminalThemePresetId =>
  isTerminalThemePresetId(value) ? value : DEFAULT_TERMINAL_THEME_PRESET;
const normalizeUiThemeId = (value: unknown): string => {
  if (typeof value !== "string") {
    return DEFAULT_UI_THEME_ID;
  }
  const trimmed = value.trim();
  return trimmed.length === 0 ? DEFAULT_UI_THEME_ID : trimmed;
};
const normalizeShellFamily = (shell: string): ShellFamily | null => {
  const normalized = path
    .basename(shell)
    .toLowerCase()
    .replace(/\.exe$/, "");
  if (normalized === "bash") {
    return "bash";
  }
  if (normalized === "zsh") {
    return "zsh";
  }
  if (normalized === "pwsh" || normalized === "powershell") {
    return "powershell";
  }
  return null;
};
const escapeDoubleQuotes = (value: string): string =>
  value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');

const createShellBootstrapCommand = (
  shellFamily: ShellFamily,
  binaryPath: string,
  configPath: string,
  presetId: TerminalThemePresetId
): string => {
  if (shellFamily === "powershell") {
    const escapedBinary = escapeDoubleQuotes(binaryPath);
    const escapedConfig = escapeDoubleQuotes(configPath);
    const escapedPreset = escapeDoubleQuotes(presetId);
    return [
      `$env:STARSHIP_CONFIG="${escapedConfig}"`,
      `$env:LYRA_TERMINAL_THEME_PRESET="${escapedPreset}"`,
      `Invoke-Expression (& "${escapedBinary}" init powershell)`
    ].join("\r\n");
  }
  const escapedBinary = escapeDoubleQuotes(binaryPath);
  const escapedConfig = escapeDoubleQuotes(configPath);
  const escapedPreset = escapeDoubleQuotes(presetId);
  return [
    `export LYRA_STARSHIP_BIN="${escapedBinary}"`,
    `export STARSHIP_CONFIG="${escapedConfig}"`,
    `export LYRA_TERMINAL_THEME_PRESET="${escapedPreset}"`,
    `eval "$("$LYRA_STARSHIP_BIN" init ${shellFamily})"`,
    "unset LYRA_STARSHIP_BIN"
  ].join("\n");
};
const createStarshipToml = (
  uiThemeId: string,
  presetId: TerminalThemePresetId
): string => {
  const palette = resolvePromptPalette(uiThemeId);
  const glyphs = resolvePromptGlyphs(presetId);
  const style = resolvePromptStyle(presetId, palette, glyphs);
  return [
    'format = """',
    style.format,
    '"""',
    ...(style.rightFormat === undefined
      ? []
      : [
          "",
          'right_format = """',
          style.rightFormat,
          '"""'
        ]),
    "",
    "[os]",
    "disabled = false",
    `style = "fg:${palette.leftFg} bg:${palette.leftA}"`,
    `format = "${style.osFormat}"`,
    "",
    "[username]",
    "show_always = true",
    `style_user = "fg:${palette.leftFg} bg:${palette.leftA}"`,
    `style_root = "fg:${palette.leftFg} bg:${palette.leftA}"`,
    `format = "${style.usernameFormat}"`,
    "",
    "[directory]",
    `style = "fg:${palette.leftFg} bg:${palette.leftB}"`,
    `format = "${style.directoryFormat}"`,
    "truncation_length = 3",
    "truncate_to_repo = false",
    "",
    "[git_branch]",
    `symbol = "${glyphs.git} "`,
    `style = "fg:${palette.leftFg} bg:${palette.leftC}"`,
    `format = "${style.gitBranchFormat}"`,
    "",
    "[git_status]",
    `style = "fg:${palette.leftFg} bg:${palette.leftC}"`,
    `format = "${style.gitStatusFormat}"`,
    "",
    "[cmd_duration]",
    `disabled = ${style.cmdDurationEnabled ? "false" : "true"}`,
    "min_time = 0",
    `style = "fg:${palette.rightFg} bg:${palette.rightA}"`,
    `format = "${style.cmdDurationFormat}"`,
    "",
    "[time]",
    `disabled = ${style.timeEnabled ? "false" : "true"}`,
    "time_format = '%H:%M:%S'",
    `style = "fg:${palette.rightFg} bg:${palette.rightB}"`,
    `format = "${style.timeFormat}"`,
    "",
    "[character]",
    `success_symbol = "${style.successSymbol}"`,
    `error_symbol = "${style.errorSymbol}"`,
    `vimcmd_symbol = "${style.vimcmdSymbol}"`
  ].join("\n");
};
const toSafeFilePart = (value: string): string =>
  value.toLowerCase().replace(/[^a-z0-9-_]/g, "_");
const resolveConfigPath = (
  runtime: StarshipRuntime,
  presetId: TerminalThemePresetId,
  uiThemeId: string
): string => {
  ensureDir(runtime.configDir);
  const fileName = `preset-${toSafeFilePart(presetId)}-theme-${toSafeFilePart(uiThemeId)}.toml`;
  const configPath = path.join(runtime.configDir, fileName);
  fs.writeFileSync(configPath, createStarshipToml(uiThemeId, presetId), "utf8");
  return configPath;
};
export const createStarshipRuntime = (storageRoot: string): StarshipRuntime => {
  const configDir = path.join(storageRoot, "starship");
  for (const candidate of resolveEmbeddedCandidates()) {
    if (isExecutableFile(candidate) && isUsableBinary(candidate)) {
      return {
        binaryPath: candidate,
        source: "embedded",
        configDir
      };
    }
  }
  const pathBinary = resolveBinaryFromPath();
  if (
    pathBinary !== null &&
    isExecutableFile(pathBinary) &&
    isUsableBinary(pathBinary)
  ) {
    return {
      binaryPath: pathBinary,
      source: "path",
      configDir
    };
  }
  return {
    binaryPath: null,
    source: "missing",
    reason: "starship binary unavailable (embedded and PATH not found)",
    configDir
  };
};
export const describeStarshipRuntime = (runtime: StarshipRuntime): StarshipRuntimeStatus => {
  if (runtime.binaryPath === null) {
    if (runtime.reason === undefined) {
      return {
        available: false,
        source: "missing"
      };
    }
    return {
      available: false,
      source: "missing",
      reason: runtime.reason
    };
  }
  return {
    available: true,
    source: runtime.source,
    binaryPath: runtime.binaryPath
  };
};
export const buildStarshipPromptInjection = (
  runtime: StarshipRuntime,
  input: {
    readonly shell: string;
    readonly presetId?: TerminalThemePresetId;
    readonly uiThemeId?: string;
  }
): StarshipPromptInjection => {
  const presetId = normalizePresetId(input.presetId);
  const uiThemeId = normalizeUiThemeId(input.uiThemeId);
  const shellFamily = normalizeShellFamily(input.shell);
  if (shellFamily === null) {
    return {
      applied: false,
      deferred: true,
      presetId,
      reason: `shell does not support prompt reload: ${input.shell}`
    };
  }

  if (runtime.binaryPath === null) {
    const fallbackCommand = createFallbackPromptCommand(
      shellFamily,
      uiThemeId,
      presetId
    );
    if (fallbackCommand !== null) {
      return {
        applied: true,
        deferred: false,
        presetId,
        command: `${fallbackCommand}\n`
      };
    }
    return {
      applied: false,
      deferred: true,
      presetId,
      reason: runtime.reason ?? "starship runtime unavailable"
    };
  }
  const configPath = resolveConfigPath(runtime, presetId, uiThemeId);
  const command = createShellBootstrapCommand(
    shellFamily,
    runtime.binaryPath,
    configPath,
    presetId
  );
  return {
    applied: true,
    deferred: false,
    presetId,
    command: `${command}\n`
  };
};
