type InteractionTextBundle = {
  readonly toolTerminalSession: string;
  readonly toolTerminalInput: string;
  readonly toolTerminalExec: string;
};

const pickString = (value: Record<string, unknown>, key: string): string | null => {
  const next = value[key];
  return typeof next === "string" && next.trim().length > 0 ? next.trim() : null;
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

  if (toolName.startsWith("workbench.document.")) {
    const scope = pickString(inputPayload, "scope") ?? "full";
    return `${toolName}(scope=${scope})`;
  }

  return pickString(metadataPayload, "approvalPattern") ?? toolName;
};
