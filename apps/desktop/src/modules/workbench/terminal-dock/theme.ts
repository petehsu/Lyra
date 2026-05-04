import type { ITheme } from "xterm";

const readCssVar = (target: HTMLElement, name: string, fallback: string): string => {
  const value = getComputedStyle(target).getPropertyValue(name).trim();
  if (value.length === 0) {
    return fallback;
  }
  return value;
};

export const resolveTerminalTheme = (target: HTMLElement): ITheme => ({
  background: readCssVar(target, "--lyra-terminal-bg", "#1f232b"),
  foreground: readCssVar(target, "--lyra-terminal-fg", "#dce0e5"),
  cursor: readCssVar(target, "--lyra-terminal-cursor", "#5c78e2"),
  cursorAccent: readCssVar(target, "--lyra-terminal-cursor-accent", "#1f232b"),
  selectionBackground: readCssVar(target, "--lyra-terminal-selection-bg", "#47679e"),
  black: readCssVar(target, "--lyra-terminal-black", "#282c33"),
  red: readCssVar(target, "--lyra-terminal-red", "#d36151"),
  green: readCssVar(target, "--lyra-terminal-green", "#669f59"),
  yellow: readCssVar(target, "--lyra-terminal-yellow", "#a48819"),
  blue: readCssVar(target, "--lyra-terminal-blue", "#5c78e2"),
  magenta: readCssVar(target, "--lyra-terminal-magenta", "#8c6bd8"),
  cyan: readCssVar(target, "--lyra-terminal-cyan", "#3a98a8"),
  white: readCssVar(target, "--lyra-terminal-white", "#dce0e5"),
  brightBlack: readCssVar(target, "--lyra-terminal-bright-black", "#878a98"),
  brightRed: readCssVar(target, "--lyra-terminal-bright-red", "#ef7c70"),
  brightGreen: readCssVar(target, "--lyra-terminal-bright-green", "#90ba6f"),
  brightYellow: readCssVar(target, "--lyra-terminal-bright-yellow", "#c9b25e"),
  brightBlue: readCssVar(target, "--lyra-terminal-bright-blue", "#8aa2f4"),
  brightMagenta: readCssVar(target, "--lyra-terminal-bright-magenta", "#af88ff"),
  brightCyan: readCssVar(target, "--lyra-terminal-bright-cyan", "#67c2d0"),
  brightWhite: readCssVar(target, "--lyra-terminal-bright-white", "#f4f4f5")
});
