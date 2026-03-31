const TERMINAL_TAB_DRAG_MIME = "application/x-lyra-terminal-tab";
export type TerminalTabDragSource = "dock" | "workspace";

type TerminalTabDragPayload = {
  readonly source: TerminalTabDragSource;
  readonly tabId: string;
};

let activeTerminalTabDragPayload: TerminalTabDragPayload | null = null;

const isNonEmptyString = (value: unknown): value is string =>
  typeof value === "string" && value.trim().length > 0;

const isTerminalTabDragPayload = (value: unknown): value is TerminalTabDragPayload => {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const payload = value as Record<string, unknown>;
  return (
    (payload.source === "dock" || payload.source === "workspace") &&
    isNonEmptyString(payload.tabId)
  );
};

export const writeTerminalTabDragPayload = (
  dataTransfer: DataTransfer,
  payload: TerminalTabDragPayload
): void => {
  const trimmedId = payload.tabId.trim();
  if (trimmedId.length === 0) {
    return;
  }

  const nextPayload: TerminalTabDragPayload = {
    source: payload.source,
    tabId: trimmedId
  };
  activeTerminalTabDragPayload = nextPayload;
  const serialized = JSON.stringify(nextPayload);
  dataTransfer.setData(TERMINAL_TAB_DRAG_MIME, serialized);
  dataTransfer.setData("text/plain", trimmedId);
  dataTransfer.effectAllowed = "move";
};

export const readTerminalTabDragPayload = (
  dataTransfer: DataTransfer
): TerminalTabDragPayload | null => {
  const raw = dataTransfer.getData(TERMINAL_TAB_DRAG_MIME);
  if (raw.trim().length === 0) {
    return activeTerminalTabDragPayload;
  }

  try {
    const parsed = JSON.parse(raw) as unknown;
    if (isTerminalTabDragPayload(parsed) === false) {
      return null;
    }
    return {
      source: parsed.source,
      tabId: parsed.tabId.trim()
    };
  } catch (_error) {
    return null;
  }
};

export const hasTerminalTabDragPayload = (dataTransfer: DataTransfer): boolean =>
  Array.from(dataTransfer.types).includes(TERMINAL_TAB_DRAG_MIME) ||
  activeTerminalTabDragPayload !== null;

export const clearTerminalTabDragPayload = (): void => {
  activeTerminalTabDragPayload = null;
};

export const setTerminalTabDragImage = (
  dataTransfer: DataTransfer,
  element: HTMLElement,
  clientX: number,
  clientY: number
): void => {
  const rect = element.getBoundingClientRect();
  const offsetX = Math.max(1, Math.min(rect.width - 1, clientX - rect.left));
  const offsetY = Math.max(1, Math.min(rect.height - 1, clientY - rect.top));
  dataTransfer.setDragImage(element, offsetX, offsetY);
};
