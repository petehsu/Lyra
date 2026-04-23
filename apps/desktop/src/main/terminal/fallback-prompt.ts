import type { TerminalThemeMode } from "../../shared/terminal-theme";
import { resolvePromptGlyphs, resolvePromptPalette } from "./prompt-theme";

export type PromptShellFamily = "bash" | "zsh" | "powershell";
const BASH_PROMPT_READY_MARKER = "\\[\\e]633;LyraPrompt\\a\\]";
const ZSH_PROMPT_READY_MARKER = "%{\u001b]633;LyraPrompt\u0007%}";

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

const BASH_ANSI_RESET = "\\[\\e[0m\\]";

const createBashResetPromptCommand = (): string =>
  [
    "unset PROMPT_COMMAND",
    "trap - DEBUG",
    "unset __lyra_prompt_cmd_start",
    "unset -f __lyra_git_branch __lyra_prompt_symbol __lyra_prompt_duration __lyra_preexec __lyra_precmd 2>/dev/null",
    "stty erase '^?' >/dev/null 2>&1 || true",
    "bind '\"\\C-h\":backward-delete-char' >/dev/null 2>&1 || true",
    "bind '\"\\C-?\":backward-delete-char' >/dev/null 2>&1 || true",
    "bind '\"\\e[3~\":delete-char' >/dev/null 2>&1 || true",
    `PS1='${BASH_PROMPT_READY_MARKER}\\u@\\h:\\w\\$ '`
  ].join("\n");

const createBashLyraPromptCommand = (
  uiThemeId: string,
  mode: Exclude<TerminalThemeMode, "follow-app">
): string => {
  const palette = resolvePromptPalette(uiThemeId);
  const glyphs = resolvePromptGlyphs(mode);
  const fgA = bashAnsiFg(palette.leftA);
  const fgB = bashAnsiFg(palette.leftB);
  const fgC = bashAnsiFg(palette.leftC);
  const fgSuccess = bashAnsiFg(palette.success);
  const fgError = bashAnsiFg(palette.error);

  const promptBody = (() => {
    if (mode === "lyra-minimal") {
      return `  PS1="${BASH_PROMPT_READY_MARKER}${fgB}${glyphs.directory} \\\\w${BASH_ANSI_RESET}${'$'}{git_segment}\\\\n${'$'}{status_segment} ${BASH_ANSI_RESET}"`;
    }

    if (mode === "lyra-standard") {
      return [
        `  local user_segment="${fgA}\\u${BASH_ANSI_RESET}"`,
        `  local dir_segment=" ${fgB}${glyphs.directory} \\\\w${BASH_ANSI_RESET}"`,
        `  local prompt_marker="${BASH_PROMPT_READY_MARKER}"`,
        "  PS1=\"${prompt_marker}${user_segment}${dir_segment}${git_segment}\\n${status_segment} " +
          `${BASH_ANSI_RESET}\"`
      ].join("\n");
    }

    if (mode === "lyra-rich") {
      return [
        `  local user_segment="${fgA}\\u${BASH_ANSI_RESET}"`,
        `  local dir_segment=" ${fgB}${glyphs.directory} \\\\w${BASH_ANSI_RESET}"`,
        `  local time_segment=" ${fgC}${glyphs.time} \\\\t${BASH_ANSI_RESET}"`,
        `  local prompt_marker="${BASH_PROMPT_READY_MARKER}"`,
        "  PS1=\"${prompt_marker}${user_segment}${dir_segment}${git_segment}${time_segment}\\n${status_segment} " +
          `${BASH_ANSI_RESET}\"`
      ].join("\n");
    }

    return [
      "  local duration_segment",
      "  duration_segment=\"$(__lyra_prompt_duration)\"",
      `  local user_segment="${fgA}\\u${BASH_ANSI_RESET}"`,
      `  local dir_segment=" ${fgB}${glyphs.directory} \\\\w${BASH_ANSI_RESET}"`,
      `  local meta_segment=" ${fgC}${glyphs.time} \\\\t ${fgA}[code:${'$'}{exit_code} dur:${'$'}{duration_segment}]${BASH_ANSI_RESET}"`,
      `  local prompt_marker="${BASH_PROMPT_READY_MARKER}"`,
      "  PS1=\"${prompt_marker}${user_segment}${dir_segment}${git_segment}\\n${meta_segment}\\n${status_segment} " +
        `${BASH_ANSI_RESET}\"`
    ].join("\n");
  })();

  return [
    "__lyra_git_branch() {",
    "  local branch",
    '  branch="$(command git symbolic-ref --short HEAD 2>/dev/null || command git rev-parse --short HEAD 2>/dev/null)" || return',
    '  [ -n "$branch" ] || return',
    '  printf "%s" "$branch"',
    "}",
    "__lyra_prompt_symbol() {",
    '  local code="$1"',
    '  if [ "$code" -eq 0 ]; then',
    `    printf "${fgSuccess}${glyphs.success}${BASH_ANSI_RESET}"`,
    "  else",
    `    printf "${fgError}${glyphs.error}${BASH_ANSI_RESET}"`,
    "  fi",
    "}",
    "__lyra_prompt_cmd_start=${SECONDS:-0}",
    "__lyra_prompt_duration() {",
    "  local elapsed=$((SECONDS - __lyra_prompt_cmd_start))",
    "  if [ \"$elapsed\" -lt 0 ]; then elapsed=0; fi",
    '  printf "%ss" "$elapsed"',
    "}",
    "__lyra_preexec() {",
    '  case "$BASH_COMMAND" in',
    "    __lyra_preexec*|__lyra_precmd*|__lyra_prompt_symbol*|__lyra_prompt_duration*) return ;;",
    "  esac",
    "  __lyra_prompt_cmd_start=${SECONDS:-0}",
    "}",
    "trap '__lyra_preexec' DEBUG",
    "__lyra_precmd() {",
    '  local exit_code="$?"',
    "  local branch",
    '  branch="$(__lyra_git_branch)"',
    "  local git_segment=\"\"",
    '  if [ -n "$branch" ]; then',
    `    git_segment=" ${fgC}${glyphs.git} ${'$'}{branch}${BASH_ANSI_RESET}"`,
    "  fi",
    "  local status_segment",
    '  status_segment="$(__lyra_prompt_symbol \"$exit_code\")"',
    promptBody,
    "}",
    "PROMPT_COMMAND='__lyra_precmd'",
    "stty erase '^?' >/dev/null 2>&1 || true",
    "bind '\"\\C-h\":backward-delete-char' >/dev/null 2>&1 || true",
    "bind '\"\\C-?\":backward-delete-char' >/dev/null 2>&1 || true",
    "bind '\"\\e[3~\":delete-char' >/dev/null 2>&1 || true"
  ].join("\n");
};

const createZshResetPromptCommand = (): string =>
  [
    "autoload -Uz add-zsh-hook >/dev/null 2>&1",
    "add-zsh-hook -d preexec __lyra_preexec >/dev/null 2>&1",
    "add-zsh-hook -d precmd __lyra_precmd >/dev/null 2>&1",
    "unfunction __lyra_git_branch __lyra_prompt_symbol __lyra_prompt_duration __lyra_preexec __lyra_precmd >/dev/null 2>&1",
    "stty erase '^?' >/dev/null 2>&1 || true",
    "bindkey -M emacs '^?' backward-delete-char >/dev/null 2>&1 || true",
    "bindkey -M emacs '^H' backward-delete-char >/dev/null 2>&1 || true",
    "bindkey -M emacs '^[[3~' delete-char >/dev/null 2>&1 || true",
    "bindkey -M emacs '^[[P' delete-char >/dev/null 2>&1 || true",
    "bindkey -M viins '^?' backward-delete-char >/dev/null 2>&1 || true",
    "bindkey -M viins '^H' backward-delete-char >/dev/null 2>&1 || true",
    "bindkey -M viins '^[[3~' delete-char >/dev/null 2>&1 || true",
    "bindkey -M viins '^[[P' delete-char >/dev/null 2>&1 || true",
    "bindkey -M vicmd '^?' backward-delete-char >/dev/null 2>&1 || true",
    "bindkey -M vicmd '^H' backward-delete-char >/dev/null 2>&1 || true",
    "bindkey -M vicmd '^[[3~' delete-char >/dev/null 2>&1 || true",
    "bindkey -M vicmd '^[[P' delete-char >/dev/null 2>&1 || true",
    "bindkey '^?' backward-delete-char >/dev/null 2>&1 || true",
    "bindkey '^H' backward-delete-char >/dev/null 2>&1 || true",
    "bindkey '^[[3~' delete-char >/dev/null 2>&1 || true",
    "bindkey '^[[P' delete-char >/dev/null 2>&1 || true",
    "KEYTIMEOUT=1",
    "unsetopt prompt_subst",
    `PROMPT='${ZSH_PROMPT_READY_MARKER}%n@%m:%~%# '`,
    "RPROMPT=''"
  ].join("\n");

const createZshLyraPromptCommand = (
  uiThemeId: string,
  mode: Exclude<TerminalThemeMode, "follow-app">
): string => {
  const palette = resolvePromptPalette(uiThemeId);
  const glyphs = resolvePromptGlyphs(mode);
  const fgA = `%F{${normalizeHex(palette.leftA)}}`;
  const fgB = `%F{${normalizeHex(palette.leftB)}}`;
  const fgC = `%F{${normalizeHex(palette.leftC)}}`;
  const fgSuccess = `%F{${normalizeHex(palette.success)}}`;
  const fgError = `%F{${normalizeHex(palette.error)}}`;
  const reset = "%f";

  const promptBody = (() => {
    if (mode === "lyra-minimal") {
      return `  PROMPT="${ZSH_PROMPT_READY_MARKER}${fgB}${glyphs.directory} %~${'$'}{git_segment}${reset}${'$'}{newline}${'$'}{status_segment} ${reset}"`;
    }

    if (mode === "lyra-standard") {
      return [
        `  local header="${fgA}%n${reset} ${fgB}${glyphs.directory} %~${reset}"`,
        `  local prompt_marker="${ZSH_PROMPT_READY_MARKER}"`,
        "  PROMPT=\"${prompt_marker}${header}${git_segment}${newline}${status_segment} " +
          `${reset}\"`
      ].join("\n");
    }

    if (mode === "lyra-rich") {
      return [
        `  local header="${fgA}%n${reset} ${fgB}${glyphs.directory} %~${reset}${'$'}{git_segment} ${fgC}${glyphs.time} %*${reset}"`,
        `  local prompt_marker="${ZSH_PROMPT_READY_MARKER}"`,
        "  PROMPT=\"${prompt_marker}${header}${newline}${status_segment} " +
          `${reset}\"`
      ].join("\n");
    }

    return [
      "  local duration_segment",
      "  duration_segment=\"$(__lyra_prompt_duration)\"",
      `  local header="${fgA}%n${reset} ${fgB}${glyphs.directory} %~${reset}${'$'}{git_segment}"`,
      `  local meta_segment="${fgC}${glyphs.time} %* ${fgA}[code:${'$'}{exit_code} dur:${'$'}{duration_segment}]${reset}"`,
      `  local prompt_marker="${ZSH_PROMPT_READY_MARKER}"`,
      "  PROMPT=\"${prompt_marker}${header}${newline}${meta_segment}${newline}${status_segment} " +
        `${reset}\"`
    ].join("\n");
  })();

  return [
    "setopt prompt_subst",
    "autoload -Uz add-zsh-hook >/dev/null 2>&1",
    "__lyra_git_branch() {",
    "  local branch",
    "  branch=$(command git symbolic-ref --short HEAD 2>/dev/null || command git rev-parse --short HEAD 2>/dev/null) || return",
    "  [[ -n \"$branch\" ]] || return",
    "  printf '%s' \"$branch\"",
    "}",
    "__lyra_prompt_symbol() {",
    "  local code=\"$1\"",
    "  if [[ \"$code\" -eq 0 ]]; then",
    `    printf '%s' '${fgSuccess}${glyphs.success}${reset}'`,
    "  else",
    `    printf '%s' '${fgError}${glyphs.error}${reset}'`,
    "  fi",
    "}",
    "__lyra_prompt_cmd_start=${EPOCHSECONDS:-0}",
    "__lyra_prompt_duration() {",
    "  local elapsed=$(( ${EPOCHSECONDS:-0} - __lyra_prompt_cmd_start ))",
    "  if [[ \"$elapsed\" -lt 0 ]]; then elapsed=0; fi",
    "  printf '%ss' \"$elapsed\"",
    "}",
    "__lyra_preexec() {",
    "  __lyra_prompt_cmd_start=${EPOCHSECONDS:-0}",
    "}",
    "__lyra_precmd() {",
    "  local exit_code=$?",
    "  local branch",
    "  branch=\"$(__lyra_git_branch)\"",
    "  local git_segment=''",
    "  if [[ -n \"$branch\" ]]; then",
    `    git_segment=" ${fgC}${glyphs.git} ${'$'}{branch}${reset}"`,
    "  fi",
    "  local status_segment",
    "  status_segment=\"$(__lyra_prompt_symbol \"$exit_code\")\"",
    "  local newline=$'\\n'",
    promptBody,
    "  RPROMPT=''",
    "}",
    "add-zsh-hook -d preexec __lyra_preexec >/dev/null 2>&1",
    "add-zsh-hook -d precmd __lyra_precmd >/dev/null 2>&1",
    "add-zsh-hook preexec __lyra_preexec",
    "add-zsh-hook precmd __lyra_precmd",
    "stty erase '^?' >/dev/null 2>&1 || true",
    "bindkey -M emacs '^?' backward-delete-char >/dev/null 2>&1 || true",
    "bindkey -M emacs '^H' backward-delete-char >/dev/null 2>&1 || true",
    "bindkey -M emacs '^[[3~' delete-char >/dev/null 2>&1 || true",
    "bindkey -M emacs '^[[P' delete-char >/dev/null 2>&1 || true",
    "bindkey -M viins '^?' backward-delete-char >/dev/null 2>&1 || true",
    "bindkey -M viins '^H' backward-delete-char >/dev/null 2>&1 || true",
    "bindkey -M viins '^[[3~' delete-char >/dev/null 2>&1 || true",
    "bindkey -M viins '^[[P' delete-char >/dev/null 2>&1 || true",
    "bindkey -M vicmd '^?' backward-delete-char >/dev/null 2>&1 || true",
    "bindkey -M vicmd '^H' backward-delete-char >/dev/null 2>&1 || true",
    "bindkey -M vicmd '^[[3~' delete-char >/dev/null 2>&1 || true",
    "bindkey -M vicmd '^[[P' delete-char >/dev/null 2>&1 || true",
    "bindkey '^?' backward-delete-char >/dev/null 2>&1 || true",
    "bindkey '^H' backward-delete-char >/dev/null 2>&1 || true",
    "bindkey '^[[3~' delete-char >/dev/null 2>&1 || true",
    "bindkey '^[[P' delete-char >/dev/null 2>&1 || true",
    "KEYTIMEOUT=1"
  ].join("\n");
};

export const resolvePromptShellFamily = (shell: string): PromptShellFamily | null => {
  const shellParts = shell.split(/[\\/]/);
  const normalized = shellParts[shellParts.length - 1]
    ?.toLowerCase()
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

export const createPromptReloadCommand = (
  shellFamily: PromptShellFamily,
  uiThemeId: string,
  mode: TerminalThemeMode
): string | null => {
  if (shellFamily === "powershell") {
    return null;
  }

  if (mode === "follow-app") {
    return shellFamily === "bash"
      ? createBashResetPromptCommand()
      : createZshResetPromptCommand();
  }

  return shellFamily === "bash"
    ? createBashLyraPromptCommand(uiThemeId, mode)
    : createZshLyraPromptCommand(uiThemeId, mode);
};
