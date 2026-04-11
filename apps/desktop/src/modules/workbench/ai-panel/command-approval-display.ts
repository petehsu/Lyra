type InteractionTextBundle = {
  readonly toolTerminalSession: string;
  readonly toolTerminalInput: string;
  readonly toolTerminalExec: string;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && Array.isArray(value) === false;

const pickString = (value: Record<string, unknown>, key: string): string | null => {
  const next = value[key];
  return typeof next === "string" && next.trim().length > 0 ? next.trim() : null;
};

const truncate = (value: string, maxLength: number): string => {
  const chars = [...value];
  if (chars.length <= maxLength) {
    return value;
  }
  return `${chars.slice(0, maxLength).join("")}...`;
};

const summarizeTarget = (target: Record<string, unknown> | null): string | null => {
  if (target === null) {
    return null;
  }
  const nodeId = pickString(target, "nodeId");
  if (nodeId !== null) {
    return `node:${truncate(nodeId, 28)}`;
  }
  const cssSelector = pickString(target, "cssSelector") ?? pickString(target, "selector");
  if (cssSelector !== null) {
    return `css:${truncate(cssSelector, 42)}`;
  }
  const selectorAddress = isRecord(target.selectorAddress) ? target.selectorAddress : null;
  if (selectorAddress !== null) {
    const path = pickString(selectorAddress, "path");
    if (path !== null) {
      return `path:${truncate(path, 42)}`;
    }
  }
  const signature = isRecord(target.stableSignature) ? target.stableSignature : null;
  if (signature !== null) {
    const signatureId =
      pickString(signature, "id")
      ?? pickString(signature, "name")
      ?? pickString(signature, "ariaLabel")
      ?? pickString(signature, "tagName");
    if (signatureId !== null) {
      return `sig:${truncate(signatureId, 28)}`;
    }
  }
  return null;
};

const summarizeWebAction = (toolName: string, inputPayload: Record<string, unknown>): string | null => {
  const action =
    isRecord(inputPayload.action)
      ? inputPayload.action
      : inputPayload;
  const kind = pickString(action, "kind") ?? pickString(action, "type");
  if (kind === null) {
    return null;
  }

  const target = summarizeTarget(isRecord(action.target) ? action.target : action);
  const actionPrefix = `${toolName}(${kind})`;

  if (kind === "goto_url") {
    const address = pickString(action, "address") ?? pickString(action, "url");
    if (address !== null) {
      return `${actionPrefix} ${truncate(address, 72)}`;
    }
    return actionPrefix;
  }

  if (kind === "type" || kind === "clear_and_type") {
    const text = pickString(action, "text");
    if (text !== null) {
      return `${actionPrefix} ${target ?? ""} text="${truncate(text, 42)}"`.trim();
    }
    return `${actionPrefix} ${target ?? ""}`.trim();
  }

  if (kind === "press_key") {
    const key = pickString(action, "key") ?? pickString(action, "text");
    const modifier =
      pickString(action, "modifierKey")
      ?? (action.meta === true ? "Meta" : null)
      ?? (action.ctrl === true ? "Ctrl" : null)
      ?? (action.alt === true ? "Alt" : null)
      ?? (action.shift === true ? "Shift" : null);
    const keySpec =
      key === null
        ? modifier
        : modifier === null
          ? key
          : `${modifier}+${key}`;
    return `${actionPrefix} ${target ?? ""} ${keySpec ?? ""}`.trim();
  }

  return `${actionPrefix} ${target ?? ""}`.trim();
};

const summarizeWebGraph = (toolName: string, inputPayload: Record<string, unknown>): string => {
  const detail = pickString(inputPayload, "detail") ?? "summary";
  return `${toolName}(detail=${detail})`;
};

export const resolveCommandApprovalToolLabel = (
  toolName: string,
  labels: InteractionTextBundle
): string => {
  if (toolName === "terminal.session.start") {
    return labels.toolTerminalSession;
  }
  if (toolName === "terminal.session.write") {
    return labels.toolTerminalInput;
  }
  if (toolName.startsWith("terminal.")) {
    return labels.toolTerminalExec;
  }
  if (toolName.startsWith("workbench.web_action.")) {
    return "Web Action";
  }
  if (toolName.startsWith("workbench.web_graph.")) {
    return "Web Graph";
  }
  if (toolName.startsWith("workbench.document.")) {
    return "Workbench Document";
  }
  if (toolName.startsWith("workbench.")) {
    return "Workbench Tool";
  }
  return toolName;
};

export const resolveCommandApprovalCommandPreview = ({
  toolName,
  inputPayload,
  metadataPayload
}: {
  readonly toolName: string;
  readonly inputPayload: Record<string, unknown>;
  readonly metadataPayload: Record<string, unknown>;
}): string => {
  const explicitCommand =
    pickString(inputPayload, "command")
    ?? pickString(metadataPayload, "command");
  if (explicitCommand !== null) {
    return explicitCommand;
  }

  if (toolName.startsWith("workbench.web_action.")) {
    const summary = summarizeWebAction(toolName, inputPayload);
    if (summary !== null) {
      return summary;
    }
  }

  if (toolName.startsWith("workbench.web_graph.")) {
    return summarizeWebGraph(toolName, inputPayload);
  }

  if (toolName.startsWith("workbench.document.")) {
    const scope = pickString(inputPayload, "scope") ?? "full";
    return `${toolName}(scope=${scope})`;
  }

  return pickString(metadataPayload, "approvalPattern") ?? toolName;
};
