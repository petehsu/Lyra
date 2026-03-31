const WORKSPACE_TAB_DRAG_MIME = "application/x-lyra-workspace-tab";

type WorkspaceTabDragPayload = {
  readonly tabId: string;
  readonly intent: "reorder" | "split";
};

let activeWorkspaceTabDragPayload: WorkspaceTabDragPayload | null = null;

const isWorkspaceTabDragPayload = (value: unknown): value is WorkspaceTabDragPayload => {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const payload = value as Record<string, unknown>;
  if (typeof payload.tabId !== "string" || payload.tabId.trim().length === 0) {
    return false;
  }
  if (payload.intent !== "reorder" && payload.intent !== "split") {
    return false;
  }
  return true;
};

export const writeWorkspaceTabDragPayload = (
  dataTransfer: DataTransfer,
  tabId: string,
  intent: WorkspaceTabDragPayload["intent"] = "reorder"
): void => {
  const trimmedId = tabId.trim();
  if (trimmedId.length === 0) {
    return;
  }

  const payload: WorkspaceTabDragPayload = {
    tabId: trimmedId,
    intent
  };
  activeWorkspaceTabDragPayload = payload;
  dataTransfer.setData(WORKSPACE_TAB_DRAG_MIME, JSON.stringify(payload));
  dataTransfer.effectAllowed = "move";
};

export const readWorkspaceTabDragPayload = (
  dataTransfer: DataTransfer
): WorkspaceTabDragPayload | null => {
  const raw = dataTransfer.getData(WORKSPACE_TAB_DRAG_MIME);
  if (raw.trim().length === 0) {
    return activeWorkspaceTabDragPayload;
  }

  try {
    const parsed = JSON.parse(raw) as unknown;
    if (isWorkspaceTabDragPayload(parsed) === false) {
      return null;
    }
    return {
      tabId: parsed.tabId.trim(),
      intent: parsed.intent
    };
  } catch (_error) {
    return null;
  }
};

export const hasWorkspaceTabDragPayload = (dataTransfer: DataTransfer): boolean =>
  Array.from(dataTransfer.types).includes(WORKSPACE_TAB_DRAG_MIME) ||
  activeWorkspaceTabDragPayload !== null;

export const clearWorkspaceTabDragPayload = (): void => {
  activeWorkspaceTabDragPayload = null;
};
