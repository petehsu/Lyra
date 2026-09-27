import type { KeyboardInputEvent } from "electron";

type Modifier = "shift" | "control" | "alt" | "meta";
const modifiers: Record<string, Modifier> = {
  shift: "shift", ctrl: "control", control: "control", alt: "alt", option: "alt",
  meta: "meta", cmd: "meta", command: "meta", super: "meta"
};
const namedKeys = ["Up", "Down", "Left", "Right", "Home", "End", "PageUp", "PageDown",
  "Tab", "Enter", "Esc", "Backspace", "Delete", "Insert", "Shift", "Control", "Alt", "Meta"];
const aliases: Record<string, string> = {
  ...Object.fromEntries(namedKeys.map(key => [key.toLowerCase(), key])),
  arrowup: "Up", arrowdown: "Down", arrowleft: "Left", arrowright: "Right",
  escape: "Esc", return: "Enter", space: " "
};

const parseBrowserKey = (chord: string): { keyCode: string; held: Modifier[] } => {
  const parts = chord === "+" ? ["+"] : chord.endsWith("++")
    ? [...chord.slice(0, -2).split("+"), "+"] : chord.split("+");
  const key = parts.pop() ?? "";
  const held: Modifier[] = [];
  for (const part of parts) {
    const modifier = modifiers[part.toLowerCase()];
    if (!modifier) throw new Error(`Unsupported key modifier: ${part}`);
    if (!held.includes(modifier)) held.push(modifier);
  }
  const keyCode = key.length === 1 ? key : aliases[key.toLowerCase()]
    ?? (/^f([1-9]|1[0-9]|2[0-4])$/i.test(key) ? key.toUpperCase() : undefined);
  if (!keyCode) throw new Error(`Unsupported key: ${key}`);
  return { keyCode, held };
};

const isSelectionKey = ({ keyCode, held }: ReturnType<typeof parseBrowserKey>): boolean =>
  ["Up", "Down", "Left", "Right", "Home", "End", "PageUp", "PageDown"].includes(keyCode)
  && !held.includes("alt");

/** Electron accepts a keyCode plus separate modifiers, not a Playwright chord. */
export const browserKeyEvents = (chord: string): KeyboardInputEvent[] => {
  const { keyCode, held } = parseBrowserKey(chord);
  return [
    { type: "keyDown", keyCode, modifiers: held },
    ...(keyCode.length === 1 && !held.some(modifier => modifier !== "shift")
      ? [{ type: "char" as const, keyCode: held.includes("shift") ? keyCode.toUpperCase() : keyCode, modifiers: held }] : []),
    { type: "keyUp", keyCode, modifiers: held }
  ];
};

export const browserKeyRepeat = (chord: string, repeat = 1): number => {
  if (!Number.isInteger(repeat) || repeat < 1 || repeat > 50) throw new Error("repeat must be an integer from 1 to 50");
  if (repeat > 1 && !isSelectionKey(parseBrowserKey(chord))) {
    throw new Error("Only navigation/selection keys may repeat; activation and editing keys execute once");
  }
  return repeat;
};

export const isBrowserNavigationKey = (chord: string): boolean => {
  try {
    const key = parseBrowserKey(chord);
    return isSelectionKey(key)
      || key.keyCode === "Tab" && key.held.every(modifier => modifier === "shift")
      || key.keyCode === "Esc" && key.held.length === 0;
  } catch { return false; }
};

/** A cancelled/failed dispatch must still release its key. */
export const dispatchBrowserKeys = (events: readonly KeyboardInputEvent[], send: (event: KeyboardInputEvent) => void): void => {
  try { for (const event of events) if (event.type !== "keyUp") send(event); }
  finally { for (const event of events) if (event.type === "keyUp") send(event); }
};
