import type {
  AgentMemorySnapshot,
  AgentMessageBlock,
  AgentSidePanelSnapshot,
  AgentRuntimeEvent,
  AgentSessionSnapshot,
  AgentToolActivity,
  AgentModelCatalogSnapshot
} from "../../shared/agent";
import type {
  ChatMessage,
  AgentImageAttachment,
  ModelOption,
  SessionMeta,
  AgentSidePanel,
  MessageBlock,
  TodoItem,
  ToolCall,
  ToolDetails,
  ToolGroup,
  ToolActionTarget,
  ToolArtifactPreview,
  ToolPeek,
  RenderSurfaceColumn,
  RenderSurfaceRow,
  WebResult,
  WorkbenchTabSummary
} from "./ai-panel/agent-chat-demo/core/types";
import { formatMessage, t } from "./ai-panel/agent-chat-demo/core/i18n";
import { isLyraSensitiveValueRef } from "../../shared/sensitive-value";
import type { LyraSensitiveValueRef } from "../../shared/desktop-bridge";

const upsertTool = (
  tools: readonly AgentToolActivity[],
  tool: AgentToolActivity
): readonly AgentToolActivity[] => [
  ...tools.filter((existing) => existing.id !== tool.id),
  tool
];

const appendTextDeltaToBlocks = (
  blocks: readonly AgentMessageBlock[] | undefined,
  blockId: string | null | undefined,
  delta: string,
  replace = false,
  fallbackText = ""
): readonly AgentMessageBlock[] => {
  const currentBlocks = [...(blocks ?? [])];
  if (currentBlocks.length === 0) {
    return [
      {
        type: "text",
        id: blockId ?? "text-0",
        text: replace ? delta : `${fallbackText}${delta}`
      }
    ];
  }
  let lastTextBlockId: string | undefined;
  for (let index = currentBlocks.length - 1; index >= 0; index -= 1) {
    const block = currentBlocks[index];
    if (block?.type === "text") {
      lastTextBlockId = block.id;
      break;
    }
  }
  const targetBlockId = blockId ?? lastTextBlockId;

  if (targetBlockId !== undefined) {
    let found = false;
    const nextBlocks = currentBlocks.map((block) => {
      if (block.type !== "text" || block.id !== targetBlockId) return block;
      found = true;
      return {
        ...block,
        text: replace ? delta : `${block.text}${delta}`
      };
    });
    if (found) return nextBlocks;
  }

  return [
    ...currentBlocks,
    {
      type: "text",
      id: targetBlockId ?? `text-${currentBlocks.length}`,
      text: delta
    }
  ];
};

const appendToolBlockToMessage = (
  blocks: readonly AgentMessageBlock[] | undefined,
  toolId: string
): readonly AgentMessageBlock[] => {
  const currentBlocks = [...(blocks ?? [])];
  if (currentBlocks.some((block) => block.type === "tool" && toolIdForBlock(block) === toolId)) {
    return currentBlocks;
  }
  return [
    ...currentBlocks,
    {
      type: "tool",
      id: `tool-${toolId}`,
      toolId
    }
  ];
};

export const applyAgentRuntimeEventToSnapshot = (
  session: AgentSessionSnapshot,
  event: AgentRuntimeEvent
): AgentSessionSnapshot => {
  if (event.kind === "sessionSnapshot") {
    return event.snapshot.id === session.id ? event.snapshot : session;
  }

  if ("sessionId" in event && event.sessionId !== session.id) {
    return session;
  }

  if (event.kind === "messageCommitted") {
    return {
      ...session,
      messages: [
        ...session.messages.filter((message) => message.id !== event.message.id),
        event.message
      ],
      updatedAt: new Date().toISOString()
    };
  }

  if (event.kind === "messageDelta") {
    return {
      ...session,
      messages: session.messages.map((message) =>
        message.id === event.messageId
          ? {
              ...message,
              text: event.replace === true ? event.delta : `${message.text}${event.delta}`,
              blocks: appendTextDeltaToBlocks(
                message.blocks,
                event.blockId,
                event.delta,
                event.replace,
                message.text
              )
            }
          : message
      ),
      updatedAt: new Date().toISOString()
    };
  }

  if (event.kind === "toolStarted") {
    return {
      ...session,
      messages: event.messageId === undefined || event.messageId === null
        ? session.messages
        : session.messages.map((message) =>
            message.id === event.messageId
              ? {
                  ...message,
                  blocks: appendToolBlockToMessage(message.blocks, event.tool.id)
                }
              : message
          ),
      tools: upsertTool(session.tools, event.tool),
      updatedAt: new Date().toISOString()
    };
  }

  if (event.kind === "toolFinished") {
    return {
      ...session,
      tools: upsertTool(session.tools, event.tool),
      updatedAt: new Date().toISOString()
    };
  }

  if (event.kind === "memoryUpdated") {
    return {
      ...session,
      memory: event.snapshot,
      updatedAt: new Date().toISOString()
    };
  }

  if (event.kind === "turnStarted" || event.kind === "turnStateChanged") {
    return {
      ...session,
      turnStatus: ["completed"].includes(event.state)
        ? "finished"
        : ["failed_recoverable", "failed_terminal"].includes(event.state)
          ? "failed"
          : ["cancelled_by_user", "interrupted"].includes(event.state)
            ? "cancelled"
            : "running",
      activeTurnId: ["completed", "failed_terminal", "cancelled_by_user"].includes(event.state)
        ? null
        : event.turnId,
      follow: {
        running: !["completed", "failed_terminal", "cancelled_by_user"].includes(event.state),
        activity: event.state
      },
      updatedAt: new Date().toISOString()
    };
  }

  if (event.kind === "toolUpdated") {
    return {
      ...session,
      tools: upsertTool(session.tools, event.tool),
      updatedAt: new Date().toISOString()
    };
  }

  if (event.kind === "todoUpdated") {
    return {
      ...session,
      todos: event.todos,
      updatedAt: new Date().toISOString()
    };
  }

  if (event.kind === "followStateChanged") {
    return {
      ...session,
      follow: event.follow,
      turnStatus: event.follow.running ? "running" : session.turnStatus,
      updatedAt: new Date().toISOString()
    };
  }

  if (event.kind === "turnFinished") {
    return {
      ...session,
      turnStatus: event.status,
      activeTurnId: null,
      follow: { running: false, activity: null },
      updatedAt: new Date().toISOString()
    };
  }

  if (event.kind === "turnCompleted") {
    return {
      ...session,
      turnStatus: "finished",
      activeTurnId: null,
      follow: { running: false, activity: null },
      updatedAt: new Date().toISOString()
    };
  }

  if (event.kind === "turnFailed") {
    return {
      ...session,
      turnStatus: "failed",
      activeTurnId: null,
      follow: { running: false, activity: null },
      updatedAt: new Date().toISOString()
    };
  }

  if (event.kind === "turnInterrupted") {
    return {
      ...session,
      turnStatus: "cancelled",
      activeTurnId: null,
      follow: { running: false, activity: null },
      updatedAt: new Date().toISOString()
    };
  }

  if (event.kind === "browserActivityChanged") {
    const currentMemory = session.memory ?? null;
    const nextTarget = asRecord(event.target);
    return {
      ...session,
      memory: currentMemory === null
        ? currentMemory
        : {
            ...currentMemory,
            activeBrowserTargets: [
              ...currentMemory.activeBrowserTargets.filter((target) => {
                const record = asRecord(target);
                return record.browserTargetId !== nextTarget.browserTargetId;
              }),
              nextTarget
            ]
          },
      follow: {
        running: true,
        activity: "browser"
      },
      updatedAt: new Date().toISOString()
    };
  }

  if (event.kind === "clarificationResolved") {
    const currentMemory = session.memory ?? null;
    return {
      ...session,
      memory: currentMemory === null
        ? currentMemory
        : {
            ...currentMemory,
            activeClarification: null
          },
      updatedAt: new Date().toISOString()
    };
  }

  return session;
};

const toolKind = (tool: AgentToolActivity): ToolCall["kind"] => {
  const hintedKind = toolKindFromHint(tool.activityKind ?? tool.rendererHint ?? null);
  if (hintedKind !== null) return hintedKind;
  const action = (toolFsOperation(tool) ?? "").toLowerCase();
  const domain = (toolFsDomain(tool) ?? "").toLowerCase();
  const toolPath = (toolFsPath(tool) ?? "").toLowerCase();
  if (domain === "render" || toolPath.startsWith("/tools/render/")) return "render";
  if (domain === "workbench" || toolPath.startsWith("/tools/workbench/")) return "workbench";
  if (domain === "terminal" || toolPath.startsWith("/tools/terminal/")) return "terminal";
  if (
    domain === "browser" ||
    domain === "web" ||
    toolPath.startsWith("/tools/browser/") ||
    toolPath.startsWith("/tools/web/")
  ) return "web";
  if (domain === "shell" || toolPath.startsWith("/tools/shell/")) return "shell";
  if (domain === "todo" || toolPath.startsWith("/tools/todo/")) return "task";
  if (domain === "git" || toolPath.startsWith("/tools/git/")) {
    return ["stage", "unstage", "discard"].includes(action) ? "edit" : "read";
  }
  if (domain === "filesystem" || toolPath.startsWith("/tools/filesystem/")) {
    if (["write", "edit", "multiedit", "apply_patch"].includes(action)) return "edit";
    if (["glob", "list"].includes(action)) return "search";
    return "read";
  }
  if (domain === "code" || toolPath.startsWith("/tools/code/")) return "search";
  return "thought";
};

const toolKindFromHint = (hint: string | null | undefined): ToolCall["kind"] | null => {
  switch ((hint ?? "").toLowerCase()) {
    case "read":
      return "read";
    case "edit":
      return "edit";
    case "search":
      return "search";
    case "shell":
      return "shell";
    case "terminal":
      return "terminal";
    case "web":
    case "lumen":
      return "web";
    case "workbench":
      return "workbench";
    case "render":
      return "render";
    case "task":
    case "todo":
      return "task";
    default:
      return null;
  }
};

const asRecord = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};

const stringField = (
  value: Record<string, unknown>,
  ...keys: readonly string[]
): string | undefined => {
  for (const key of keys) {
    const field = value[key];
    if (typeof field === "string" && field.trim().length > 0) return field;
  }
  return undefined;
};

const numberField = (
  value: Record<string, unknown>,
  ...keys: readonly string[]
): number | undefined => {
  for (const key of keys) {
    const field = value[key];
    if (typeof field === "number" && Number.isFinite(field)) return field;
  }
  return undefined;
};

const arrayField = (
  value: Record<string, unknown>,
  ...keys: readonly string[]
): readonly unknown[] | undefined => {
  for (const key of keys) {
    const field = value[key];
    if (Array.isArray(field)) return field;
  }
  return undefined;
};

const rangeField = (
  value: unknown
): { readonly start: number; readonly end: number } | undefined => {
  const record = asRecord(value);
  const start = numberField(record, "start");
  const end = numberField(record, "end");
  return start === undefined || end === undefined ? undefined : { start, end };
};

const labelFromPath = (value: string): string => {
  const normalized = value.replaceAll("\\", "/");
  const tail = normalized.split("/").filter(Boolean).at(-1);
  return tail ?? value;
};

const targetFromOpenTarget = (
  value: unknown,
  fallbackLabel?: string
): ToolActionTarget | null => {
  const target = asRecord(value);
  const kind = stringField(target, "kind", "type");
  if (kind === "url") {
    const url = stringField(target, "url", "href", "value");
    if (url === undefined) return null;
    return {
      kind: "url",
      label: fallbackLabel ?? stringField(target, "label", "title") ?? url,
      value: url
    };
  }
  if (kind === "file" || kind === "path") {
    const path = stringField(target, "path", "filePath", "value");
    if (path === undefined) return null;
    return {
      kind: "file",
      label: fallbackLabel ?? stringField(target, "label", "title") ?? labelFromPath(path),
      value: path
    };
  }
  if (kind === "secret") {
    const secretRef = isLyraSensitiveValueRef(target.secretRef)
      ? target.secretRef
      : isLyraSensitiveValueRef(value)
        ? value
        : null;
    const targetId = secretRef?.id ?? stringField(target, "id", "value");
    if (secretRef === null || targetId === undefined) return null;
    return {
      kind: "secret",
      label: fallbackLabel ?? stringField(target, "label", "title") ?? secretRef.label,
      value: targetId,
      secretRef
    };
  }
  return null;
};

const targetFromSensitiveValueRef = (
  value: LyraSensitiveValueRef,
  fallbackLabel?: string
): ToolActionTarget => ({
  kind: "secret",
  label: fallbackLabel ?? value.label,
  value: value.id,
  secretRef: value
});

const uniqueActionTargets = (
  targets: readonly (ToolActionTarget | null | undefined)[]
): ToolActionTarget[] => {
  const seen = new Set<string>();
  const result: ToolActionTarget[] = [];
  for (const target of targets) {
    if (target === null || target === undefined) continue;
    const key = `${target.kind}:${target.value}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(target);
  }
  return result;
};

const imageAttachmentFromArtifact = (
  value: unknown,
  fallbackLabel = "Image artifact"
): AgentImageAttachment | undefined => {
  const artifact = asRecord(value);
  const openTarget = targetFromOpenTarget(artifact.openTarget, fallbackLabel);
  const path = openTarget?.kind === "file"
    ? openTarget.value
    : stringField(artifact, "path", "filePath");
  if (path === undefined) {
    return undefined;
  }
  const mediaType = stringField(artifact, "mediaType", "mimeType") ?? "image/png";
  return {
    id: stringField(artifact, "id") ?? `image-artifact-${path}`,
    mediaType,
    data: "",
    label: fallbackLabel,
    source: path,
    width: numberField(artifact, "width") ?? null,
    height: numberField(artifact, "height") ?? null
  };
};

const targetWithArtifactMetadata = (
  target: ToolActionTarget,
  artifact: Record<string, unknown>
): ToolActionTarget => {
  const mediaType = stringField(artifact, "mediaType", "mimeType");
  const width = numberField(artifact, "width");
  const height = numberField(artifact, "height");
  return {
    ...target,
    ...(mediaType === undefined ? {} : { mediaType }),
    ...(width === undefined ? {} : { width }),
    ...(height === undefined ? {} : { height })
  };
};

const targetFromArtifactRef = (
  value: unknown,
  fallbackLabel = "Open artifact"
): ToolActionTarget | null => {
  const artifact = asRecord(value);
  if (Object.keys(artifact).length === 0) return null;
  const openTarget = targetFromOpenTarget(artifact.openTarget, fallbackLabel);
  if (openTarget !== null) return targetWithArtifactMetadata(openTarget, artifact);
  const path = stringField(artifact, "path", "filePath", "source");
  if (path === undefined) return null;
  return targetWithArtifactMetadata({
    kind: "file",
    label: fallbackLabel ?? stringField(artifact, "label", "title") ?? labelFromPath(path),
    value: path
  }, artifact);
};

const artifactTargetsFromEvidence = (
  artifactRefs: readonly unknown[] | undefined,
  changes: readonly unknown[] | undefined
): ToolActionTarget[] | undefined => {
  const targets = uniqueActionTargets([
    ...(artifactRefs ?? []).map((artifact, index) =>
      targetFromArtifactRef(artifact, `Open artifact ${index + 1}`)
    ),
    ...(changes ?? []).flatMap((change, index) => {
      const record = asRecord(change);
      return [
        targetFromArtifactRef(record.diffRef, `Open change ${index + 1} diff`),
        targetFromArtifactRef(record.beforeRef, `Open change ${index + 1} before`),
        targetFromArtifactRef(record.afterRef, `Open change ${index + 1} after`),
        targetFromArtifactRef(record.dataRef, `Open change ${index + 1} data`),
        targetFromArtifactRef(record.artifactRef, `Open change ${index + 1}`)
      ];
    })
  ]);
  return targets.length === 0 ? undefined : targets;
};

const artifactPreviewFromRef = (
  value: unknown,
  fallbackLabel: string
): ToolArtifactPreview | null => {
  const artifact = asRecord(value);
  if (Object.keys(artifact).length === 0) return null;
  const text = stringField(
    artifact,
    "preview",
    "excerpt",
    "summary",
    "content",
    "text"
  );
  if (text === undefined || text.trim().length === 0) return null;
  const kind = stringField(artifact, "kind", "type");
  const path = stringField(artifact, "path", "filePath", "uri", "id");
  const bytes = numberField(artifact, "bytes", "size");
  const truncated = typeof artifact.previewTruncated === "boolean"
    ? artifact.previewTruncated
    : typeof artifact.truncated === "boolean"
      ? artifact.truncated
      : undefined;
  return {
    label: stringField(artifact, "label", "title", "id", "kind") ?? fallbackLabel,
    text,
    ...(kind === undefined ? {} : { kind }),
    ...(path === undefined ? {} : { path }),
    ...(bytes === undefined ? {} : { bytes }),
    ...(truncated === undefined ? {} : { truncated })
  };
};

const artifactPreviewsFromEvidence = (
  artifactRefs: readonly unknown[] | undefined,
  changes: readonly unknown[] | undefined
): ToolArtifactPreview[] | undefined => {
  const candidates = [
    ...(artifactRefs ?? []).map((artifact, index) =>
      artifactPreviewFromRef(artifact, `artifact ${index + 1}`)
    ),
    ...(changes ?? []).flatMap((change, index) => {
      const record = asRecord(change);
      return [
        artifactPreviewFromRef(record.diffRef, `change ${index + 1} diff`),
        artifactPreviewFromRef(record.beforeRef, `change ${index + 1} before`),
        artifactPreviewFromRef(record.afterRef, `change ${index + 1} after`),
        artifactPreviewFromRef(record.dataRef, `change ${index + 1} data`),
        artifactPreviewFromRef(record.artifactRef, `change ${index + 1}`)
      ];
    })
  ].filter((preview): preview is ToolArtifactPreview => preview !== null);
  const seen = new Set<string>();
  const result: ToolArtifactPreview[] = [];
  for (const preview of candidates) {
    const key = `${preview.label}:${preview.path ?? ""}:${preview.text}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(preview);
  }
  return result.length === 0 ? undefined : result;
};

const secretTargetsFromValue = (
  value: unknown,
  depth = 0
): ToolActionTarget[] => {
  if (depth > 6) {
    return [];
  }
  if (isLyraSensitiveValueRef(value)) {
    return [targetFromSensitiveValueRef(value)];
  }
  if (Array.isArray(value)) {
    return value.flatMap((item) => secretTargetsFromValue(item, depth + 1));
  }
  const record = asRecord(value);
  if (Object.keys(record).length === 0) {
    return [];
  }
  return Object.values(record).flatMap((item) => secretTargetsFromValue(item, depth + 1));
};

const targetsFromToolRaw = (raw: Record<string, unknown>): ToolActionTarget[] => {
  const output = asRecord(raw.output);
  const imageArtifact =
    asRecord(raw.imageArtifact).path === undefined
      ? asRecord(output.imageArtifact)
      : asRecord(raw.imageArtifact);
  const imageTarget = targetFromOpenTarget(imageArtifact.openTarget, "Open image");
  const imageTargetWithMetadata = imageTarget?.kind === "file"
    ? {
        ...imageTarget,
        mediaType: stringField(imageArtifact, "mediaType", "mimeType") ?? "image/png",
        width: numberField(imageArtifact, "width") ?? null,
        height: numberField(imageArtifact, "height") ?? null
      }
    : imageTarget;
  return uniqueActionTargets([
    targetFromOpenTarget(raw.openTarget),
    targetFromOpenTarget(output.openTarget),
    imageTargetWithMetadata,
    ...secretTargetsFromValue(raw),
    ...secretTargetsFromValue(output)
  ]);
};

const parseJsonRecord = (value: string): Record<string, unknown> | null => {
  try {
    const parsed = JSON.parse(value) as unknown;
    return asRecord(parsed);
  } catch {
    return null;
  }
};

const toolInputRecord = (tool: AgentToolActivity): Record<string, unknown> => {
  const input = asRecord(tool.input);
  const delta = stringField(input, "delta");
  if (delta !== undefined) {
    return parseJsonRecord(delta) ?? input;
  }
  return input;
};

const toolArgsRecord = (tool: AgentToolActivity): Record<string, unknown> =>
  asRecord(toolInputRecord(tool).args);

const toolOutputText = (tool: AgentToolActivity): string => {
  const output = asRecord(tool.output);
  const content = output.content;
  if (typeof content === "string") return content;
  if (tool.output !== undefined) return JSON.stringify(tool.output, null, 2);
  return JSON.stringify(tool.input, null, 2);
};

type ParsedWorkbenchDetails = Extract<ToolDetails, { type: "workbench" }>;
type ParsedLumenDetails = Extract<ToolDetails, { type: "lumen" }>;
type ParsedSoftwareDetails = Extract<ToolDetails, { type: "software" }>;
type ParsedRenderDetails = Extract<ToolDetails, { type: "render" }>;
type ParsedTerminalDetails = Extract<ToolDetails, { type: "terminal" }>;

type ParsedLumenElement = {
  readonly id: string;
  readonly role: string;
  readonly label: string;
};

const LUMEN_ACTIONS = new Set([
  "map",
  "focus_scan",
  "act",
  "type",
  "press",
  "submit",
  "reveal",
  "navigate",
  "read",
  "see",
  "wait",
  "read_until",
  "follow_audit",
  "explain_target",
  "elevate"
]);

const isHttpUrl = (value: string): boolean =>
  value.startsWith("https://") || value.startsWith("http://");

const normalizeToolFsPath = (value: string | null | undefined): string | undefined => {
  const normalized = value?.trim();
  if (normalized === undefined || normalized.length === 0) return undefined;
  return normalized === "/tools" || normalized.startsWith("/tools/")
    ? normalized
    : undefined;
};

const toolFsPath = (tool: AgentToolActivity): string | undefined => {
  const input = toolInputRecord(tool);
  const output = asRecord(tool.output);
  const raw = asRecord(output.raw);
  return [
    tool.toolPath,
    stringField(input, "toolPath", "tool_path", "path"),
    stringField(output, "toolPath", "tool_path"),
    stringField(raw, "toolPath", "tool_path")
  ].map(normalizeToolFsPath).find((path) => path !== undefined);
};

const toolFsDomain = (tool: AgentToolActivity): string | undefined => {
  const input = toolInputRecord(tool);
  const output = asRecord(tool.output);
  const raw = asRecord(output.raw);
  return tool.domain
    ?? stringField(input, "domain")
    ?? stringField(output, "domain")
    ?? stringField(raw, "domain");
};

const toolFsOperation = (tool: AgentToolActivity): string | undefined => {
  const input = toolInputRecord(tool);
  const output = asRecord(tool.output);
  const raw = asRecord(output.raw);
  return tool.operation
    ?? stringField(input, "operation", "action", "op")
    ?? stringField(output, "operation", "op")
    ?? stringField(raw, "operation", "action", "op");
};

const isToolFsActivity = (tool: AgentToolActivity): boolean => {
  const toolName = tool.name.toLowerCase();
  return toolName === "tool_fs"
    || toolName.startsWith("tool_fs_")
    || toolFsPath(tool) !== undefined
    || toolFsDomain(tool) !== undefined
    || toolFsOperation(tool) !== undefined
    || manifestToolTitle(tool) !== null;
};

const isLyraLumenTool = (tool: AgentToolActivity): boolean =>
  (toolFsDomain(tool) ?? "").toLowerCase() === "browser"
  || (toolFsPath(tool) ?? "").toLowerCase().startsWith("/tools/browser/");

const isSoftwareTool = (tool: AgentToolActivity): boolean => {
  return (toolFsDomain(tool) ?? "").toLowerCase() === "software"
    || (toolFsPath(tool) ?? "").toLowerCase().startsWith("/tools/software/");
};

const isTerminalTool = (tool: AgentToolActivity): boolean => {
  return (toolFsDomain(tool) ?? "").toLowerCase() === "terminal"
    || (toolFsPath(tool) ?? "").toLowerCase().startsWith("/tools/terminal/");
};

const compactText = (value: string): string =>
  value.replace(/\s+/gu, " ").trim();

const truncateText = (value: string, maxLength: number): string => {
  const compact = compactText(value);
  if (compact.length <= maxLength) return compact;
  return `${compact.slice(0, Math.max(0, maxLength - 3)).trimEnd()}...`;
};

const urlHost = (url: string | undefined): string | undefined => {
  if (url === undefined) return undefined;
  try {
    return new URL(url).host;
  } catch {
    return undefined;
  }
};

const normalizeLumenAction = (value: string | undefined): string => {
  if (value === undefined) return "browser";
  const normalized = value.trim();
  if (normalized === "focusScan") return "focus_scan";
  return normalized.length === 0 ? "browser" : normalized;
};

const lumenTargetMode = (input: Record<string, unknown>): string =>
  stringField(input, "target", "targetMode") === "live" ? "live" : "isolated";

const lumenElementLabel = (input: Record<string, unknown>): string | undefined => {
  const elementId = input.element_id ?? input.elementId;
  if (typeof elementId === "string" && elementId.trim().length > 0) {
    return `element ${elementId.trim()}`;
  }
  if (typeof elementId === "number" && Number.isFinite(elementId)) {
    return `element ${Math.round(elementId)}`;
  }
  return undefined;
};

const lumenTargetRefLabel = (input: Record<string, unknown>): string | undefined => {
  const targetRef = stringField(input, "lumenTargetRef", "targetRef");
  return targetRef === undefined ? undefined : `target ${targetRef}`;
};

const lumenPointLabel = (input: Record<string, unknown>): string | undefined => {
  const point = asRecord(input.point);
  const x = typeof point.x === "number" ? point.x : Number.NaN;
  const y = typeof point.y === "number" ? point.y : Number.NaN;
  if (!Number.isFinite(x) || !Number.isFinite(y)) return undefined;
  return `point ${Math.round(x)},${Math.round(y)}`;
};

const lumenElementFromRaw = (value: unknown): ParsedLumenElement | null => {
  const element = asRecord(value);
  if (Object.keys(element).length === 0) return null;
  const id =
    stringField(element, "id", "elementId")
    ?? (numberField(element, "id", "elementId") === undefined
      ? undefined
      : `${numberField(element, "id", "elementId")}`);
  const target = asRecord(element.target);
  const targetRef = stringField(element, "targetRef") ?? stringField(target, "targetRef");
  const role = stringField(element, "role", "tagName") ?? "element";
  const label = stringField(element, "label", "text", "name", "accessibleName") ?? targetRef ?? "";
  if (id === undefined && label.length === 0 && targetRef === undefined) return null;
  return {
    id: id ?? targetRef ?? "?",
    role,
    label
  };
};

const parseStructuredLumenMap = (
  raw: Record<string, unknown>
): {
  readonly observationId?: string;
  readonly strategy?: string;
  readonly title?: string;
  readonly url?: string;
  readonly elements: readonly ParsedLumenElement[];
} | null => {
  const rawElements = Array.isArray(raw.elements) ? raw.elements : undefined;
  const isStructuredMap =
    raw.kind === "lyraLumenMap"
    || rawElements !== undefined
    || Array.isArray(raw.targets)
    || raw.semanticTree !== undefined
    || raw.coverage !== undefined;
  if (!isStructuredMap) return null;
  const elements = (rawElements ?? [])
    .map(lumenElementFromRaw)
    .filter((element): element is ParsedLumenElement => element !== null);
  const observationId = stringField(raw, "observationId");
  const strategy = stringField(raw, "strategy");
  const title = stringField(raw, "title");
  const url = stringField(raw, "url");
  return {
    ...(observationId === undefined ? {} : { observationId }),
    ...(strategy === undefined ? {} : { strategy }),
    ...(title === undefined ? {} : { title }),
    ...(url === undefined ? {} : { url }),
    elements
  };
};

const parseStructuredLumenFocus = (
  raw: Record<string, unknown>
): {
  readonly direction?: string;
  readonly activeElementId?: string;
  readonly focused?: string;
  readonly trail: readonly string[];
} | null => {
  const rawTrail = Array.isArray(raw.focusTrail) ? raw.focusTrail : undefined;
  const focusedElement = lumenElementFromRaw(raw.focusedElement);
  const activeElementId =
    stringField(raw, "activeElementId")
    ?? (numberField(raw, "activeElementId") === undefined
      ? undefined
      : `${numberField(raw, "activeElementId")}`);
  const isStructuredFocus =
    raw.kind === "lyraLumenFocusResult"
    || rawTrail !== undefined
    || focusedElement !== null
    || activeElementId !== undefined;
  if (!isStructuredFocus) return null;
  const trail = (rawTrail ?? [])
    .map((entry) => {
      const record = asRecord(entry);
      const role = stringField(record, "role") ?? "element";
      const label = stringField(record, "label") ?? "";
      const elementId =
        stringField(record, "elementId")
        ?? (numberField(record, "elementId") === undefined
          ? undefined
          : `${numberField(record, "elementId")}`);
      return `${elementId === undefined ? "" : `[${elementId}] `}${role}${label.length === 0 ? "" : ` ${label}`}`.trim();
    })
    .filter((label) => label.length > 0);
  const direction = stringField(raw, "direction");
  return {
    ...(direction === undefined ? {} : { direction }),
    ...(activeElementId === undefined ? {} : { activeElementId }),
    ...(focusedElement === null
      ? {}
      : { focused: `${focusedElement.role}: ${focusedElement.label}`.trim() }),
    trail
  };
};

const lumenTitle = (tool: AgentToolActivity): string => {
  const input = toolInputRecord(tool);
  const action = normalizeLumenAction(stringField(input, "action"));
  switch (action) {
    case "map":
      return "Mapped browser elements";
    case "focus_scan":
      return "Scanned browser focus";
    case "act": {
      const interaction = stringField(input, "interaction") ?? "click";
      return `${interaction.replace(/_/gu, " ")} browser element`;
    }
    case "type":
      return "Typed in browser";
    case "press":
      return "Pressed browser key";
    case "submit":
      return "Submitted browser control";
    case "reveal":
      return "Revealed browser controls";
    case "navigate":
      return "Navigated browser";
    case "read":
      return "Read browser text";
    case "see":
      return "Captured browser snapshot";
    case "wait":
      return "Waited in browser";
    case "read_until":
      return "Read browser until condition";
    case "follow_audit":
      return "Read browser follow audit";
    case "explain_target":
      return "Explained browser target";
    case "elevate":
      return "Elevated browser";
    default:
      return "Lyra Lumen";
  }
};

const toLumenDetails = (
  tool: AgentToolActivity,
  output: string,
  rawOutput: Record<string, unknown>,
  screenshot: string | undefined,
  screenshotImage: AgentImageAttachment | undefined,
  targets: readonly ToolActionTarget[]
): ParsedLumenDetails => {
  const input = toolInputRecord(tool);
  const action = normalizeLumenAction(stringField(input, "action"));
  const targetMode = lumenTargetMode(input);
  const chips = [targetMode];
  const structuredTarget = lumenTargetRefLabel(input);
  const followSessionId = stringField(input, "followSessionId", "sessionId");
  const followActionId = stringField(input, "followActionId", "actionId");
  if (structuredTarget !== undefined) chips.push(structuredTarget);
  if (followSessionId !== undefined) chips.push(`follow ${followSessionId}`);
  if (followActionId !== undefined) chips.push(`action ${followActionId}`);
  let excerpt: string | undefined;

  if (action === "map") {
    const parsed = parseStructuredLumenMap(rawOutput);
    if (parsed !== null) {
      if (parsed.strategy !== undefined) chips.push(parsed.strategy);
      chips.push(`${parsed.elements.length} elements`);
      const host = urlHost(parsed.url);
      if (host !== undefined) chips.push(host);
      const labels = parsed.elements
        .map((element) => `${element.id} ${element.role} ${element.label}`)
        .filter((label) => label.trim().length > 0)
        .slice(0, 2);
      excerpt = labels.length > 0
        ? truncateText(labels.join(" / "), 120)
        : truncateText(parsed.title ?? output, 120);
    } else {
      excerpt = output.trim().length === 0 ? undefined : truncateText(output, 120);
    }
  } else if (action === "focus_scan") {
    const parsed = parseStructuredLumenFocus(rawOutput);
    if (parsed !== null) {
      chips.push(`${parsed.trail.length} tab stops`);
      if (parsed.activeElementId !== undefined) chips.push(`active ${parsed.activeElementId}`);
      excerpt = truncateText(parsed.focused ?? parsed.trail.slice(0, 2).join(" / "), 120);
    } else {
      excerpt = output.trim().length === 0 ? undefined : truncateText(output, 120);
    }
  } else if (action === "read") {
    const strategy = stringField(input, "strategy") ?? "focus";
    chips.push(strategy === "domFallback" ? "dom fallback" : "focus read");
    if (output.trim().length > 0) chips.push(`${output.length} chars`);
    excerpt = output.trim().length === 0 ? undefined : truncateText(output, 140);
  } else if (action === "see") {
    chips.push("visual fallback");
    excerpt = output.trim().length === 0 ? undefined : truncateText(output, 120);
  } else if (action === "type") {
    const text = stringField(input, "text") ?? "";
    chips.push(`${text.length} chars`);
    chips.push(structuredTarget ?? lumenElementLabel(input) ?? "focused element");
    chips.push("chromium keyboard");
    excerpt = output.trim().length === 0 ? undefined : truncateText(output, 120);
  } else if (action === "act") {
    chips.push((stringField(input, "interaction") ?? "click").replace(/_/gu, " "));
    const target = structuredTarget ?? lumenElementLabel(input) ?? lumenPointLabel(input);
    if (target !== undefined) chips.push(target);
    chips.push("chromium mouse");
    excerpt = output.trim().length === 0 ? undefined : truncateText(output, 120);
  } else if (action === "reveal") {
    chips.push((stringField(input, "interaction") ?? "hover").replace(/_/gu, " "));
    const target = structuredTarget ?? lumenElementLabel(input) ?? lumenPointLabel(input);
    if (target !== undefined) chips.push(target);
    excerpt = output.trim().length === 0 ? undefined : truncateText(output, 120);
  } else if (action === "press" || action === "submit") {
    chips.push(stringField(input, "key") ?? (action === "submit" ? "Enter" : "key"));
    chips.push(structuredTarget ?? lumenElementLabel(input) ?? "focused element");
    chips.push("chromium keyboard");
    excerpt = output.trim().length === 0 ? undefined : truncateText(output, 120);
  } else if (action === "follow_audit") {
    chips.push("compact");
    if (input.includeFrames === true) chips.push("frames");
    excerpt = output.trim().length === 0 ? undefined : truncateText(output, 140);
  } else if (action === "explain_target") {
    chips.push(structuredTarget ?? "target");
    excerpt = output.trim().length === 0 ? undefined : truncateText(output, 120);
  } else if (action === "navigate") {
    const url = stringField(input, "url");
    const host = urlHost(url);
    if (host !== undefined) chips.push(host);
    excerpt = truncateText(url ?? output, 120);
  } else if (action === "wait" || action === "read_until") {
    const timeout = input.timeout_ms ?? input.timeoutMs;
    if (typeof timeout === "number" && Number.isFinite(timeout)) {
      chips.push(`${Math.round(timeout)}ms`);
    }
    excerpt = output.trim().length === 0 ? undefined : truncateText(output, 120);
  } else if (LUMEN_ACTIONS.has(action)) {
    excerpt = output.trim().length === 0 ? undefined : truncateText(output, 120);
  }

  const peek: ToolPeek = {
    chips: [...new Set(chips.filter((chip) => chip.trim().length > 0))],
    ...(excerpt === undefined ? {} : { excerpt }),
    ...(screenshot === undefined
      ? {}
      : { thumbnail: { src: screenshot, alt: "Lyra Lumen snapshot" } })
  };

  return {
    type: "lumen",
    action,
    targetMode,
    peek,
    ...(output.trim().length === 0 ? {} : { text: output }),
    ...(screenshot === undefined ? {} : { screenshot }),
    ...(screenshotImage === undefined ? {} : { screenshotImage }),
    ...(targets.length === 0 ? {} : { targets: [...targets] })
  };
};

const normalizeWorkbenchFlags = (flags: string | undefined): string[] => {
  if (flags === undefined) return [];
  return flags
    .split(",")
    .map((flag) => flag.trim())
    .filter((flag) => flag.length > 0 && flag !== "none");
};

const workbenchActionLabel = (action: string): string => {
  switch (action) {
    case "list_tabs":
      return "Workbench tabs";
    case "read_tab":
      return "Workbench tab";
    case "read_workspace":
      return "Workbench workspace";
    case "extract_tab_text":
      return "Workbench text";
    default:
      return "Workbench";
  }
};

const webResultsFromRaw = (raw: Record<string, unknown>): WebResult[] | undefined => {
  const rawResults = arrayField(raw, "results");
  if (rawResults === undefined) return undefined;
  const results = rawResults
    .map((item) => {
      const record = asRecord(item);
      const title = stringField(record, "title", "name") ?? "Untitled";
      const url = stringField(record, "url", "href");
      if (url === undefined || !isHttpUrl(url)) return null;
      const snippet = stringField(record, "snippet", "summary", "text");
      return {
        title,
        url,
        ...(snippet === undefined ? {} : { snippet })
      };
    })
    .filter((item): item is WebResult => item !== null);
  return results.length === 0 ? undefined : results;
};

const workbenchTabFromRaw = (value: unknown): WorkbenchTabSummary | null => {
  const record = asRecord(value);
  if (Object.keys(record).length === 0) return null;
  const tabId = stringField(record, "tabId", "id");
  const title = stringField(record, "title", "label", "name") ?? "Untitled";
  const kind = stringField(record, "kind", "pageKind", "type") ?? "tab";
  const observationKind = stringField(record, "observationKind");
  const rawFlags = arrayField(record, "flags")
    ?.filter((flag): flag is string => typeof flag === "string")
    ?? normalizeWorkbenchFlags(stringField(record, "flags"));
  const url = stringField(record, "url", "displayAddress", "href");
  const excerpt = stringField(record, "excerpt", "summary", "text", "content");
  if (tabId === undefined && excerpt === undefined && url === undefined) return null;
  return {
    title,
    tabId: tabId ?? "-",
    kind,
    flags: rawFlags,
    ...(observationKind === undefined ? {} : { observationKind }),
    ...(url === undefined || !isHttpUrl(url) ? {} : { url }),
    ...(excerpt === undefined ? {} : { excerpt })
  };
};

const workbenchTabsFromRaw = (raw: Record<string, unknown>): WorkbenchTabSummary[] | null => {
  const rawTabs = arrayField(raw, "tabs", "observations", "pages");
  if (rawTabs === undefined) return null;
  const tabs = rawTabs
    .map(workbenchTabFromRaw)
    .filter((tab): tab is WorkbenchTabSummary => tab !== null);
  return tabs.length === 0 ? null : tabs;
};

const softwareTitle = (tool: AgentToolActivity): string => {
  const input = toolInputRecord(tool);
  const actionId = stringField(input, "actionId", "capabilityId");
  if (actionId !== undefined) return actionId;
  const action = stringField(input, "action");
  if (action === "list_capabilities") return "Listed software capabilities";
  if (action === "inspect_capability") return "Inspected software capability";
  if (action === "read_state") return "Read software state";
  if (action === "invoke_capability") return "Invoked software capability";
  return "Software capability";
};

const toWorkbenchDetails = (
  tool: AgentToolActivity,
  output: string,
  raw: Record<string, unknown>
): ParsedWorkbenchDetails => {
  const input = asRecord(tool.input);
  const action = stringField(input, "action") ?? "workbench";
  const label = workbenchActionLabel(action);

  if (action === "list_tabs") {
    const tabs = workbenchTabsFromRaw(raw);
    return {
      type: "workbench",
      action,
      label,
      ...(tabs === null ? { text: output } : { tabs })
    };
  }

  if (action === "read_workspace") {
    const tabs = workbenchTabsFromRaw(raw);
    return {
      type: "workbench",
      action,
      label,
      ...(tabs === null ? { text: output } : { tabs })
    };
  }

  if (action === "read_tab") {
    const tab = workbenchTabFromRaw(raw.tab) ?? workbenchTabFromRaw(raw);
    return {
      type: "workbench",
      action,
      label,
      ...(tab === null
        ? { text: output }
        : {
            tab,
            ...(tab.excerpt === undefined ? {} : { excerpt: tab.excerpt })
          })
    };
  }

  return {
    type: "workbench",
    action,
    label,
    ...(output.trim().length === 0 ? {} : { text: output })
  };
};

const toSoftwareDetails = (
  tool: AgentToolActivity,
  output: string,
  raw: Record<string, unknown>,
  targets: readonly ToolActionTarget[]
): ParsedSoftwareDetails => {
  const input = toolInputRecord(tool);
  const softwareId =
    stringField(raw, "softwareId")
    ?? stringField(input, "softwareId");
  const actionId =
    stringField(raw, "actionId", "capabilityId")
    ?? stringField(input, "actionId", "capabilityId");
  return {
    type: "software",
    action: stringField(input, "action") ?? "software",
    ...(softwareId === undefined ? {} : { softwareId }),
    ...(actionId === undefined ? {} : { actionId }),
    ...(output.trim().length === 0 ? {} : { text: output }),
    ...(targets.length === 0 ? {} : { targets: [...targets] })
  };
};

const normalizeTerminalTarget = (value: unknown): ParsedTerminalDetails["target"] => {
  const record = asRecord(value);
  const type = stringField(record, "type");
  if (type === "private" || type === "ui" || type === "list") {
    return type;
  }
  return "private";
};

const normalizeTerminalReason = (
  value: string | undefined
): ParsedTerminalDetails["reason"] | undefined => {
  if (value === "output" || value === "exit" || value === "timeout") {
    return value;
  }
  return undefined;
};

const terminalMemoryFromRaw = (
  rawMemory: Record<string, unknown>
): ParsedTerminalDetails["memory"] | undefined => {
  const eventLogPath = stringField(rawMemory, "eventLogPath");
  const summaryPath = stringField(rawMemory, "summaryPath");
  const uiTimelinePath = stringField(rawMemory, "uiTimelinePath");
  const outputTextPath = stringField(rawMemory, "outputTextPath");
  const rawOutputPath = stringField(rawMemory, "rawOutputPath");
  const lineIndexPath = stringField(rawMemory, "lineIndexPath");
  const errorIndexPath = stringField(rawMemory, "errorIndexPath");
  const commandsPath = stringField(rawMemory, "commandsPath");
  const eventSeqRange = rangeField(rawMemory.eventSeqRange);
  const outputByteRange = rangeField(rawMemory.outputByteRange);
  const estimatedTokens = numberField(rawMemory, "estimatedTokens");
  const lineCount = numberField(rawMemory, "lineCount");
  const errorCount = numberField(rawMemory, "errorCount");
  const latestOutputPreview = stringField(rawMemory, "latestOutputPreview");
  const truncatedByProjection =
    typeof rawMemory.truncatedByProjection === "boolean"
      ? rawMemory.truncatedByProjection
      : undefined;
  const hasMemory =
    eventLogPath !== undefined
    || summaryPath !== undefined
    || uiTimelinePath !== undefined
    || outputTextPath !== undefined
    || rawOutputPath !== undefined
    || lineIndexPath !== undefined
    || errorIndexPath !== undefined
    || commandsPath !== undefined
    || eventSeqRange !== undefined
    || outputByteRange !== undefined
    || estimatedTokens !== undefined
    || lineCount !== undefined
    || errorCount !== undefined
    || latestOutputPreview !== undefined
    || truncatedByProjection !== undefined;
  if (!hasMemory) return undefined;
  return {
    ...(eventLogPath === undefined ? {} : { eventLogPath }),
    ...(summaryPath === undefined ? {} : { summaryPath }),
    ...(uiTimelinePath === undefined ? {} : { uiTimelinePath }),
    ...(outputTextPath === undefined ? {} : { outputTextPath }),
    ...(rawOutputPath === undefined ? {} : { rawOutputPath }),
    ...(lineIndexPath === undefined ? {} : { lineIndexPath }),
    ...(errorIndexPath === undefined ? {} : { errorIndexPath }),
    ...(commandsPath === undefined ? {} : { commandsPath }),
    ...(eventSeqRange === undefined ? {} : { eventSeqRange }),
    ...(outputByteRange === undefined ? {} : { outputByteRange }),
    ...(estimatedTokens === undefined ? {} : { estimatedTokens }),
    ...(lineCount === undefined ? {} : { lineCount }),
    ...(errorCount === undefined ? {} : { errorCount }),
    ...(latestOutputPreview === undefined ? {} : { latestOutputPreview }),
    ...(truncatedByProjection === undefined ? {} : { truncatedByProjection })
  };
};

const terminalReadHintFromRaw = (
  rawReadHint: Record<string, unknown>
): ParsedTerminalDetails["readHint"] | undefined => {
  const message = stringField(rawReadHint, "message");
  const outputTextPath = stringField(rawReadHint, "outputTextPath");
  const rawOutputPath = stringField(rawReadHint, "rawOutputPath");
  const lineIndexPath = stringField(rawReadHint, "lineIndexPath");
  const errorIndexPath = stringField(rawReadHint, "errorIndexPath");
  const eventLogPath = stringField(rawReadHint, "eventLogPath");
  const summaryPath = stringField(rawReadHint, "summaryPath");
  const uiTimelinePath = stringField(rawReadHint, "uiTimelinePath");
  const commandsPath = stringField(rawReadHint, "commandsPath");
  const hasReadHint =
    message !== undefined
    || outputTextPath !== undefined
    || rawOutputPath !== undefined
    || lineIndexPath !== undefined
    || errorIndexPath !== undefined
    || eventLogPath !== undefined
    || summaryPath !== undefined
    || uiTimelinePath !== undefined
    || commandsPath !== undefined;
  if (!hasReadHint) return undefined;
  return {
    ...(message === undefined ? {} : { message }),
    ...(outputTextPath === undefined ? {} : { outputTextPath }),
    ...(rawOutputPath === undefined ? {} : { rawOutputPath }),
    ...(lineIndexPath === undefined ? {} : { lineIndexPath }),
    ...(errorIndexPath === undefined ? {} : { errorIndexPath }),
    ...(eventLogPath === undefined ? {} : { eventLogPath }),
    ...(summaryPath === undefined ? {} : { summaryPath }),
    ...(uiTimelinePath === undefined ? {} : { uiTimelinePath }),
    ...(commandsPath === undefined ? {} : { commandsPath })
  };
};

const terminalVisibleRowsFromRaw = (value: unknown) =>
  Array.isArray(value)
    ? value.flatMap((item) => {
        const record = asRecord(item);
        const row = numberField(record, "row");
        const text = stringField(record, "text") ?? "";
        if (row === undefined) return [];
        return [{ row, text, wrapped: typeof record.wrapped === "boolean" ? record.wrapped : false }];
      })
    : [];

const terminalCellsFromRaw = (value: unknown) =>
  Array.isArray(value)
    ? value.flatMap((item) => {
        const record = asRecord(item);
        const row = numberField(record, "row");
        const col = numberField(record, "col");
        const width = numberField(record, "width");
        if (row === undefined || col === undefined || width === undefined) return [];
        return [{
          row,
          col,
          text: stringField(record, "text") ?? "",
          width,
          styleId: stringField(record, "styleId") ?? null,
          hyperlinkId: stringField(record, "hyperlinkId") ?? null
        }];
      })
    : [];

const terminalStylesFromRaw = (value: unknown) =>
  Array.isArray(value)
    ? value.flatMap((item) => {
        const record = asRecord(item);
        const styleId = stringField(record, "styleId");
        if (styleId === undefined) return [];
        return [{
          styleId,
          foreground: stringField(record, "foreground") ?? "default",
          background: stringField(record, "background") ?? "default",
          bold: typeof record.bold === "boolean" ? record.bold : false,
          dim: typeof record.dim === "boolean" ? record.dim : false,
          italic: typeof record.italic === "boolean" ? record.italic : false,
          underline: typeof record.underline === "boolean" ? record.underline : false,
          inverse: typeof record.inverse === "boolean" ? record.inverse : false
        }];
      })
    : [];

const terminalLinksFromRaw = (value: unknown) =>
  Array.isArray(value)
    ? value.flatMap((item) => {
        const record = asRecord(item);
        const linkId = stringField(record, "linkId");
        const uri = stringField(record, "uri");
        const rowStart = numberField(record, "rowStart");
        const rowEnd = numberField(record, "rowEnd");
        const colStart = numberField(record, "colStart");
        const colEnd = numberField(record, "colEnd");
        if (
          linkId === undefined
          || uri === undefined
          || rowStart === undefined
          || rowEnd === undefined
          || colStart === undefined
          || colEnd === undefined
        ) return [];
        return [{ linkId, uri, rowStart, rowEnd, colStart, colEnd }];
      })
    : [];

const terminalInputModesFromRaw = (value: unknown) => {
  const record = asRecord(value);
  return {
    applicationCursor:
      typeof record.applicationCursor === "boolean" ? record.applicationCursor : false,
    applicationKeypad:
      typeof record.applicationKeypad === "boolean" ? record.applicationKeypad : false,
    bracketedPaste:
      typeof record.bracketedPaste === "boolean" ? record.bracketedPaste : false,
    mouseReporting: stringField(record, "mouseReporting") ?? "none",
    mouseEncoding: stringField(record, "mouseEncoding") ?? "default",
    lineWrap: typeof record.lineWrap === "boolean" ? record.lineWrap : true
  };
};

const terminalScreenFromRaw = (
  rawScreen: Record<string, unknown>
): ParsedTerminalDetails["screen"] | undefined => {
  const cursor = stringField(rawScreen, "cursor");
  const screenVersion = numberField(rawScreen, "screenVersion");
  const rows = numberField(rawScreen, "rows");
  const cols = numberField(rawScreen, "cols");
  const visibleText = stringField(rawScreen, "visibleText") ?? "";
  const rawCursorPosition = asRecord(rawScreen.cursorPosition);
  const cursorRow = numberField(rawCursorPosition, "row");
  const cursorCol = numberField(rawCursorPosition, "col");
  if (
    cursor === undefined
    || screenVersion === undefined
    || rows === undefined
    || cols === undefined
    || cursorRow === undefined
    || cursorCol === undefined
  ) {
    return undefined;
  }
  const mode = stringField(rawScreen, "mode");
  return {
    cursor,
    screenVersion,
    rows,
    cols,
    mode: mode === "normal" || mode === "alternate" ? mode : "unknown",
    visibleText,
    visibleRows: terminalVisibleRowsFromRaw(rawScreen.visibleRows),
    scrollbackText: stringField(rawScreen, "scrollbackText") ?? null,
    scrollbackCursor: stringField(rawScreen, "scrollbackCursor") ?? "0",
    scrollbackRows: terminalVisibleRowsFromRaw(rawScreen.scrollbackRows),
    cursorPosition: {
      row: cursorRow,
      col: cursorCol,
      visible: typeof rawCursorPosition.visible === "boolean" ? rawCursorPosition.visible : true
    },
    cells: terminalCellsFromRaw(rawScreen.cells),
    cellsTruncated: typeof rawScreen.cellsTruncated === "boolean" ? rawScreen.cellsTruncated : false,
    styles: terminalStylesFromRaw(rawScreen.styles),
    links: terminalLinksFromRaw(rawScreen.links),
    inputModes: terminalInputModesFromRaw(rawScreen.inputModes),
    selectedText: stringField(rawScreen, "selectedText") ?? null,
    activeCommand: stringField(rawScreen, "activeCommand") ?? null,
    prompt: stringField(rawScreen, "prompt") ?? null,
    regions: [],
    truncated: typeof rawScreen.truncated === "boolean" ? rawScreen.truncated : false
  };
};

const terminalArtifactTarget = (
  label: string,
  path: string | undefined
): ToolActionTarget | null =>
  path === undefined
    ? null
    : {
        kind: "file",
        label,
        value: path
      };

const terminalArtifactTargets = (
  memory: ParsedTerminalDetails["memory"],
  readHint: ParsedTerminalDetails["readHint"]
): ToolActionTarget[] => uniqueActionTargets([
  terminalArtifactTarget("summary.json", readHint?.summaryPath ?? memory?.summaryPath),
  terminalArtifactTarget("ui-timeline.jsonl", readHint?.uiTimelinePath ?? memory?.uiTimelinePath),
  terminalArtifactTarget("session-output.txt", readHint?.outputTextPath ?? memory?.outputTextPath),
  terminalArtifactTarget("session-output.raw", readHint?.rawOutputPath ?? memory?.rawOutputPath),
  terminalArtifactTarget(
    "session-output.lines.jsonl",
    readHint?.lineIndexPath ?? memory?.lineIndexPath
  ),
  terminalArtifactTarget(
    "session-output.errors.jsonl",
    readHint?.errorIndexPath ?? memory?.errorIndexPath
  ),
  terminalArtifactTarget("events.jsonl", readHint?.eventLogPath ?? memory?.eventLogPath),
  terminalArtifactTarget("commands.jsonl", readHint?.commandsPath ?? memory?.commandsPath)
]);

const toTerminalDetails = (
  tool: AgentToolActivity,
  output: string,
  raw: Record<string, unknown>
): ParsedTerminalDetails => {
  const input = toolInputRecord(tool);
  const target = asRecord(raw.target);
  const action = stringField(input, "action") ?? "terminal";
  const cursor = stringField(raw, "cursor");
  const sessionId = stringField(raw, "sessionId");
  const terminalTabId = stringField(raw, "terminalTabId") ?? stringField(target, "terminalTabId");
  const paneId = stringField(raw, "paneId") ?? stringField(target, "paneId");
  const command = stringField(raw, "command") ?? stringField(input, "command");
  const wrote = stringField(raw, "wrote");
  const reason = normalizeTerminalReason(stringField(raw, "reason"));
  const screen = terminalScreenFromRaw(asRecord(raw.screen));
  const memory = terminalMemoryFromRaw(asRecord(raw.memory));
  const readHint = terminalReadHintFromRaw(asRecord(raw.readHint));
  const artifacts = terminalArtifactTargets(memory, readHint);
  return {
    type: "terminal",
    action,
    target: normalizeTerminalTarget(raw.target),
    output: stringField(raw, "output") ?? screen?.visibleText ?? output,
    running: typeof raw.running === "boolean" ? raw.running : false,
    exitCode: typeof raw.exitCode === "number" ? raw.exitCode : null,
    truncated: typeof raw.truncated === "boolean" ? raw.truncated : false,
    ...(cursor === undefined ? {} : { cursor }),
    ...(sessionId === undefined ? {} : { sessionId }),
    ...(terminalTabId === undefined ? {} : { terminalTabId }),
    ...(paneId === undefined ? {} : { paneId }),
    ...(command === undefined ? {} : { command }),
    ...(wrote === undefined ? {} : { wrote }),
    ...(reason === undefined ? {} : { reason }),
    ...(screen === undefined ? {} : { screen }),
    ...(memory === undefined ? {} : { memory }),
    ...(readHint === undefined ? {} : { readHint }),
    ...(artifacts.length === 0 ? {} : { artifacts })
  };
};

const renderSurfaceFormat = (value: string | undefined): ParsedRenderDetails["format"] => {
  switch (value) {
    case "html":
    case "markdown":
    case "svg":
    case "json":
    case "table":
    case "text":
      return value;
    case "md":
      return "markdown";
    default:
      return "html";
  }
};

const renderSurfaceOperation = (value: string | undefined): ParsedRenderDetails["operation"] => {
  switch (value) {
    case "update":
    case "replace":
    case "append":
      return value;
    default:
      return "create";
  }
};

const renderSurfaceTheme = (value: string | undefined): ParsedRenderDetails["theme"] => {
  switch (value) {
    case "light":
    case "dark":
      return value;
    default:
      return "auto";
  }
};

const renderSurfaceColumns = (value: unknown): RenderSurfaceColumn[] | undefined => {
  if (!Array.isArray(value)) return undefined;
  const columns = value
    .map((column) => {
      if (typeof column === "string" && column.trim().length > 0) {
        return { key: column, label: column };
      }
      const record = asRecord(column);
      const key = stringField(record, "key", "id", "name");
      if (key === undefined) return null;
      return {
        key,
        label: stringField(record, "label", "title") ?? key
      };
    })
    .filter((column): column is RenderSurfaceColumn => column !== null);
  return columns.length === 0 ? undefined : columns;
};

const renderSurfaceRows = (value: unknown): RenderSurfaceRow[] | undefined => {
  if (!Array.isArray(value)) return undefined;
  return value.filter((row): row is RenderSurfaceRow => {
    return Array.isArray(row) || (row !== null && typeof row === "object");
  });
};

const toRenderDetails = (
  tool: AgentToolActivity,
  output: string,
  raw: Record<string, unknown>
): ParsedRenderDetails => {
  const input = toolInputRecord(tool);
  const args = toolArgsRecord(tool);
  const format = renderSurfaceFormat(
    stringField(raw, "format", "kind")
    ?? stringField(args, "kind", "format")
    ?? stringField(input, "kind", "format")
  );
  const surfaceId =
    stringField(raw, "surfaceId", "id")
    ?? stringField(args, "surfaceId", "id")
    ?? stringField(input, "surfaceId", "id")
    ?? tool.id;
  const title =
    stringField(raw, "title")
    ?? stringField(args, "title")
    ?? stringField(input, "title")
    ?? "Render Surface";
  const content =
    stringField(raw, "content")
    ?? stringField(args, "content", format)
    ?? stringField(input, "content", format)
    ?? (format === "table" ? "" : output);
  const height = Math.max(
    140,
    Math.min(720, numberField(raw, "height") ?? numberField(args, "height") ?? numberField(input, "height") ?? 320)
  );
  const rawSecurity = asRecord(raw.security);
  const details: ParsedRenderDetails = {
    type: "render",
    surfaceId,
    title,
    format,
    operation: renderSurfaceOperation(
      stringField(raw, "operation") ?? stringField(args, "operation") ?? stringField(input, "operation")
    ),
    content,
    height,
    interactive: typeof raw.interactive === "boolean" ? raw.interactive : true,
    theme: renderSurfaceTheme(stringField(raw, "theme") ?? stringField(args, "theme") ?? stringField(input, "theme"))
  };
  const summary = stringField(raw, "summary");
  if (summary !== undefined) details.summary = summary;
  if (raw.data !== undefined && raw.data !== null) details.data = raw.data;
  const columns = renderSurfaceColumns(raw.columns ?? args.columns ?? input.columns);
  if (columns !== undefined) details.columns = columns;
  const rows = renderSurfaceRows(raw.rows ?? args.rows ?? input.rows);
  if (rows !== undefined) details.rows = rows;
  if (Object.keys(rawSecurity).length > 0) {
    details.security = {
      ...(typeof rawSecurity.runtime === "string" ? { runtime: rawSecurity.runtime } : {}),
      ...(typeof rawSecurity.node === "boolean" ? { node: rawSecurity.node } : {}),
      ...(typeof rawSecurity.sameOriginWithParent === "boolean"
        ? { sameOriginWithParent: rawSecurity.sameOriginWithParent }
        : {}),
      ...(typeof rawSecurity.parentDomAccess === "boolean"
        ? { parentDomAccess: rawSecurity.parentDomAccess }
        : {}),
      ...(typeof rawSecurity.network === "string" ? { network: rawSecurity.network } : {}),
      ...(typeof rawSecurity.eventBridge === "string" ? { eventBridge: rawSecurity.eventBridge } : {})
    };
  }
  return details;
};

const toToolDetails = (
  tool: AgentToolActivity,
  kind: ToolCall["kind"]
): ToolDetails => {
  if (!isToolFsActivity(tool)) {
    return {
      type: "text",
      body: toolOutputText(tool)
    };
  }
  const input = asRecord(tool.input);
  const args = toolArgsRecord(tool);
  const output = toolOutputText(tool);
  const outputRecord = asRecord(tool.output);
  const rawOutputRecord = asRecord(outputRecord.raw);
  const screenshotObj = asRecord(outputRecord.screenshot);
  const imageArtifactObj = asRecord(outputRecord.imageArtifact);
  const rawImageArtifactObj = asRecord(rawOutputRecord.imageArtifact);
  const imageArtifactPath =
    stringField(imageArtifactObj, "path")
    ?? stringField(rawImageArtifactObj, "path");
  const screenshotImage =
    imageAttachmentFromArtifact(rawImageArtifactObj, "Lyra Lumen snapshot")
    ?? imageAttachmentFromArtifact(imageArtifactObj, "Lyra Lumen snapshot");
  const targets = targetsFromToolRaw(rawOutputRecord);
  const screenshot = typeof screenshotObj.data === "string"
    ? `data:${screenshotObj.mediaType || "image/png"};base64,${screenshotObj.data}`
    : imageArtifactPath;

  if (isLyraLumenTool(tool)) {
    return toLumenDetails(tool, output, rawOutputRecord, screenshot, screenshotImage, targets);
  }
  if (isSoftwareTool(tool)) {
    return toSoftwareDetails(tool, output, rawOutputRecord, targets);
  }
  if (isTerminalTool(tool)) {
    return toTerminalDetails(tool, output, rawOutputRecord);
  }
  if (kind === "render") {
    return toRenderDetails(tool, output, rawOutputRecord);
  }
  if (kind === "read") {
    const file =
      stringField(rawOutputRecord, "file_path", "filePath", "path", "target")
      ?? stringField(args, "file_path", "filePath", "path", "target")
      ?? stringField(input, "file_path", "filePath", "path", "target")
      ?? toolFsPath(tool)
      ?? "Tool output";
    return {
      type: "read",
      file,
      ...(output.trim().length === 0 ? {} : { preview: output })
    };
  }
  if (kind === "shell") {
    const command =
      stringField(rawOutputRecord, "command", "cmd")
      ?? stringField(args, "command", "cmd")
      ?? stringField(input, "command", "cmd")
      ?? toolPathTitle(tool)
      ?? "Command";
    return {
      type: "shell",
      command,
      output,
      exitCode: numberField(rawOutputRecord, "exitCode", "exit_code")
        ?? (asRecord(tool.output).error ? 1 : 0)
    };
  }
  if (kind === "web") {
    const webResults = webResultsFromRaw(rawOutputRecord);
    const query =
      stringField(rawOutputRecord, "query")
      ?? stringField(args, "query")
      ?? stringField(input, "query");
    const url =
      stringField(rawOutputRecord, "finalUrl", "url", "href")
      ?? stringField(args, "url", "href")
      ?? stringField(input, "url", "href")
      ?? webResults?.[0]?.url;
    if (url === undefined) {
      return {
        type: "text",
        body: output
      };
    }
    return {
      type: "web",
      url,
      ...(query === undefined ? {} : { query }),
      ...(webResults === undefined ? {} : { results: webResults }),
      ...(numberField(rawOutputRecord, "bytes", "fetchedBytes") === undefined
        ? {}
        : { fetchedBytes: numberField(rawOutputRecord, "bytes", "fetchedBytes")! }),
      ...(stringField(rawOutputRecord, "title") === undefined
        ? {}
        : { title: stringField(rawOutputRecord, "title")! }),
      ...(stringField(rawOutputRecord, "text", "summary", "content") === undefined
        ? (output.trim().length === 0 ? {} : { summary: output })
        : { summary: stringField(rawOutputRecord, "text", "summary", "content")! }),
      screenshot
    };
  }
  if (kind === "workbench") {
    return toWorkbenchDetails(tool, output, rawOutputRecord);
  }
  return {
    type: "text",
    body: output
  };
};

const toolStatus = (tool: AgentToolActivity): ToolCall["status"] => {
  if (tool.status === "running") return "running";
  if (tool.status === "failed") return "error";
  return "success";
};

const toolFsMetaTitle = (tool: AgentToolActivity): string | null => {
  const input = toolInputRecord(tool);
  const toolName = tool.name.toLowerCase();
  if (toolName !== "tool_fs" && !toolName.startsWith("tool_fs_")) return null;
  const operation = toolName.startsWith("tool_fs_")
    ? toolName.slice("tool_fs_".length)
    : stringField(input, "action") ?? tool.operation ?? stringField(input, "operation");
  if (operation === "list") return "List tools";
  if (operation === "read_doc") return "Read tool docs";
  if (operation === "inspect") return "Inspect tool";
  if (operation === "run") return toolPathTitle(tool) ?? "Tool filesystem";
  return "Tool filesystem";
};

const toolPathTitle = (tool: AgentToolActivity): string | null => {
  const path = toolFsPath(tool);
  const pathParts = path?.split("/").filter(Boolean) ?? [];
  const leaf = pathParts[pathParts.length - 1];
  if (leaf === undefined || leaf.trim().length === 0) return null;
  return leaf
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
};

const genericToolTitle = (tool: AgentToolActivity): string => {
  const metaTitle = toolFsMetaTitle(tool);
  if (metaTitle !== null) return metaTitle;
  const label = tool.label.trim();
  if (label.length > 0 && !["Ran", "Run tool", "Used Lyra tool"].includes(label)) return label;
  const pathTitle = toolPathTitle(tool);
  if (pathTitle !== null) return pathTitle;
  return "Tool activity";
};

const manifestToolTitle = (tool: AgentToolActivity): string | null => {
  const title =
    tool.manifestTitle?.trim() || stringField(asRecord(tool.output), "manifestTitle")?.trim();
  return title !== undefined && title.length > 0 ? title : null;
};

const toToolCall = (tool: AgentToolActivity): ToolCall => {
  const kind = toolKind(tool);
  const details = toToolDetails(tool, kind);
  const output = asRecord(tool.output);
  const traceId = tool.traceId ?? stringField(output, "traceId", "trace_id");
  const trace = tool.trace ?? arrayField(output, "trace");
  const artifactRefs = tool.artifactRefs ?? arrayField(output, "artifactRefs", "artifact_refs");
  const changes = tool.changes ?? arrayField(output, "changes");
  const artifactTargets = artifactTargetsFromEvidence(artifactRefs, changes);
  const artifactPreviews = artifactPreviewsFromEvidence(artifactRefs, changes);
  const failureReason = stringField(output, "notRunReason", "not_run_reason");
  const title = manifestToolTitle(tool)
    ?? (isLyraLumenTool(tool)
    ? lumenTitle(tool)
    : isSoftwareTool(tool)
      ? softwareTitle(tool)
      : isTerminalTool(tool)
        ? tool.label
      : kind === "render"
        ? stringField(asRecord(asRecord(tool.output).raw), "title") ?? "Rendered surface"
    : kind === "workbench"
      ? workbenchActionLabel(stringField(toolInputRecord(tool), "action") ?? "workbench")
      : genericToolTitle(tool));
  return {
    id: tool.id,
    kind,
    title,
    status: toolStatus(tool),
    details,
    ...(traceId === undefined ? {} : { traceId }),
    ...(trace === undefined ? {} : { trace }),
    ...(artifactRefs === undefined ? {} : { artifactRefs }),
    ...(artifactTargets === undefined ? {} : { artifactTargets }),
    ...(artifactPreviews === undefined ? {} : { artifactPreviews }),
    ...(changes === undefined ? {} : { changes }),
    ...(failureReason === undefined ? {} : { failureReason })
  };
};

const toToolGroup = (
  tools: readonly AgentToolActivity[],
  id = "lyra-agent-tools"
): ToolGroup | null => {
  if (tools.length === 0) return null;
  const calls = tools.map(toToolCall);
  const running = tools.find((tool) => tool.status === "running");
  const runningCall = running === undefined
    ? undefined
    : calls.find((call) => call.id === running.id);
  return {
    id,
    status: running === undefined ? "done" : "running",
    label: runningCall?.title ?? running?.label ?? t("tool.agentActivity"),
    hint: running === undefined
      ? formatMessage("tool.events", { count: tools.length })
      : t("tool.running"),
    ...(running === undefined ? {} : { currentCallId: running.id }),
    calls
  };
};

export const formatAgentMessageTime = (value: string | undefined): string | undefined => {
  if (value === undefined) return undefined;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    hourCycle: "h23"
  }).format(date);
};

export const cleanSyntheticImageText = (text: string): string => {
  return text
    .split("\n")
    .filter((line) => {
      const trimmed = line.trim();
      if (trimmed === "[image]") return false;
      if (trimmed.startsWith("[Attached image associated with the preceding tool result:")) return false;
      return true;
    })
    .join("\n")
    .trim();
};

const isAssistantToolPlaceholderText = (text: string): boolean => {
  const cleaned = cleanSyntheticImageText(text).trim();
  return cleaned === "..." || cleaned === "…";
};

const messageBody = (
  session: AgentSessionSnapshot,
  message: AgentSessionSnapshot["messages"][number],
  index: number
): string => {
  if (message.text.length > 0) return cleanSyntheticImageText(message.text);
  const isLastAssistant = message.role === "assistant" && index === session.messages.length - 1;
  return isLastAssistant && session.turnStatus === "running" ? "" : t("msg.noResponseText");
};

const timelineTimeMs = (value: string | undefined, fallback: number): number => {
  if (value === undefined) return fallback;
  const parsed = new Date(value).getTime();
  return Number.isNaN(parsed) ? fallback : parsed;
};

const latestToolActivities = (
  tools: readonly AgentToolActivity[]
): AgentToolActivity[] => {
  const seen = new Set<string>();
  const latest: AgentToolActivity[] = [];
  for (let index = tools.length - 1; index >= 0; index -= 1) {
    const tool = tools[index];
    if (tool === undefined || seen.has(tool.id)) continue;
    seen.add(tool.id);
    latest.push(tool);
  }
  return latest.reverse();
};

const isPendingAgentMessage = (message: ChatMessage): boolean =>
  message.author === "agent" &&
  message.blocks.length > 0 &&
  message.blocks.every((block) => block.type === "text" && block.body.trim().length === 0);

type LegacyAgentToolBlock = Extract<AgentMessageBlock, { type: "tool" }> & {
  readonly tool_id?: string;
};

const toolIdForBlock = (block: AgentMessageBlock): string | null => {
  if (block.type !== "tool") return null;
  return block.toolId ?? (block as LegacyAgentToolBlock).tool_id ?? null;
};

const chatBlocksForAgentMessage = (
  session: AgentSessionSnapshot,
  message: AgentSessionSnapshot["messages"][number],
  index: number,
  toolsById: ReadonlyMap<string, AgentToolActivity>,
  referencedToolIds: Set<string>
): MessageBlock[] => {
  const sourceBlocks = message.blocks ?? [];
  if (sourceBlocks.length === 0) {
    if (
      message.role === "assistant" &&
      message.text.trim().length === 0 &&
      !(index === session.messages.length - 1 && session.turnStatus === "running")
    ) {
      return [];
    }
    const body = messageBody(session, message, index);
    return [
      {
        type: "text",
        id: `${message.id}-text`,
        body
      }
    ];
  }

  const chatBlocks: MessageBlock[] = [];
  const hasAssistantToolBlock =
    message.role === "assistant" && sourceBlocks.some((block) => block.type === "tool");
  let pendingTools: AgentToolActivity[] = [];
  const flushTools = () => {
    if (pendingTools.length === 0) return;
    const group = toToolGroup(pendingTools, `${message.id}-tools-${chatBlocks.length}`);
    if (group !== null) {
      chatBlocks.push({
        type: "tools",
        id: `${group.id}-block`,
        group
      });
    }
    pendingTools = [];
  };

  for (const block of sourceBlocks) {
    if (block.type === "text") {
      if (
        hasAssistantToolBlock &&
        isAssistantToolPlaceholderText(block.text)
      ) {
        continue;
      }
      flushTools();
      const cleaned = cleanSyntheticImageText(block.text);
      if (cleaned.length > 0) {
        chatBlocks.push({
          type: "text",
          id: `${message.id}-${block.id}`,
          body: cleaned
        });
      }
      continue;
    }

    if (block.type === "image") {
      flushTools();
      chatBlocks.push({
        type: "image",
        id: `${message.id}-${block.id}`,
        image: {
          id: block.id,
          mediaType: block.mediaType,
          data: block.data,
          label: block.label ?? null,
          source: block.source ?? null,
          width: block.width ?? null,
          height: block.height ?? null
        }
      });
      continue;
    }

    const toolId = toolIdForBlock(block);
    const tool = toolId === null ? undefined : toolsById.get(toolId);
    if (tool !== undefined) {
      referencedToolIds.add(tool.id);
      pendingTools.push(tool);
    }
  }
  flushTools();

  if (chatBlocks.length > 0) return chatBlocks;
  if (
    message.role === "assistant" &&
    sourceBlocks.some((block) => block.type === "tool") &&
    message.text.trim().length === 0
  ) {
    return [];
  }
  const body = messageBody(session, message, index);
  if (body.trim().length === 0) {
    return [];
  }
  return [
    {
      type: "text",
      id: `${message.id}-text`,
      body
    }
  ];
};

export const agentSessionToChatMessages = (
  session: AgentSessionSnapshot | null,
  options: {
    readonly failedTurnMessage?: string | null;
    readonly messageLimitFromEnd?: number | null;
  } = {}
): ChatMessage[] => {
  if (session === null) return [];

  const sessionTools = latestToolActivities(session.tools);
  const toolsById = new Map(sessionTools.map((tool) => [tool.id, tool]));
  const referencedToolIds = new Set<string>();
  const messageLimit = typeof options.messageLimitFromEnd === "number" &&
    Number.isFinite(options.messageLimitFromEnd)
    ? Math.max(0, Math.floor(options.messageLimitFromEnd))
    : null;
  const sourceMessageStartIndex = messageLimit === null || messageLimit >= session.messages.length
    ? 0
    : Math.max(0, session.messages.length - messageLimit);
  const sourceMessages = sourceMessageStartIndex === 0
    ? session.messages
    : session.messages.slice(sourceMessageStartIndex);

  // 1. Map raw AgentMessages to ChatMessages
  const timedMessages = sourceMessages
    .map((message, index) => {
      const originalIndex = sourceMessageStartIndex + index;
      const formattedTime = formatAgentMessageTime(message.createdAt);
      const hasToolBlock = message.blocks?.some((b) => b.type === "tool") ?? false;
      const author = (message.role === "user" && !hasToolBlock) ? "user" : "agent";
      const chatMessage: ChatMessage = {
        id: message.id,
        author,
        ...(formattedTime === undefined ? {} : { time: formattedTime }),
        ...(message.rollback === undefined || message.rollback === null
          ? {}
          : { rollback: message.rollback }),
        blocks: chatBlocksForAgentMessage(
          session,
          message,
          originalIndex,
          toolsById,
          referencedToolIds
        )
      };
      return {
        message: chatMessage,
        atMs: timelineTimeMs(message.createdAt, originalIndex),
        sequence: originalIndex
      };
    })
    .filter((item) => item.message.blocks.length > 0);

  const lastMessage = session.messages.at(-1);
  if (session.turnStatus === "failed" && lastMessage?.role === "user") {
    const errorDetail = options.failedTurnMessage?.trim();
    const formattedTime = formatAgentMessageTime(session.updatedAt);
    timedMessages.push({
      message: {
        id: `${session.id}-turn-failed`,
        author: "agent",
        ...(formattedTime === undefined ? {} : { time: formattedTime }),
        blocks: [
          {
            type: "text",
            id: `${session.id}-turn-failed-text`,
            body: errorDetail === undefined || errorDetail.length === 0
              ? t("msg.turnFailedNoResponse")
              : formatMessage("msg.turnFailedWithReason", { message: errorDetail })
          }
        ]
      },
      atMs: timelineTimeMs(session.updatedAt, session.messages.length),
      sequence: session.messages.length
    });
  }

  const firstVisibleMessage = sourceMessages[0];
  const firstVisibleAtMs = firstVisibleMessage === undefined
    ? null
    : timelineTimeMs(firstVisibleMessage.createdAt, sourceMessageStartIndex);
  const orphanTools = sessionTools
    .filter((tool) => !referencedToolIds.has(tool.id))
    .filter((tool) => (
      messageLimit === null ||
      firstVisibleAtMs === null ||
      timelineTimeMs(tool.startedAt, 0) >= firstVisibleAtMs
    ));
  orphanTools.forEach((tool, index) => {
    const group = toToolGroup([tool], `lyra-agent-tools-${tool.id}`);
    if (group === null) return;
    const formattedTime = formatAgentMessageTime(tool.startedAt);
    timedMessages.push({
      message: {
        id: `lyra-agent-tool-message-${tool.id}`,
        author: "agent",
        ...(formattedTime === undefined ? {} : { time: formattedTime }),
        blocks: [
          {
            type: "tools",
            id: `${group.id}-block`,
            group
          }
        ]
      },
      atMs: timelineTimeMs(tool.startedAt, session.messages.length + index),
      sequence: session.messages.length + index
    });
  });

  timedMessages.sort((left, right) => {
    if (left.atMs !== right.atMs) return left.atMs - right.atMs;
    return left.sequence - right.sequence;
  });

  const messages = timedMessages.map((item) => item.message);

  if (
    session.follow.running &&
    !messages.some((message) => isPendingAgentMessage(message))
  ) {
    messages.push({
      id: "lyra-agent-loading",
      author: "agent",
      blocks: [
        {
          type: "text",
          id: "lyra-agent-loading-text",
          body: ""
        }
      ]
    });
  }

  // 2. Merge pass on ChatMessages to combine consecutive agent messages and unify tool groups
  const finalMessages: ChatMessage[] = [];
  for (const msg of messages) {
    if (finalMessages.length > 0) {
      const prev = finalMessages[finalMessages.length - 1];
      if (
        prev !== undefined &&
        prev.author === msg.author &&
        prev.author === "agent" &&
        !isPendingAgentMessage(prev) &&
        !isPendingAgentMessage(msg)
      ) {
        // Merge blocks and combine consecutive tool groups
        const nextBlocks = [...prev.blocks];
        for (const block of msg.blocks) {
          const lastBlock = nextBlocks[nextBlocks.length - 1];
          if (lastBlock?.type === "tools" && block.type === "tools") {
            const combinedCalls = [...lastBlock.group.calls, ...block.group.calls];
            const running = combinedCalls.find((c) => c.status === "running");
            nextBlocks[nextBlocks.length - 1] = {
              ...lastBlock,
              group: {
                ...lastBlock.group,
                status: running === undefined ? "done" : "running",
                label: running?.title ?? lastBlock.group.label,
                hint: running === undefined
                  ? formatMessage("tool.events", { count: combinedCalls.length })
                  : t("tool.running"),
                ...(running === undefined ? {} : { currentCallId: running.id }),
                calls: combinedCalls
              }
            };
          } else {
            nextBlocks.push(block);
          }
        }

        const prevRollback = prev.rollback ?? undefined;
        const nextRollback = msg.rollback ?? prevRollback;
        finalMessages[finalMessages.length - 1] = {
          ...prev,
          blocks: nextBlocks,
          ...(nextRollback === undefined ? {} : { rollback: nextRollback })
        };
        continue;
      }
    }
    finalMessages.push(msg);
  }

  return finalMessages;
};

export const agentSessionToSessionMeta = (
  session: AgentSessionSnapshot | null
): SessionMeta => {
  const workingDir = normalizeSessionWorkingDir(session?.workingDir);
  const projectBound = session?.projectBound ?? false;
  return {
    id: session?.id ?? null,
    title: session?.title ?? "Lyra Agent",
    project: projectBound ? projectNameFromWorkingDir(workingDir) : "",
    workingDir,
    projectBound,
    automation: session?.automation ?? null,
    totalAdditions: 0,
    totalDeletions: 0
  };
};

export const agentSessionToSidePanel = (
  session: AgentSessionSnapshot | null
): AgentSidePanel | null => {
  if (session?.sidePanel === undefined || session.sidePanel.pages.length === 0) {
    return null;
  }
  return sidePanelSnapshotToViewModel(session.sidePanel);
};

const sidePanelSnapshotToViewModel = (
  snapshot: AgentSidePanelSnapshot
): AgentSidePanel => ({
  focusedPageId: snapshot.focusedPageId ?? null,
  pages: snapshot.pages.map((page) => ({
    id: page.id,
    title: page.title,
    content: page.content,
    updatedAtMs: page.updatedAtMs,
    filePath: page.filePath,
    format: page.format,
    source: page.source
  }))
});

const normalizeSessionWorkingDir = (value: string | null | undefined): string | null => {
  const trimmed = typeof value === "string" ? value.trim() : "";
  return trimmed.length === 0 ? null : trimmed;
};

const projectNameFromWorkingDir = (workingDir: string | null): string => {
  if (workingDir === null) return "";
  const segments = workingDir.split(/[\\/]+/).filter(Boolean);
  return segments.at(-1) ?? workingDir;
};

const todoStatus = (raw: unknown): TodoItem["status"] => {
  if (typeof raw !== "string") return "pending";
  const value = raw.trim().toLowerCase();
  if (["completed", "complete", "done", "success", "succeeded", "cancelled", "canceled"].includes(value)) return "done";
  if (["in_progress", "running", "active", "current", "working"].includes(value)) return "running";
  return "pending";
};

export const agentSessionToTodos = (
  session: AgentSessionSnapshot | null
): TodoItem[] => {
  if (session === null) return [];
  return session.todos
    .map((todo, index) => ({
      id: todo.id,
      title: todo.content.trim().length > 0
        ? todo.content
        : formatMessage("todo.fallback", { index: index + 1 }),
      status: todoStatus(todo.status)
    }))
    .filter((todo) => todo.title.trim().length > 0);
};

export const agentModelsToModelOptions = (
  state: AgentModelCatalogSnapshot | null
): ModelOption[] =>
  (state?.models ?? [])
    .filter((model) =>
      model.available &&
      (
        (model.provider ?? "").trim().length > 0 ||
        (model.providerLabel ?? "").trim().length > 0 ||
        (model.apiMethod ?? "").trim().length > 0
      )
    )
    .map((model) => ({
      id: model.id,
      label: model.label,
      model: model.model,
      provider: model.providerLabel ?? model.provider ?? null,
      detail: model.detail ?? model.apiMethod ?? null,
      available: model.available
    }));
