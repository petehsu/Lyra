// ============================================================================
// Lyra Agent UI — Core Domain Types
// ============================================================================
//
// This file is the single source of truth for all domain models the UI
// consumes. It is framework-agnostic and contains no React types so it can
// be reused from a server-side rendering pipeline or type-checked from
// external data providers.

import type { LyraSensitiveValueRef } from "../../../../../shared/desktop-bridge";

export type ToolStatus = "running" | "success" | "error";

export type ToolKind =
  | "read"
  | "edit"
  | "search"
  | "shell"
  | "terminal"
  | "web"
  | "workbench"
  | "thought"
  | "task"
  | "create"
  | "render";

export interface ToolCall {
  id: string;
  kind: ToolKind;
  title: string;
  status: ToolStatus;
  details?: ToolDetails;
}

export type ToolDetails =
  | { type: "edit"; file: string; additions: number; deletions: number; hunks: DiffHunk[] }
  | { type: "read"; file: string; range?: string; preview?: string }
  | { type: "search"; query: string; results: SearchResult[] }
  | { type: "shell"; command: string; output: string; exitCode: number }
  | {
      type: "terminal";
      action: string;
      target: "private" | "ui" | "list";
      output: string;
      cursor?: string;
      sessionId?: string;
      terminalTabId?: string;
      paneId?: string;
      command?: string;
      wrote?: string;
      reason?: "output" | "exit" | "timeout";
      screen?: TerminalScreenSnapshot;
      running: boolean;
      exitCode: number | null;
      truncated: boolean;
      memory?: {
        eventLogPath?: string;
        summaryPath?: string;
        uiTimelinePath?: string;
        outputTextPath?: string;
        rawOutputPath?: string;
        lineIndexPath?: string;
        errorIndexPath?: string;
        commandsPath?: string;
        eventSeqRange?: { start: number; end: number } | null;
        outputByteRange?: { start: number; end: number };
        estimatedTokens?: number;
        lineCount?: number;
        errorCount?: number;
        latestOutputPreview?: string;
        truncatedByProjection?: boolean;
      };
      readHint?: {
        message?: string;
        outputTextPath?: string;
        rawOutputPath?: string;
        lineIndexPath?: string;
        errorIndexPath?: string;
        eventLogPath?: string;
        summaryPath?: string;
        uiTimelinePath?: string;
        commandsPath?: string;
      };
      artifacts?: ToolActionTarget[];
    }
  | {
      type: "web";
      url: string;
      summary?: string;
      screenshot?: string | undefined;
      query?: string;
      results?: WebResult[];
      title?: string;
      fetchedBytes?: number;
    }
  | {
      type: "workbench";
      action: string;
      label: string;
      tabs?: WorkbenchTabSummary[];
      tab?: WorkbenchTabSummary;
      excerpt?: string;
      text?: string;
    }
  | {
      type: "lumen";
      action: string;
      targetMode: string;
      peek: ToolPeek;
      text?: string;
      screenshot?: string | undefined;
      screenshotImage?: AgentImageAttachment | undefined;
      targets?: ToolActionTarget[];
    }
  | {
      type: "software";
      action: string;
      softwareId?: string;
      actionId?: string;
      text?: string;
      targets?: ToolActionTarget[];
    }
  | {
      type: "render";
      surfaceId: string;
      title: string;
      format: "html" | "markdown" | "svg" | "json" | "table" | "text";
      operation: "create" | "update" | "replace" | "append";
      content: string;
      summary?: string;
      data?: unknown;
      columns?: RenderSurfaceColumn[];
      rows?: RenderSurfaceRow[];
      height: number;
      interactive: boolean;
      theme: "auto" | "light" | "dark";
      security?: {
        runtime?: string;
        node?: boolean;
        sameOriginWithParent?: boolean;
        parentDomAccess?: boolean;
        network?: string;
        eventBridge?: string;
      };
    }
  | { type: "task"; tasks: TodoTask[] }
  | { type: "text"; body: string }
  | { type: "ask"; question: string; answer: string };

export interface RenderSurfaceColumn {
  key: string;
  label: string;
}

export type RenderSurfaceRow = Record<string, unknown> | readonly unknown[];

export interface ToolPeek {
  chips: string[];
  excerpt?: string;
  thumbnail?: {
    src: string;
    alt: string;
  };
}

export interface TerminalScreenCursorPosition {
  readonly row: number;
  readonly col: number;
  readonly visible: boolean;
}

export interface TerminalScreenVisibleRow {
  readonly row: number;
  readonly text: string;
  readonly wrapped: boolean;
}

export interface TerminalScreenCell {
  readonly row: number;
  readonly col: number;
  readonly text: string;
  readonly width: number;
  readonly styleId?: string | null;
  readonly hyperlinkId?: string | null;
}

export interface TerminalScreenStyle {
  readonly styleId: string;
  readonly foreground: string;
  readonly background: string;
  readonly bold: boolean;
  readonly dim: boolean;
  readonly italic: boolean;
  readonly underline: boolean;
  readonly inverse: boolean;
}

export interface TerminalScreenLink {
  readonly linkId: string;
  readonly uri: string;
  readonly rowStart: number;
  readonly rowEnd: number;
  readonly colStart: number;
  readonly colEnd: number;
}

export interface TerminalScreenInputModes {
  readonly applicationCursor: boolean;
  readonly applicationKeypad: boolean;
  readonly bracketedPaste: boolean;
  readonly mouseReporting: string;
  readonly mouseEncoding: string;
  readonly lineWrap: boolean;
}

export interface TerminalScreenRegion {
  readonly regionId: string;
  readonly kind: string;
  readonly text: string;
  readonly rowStart: number;
  readonly rowEnd: number;
  readonly colStart: number;
  readonly colEnd: number;
  readonly confidence: number;
  readonly suggestedActions: readonly string[];
}

export interface TerminalScreenSnapshot {
  readonly cursor: string;
  readonly screenVersion: number;
  readonly rows: number;
  readonly cols: number;
  readonly mode: "normal" | "alternate" | "unknown";
  readonly visibleText: string;
  readonly visibleRows?: readonly TerminalScreenVisibleRow[];
  readonly scrollbackText?: string | null;
  readonly scrollbackCursor?: string;
  readonly scrollbackRows?: readonly TerminalScreenVisibleRow[];
  readonly cursorPosition: TerminalScreenCursorPosition;
  readonly cells?: readonly TerminalScreenCell[];
  readonly cellsTruncated?: boolean;
  readonly styles?: readonly TerminalScreenStyle[];
  readonly links?: readonly TerminalScreenLink[];
  readonly inputModes?: TerminalScreenInputModes;
  readonly selectedText?: string | null;
  readonly activeCommand?: string | null;
  readonly prompt?: string | null;
  readonly regions: readonly TerminalScreenRegion[];
  readonly truncated: boolean;
}

export interface SearchResult {
  file: string;
  line: number;
  text: string;
}

export interface WebResult {
  title: string;
  url: string;
  snippet?: string;
}

export interface WorkbenchTabSummary {
  title: string;
  tabId: string;
  kind: string;
  observationKind?: string;
  flags: string[];
  url?: string;
  excerpt?: string;
}

export interface DiffHunk {
  startLine: number;
  lines: DiffLine[];
}

export interface DiffLine {
  kind: "add" | "del" | "ctx";
  text: string;
}

export interface TodoTask {
  title: string;
  status: "pending" | "running" | "done";
}

export interface AgentImageAttachment {
  id: string;
  mediaType: string;
  data: string;
  label?: string | null;
  source?: string | null;
  width?: number | null;
  height?: number | null;
}

export interface ToolActionTarget {
  kind: "url" | "file" | "secret";
  label: string;
  value: string;
  mediaType?: string;
  width?: number | null;
  height?: number | null;
  secretRef?: LyraSensitiveValueRef;
}

export type GroupStatus = "running" | "done";

export interface ToolGroup {
  id: string;
  status: GroupStatus;
  label: string;
  hint?: string;
  calls: ToolCall[];
  currentCallId?: string;
}

export type MessageBlock =
  | { type: "text"; id: string; body: string }
  | { type: "image"; id: string; image: AgentImageAttachment }
  | { type: "tools"; id: string; group: ToolGroup };

export interface ChatMessage {
  id: string;
  author: "user" | "agent";
  blocks: MessageBlock[];
  time?: string;
  rollback?: {
    available: boolean;
    anchorId?: string | null;
    checkpointAt?: string | null;
    unavailableReason?: string | null;
  } | null;
}

export interface ModelOption {
  id: string;
  label: string;
  model: string;
  provider?: string | null;
  detail?: string | null;
  available: boolean;
}

export interface ProviderOptionControl {
  current?: string | null;
  options: string[];
  supported: boolean;
}

export interface ComposerModelControls {
  currentModel: string;
  currentProvider: string;
  models: ModelOption[];
  reasoningEffort: ProviderOptionControl;
  serviceTier: ProviderOptionControl;
  isRefreshing: boolean;
  isSwitching: boolean;
  switchModel(modelId: string): Promise<void>;
  refreshModels(): Promise<void>;
  openModelSettings(): Promise<void>;
  updateReasoningEffort(value: string): Promise<void>;
  updateServiceTier(value: string): Promise<void>;
}

export interface AgentSidePanelPage {
  id: string;
  title: string;
  content: string;
  updatedAtMs: number;
  filePath?: string | null;
  format?: string | null;
  source?: string | null;
}

export interface AgentSidePanel {
  focusedPageId?: string | null;
  pages: AgentSidePanelPage[];
}

export interface AgentAutomationSettings {
  subagentModel?: string | null;
  autoreviewEnabled?: boolean | null;
  autojudgeEnabled?: boolean | null;
}

export interface AgentGoalItem {
  id: string;
  title: string;
  status?: string | null;
  scope?: string | null;
}

// Session-level state surfaced through the data provider ------------------

export interface TodoItem {
  id: string;
  title: string;
  status: "pending" | "running" | "done";
}

export interface DiffFileEntry {
  file: string;
  additions: number;
  deletions: number;
}

export interface DecisionOption {
  label: string;
  description?: string | null;
}

export interface DecisionQuestion {
  id: string;
  question: string;
  options: DecisionOption[];
  allowCustomAnswer?: boolean;
  detail?: string | null;
}

export interface PermissionRequest {
  id: string;
  type: "shell" | "file" | "network" | "dangerous";
  title: string;
  detail: string;
}

export interface SessionMeta {
  id?: string | null;
  title: string;
  project: string;
  workingDir: string | null;
  projectBound: boolean;
  automation?: AgentAutomationSettings | null;
  totalAdditions: number;
  totalDeletions: number;
}
