const THOUGHT_CHARS = 1_200;

let text = "";
let blockId = "";
let paint: ((thought: string) => void) | null = null;

export const readAgentCursorThought = (): string => text;

export const registerAgentCursorThoughtPaint = (next: (thought: string) => void): void => {
  paint = next;
};

export const rememberAgentCursorThought = (nextBlockId: string, delta: string): void => {
  if (delta.length === 0) return;
  if (nextBlockId !== blockId) {
    blockId = nextBlockId;
    text = "";
  }
  text = `${text}${delta}`.slice(-THOUGHT_CHARS);
  paint?.(text);
};

export const clearAgentCursorThought = (): void => {
  text = "";
  blockId = "";
  paint?.("");
};
