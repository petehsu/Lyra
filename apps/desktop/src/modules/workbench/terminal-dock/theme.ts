import type { ITheme } from "xterm";

const readCssVar = (target: HTMLElement, name: string): string => {
  const value = getComputedStyle(target).getPropertyValue(name).trim();
  return value;
};

const readCssColorVar = (target: HTMLElement, name: string, fallback: string): string => {
  const raw = readCssVar(target, name);
  const document = target.ownerDocument;
  const probe = document.createElement("span");
  probe.style.position = "absolute";
  probe.style.inset = "0 auto auto 0";
  probe.style.visibility = "hidden";
  probe.style.pointerEvents = "none";
  probe.style.color = `var(${name})`;
  target.append(probe);
  const computed = getComputedStyle(probe).color.trim();
  probe.remove();
  if (computed.length > 0 && computed.toLocaleLowerCase() !== "canvastext") {
    return computed;
  }
  if (raw.length > 0 && !raw.includes("var(") && !raw.includes("color-mix(")) {
    return raw;
  }
  return fallback;
};

export const resolveTerminalTheme = (target: HTMLElement): ITheme => ({
  background: readCssColorVar(target, "--lyra-terminal-bg", "#1f232b"),
  foreground: readCssColorVar(target, "--lyra-terminal-fg", "#dce0e5"),
  cursor: readCssColorVar(target, "--lyra-terminal-cursor", "#5c78e2"),
  cursorAccent: readCssColorVar(target, "--lyra-terminal-cursor-accent", "#1f232b"),
  selectionBackground: readCssColorVar(target, "--lyra-terminal-selection-bg", "#47679e"),
  black: readCssColorVar(target, "--lyra-terminal-black", "#282c33"),
  red: readCssColorVar(target, "--lyra-terminal-red", "#d36151"),
  green: readCssColorVar(target, "--lyra-terminal-green", "#669f59"),
  yellow: readCssColorVar(target, "--lyra-terminal-yellow", "#a48819"),
  blue: readCssColorVar(target, "--lyra-terminal-blue", "#5c78e2"),
  magenta: readCssColorVar(target, "--lyra-terminal-magenta", "#8c6bd8"),
  cyan: readCssColorVar(target, "--lyra-terminal-cyan", "#3a98a8"),
  white: readCssColorVar(target, "--lyra-terminal-white", "#dce0e5"),
  brightBlack: readCssColorVar(target, "--lyra-terminal-bright-black", "#878a98"),
  brightRed: readCssColorVar(target, "--lyra-terminal-bright-red", "#ef7c70"),
  brightGreen: readCssColorVar(target, "--lyra-terminal-bright-green", "#90ba6f"),
  brightYellow: readCssColorVar(target, "--lyra-terminal-bright-yellow", "#c9b25e"),
  brightBlue: readCssColorVar(target, "--lyra-terminal-bright-blue", "#8aa2f4"),
  brightMagenta: readCssColorVar(target, "--lyra-terminal-bright-magenta", "#af88ff"),
  brightCyan: readCssColorVar(target, "--lyra-terminal-bright-cyan", "#67c2d0"),
  brightWhite: readCssColorVar(target, "--lyra-terminal-bright-white", "#f4f4f5")
});
