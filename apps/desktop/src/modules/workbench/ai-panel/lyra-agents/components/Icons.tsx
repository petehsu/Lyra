import {
  Bot,
  ChevronRight,
  BookText,
  FileText,
  FilePlus,
  FileDiff,
  FilePenLine,
  Globe,
  HelpCircle,
  Search,
  List,
  ListChecks,
  Monitor,
  PackageOpen,
  Pencil,
  SquareTerminal,
  Store,
  AppWindow,
  Clock3,
  CheckCircle2,
  CheckCheck,
  ClipboardPaste,
  XCircle,
  Database,
  File,
  FileCode2,
  Terminal,
  Hammer,
  FolderOpen,
  Camera,
  Crosshair,
  Eye,
  FileCog,
  FolderTree,
  GitBranch,
  GitCommitHorizontal,
  GitCompareArrows,
  Link2,
  RadioTower,
  ScrollText,
  Sparkles,
  Target,
  Workflow,
  Puzzle,
  Webhook,
} from "lucide-react";
import type { ToolCall } from "../types";

const ICON_SIZE = 15;
const ICON_STROKE = 1.7;

export const ChevronIcon = ({ open }: { open: boolean }) => (
  <ChevronRight
    size={14}
    strokeWidth={2}
    style={{
      transition: "transform 160ms ease",
      transform: open ? "rotate(90deg)" : "rotate(0deg)",
    }}
    aria-hidden
  />
);

export const ToolExecutionIndicator = () => (
  <span className="lyra-agents-tool-execution-indicator" aria-hidden="true">
    <span />
    <span />
    <span />
    <span />
  </span>
);

export const ToolIcon = ({ kind }: { kind: ToolCall["kind"] }) => {
  const props = { size: ICON_SIZE, strokeWidth: ICON_STROKE, "aria-hidden": true as const };
  switch (kind) {
    case "read":
      return <FileText {...props} />;
    case "edit":
      return <Pencil {...props} />;
    case "search":
      return <Search {...props} />;
    case "shell":
    case "terminal":
      return <SquareTerminal {...props} />;
    case "web":
      return <Globe {...props} />;
    case "workbench":
      return <AppWindow {...props} />;
    case "thought":
      return <Sparkles {...props} />;
    case "plan":
      return <BookText {...props} />;
    case "task":
      return <ListChecks {...props} />;
    case "create":
      return <FilePlus {...props} />;
  }
};

function lower(value: string | undefined): string {
  return value?.toLowerCase() ?? "";
}

function includesAny(value: string, needles: readonly string[]): boolean {
  return needles.some((needle) => value.includes(needle));
}

function detailKey(details: ToolCall["details"]): string {
  if (details === undefined) return "";
  switch (details.type) {
    case "edit":
    case "read":
      return details.file;
    case "search":
      return details.query;
    case "shell":
      return details.command;
    case "terminal":
    case "workbench":
    case "lumen":
    case "software":
      return [
        details.action,
        "softwareId" in details ? details.softwareId : "",
        "actionId" in details ? details.actionId : ""
      ].join(" ");
    case "web":
      return [details.url, details.query, details.title].join(" ");
    case "task":
      return "todo";
    case "ask":
      return details.question;
    case "text":
      return "";
  }
}

export const ToolCallIcon = ({ call }: { call: ToolCall }) => {
  const props = { size: ICON_SIZE, strokeWidth: ICON_STROKE, "aria-hidden": true as const };
  const details = call.details;
  const title = lower(call.title);
  const semantic = `${title} ${lower(detailKey(details))}`;

  if (includesAny(semantic, ["todo", "todos", "待办"])) {
    if (includesAny(semantic, ["finish", "complete", "completed", "done", "完成"])) {
      return <CheckCheck {...props} />;
    }
    if (includesAny(semantic, ["update", "updated", "progress", "in_progress", "执行"])) {
      return <CheckCheck {...props} />;
    }
    if (includesAny(semantic, ["write", "replace", "写入"])) {
      return <ClipboardPaste {...props} />;
    }
    if (includesAny(semantic, ["read", "list", "读取", "列表"])) {
      return <List {...props} />;
    }
    return <ListChecks {...props} />;
  }
  if (includesAny(semantic, ["/tools/git/", "git "])) {
    if (includesAny(semantic, ["diff", "compare"])) return <GitCompareArrows {...props} />;
    if (semantic.includes("commit")) return <GitCommitHorizontal {...props} />;
    return <GitBranch {...props} />;
  }
  if (includesAny(title, ["search tools", "tool search"])) {
    return <Search {...props} />;
  }
  if (includesAny(title, ["list tools", "list tool"])) {
    return <List {...props} />;
  }
  if (includesAny(title, ["read tool docs", "tool docs"])) {
    return <BookText {...props} />;
  }
  if (includesAny(title, ["read lyra artifact", "artifact"])) {
    return <FileText {...props} />;
  }
  if (includesAny(title, ["searched project", "project search"])) {
    return <Search {...props} />;
  }
  if (includesAny(title, ["searched web", "web search", "search web"])) {
    return <Search {...props} />;
  }
  if (includesAny(title, ["fetched web page", "fetch url", "fetch webpage", "fetch web page"])) {
    return <Link2 {...props} />;
  }
  if (includesAny(title, ["updated memory", "searched memory", "memory"])) {
    return <Database {...props} />;
  }
  if (includesAny(title, ["queried lsp", "code symbols", "code text", "searched code"])) {
    return <FileCode2 {...props} />;
  }
  if (includesAny(title, ["expanded code graph", "code graph"])) {
    return <Workflow {...props} />;
  }
  if (includesAny(title, ["asked for clarification", "clarification"])) {
    return <HelpCircle {...props} />;
  }
  if (includesAny(title, ["lyra skill", "skills"])) {
    return <Puzzle {...props} />;
  }
  if (includesAny(title, ["mcp capability", "mcp"])) {
    return <Webhook {...props} />;
  }
  if (includesAny(title, ["lyra software", "software"])) {
    return <Store {...props} />;
  }

  if (includesAny(title, ["act in browser", "click browser", "type in browser", "drag browser"])) {
    return <Target {...props} />;
  }
  if (includesAny(title, ["web search", "search web"])) {
    return <Search {...props} />;
  }
  if (includesAny(title, ["fetch url", "fetch webpage", "fetch web page"])) {
    return <Link2 {...props} />;
  }
  if (includesAny(title, ["locate browser page", "browser page section", "locate section"])) {
    return <Crosshair {...props} />;
  }
  if (includesAny(title, ["find in browser page", "search browser page", "find browser page"])) {
    return <Search {...props} />;
  }
  if (includesAny(title, ["scroll browser page", "scroll page"])) {
    return <ScrollText {...props} />;
  }
  if (includesAny(title, ["map browser page", "map page", "map actionable"])) {
    return <Workflow {...props} />;
  }
  if (includesAny(title, ["read browser page", "read page text", "read visible browser"])) {
    return <BookText {...props} />;
  }
  if (includesAny(title, ["see browser page", "capture browser page", "screenshot"])) {
    return <Camera {...props} />;
  }
  if (includesAny(title, ["navigate browser page", "open browser page"])) {
    return <Link2 {...props} />;
  }
  if (includesAny(title, ["wait for browser page", "wait browser page"])) {
    return <Clock3 {...props} />;
  }
  if (includesAny(title, ["inspect tool", "inspect path", "inspect filesystem"])) {
    return <FileCog {...props} />;
  }
  if (includesAny(title, ["tool filesystem", "tool file system", "filesystem tool"])) {
    return <FolderTree {...props} />;
  }

  if (details?.type === "terminal") {
    const action = lower(details.action);
    if (action.includes("write") || action.includes("input") || action.includes("type")) {
      return <FilePenLine {...props} />;
    }
    if (action.includes("read") || action.includes("screen") || action.includes("output")) {
      return <Monitor {...props} />;
    }
    if (details.command !== undefined || action.includes("run") || action.includes("command")) {
      return <SquareTerminal {...props} />;
    }
    return <Terminal {...props} />;
  }

  if (details?.type === "workbench") {
    const action = lower(details.action);
    if (action.includes("list")) return <List {...props} />;
    if (action.includes("read")) return <BookText {...props} />;
    if (action.includes("open") || action.includes("focus") || action.includes("switch")) {
      return <FolderOpen {...props} />;
    }
    return <AppWindow {...props} />;
  }

  if (details?.type === "web") {
    if (details.query !== undefined || details.results !== undefined || title.includes("search") || title.includes("find")) {
      return <Search {...props} />;
    }
    if (details.screenshot !== undefined) return <Camera {...props} />;
    if (title.includes("scroll")) return <ScrollText {...props} />;
    if (title.includes("map")) return <Workflow {...props} />;
    if (title.includes("locate")) return <Crosshair {...props} />;
    if (title.includes("read")) return <BookText {...props} />;
    return <Globe {...props} />;
  }

  if (details?.type === "lumen") return <Camera {...props} />;
  if (details?.type === "software") {
    const action = lower(details.action);
    if (action.includes("install") || action.includes("package")) return <PackageOpen {...props} />;
    return <Store {...props} />;
  }
  if (details?.type === "task") return <ListChecks {...props} />;
  if (details?.type === "ask") return <HelpCircle {...props} />;
  if (details?.type === "text") return <Bot {...props} />;

  if (call.kind === "read") {
    if (title.includes("search") || title.includes("find")) return <Search {...props} />;
    if (title.includes("browser") || title.includes("page")) return <BookText {...props} />;
    return <FileText {...props} />;
  }
  if (call.kind === "edit") {
    if (title.includes("create") || title.includes("new")) return <FilePlus {...props} />;
    if (title.includes("patch") || title.includes("diff")) return <FileDiff {...props} />;
    return <FilePenLine {...props} />;
  }
  if (call.kind === "search") return <Search {...props} />;
  if (call.kind === "shell") return <SquareTerminal {...props} />;
  if (call.kind === "thought") return <Sparkles {...props} />;
  if (call.kind === "plan") return <BookText {...props} />;
  if (call.kind === "create") return <FilePlus {...props} />;
  if (call.kind === "task") return <ListChecks {...props} />;
  if (call.kind === "workbench") return <AppWindow {...props} />;
  if (call.kind === "web") {
    if (title.includes("find") || title.includes("search")) return <Search {...props} />;
    if (title.includes("act") || title.includes("click") || title.includes("type") || title.includes("drag")) {
      return <Target {...props} />;
    }
    if (title.includes("fetch")) return <Link2 {...props} />;
    if (title.includes("scroll")) return <ScrollText {...props} />;
    if (title.includes("map")) return <Workflow {...props} />;
    if (title.includes("locate") || title.includes("section")) return <Crosshair {...props} />;
    if (title.includes("read")) return <BookText {...props} />;
    if (title.includes("see") || title.includes("capture")) return <Camera {...props} />;
    if (title.includes("audit") || title.includes("diagnostic")) return <RadioTower {...props} />;
    return <Globe {...props} />;
  }
  if (title.includes("filesystem") || title.includes("file system")) return <FolderTree {...props} />;
  if (title.includes("inspect")) return <Eye {...props} />;
  return <Hammer {...props} />;
};

export const FileIcon = () => (
  <File size={ICON_SIZE} strokeWidth={ICON_STROKE} aria-hidden />
);

export const ErrorCircleIcon = () => (
  <XCircle size={14} strokeWidth={1.8} aria-hidden />
);

export const CheckCircleIcon = () => (
  <CheckCircle2
    size={14}
    strokeWidth={1.8}
    aria-hidden
  />
);
