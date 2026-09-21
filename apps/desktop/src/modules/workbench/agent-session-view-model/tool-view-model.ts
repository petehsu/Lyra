import type { AgentSubagentRecord, AgentToolActivity, AgentTurnStatus } from "../../../shared/agent";
import type { ToolCall, ToolDetails, ToolGroup } from "../ai-panel/lyra-agents/core/types";
import { formatMessage, t } from "@workbench/i18n";
import { looksLikeUnifiedDiff } from "@workbench/syntax/language-from-path";
import {
  artifactPreviewsFromEvidence,
  artifactTargetsFromEvidence,
  arrayField,
  asRecord,
  firstProjectFilePath,
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
import { humanProcessOutput, isDumpArtifactKind, toTerminalDetails } from "./tool-parsing/terminal";
import { toEditDetails } from "./tool-parsing/edit";

export const toolKind = (tool: AgentToolActivity): ToolCall["kind"] => {
  const hintedKind = toolKindFromHint(tool.activityKind ?? tool.rendererHint ?? null);
  if (hintedKind !== null) return hintedKind;
  const action = (toolFsOperation(tool) ?? "").toLowerCase();
  const domain = (toolFsDomain(tool) ?? "").toLowerCase();
  const toolPath = (toolFsPath(tool) ?? "").toLowerCase();
  const toolName = normalizedToolName(tool);
  const legacyFamily = legacyToolFamily(tool);
  if (isTodoTool(toolName, domain, toolPath)) return "task";
  if (
    domain === "plan" ||
    toolPath.startsWith("/tools/plan/") ||
    ["plan_begin", "plan_write", "plan_finalize", "plan_revise"].includes(toolName)
  ) return "plan";
  if (toolName === "apply_patch" || toolName === "edit_file" || toolName === "write_file") return "edit";
  if (toolName === "file" && ["write", "edit", "strict_edit", "multiedit", "apply_patch"].includes(action)) return "edit";
  if (toolName === "file" && ["glob", "list"].includes(action)) return "search";
  if (toolName === "file" && action === "read") return "read";
  if (toolName === "exec_command") return "shell";
  if (toolName === "write_stdin") return "terminal";
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
  if (domain === "git" || toolPath.startsWith("/tools/git/")) {
    return ["stage", "unstage", "discard"].includes(action) ? "edit" : "read";
  }
  if (domain === "filesystem" || toolPath.startsWith("/tools/filesystem/")) {
    if (["write", "edit", "strict_edit", "multiedit", "apply_patch"].includes(action)) return "edit";
    if (["glob", "list"].includes(action)) return "search";
    return "read";
  }
  if (domain === "code" || toolPath.startsWith("/tools/code/")) return "search";
  return "thought";
};

const isTodoTool = (toolName: string, domain: string, toolPath: string): boolean =>
  domain === "todo"
  || toolPath.startsWith("/tools/todo/")
  || toolName === "todo"
  || toolName.startsWith("todo_");

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
    case "plan":
      return "plan";
    case "task":
    case "todo":
      return "task";
    default:
      return null;
  }
};

const isClarificationActivity = (tool: AgentToolActivity): boolean => {
  const name = normalizedToolName(tool);
  const path = (toolFsPath(tool) ?? "").toLowerCase();
  return name === "clarification"
    || name === "lyra_clarification_ask"
    || path.includes("/clarification/");
};

const toAskDetails = (tool: AgentToolActivity): ToolDetails | null => {
  if (!isClarificationActivity(tool)) return null;
  const input = toolInputRecord(tool);
  const args = toolArgsRecord(tool);
  const output = asRecord(tool.output);
  const raw = asRecord(output.raw);
  const question =
    stringField(input, "question")
    ?? stringField(args, "question")
    ?? stringField(asRecord(args.args ?? input.args), "question")
    ?? "Asked for clarification";
  const answer =
    stringField(output, "answer")
    ?? stringField(raw, "answer")
    ?? "";
  return { type: "ask", question, answer };
};

export const toToolDetails = (
  tool: AgentToolActivity,
  kind: ToolCall["kind"]
): ToolDetails => {
  const ask = toAskDetails(tool);
  if (ask !== null) return ask;
  const isDirectCodexTool =
    tool.name === "apply_patch"
    || tool.name === "edit_file"
    || tool.name === "write_file"
    || tool.name === "exec_command"
    || tool.name === "write_stdin";
  if (!isToolFsActivity(tool) && !isDirectCodexTool) {
    return {
      type: "text",
      body: toolOutputText(tool)
    };
  }
  const input = toolInputRecord(tool);
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
  if (kind === "plan") {
    return {
      type: "text",
      body: stringField(rawOutputRecord, "markdown")
        ?? stringField(rawOutputRecord, "diff")
        ?? output
    };
  }
  if (kind === "read") {
    const nested = asRecord(args.args ?? input.args);
    const file = firstProjectFilePath(
      stringField(rawOutputRecord, "file_path", "filePath", "target"),
      stringField(rawOutputRecord, "path"),
      stringField(args, "file_path", "filePath", "target"),
      stringField(nested, "file_path", "filePath", "path", "target"),
      stringField(args, "path"),
      stringField(input, "file_path", "filePath", "target"),
      stringField(input, "path")
    );
    if (file === undefined) {
      return {
        type: "text",
        body: output
      };
    }
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
      output: humanProcessOutput(rawOutputRecord, output),
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
  if (kind === "edit") {
    return toEditDetails(tool);
  }
  return {
    type: "text",
    body: output
  };
};

const WORK_RESULT_FAILURE_CODES = new Set([
  "command_failed",
  "tool_reported_failure",
  "tool_timeout",
  "background_process_terminated"
]);

const isLyraToolFailure = (tool: AgentToolActivity): boolean => {
  const output = asRecord(tool.output);
  const raw = asRecord(output.raw);
  const error = asRecord(output.error);
  const content = stringField(output, "content") ?? "";
  if (content.startsWith("Lyra tool failed:")) return true;
  const code = stringField(error, "code")
    ?? stringField(asRecord(raw.error), "code", "kind");
  if (code !== undefined && WORK_RESULT_FAILURE_CODES.has(code)) return false;
  const notRunReason = stringField(output, "notRunReason", "not_run_reason");
  if (notRunReason === "timeout") return false;
  const exitCode = numberField(output, "exitCode") ?? numberField(raw, "exitCode");
  if (exitCode !== undefined && exitCode !== 0) return false;
  return true;
};

export type ToolProjectionContext = {
  readonly turnStatus?: AgentTurnStatus;
  readonly subagents?: readonly AgentSubagentRecord[];
};

export const isLiveBackgroundSubagentTool = (
  tool: AgentToolActivity,
  context?: ToolProjectionContext
): boolean => {
  if (tool.status !== "running") return false;
  const raw = asRecord(asRecord(tool.output).raw);
  if (raw.background !== true) return false;
  const subagentId = typeof raw.subagentId === "string" ? raw.subagentId.trim() : "";
  if (subagentId.length === 0) return false;
  const child = context?.subagents?.find((item) => item.id === subagentId);
  return child?.status === "running" || child?.status === "continuing";
};

export const projectedToolActivityStatus = (
  tool: AgentToolActivity,
  context?: ToolProjectionContext
): AgentToolActivity["status"] => {
  if (
    tool.status === "running"
    && context?.turnStatus !== undefined
    && context.turnStatus !== "running"
    && !isLiveBackgroundSubagentTool(tool, context)
  ) {
    return "cancelled";
  }
  return tool.status;
};

export const toolStatus = (
  tool: AgentToolActivity,
  context?: ToolProjectionContext
): ToolCall["status"] => {
  const status = projectedToolActivityStatus(tool, context);
  if (status === "running") return "running";
  if (tool.status === "suspended_user_action") return "suspended";
  if (tool.status === "failed") return isLyraToolFailure(tool) ? "error" : "warning";
  if (tool.status === "uncertain") return "success";
  return "success";
};

export const toolFsMetaTitle = (tool: AgentToolActivity): string | null => {
  const input = toolInputRecord(tool);
  const toolName = tool.name.toLowerCase();
  if (toolName !== "tool_fs" && !toolName.startsWith("tool_fs_")) return null;
  const operation = toolName.startsWith("tool_fs_")
    ? toolName.slice("tool_fs_".length)
    : stringField(input, "action") ?? tool.operation ?? stringField(input, "operation");
  if (operation === "search") return "Search tools";
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

const todoTitle = (tool: AgentToolActivity): string | null => {
  const toolName = normalizedToolName(tool);
  const action = (toolFsOperation(tool) ?? toolName.replace(/^todo_/, "")).toLowerCase();
  const domain = (toolFsDomain(tool) ?? "").toLowerCase();
  const toolPath = (toolFsPath(tool) ?? "").toLowerCase();
  if (!isTodoTool(toolName, domain, toolPath)) return null;
  if (action === "read") return "Read todos";
  if (action === "write") return "Write todos";
  if (action === "update") return "Update todo";
  if (action === "finish") return "Finish todos";
  return "Todo activity";
};

const GENERIC_AGENT_TITLES = new Set([
  "agent",
  "ran",
  "run tool",
  "used lyra tool",
  "spawn a worker agent",
  "spawn",
  "subagent"
]);

const isGenericAgentTitle = (value: string): boolean =>
  GENERIC_AGENT_TITLES.has(value.trim().toLowerCase());

export const isAgentSpawnActivity = (tool: AgentToolActivity): boolean => {
  const name = normalizedToolName(tool);
  const path = (toolFsPath(tool) ?? "").toLowerCase();
  const domain = (toolFsDomain(tool) ?? "").toLowerCase();
  const operation = (toolFsOperation(tool) ?? "").toLowerCase();
  if (name === "agent" || name === "agent_spawn") return true;
  if (path.includes("/agent/spawn")) return true;
  return domain === "agent" && (operation === "spawn" || operation.length === 0);
};

export const isAgentSpawnCall = (call: ToolCall): boolean => {
  const name = (call.toolName ?? "").trim().toLowerCase();
  const path = (call.toolPath ?? "").trim().toLowerCase();
  const domain = (call.domain ?? "").trim().toLowerCase();
  if ((call.subagentId ?? "").trim().length > 0) return true;
  if (name === "agent" || name === "agent_spawn") return true;
  if (path.includes("/agent/spawn")) return true;
  return domain === "agent";
};

export const agentSpawnTitle = (
  tool: AgentToolActivity,
  context?: ToolProjectionContext
): string | null => {
  if (!isAgentSpawnActivity(tool)) return null;
  const input = toolInputRecord(tool);
  const args = toolArgsRecord(tool);
  const nested = asRecord(args.args ?? input.args);
  const fromFields = [
    stringField(input, "description"),
    stringField(args, "description"),
    stringField(nested, "description")
  ].find((value) => value !== undefined && !isGenericAgentTitle(value));
  if (fromFields !== undefined) return fromFields.trim();
  const label = tool.label.trim();
  if (label.length > 0 && !isGenericAgentTitle(label)) return label;
  const started = toolOutputText(tool).match(
    /^Started (.+?) \(([^)]+)\) in the background/u
  );
  const startedName = started?.[1]?.trim();
  if (startedName !== undefined && startedName.length > 0 && !isGenericAgentTitle(startedName)) {
    return startedName;
  }
  const subagentId = stringField(asRecord(asRecord(tool.output).raw), "subagentId");
  const childDescription = subagentId === undefined
    ? undefined
    : context?.subagents?.find((item) => item.id === subagentId)?.description.trim();
  if (
    childDescription !== undefined
    && childDescription.length > 0
    && !isGenericAgentTitle(childDescription)
  ) {
    return childDescription;
  }
  return null;
};

export const toolGroupLabel = (
  calls: readonly ToolCall[],
  fallback: string
): string => {
  if (calls.length === 0) return fallback;
  const counts = {
    reads: 0,
    searches: 0,
    edits: 0,
    commands: 0,
    browses: 0,
    agents: 0,
    asks: 0,
    other: 0
  };
  for (const call of calls) {
    if (isAgentSpawnCall(call)) {
      counts.agents += 1;
      continue;
    }
    if (call.details?.type === "ask") {
      counts.asks += 1;
      continue;
    }
    if (call.kind === "read") {
      counts.reads += 1;
      continue;
    }
    if (call.kind === "search") {
      counts.searches += 1;
      continue;
    }
    if (call.kind === "edit" || call.kind === "create") {
      counts.edits += 1;
      continue;
    }
    if (call.kind === "shell" || call.kind === "terminal") {
      counts.commands += 1;
      continue;
    }
    if (call.kind === "web") {
      counts.browses += 1;
      continue;
    }
    counts.other += 1;
  }
  const parts: string[] = [];
  const push = (key: Parameters<typeof formatMessage>[0], count: number): void => {
    if (count > 0) parts.push(formatMessage(key, { count }));
  };
  push("tool.summary.reads", counts.reads);
  push("tool.summary.searches", counts.searches);
  push("tool.summary.edits", counts.edits);
  push("tool.summary.commands", counts.commands);
  push("tool.summary.browses", counts.browses);
  push("tool.agents", counts.agents);
  push("tool.summary.asks", counts.asks);
  push("tool.events", counts.other);
  return parts.length > 0 ? parts.join(", ") : fallback;
};

export const genericToolTitle = (tool: AgentToolActivity): string => {
  const toolName = normalizedToolName(tool);
  if (isAgentSpawnActivity(tool)) {
    return agentSpawnTitle(tool) ?? "Agent";
  }
  if (toolKind(tool) === "plan") {
    if (toolName === "plan_begin") return "Starting plan";
    if (toolName === "plan_write") return "Writing plan";
    if (toolName === "plan_finalize") return "Finalizing plan";
    if (toolName === "plan_revise") return "Revising plan";
    return "Planning";
  }
  const todo = todoTitle(tool);
  if (todo !== null) return todo;
  const metaTitle = toolFsMetaTitle(tool);
  if (metaTitle !== null) return metaTitle;
  const label = tool.label.trim();
  if (label.length > 0 && !["Ran", "Run tool", "Used Lyra tool"].includes(label)) return label;
  const pathTitle = toolPathTitle(tool);
  if (pathTitle !== null) return pathTitle;
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

const dropDuplicateEditDiffPreviews = (
  details: ToolDetails,
  previews: ReturnType<typeof artifactPreviewsFromEvidence>
): ReturnType<typeof artifactPreviewsFromEvidence> => {
  if (previews === undefined || details.type !== "edit" || details.hunks.length === 0) {
    return previews;
  }
  const kept = previews.filter((preview) => !looksLikeUnifiedDiff(preview.text));
  return kept.length === 0 ? undefined : kept;
};

const dropDuplicateDumpPreviews = (
  details: ToolDetails,
  previews: ReturnType<typeof artifactPreviewsFromEvidence>
): ReturnType<typeof artifactPreviewsFromEvidence> => {
  if (previews === undefined || (details.type !== "shell" && details.type !== "terminal")) {
    return previews;
  }
  const kept = previews.filter((preview) => !isDumpArtifactKind(preview.kind));
  return kept.length === 0 ? undefined : kept;
};

const diffArtifactPathsFromEvidence = (
  artifactRefs: readonly unknown[] | undefined,
  changes: readonly unknown[] | undefined
): ReadonlySet<string> => {
  const paths = new Set<string>();
  const takeDiffRef = (value: unknown): void => {
    const record = asRecord(value);
    const path = stringField(record, "path", "filePath", "source");
    if (path !== undefined) {
      paths.add(path);
    }
  };
  for (const artifact of artifactRefs ?? []) {
    const record = asRecord(artifact);
    const kind = (stringField(record, "kind", "type") ?? "").toLowerCase();
    if (kind === "diff") {
      takeDiffRef(record);
    }
  }
  for (const change of changes ?? []) {
    takeDiffRef(asRecord(change).diffRef);
  }
  return paths;
};

const dropDuplicateEditDiffTargets = (
  details: ToolDetails,
  artifactRefs: readonly unknown[] | undefined,
  changes: readonly unknown[] | undefined,
  targets: ReturnType<typeof artifactTargetsFromEvidence>
): ReturnType<typeof artifactTargetsFromEvidence> => {
  if (targets === undefined || details.type !== "edit" || details.hunks.length === 0) {
    return targets;
  }
  const diffPaths = diffArtifactPathsFromEvidence(artifactRefs, changes);
  const kept = targets.filter((target) => !diffPaths.has(target.value));
  return kept.length === 0 ? undefined : kept;
};

const dumpArtifactPathsFromEvidence = (
  artifactRefs: readonly unknown[] | undefined,
  changes: readonly unknown[] | undefined
): ReadonlySet<string> => {
  const paths = new Set<string>();
  const takeDumpRef = (value: unknown): void => {
    const record = asRecord(value);
    if (!isDumpArtifactKind(stringField(record, "kind", "type"))) {
      return;
    }
    const path = stringField(record, "path", "filePath", "source");
    if (path !== undefined) {
      paths.add(path);
    }
  };
  for (const artifact of artifactRefs ?? []) {
    takeDumpRef(artifact);
  }
  for (const change of changes ?? []) {
    takeDumpRef(asRecord(change).artifactRef);
  }
  return paths;
};

const dropDuplicateDumpTargets = (
  details: ToolDetails,
  artifactRefs: readonly unknown[] | undefined,
  changes: readonly unknown[] | undefined,
  targets: ReturnType<typeof artifactTargetsFromEvidence>
): ReturnType<typeof artifactTargetsFromEvidence> => {
  if (targets === undefined || (details.type !== "shell" && details.type !== "terminal")) {
    return targets;
  }
  const dumpPaths = dumpArtifactPathsFromEvidence(artifactRefs, changes);
  const kept = targets.filter((target) => !dumpPaths.has(target.value));
  return kept.length === 0 ? undefined : kept;
};

export const toToolCall = (
  tool: AgentToolActivity,
  context?: ToolProjectionContext
): ToolCall => {
  const kind = toolKind(tool);
  const details = toToolDetails(tool, kind);
  const toolPath = toolFsPath(tool);
  const domain = toolFsDomain(tool);
  const operation = toolFsOperation(tool);
  const output = asRecord(tool.output);
  const traceId = tool.traceId ?? stringField(output, "traceId", "trace_id");
  const trace = tool.trace ?? arrayField(output, "trace");
  const artifactRefs = tool.artifactRefs ?? arrayField(output, "artifactRefs", "artifact_refs");
  const changes = tool.changes ?? arrayField(output, "changes");
  const artifactTargets = dropDuplicateDumpTargets(
    details,
    artifactRefs,
    changes,
    dropDuplicateEditDiffTargets(
      details,
      artifactRefs,
      changes,
      artifactTargetsFromEvidence(artifactRefs, changes)
    )
  );
  const artifactPreviews = dropDuplicateDumpPreviews(
    details,
    dropDuplicateEditDiffPreviews(
      details,
      artifactPreviewsFromEvidence(artifactRefs, changes)
    )
  );
  const failureReason = tool.status === "uncertain"
    ? stringField(output, "message")
      ?? stringField(asRecord(output.raw), "message")
      ?? "Result unconfirmed — verify before retrying."
    : stringField(output, "notRunReason", "not_run_reason");
  const raw = asRecord(output.raw);
  const subagentId = stringField(raw, "subagentId");
  const background = raw.background === true;
  const spawnTitle = agentSpawnTitle(tool, context);
  const title = spawnTitle
    ?? (isAgentSpawnActivity(tool) ? null : manifestToolTitle(tool))
    ?? (isLyraLumenTool(tool)
    ? lumenTitle(tool)
    : isSoftwareTool(tool)
      ? softwareTitle(tool)
      : isTerminalTool(tool)
        ? tool.label

    : kind === "workbench"
      ? workbenchActionLabel(stringField(toolInputRecord(tool), "action") ?? "workbench")
      : genericToolTitle(tool));
  return {
    id: tool.id,
    kind,
    title,
    status: toolStatus(tool, context),
    toolName: normalizedToolName(tool),
    ...(toolPath === undefined ? {} : { toolPath }),
    ...(domain === undefined ? {} : { domain }),
    ...(operation === undefined ? {} : { operation }),
    ...(tool.activityKind === null || tool.activityKind === undefined
      ? {}
      : { activityKind: tool.activityKind }),
    ...(tool.rendererHint === null || tool.rendererHint === undefined
      ? {}
      : { rendererHint: tool.rendererHint }),
    details,
    ...(traceId === undefined ? {} : { traceId }),
    ...(trace === undefined ? {} : { trace }),
    ...(artifactRefs === undefined ? {} : { artifactRefs }),
    ...(artifactTargets === undefined ? {} : { artifactTargets }),
    ...(artifactPreviews === undefined ? {} : { artifactPreviews }),
    ...(changes === undefined ? {} : { changes }),
    ...(failureReason === undefined ? {} : { failureReason }),
    ...(subagentId === undefined ? {} : { subagentId }),
    ...(background ? { background: true } : {})
  };
};

const isSilentToolSearch = (tool: AgentToolActivity): boolean =>
  normalizedToolName(tool) === "toolsearch";

export const toToolGroup = (
  tools: readonly AgentToolActivity[],
  id = "lyra-agent-tools",
  context?: ToolProjectionContext
): ToolGroup | null => {
  const visible = tools.filter((tool) => !isSilentToolSearch(tool));
  if (visible.length === 0) return null;
  const calls = visible.map((tool) => toToolCall(tool, context));
  const running = calls.find((call) => call.status === "running");
  const suspended = calls.find((call) => call.status === "suspended");
  const active = running ?? suspended;
  return {
    id,
    status: running !== undefined ? "running" : suspended !== undefined ? "suspended" : "done",
    label: toolGroupLabel(calls, t("tool.agentActivity")),
    hint: active === undefined
      ? formatMessage("tool.events", { count: visible.length })
      : running !== undefined ? t("tool.running") : t("tool.waitingForUserAction"),
    ...(active === undefined ? {} : { currentCallId: active.id }),
    calls
  };
};
