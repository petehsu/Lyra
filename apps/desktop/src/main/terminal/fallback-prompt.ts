import type { TerminalThemePresetId } from "../../shared/terminal-theme";
import { resolvePromptGlyphs, resolvePromptPalette } from "./prompt-theme";

export type PromptShellFamily = "bash" | "zsh" | "powershell";

const normalizeHex = (value: string): string => {
  const trimmed = value.trim();
  if (/^#[0-9a-fA-F]{6}$/.test(trimmed)) {
    return trimmed;
  }
  if (/^#[0-9a-fA-F]{3}$/.test(trimmed)) {
    const [r, g, b] = trimmed.slice(1);
    return `#${r}${r}${g}${g}${b}${b}`;
  }
  return "#ffffff";
};

const parseHexRgb = (value: string): { readonly r: number; readonly g: number; readonly b: number } => {
  const normalized = normalizeHex(value).slice(1);
  return {
    r: Number.parseInt(normalized.slice(0, 2), 16),
    g: Number.parseInt(normalized.slice(2, 4), 16),
    b: Number.parseInt(normalized.slice(4, 6), 16)
  };
};

const bashAnsiFg = (value: string): string => {
  const rgb = parseHexRgb(value);
  return `\\[\\e[38;2;${rgb.r};${rgb.g};${rgb.b}m\\]`;
};

const bashAnsiBg = (value: string): string => {
  const rgb = parseHexRgb(value);
  return `\\[\\e[48;2;${rgb.r};${rgb.g};${rgb.b}m\\]`;
};

const BASH_ANSI_RESET = "\\[\\e[0m\\]";

const createBashFallbackPromptCommand = (
  uiThemeId: string,
  presetId: TerminalThemePresetId
): string => {
  const palette = resolvePromptPalette(uiThemeId);
  const glyphs = resolvePromptGlyphs(presetId);
  const fgMain = bashAnsiFg(palette.leftFg);
  const fgAccentA = bashAnsiFg(palette.leftA);
  const fgAccentB = bashAnsiFg(palette.leftB);
  const fgAccentC = bashAnsiFg(palette.leftC);
  const fgSuccess = bashAnsiFg(palette.success);
  const fgError = bashAnsiFg(palette.error);
  const bgA = bashAnsiBg(palette.leftA);
  const bgB = bashAnsiBg(palette.leftB);
  const bgC = bashAnsiBg(palette.leftC);
  const bgRightA = bashAnsiBg(palette.rightA);
  const separator = "";

  const commonFunctions = [
    "__lyra_git_branch() {",
    "  local branch",
    '  branch="$(command git symbolic-ref --short HEAD 2>/dev/null || command git rev-parse --short HEAD 2>/dev/null)" || return',
    '  [ -n "$branch" ] || return',
    '  printf "%s" "$branch"',
    "}",
    "__lyra_prompt_char() {",
    '  local code="$?"',
    '  if [ "$code" -eq 0 ]; then',
    `    printf "${fgSuccess}${glyphs.success}${BASH_ANSI_RESET}"`,
    "  else",
    `    printf "${fgError}${glyphs.error}${BASH_ANSI_RESET}"`,
    "  fi",
    "}"
  ];

  if (presetId === "ocean-matrix") {
    return [
      ...commonFunctions,
      "__lyra_git_line() {",
      "  local branch",
      '  branch="$(__lyra_git_branch)"',
      '  [ -n "$branch" ] || return',
      `  printf " ${glyphs.git} %s" "$branch"`,
      "}",
      "PROMPT_COMMAND=''",
      `PS1='${fgAccentA}┌─ ${glyphs.directory} \\w${fgAccentB}$(__lyra_git_line)${BASH_ANSI_RESET}\\n${fgAccentC}└─$(__lyra_prompt_char) ${BASH_ANSI_RESET}'`
    ].join("\n");
  }

  if (presetId === "amber-forge") {
    return [
      ...commonFunctions,
      "__lyra_git_block() {",
      "  local branch",
      '  branch="$(__lyra_git_branch)"',
      '  [ -n "$branch" ] || return',
      `  printf " ${glyphs.git} %s " "$branch"`,
      "}",
      "PROMPT_COMMAND=''",
      `PS1='${bgA}${fgMain} ${glyphs.time} \\u ${BASH_ANSI_RESET}${fgAccentA}${separator}${bgB}${fgMain} ${glyphs.directory} \\W ${BASH_ANSI_RESET}${fgAccentB}${separator}${bgC}${fgMain}$(__lyra_git_block)${BASH_ANSI_RESET}${fgAccentC} [\\t] ${BASH_ANSI_RESET}\\n$(__lyra_prompt_char) ${BASH_ANSI_RESET}'`
    ].join("\n");
  }

  if (presetId === "mono-signal") {
    return [
      ...commonFunctions,
      "__lyra_git_bracket() {",
      "  local branch",
      '  branch="$(__lyra_git_branch)"',
      '  [ -n "$branch" ] || return',
      `  printf " | ${glyphs.git}:%s" "$branch"`,
      "}",
      "PROMPT_COMMAND=''",
      `PS1='${fgMain}[\\u ${glyphs.directory} \\w$(__lyra_git_bracket)]${BASH_ANSI_RESET}\\n$(__lyra_prompt_char) ${BASH_ANSI_RESET}'`
    ].join("\n");
  }

  return [
    ...commonFunctions,
    "__lyra_git_block() {",
    "  local branch",
    '  branch="$(__lyra_git_branch)"',
    '  [ -n "$branch" ] || return',
    `  printf " ${glyphs.git} %s " "$branch"`,
    "}",
    "PROMPT_COMMAND=''",
    `PS1='${bgA}${fgMain} ${glyphs.time} \\u ${BASH_ANSI_RESET}${fgAccentA}${separator}${bgB}${fgMain} ${glyphs.directory} \\w ${BASH_ANSI_RESET}${fgAccentB}${separator}${bgC}${fgMain}$(__lyra_git_block)${BASH_ANSI_RESET}${fgAccentC}${separator}${bgRightA}${fgMain} ${glyphs.duration} \\t ${BASH_ANSI_RESET}\\n$(__lyra_prompt_char) ${BASH_ANSI_RESET}'`
  ].join("\n");
};

const createZshFallbackPromptCommand = (
  uiThemeId: string,
  presetId: TerminalThemePresetId
): string => {
  const palette = resolvePromptPalette(uiThemeId);
  const glyphs = resolvePromptGlyphs(presetId);
  const fgA = `%F{${normalizeHex(palette.leftA)}}`;
  const fgB = `%F{${normalizeHex(palette.leftB)}}`;
  const fgC = `%F{${normalizeHex(palette.leftC)}}`;
  const fgSuccess = `%F{${normalizeHex(palette.success)}}`;
  const fgError = `%F{${normalizeHex(palette.error)}}`;
  const reset = "%f";

  if (presetId === "mono-signal") {
    return `PROMPT='${fgA}[%n ${glyphs.directory} %~ \${vcs_info_msg_0_}]${reset}
%(?.${fgSuccess}>.${fgError}x) ${reset}'`;
  }

  if (presetId === "ocean-matrix") {
    return `PROMPT='${fgA}┌─ ${glyphs.directory} %~ ${fgB}\${vcs_info_msg_0_}${reset}
${fgC}└─ %(?.${glyphs.success}.${glyphs.error}) ${reset}'`;
  }

  if (presetId === "amber-forge") {
    return `PROMPT='${fgA}${glyphs.time} %n ${fgB}${glyphs.directory} %1~ ${fgC}\${vcs_info_msg_0_} [%*]${reset}
%(?.${fgSuccess}${glyphs.success}.${fgError}${glyphs.error}) ${reset}'`;
  }

  return `PROMPT='${fgA}${glyphs.time} %n ${fgB}${glyphs.directory} %~ ${fgC}\${vcs_info_msg_0_}${reset}
%(?.${fgSuccess}${glyphs.success}.${fgError}${glyphs.error}) ${reset}'`;
};

export const createFallbackPromptCommand = (
  shellFamily: PromptShellFamily,
  uiThemeId: string,
  presetId: TerminalThemePresetId
): string | null => {
  if (shellFamily === "bash") {
    return createBashFallbackPromptCommand(uiThemeId, presetId);
  }
  if (shellFamily === "zsh") {
    return createZshFallbackPromptCommand(uiThemeId, presetId);
  }
  return null;
};

