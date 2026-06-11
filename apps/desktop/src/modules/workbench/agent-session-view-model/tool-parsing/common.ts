import type { AgentToolActivity } from "../../../../shared/agent";
import type {
  AgentImageAttachment,
  ToolActionTarget,
  ToolArtifactPreview
} from "../../ai-panel/agent-chat-demo/core/types";
import { isLyraSensitiveValueRef } from "../../../../shared/sensitive-value";
import type { LyraSensitiveValueRef } from "../../../../shared/desktop-bridge";

export const asRecord = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};

export const stringField = (
  value: Record<string, unknown>,
  ...keys: readonly string[]
): string | undefined => {
  for (const key of keys) {
    const field = value[key];
    if (typeof field === "string" && field.trim().length > 0) return field;
  }
  return undefined;
};

export const numberField = (
  value: Record<string, unknown>,
  ...keys: readonly string[]
): number | undefined => {
  for (const key of keys) {
    const field = value[key];
    if (typeof field === "number" && Number.isFinite(field)) return field;
  }
  return undefined;
};

export const arrayField = (
  value: Record<string, unknown>,
  ...keys: readonly string[]
): readonly unknown[] | undefined => {
  for (const key of keys) {
    const field = value[key];
    if (Array.isArray(field)) return field;
  }
  return undefined;
};

export const rangeField = (
  value: unknown
): { readonly start: number; readonly end: number } | undefined => {
  const record = asRecord(value);
  const start = numberField(record, "start");
  const end = numberField(record, "end");
  return start === undefined || end === undefined ? undefined : { start, end };
};

export const labelFromPath = (value: string): string => {
  const normalized = value.replaceAll("\\", "/");
  const tail = normalized.split("/").filter(Boolean).at(-1);
  return tail ?? value;
};

export const targetFromOpenTarget = (
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

export const targetFromSensitiveValueRef = (
  value: LyraSensitiveValueRef,
  fallbackLabel?: string
): ToolActionTarget => ({
  kind: "secret",
  label: fallbackLabel ?? value.label,
  value: value.id,
  secretRef: value
});

export const uniqueActionTargets = (
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

export const imageAttachmentFromArtifact = (
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

export const targetWithArtifactMetadata = (
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

export const targetFromArtifactRef = (
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

export const artifactTargetsFromEvidence = (
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

export const artifactPreviewFromRef = (
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

export const artifactPreviewsFromEvidence = (
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

export const secretTargetsFromValue = (
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

export const targetsFromToolRaw = (raw: Record<string, unknown>): ToolActionTarget[] => {
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

export const parseJsonRecord = (value: string): Record<string, unknown> | null => {
  try {
    const parsed = JSON.parse(value) as unknown;
    return asRecord(parsed);
  } catch {
    return null;
  }
};

export const toolInputRecord = (tool: AgentToolActivity): Record<string, unknown> => {
  const input = asRecord(tool.input);
  const delta = stringField(input, "delta");
  if (delta !== undefined) {
    return parseJsonRecord(delta) ?? input;
  }
  return input;
};

export const toolArgsRecord = (tool: AgentToolActivity): Record<string, unknown> =>
  asRecord(toolInputRecord(tool).args);

export const toolOutputText = (tool: AgentToolActivity): string => {
  const output = asRecord(tool.output);
  const content = output.content;
  if (typeof content === "string") return content;
  if (tool.output !== undefined) return JSON.stringify(tool.output, null, 2);
  return JSON.stringify(tool.input, null, 2);
};

export type LegacyToolFamily =
  | "browser"
  | "render"
  | "software"
  | "terminal"
  | "web"
  | "workbench"
  | "shell";

export const normalizedToolName = (tool: AgentToolActivity): string =>
  tool.name.trim().toLowerCase();

const toolNameHasPrefix = (toolName: string, prefix: string): boolean =>
  toolName === prefix
  || toolName.startsWith(`${prefix}_`)
  || toolName.startsWith(`${prefix}.`)
  || toolName.startsWith(`${prefix}-`);

export const legacyToolFamily = (
  tool: AgentToolActivity
): LegacyToolFamily | null => {
  const toolName = normalizedToolName(tool);
  if (toolName === "lyra_lumen" || toolNameHasPrefix(toolName, "lyra_lumen")) {
    const input = asRecord(tool.input);
    const action = stringField(input, "action");
    const filePath = stringField(input, "path", "filePath", "file_path");
    const browserTarget = stringField(
      input,
      "target",
      "targetMode",
      "lumenTargetRef",
      "targetRef",
      "url"
    );
    if (action === "read" && filePath !== undefined && browserTarget === undefined) {
      return null;
    }
    return "browser";
  }
  if (toolName === "render_surface" || toolNameHasPrefix(toolName, "render")) {
    return "render";
  }
  if (toolNameHasPrefix(toolName, "software")) {
    return "software";
  }
  if (toolNameHasPrefix(toolName, "terminal")) {
    return "terminal";
  }
  if (toolNameHasPrefix(toolName, "workbench")) {
    return "workbench";
  }
  if (toolNameHasPrefix(toolName, "shell")) {
    return "shell";
  }
  if (
    toolName === "websearch"
    || toolName === "web_search"
    || toolName === "web.search"
    || toolName === "search_web"
    || toolName === "webfetch"
    || toolName === "web_fetch"
    || toolName === "web.fetch"
    || toolName === "fetch_web"
  ) {
    return "web";
  }
  return null;
};


export const isHttpUrl = (value: string): boolean =>
  value.startsWith("https://") || value.startsWith("http://");

export const normalizeToolFsPath = (value: string | null | undefined): string | undefined => {
  const normalized = value?.trim();
  if (normalized === undefined || normalized.length === 0) return undefined;
  return normalized === "/tools" || normalized.startsWith("/tools/")
    ? normalized
    : undefined;
};

export const toolFsPath = (tool: AgentToolActivity): string | undefined => {
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

export const toolFsDomain = (tool: AgentToolActivity): string | undefined => {
  const input = toolInputRecord(tool);
  const output = asRecord(tool.output);
  const raw = asRecord(output.raw);
  return tool.domain
    ?? stringField(input, "domain")
    ?? stringField(output, "domain")
    ?? stringField(raw, "domain");
};

export const toolFsOperation = (tool: AgentToolActivity): string | undefined => {
  const input = toolInputRecord(tool);
  const output = asRecord(tool.output);
  const raw = asRecord(output.raw);
  return tool.operation
    ?? stringField(input, "operation", "action", "op")
    ?? stringField(output, "operation", "op")
    ?? stringField(raw, "operation", "action", "op");
};

export const isToolFsActivity = (tool: AgentToolActivity): boolean => {
  const toolName = normalizedToolName(tool);
  return toolName === "tool_fs"
    || toolName.startsWith("tool_fs_")
    || legacyToolFamily(tool) !== null
    || toolFsPath(tool) !== undefined
    || toolFsDomain(tool) !== undefined
    || toolFsOperation(tool) !== undefined
    || (tool.manifestTitle?.trim() ?? stringField(asRecord(tool.output), "manifestTitle")?.trim() ?? "").length > 0;
};

export const isLyraLumenTool = (tool: AgentToolActivity): boolean =>
  legacyToolFamily(tool) === "browser"
  || (toolFsDomain(tool) ?? "").toLowerCase() === "browser"
  || (toolFsPath(tool) ?? "").toLowerCase().startsWith("/tools/browser/");

export const isSoftwareTool = (tool: AgentToolActivity): boolean => {
  return legacyToolFamily(tool) === "software"
    || (toolFsDomain(tool) ?? "").toLowerCase() === "software"
    || (toolFsPath(tool) ?? "").toLowerCase().startsWith("/tools/software/");
};

export const isTerminalTool = (tool: AgentToolActivity): boolean => {
  return legacyToolFamily(tool) === "terminal"
    || (toolFsDomain(tool) ?? "").toLowerCase() === "terminal"
    || (toolFsPath(tool) ?? "").toLowerCase().startsWith("/tools/terminal/");
};
