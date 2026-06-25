// ============================================================================
// Lyra Agents — Core Domain Types
// ============================================================================
//
// This file is the single source of truth for all domain models the UI
// consumes. It is framework-agnostic and contains no React types so it can
// be reused from a server-side rendering pipeline or type-checked from
// external data providers.

import type { AgentPageCitation, AgentTranscriptCitation } from "../../../../../shared/agent";
import type { AgentFileAttachment } from "../features/chat/composer-file";
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
  | "plan"
  | "task"
  | "create";

export interface ToolCall {
  id: string;
  kind: ToolKind;
  title: string;
  status: ToolStatus;
  details?: ToolDetails;
  traceId?: string;
  trace?: readonly unknown[];
  artifactRefs?: readonly unknown[];
  artifactTargets?: readonly ToolActionTarget[];
  artifactPreviews?: readonly ToolArtifactPreview[];
  changes?: readonly unknown[];
  failureReason?: string;
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
  | { type: "task"; tasks: TodoTask[] }
  | { type: "text"; body: string }
  | { type: "ask"; question: string; answer: string };

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
  /** Empty when the attachment is stored by filesystem path in `source`. */
  data?: string;
  label?: string | null;
  source?: string | null;
  width?: number | null;
  height?: number | null;
  workspaceTabId?: string | null;
  workspaceTabTitle?: string | null;
  workspaceTabPageKind?: string | null;
  workspaceTabAddress?: string | null;
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

export interface ToolArtifactPreview {
  label: string;
  text: string;
  kind?: string;
  path?: string;
  bytes?: number;
  truncated?: boolean;
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
  | {
      type: "text";
      id: string;
      body: string;
    }
  | { type: "image"; id: string; image: AgentImageAttachment }
  | { type: "tools"; id: string; group: ToolGroup };

export interface ChatMessage {
  id: string;
  author: "user" | "agent";
  blocks: MessageBlock[];
  isApiError?: boolean;
  /** Resolved transcript citations attached to a sent user message. */
  transcriptCitations?: readonly AgentTranscriptCitation[];
  /** Resolved page citations attached to a sent user message. */
  pageCitations?: readonly AgentPageCitation[];
  /** Inline image attachments referenced by ⟦image:id⟧ markers in message text. */
  inlineImages?: readonly AgentImageAttachment[];
  /** Inline file attachments referenced by ⟦file:id⟧ markers in message text. */
  fileAttachments?: readonly AgentFileAttachment[];
  /** Real elapsed work duration for the assistant process folded before the final summary. */
  workDurationMs?: number;
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
  providerId?: string | null;
  providerKey?: string | null;
  detail?: string | null;
  available: boolean;
  enabled: boolean;
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
  verbosity: ProviderOptionControl;
  serviceTier: ProviderOptionControl;
  isRefreshing: boolean;
  isSwitching: boolean;
  switchModel(modelId: string): Promise<void>;
  refreshModels(): Promise<void>;
  openModelSettings(): Promise<void>;
  updateReasoningEffort(value: string): Promise<void>;
  updateVerbosity(value: string): Promise<void>;
  updateServiceTier(value: string): Promise<void>;
}

export type ComposerPermissionMode = "approval" | "full_auto" | "custom";

export interface ComposerPermissionModeControls {
  currentMode: ComposerPermissionMode;
  isSwitching: boolean;
  warning?: string | null;
  configPath?: string | null;
  switchMode(mode: Exclude<ComposerPermissionMode, "custom">): Promise<void>;
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
  /** True when the session is bound to the user's home directory by default. */
  workingDirIsHome: boolean;
  totalAdditions: number;
  totalDeletions: number;
}
