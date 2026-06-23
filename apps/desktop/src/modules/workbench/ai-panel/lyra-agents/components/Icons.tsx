import {
  Bot,
  ChevronRight,
  BookText,
  FileCode2,
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
  XCircle,
  Loader2,
  File,
  PanelsTopLeft,
  Terminal,
  Hammer,
  FolderOpen,
  LayoutGrid,
  Camera,
  Crosshair,
  Eye,
  FileCog,
  FolderTree,
  Link2,
  RadioTower,
  ScrollText,
  Target,
  Workflow,
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

export const ThinkingIndicator = () => (
  <span className="lyra-agents-thinking-indicator" aria-hidden="true">
    <span />
    <span />
    <span />
  </span>
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
      return <Clock3 {...props} />;
    case "plan":
      return <BookText {...props} />;
    case "task":
      return <ListChecks {...props} />;
    case "create":
      return <FilePlus {...props} />;
    case "render":
      return <PanelsTopLeft {...props} />;
  }
};

function lower(value: string | undefined): string {
  return value?.toLowerCase() ?? "";
}

function includesAny(value: string, needles: readonly string[]): boolean {
  return needles.some((needle) => value.includes(needle));
}

export const ToolCallIcon = ({ call }: { call: ToolCall }) => {
  const props = { size: ICON_SIZE, strokeWidth: ICON_STROKE, "aria-hidden": true as const };
  const details = call.details;
  const title = lower(call.title);

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
  if (details?.type === "render") {
    if (details.format === "html" || details.format === "svg" || details.format === "json") {
      return <FileCode2 {...props} />;
    }
    if (details.format === "table") return <LayoutGrid {...props} />;
    return <PanelsTopLeft {...props} />;
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
  if (call.kind === "thought") return <Clock3 {...props} />;
  if (call.kind === "plan") return <BookText {...props} />;
  if (call.kind === "create") return <FilePlus {...props} />;
  if (call.kind === "render") return <PanelsTopLeft {...props} />;
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

export const SpinnerIcon = () => (
  <Loader2
    size={14}
    strokeWidth={2}
    className="lyra-agents-spinner"
    aria-hidden
  />
);

export const CheckCircleIcon = () => (
  <CheckCircle2
    size={14}
    strokeWidth={1.8}
    aria-hidden
  />
);
