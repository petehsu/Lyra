import type { AgentToolActivity } from "../../../shared/agent";
import type { ToolCall, ToolDetails, ToolGroup } from "../ai-panel/agent-chat-demo/core/types";
import { formatMessage, t } from "../ai-panel/agent-chat-demo/core/i18n";
import {
  artifactPreviewsFromEvidence,
  artifactTargetsFromEvidence,
  arrayField,
  asRecord,
  imageAttachmentFromArtifact,
  isLyraLumenTool,
  isSoftwareTool,
  isTerminalTool,
  isToolFsActivity,
  legacyToolFamily,
  normalizedToolName,
  numberField,
  stringField,
  targetsFromToolRaw,
  toolArgsRecord,
  toolFsDomain,
  toolFsOperation,
  toolFsPath,
  toolInputRecord,
  toolOutputText
} from "./tool-parsing/common";
import { lumenTitle, toLumenDetails } from "./tool-parsing/lumen";
import {
  softwareTitle,
  toSoftwareDetails,
  toWorkbenchDetails,
  webFetchFromText,
  webResultsFromRaw,
  webResultsFromText,
  workbenchActionLabel
} from "./tool-parsing/workbench-software";
import { toTerminalDetails } from "./tool-parsing/terminal";
import { toRenderDetails } from "./tool-parsing/render";

export const toolKind = (tool: AgentToolActivity): ToolCall["kind"] => {
  const hintedKind = toolKindFromHint(tool.activityKind ?? tool.rendererHint ?? null);
  if (hintedKind !== null) return hintedKind;
  const action = (toolFsOperation(tool) ?? "").toLowerCase();
  const domain = (toolFsDomain(tool) ?? "").toLowerCase();
  const toolPath = (toolFsPath(tool) ?? "").toLowerCase();
  const legacyFamily = legacyToolFamily(tool);
  if (domain === "render" || toolPath.startsWith("/tools/render/") || legacyFamily === "render") return "render";
  if (domain === "workbench" || toolPath.startsWith("/tools/workbench/") || legacyFamily === "workbench") return "workbench";
  if (domain === "terminal" || toolPath.startsWith("/tools/terminal/") || legacyFamily === "terminal") return "terminal";
  if (
    domain === "browser" ||
    domain === "web" ||
    legacyFamily === "browser" ||
    legacyFamily === "web" ||
    toolPath.startsWith("/tools/browser/") ||
    toolPath.startsWith("/tools/web/")
  ) return "web";
  if (domain === "shell" || toolPath.startsWith("/tools/shell/") || legacyFamily === "shell") return "shell";
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

export const toolKindFromHint = (hint: string | null | undefined): ToolCall["kind"] | null => {
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

export const toToolDetails = (
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
    const webResults = webResultsFromRaw(rawOutputRecord) ?? webResultsFromText(output);
    const webFetch = webFetchFromText(output);
    const query =
      stringField(rawOutputRecord, "query")
      ?? stringField(args, "query")
      ?? stringField(input, "query");
    const url =
      stringField(rawOutputRecord, "finalUrl", "url", "href")
      ?? stringField(args, "url", "href")
      ?? stringField(input, "url", "href")
      ?? webFetch.url
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
      ...((numberField(rawOutputRecord, "bytes", "fetchedBytes") ?? webFetch.fetchedBytes) === undefined
        ? {}
        : { fetchedBytes: (numberField(rawOutputRecord, "bytes", "fetchedBytes") ?? webFetch.fetchedBytes)! }),
      ...((stringField(rawOutputRecord, "title") ?? webFetch.title) === undefined
        ? {}
        : { title: (stringField(rawOutputRecord, "title") ?? webFetch.title)! }),
      ...((stringField(rawOutputRecord, "text", "summary", "content") ?? webFetch.summary) === undefined
        ? (output.trim().length === 0 || webResults !== undefined ? {} : { summary: output })
        : { summary: (stringField(rawOutputRecord, "text", "summary", "content") ?? webFetch.summary)! }),
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

export const toolStatus = (tool: AgentToolActivity): ToolCall["status"] => {
  if (tool.status === "running") return "running";
  if (tool.status === "failed") return "error";
  return "success";
};

export const toolFsMetaTitle = (tool: AgentToolActivity): string | null => {
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

export const toolPathTitle = (tool: AgentToolActivity): string | null => {
  const path = toolFsPath(tool);
  const pathParts = path?.split("/").filter(Boolean) ?? [];
  const leaf = pathParts[pathParts.length - 1];
  if (leaf === undefined || leaf.trim().length === 0) return null;
  return leaf
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
};

export const genericToolTitle = (tool: AgentToolActivity): string => {
  const metaTitle = toolFsMetaTitle(tool);
  if (metaTitle !== null) return metaTitle;
  const label = tool.label.trim();
  if (label.length > 0 && !["Ran", "Run tool", "Used Lyra tool"].includes(label)) return label;
  const pathTitle = toolPathTitle(tool);
  if (pathTitle !== null) return pathTitle;
  const toolName = normalizedToolName(tool);
  if (legacyToolFamily(tool) === "shell" && toolName.length > 0) {
    return toolName;
  }
  return "Tool activity";
};

export const manifestToolTitle = (tool: AgentToolActivity): string | null => {
  const title =
    tool.manifestTitle?.trim() || stringField(asRecord(tool.output), "manifestTitle")?.trim();
  return title !== undefined && title.length > 0 ? title : null;
};

export const toToolCall = (tool: AgentToolActivity): ToolCall => {
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

export const toToolGroup = (
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
