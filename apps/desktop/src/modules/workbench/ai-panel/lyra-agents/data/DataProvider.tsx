/* eslint-disable react-refresh/only-export-components */
// ============================================================================
// Lyra Agents — Data Provider
// ============================================================================
//
// The entire Lyra Agents app consumes data through a single React Context so switching
// between mock data and a real backend is a one-line change in App.tsx:
//
//   <MockDataProvider>...</MockDataProvider>   →   <ApiDataProvider>...</ApiDataProvider>
//
// Implementors of a real provider only need to match the DataProviderValue
// shape. See `MockDataProvider.tsx` for the reference implementation.

import { createContext, useContext, type ReactNode } from "react";
import type {
  AgentPageCitation,
  AgentProjectTodoSnapshot,
  AgentPlanReviewRespondAction,
  AgentPlanSnapshot,
  AgentRollbackPreviewResponse,
  AgentTranscriptCitation
} from "../../../../../shared/agent";
import type { ComposerInsertableCitation } from "../features/chat/message-citation";
import type { LyraSensitiveValueRef } from "../../../../../shared/desktop-bridge";
import type { WorkbenchLocationControls } from "../../../location";
import type {
  AgentImageAttachment,
  ChatMessage,
  ComposerModelControls,
  ComposerPermissionModeControls,
  DecisionQuestion,
  DiffFileEntry,
  PermissionRequest,
  SessionMeta,
  TodoItem
} from "../core/types";

export type CitationScrollTarget = {
  readonly messageId: string;
  readonly blockId?: string | null;
  readonly startOffset?: number | null;
  /** Message window size before expanding to reveal the citation target. */
  readonly visibleCountAtStart: number;
  readonly token: number;
};

export type MessageWindowBudgetRequest = {
  readonly heightBudgetPx: number;
  readonly contentWidthPx: number;
};

export interface MessageWindowState {
  /** Number of source session messages represented by the current UI window. */
  readonly visibleCount: number;
  /** Number of source session messages still hidden above the current UI window. */
  readonly hiddenBefore: number;
  /** Total source session messages available in the current session. */
  readonly totalCount: number;
  /** True when the UI can request another older batch. */
  readonly canLoadEarlier: boolean;
}

export interface DataProviderValue {
  /** Session-level metadata (id, title, project, total diff). */
  session: SessionMeta;

  /** Chat messages in chronological order. */
  messages: ChatMessage[];

  /** Progressive UI window for long threads. Does not change runtime context. */
  messageWindow: MessageWindowState;

  /** Global todo list aggregated from all task tool calls in the session. */
  todos: TodoItem[];

  /** Project-scoped todo list associated with the approved Agent plan. */
  projectTodo: AgentProjectTodoSnapshot | null;

  /** Files modified in the current work session. */
  diffFiles: DiffFileEntry[];

  /** Pending decision questions from the agent. */
  decisions: DecisionQuestion[];

  /** Pending permission requests from the agent. */
  permissions: PermissionRequest[];

  /** Pending Agent-authored plan awaiting user review. */
  planReview: AgentPlanSnapshot | null;

  /** Lyra Agent-backed model and provider controls rendered in the lyra-agents-composer toolbar. */
  modelControls?: ComposerModelControls | null;

  /** Local-config-backed Lyra Agent permission mode controls rendered in the lyra-agents-composer toolbar. */
  permissionModeControls?: ComposerPermissionModeControls | null;

  /** User-authorized physical location controls rendered in the composer toolbar. */
  locationControls?: WorkbenchLocationControls | null;

  /** Open Lyra Agent model/provider settings. */
  openModelSettings(): Promise<void>;

  /** Whether completed agent replies should use Rust-backed rich rendering. */
  readonly aiRichRenderingEnabled: boolean;

  /** True when Agent browser actions should follow the visible Workbench page. */
  readonly browserFollowModeEnabled: boolean;

  /** Toggle visible Workbench browser following for Agent browser actions. */
  setBrowserFollowMode(enabled: boolean): Promise<void>;

  /** Open a web URL in the center Workbench browser area. */
  openUrlInWorkbench(url: string, title?: string): Promise<void>;

  /** Open a local file path in the center Workbench area. */
  openFileInWorkbench(filePath: string): Promise<void>;

  /** Reveal a local path in the Workbench without assuming it is an editable file. */
  revealPathInWorkbench(filePath: string): Promise<void>;

  /** Open or focus the rich plan review surface for the pending plan. */
  openPlanReview(plan: AgentPlanSnapshot): Promise<void>;

  /** Open or focus the plan/todo workspace surface for the active project todo. */
  openProjectTodo(): Promise<void>;

  /** Open or focus the project-scoped Plan/Todo manager. */
  openProjectPlanManager(view?: "plan" | "todo" | "both"): Promise<void>;

  /** Approve, set aside, resume, or request revision for the active plan. */
  respondPlanReview(action: AgentPlanReviewRespondAction, feedback?: string | null): Promise<void>;

  /** Open the live Workbench terminal pane for a terminal session when it exists. */
  openTerminalLiveSession(request: {
    readonly sessionId?: string | null;
    readonly terminalTabId?: string | null;
    readonly paneId?: string | null;
  }): Promise<void>;

  /** Open an inline or attached image in the center Workbench image viewer. */
  openImageInWorkbench(image: AgentImageAttachment): Promise<void>;

  /** Whether an inline or attached image has a working route into the Workbench. */
  canOpenImageInWorkbench(image: AgentImageAttachment): boolean;

  /** Reveal a model-opaque sensitive value to the user in the UI without returning it to Agent context. */
  revealSensitiveValueToUser(ref: LyraSensitiveValueRef): Promise<string>;

  /** Send a new user message. Returns a promise that resolves when delivered. */
  sendMessage(
    text: string,
    images?: readonly AgentImageAttachment[],
    citations?: readonly AgentTranscriptCitation[],
    pageCitations?: readonly AgentPageCitation[],
    fileCitations?: readonly import("../../../../../shared/agent").AgentFileCitation[],
    segments?: readonly import("../features/chat/message-citation").ComposerSegment[]
  ): Promise<void>;

  /** Queue a transcript citation chip in the composer. */
  addCitationToComposer(citation: AgentTranscriptCitation): void;

  /** Queue a browser page citation chip in the composer. */
  addPageCitationToComposer(citation: AgentPageCitation): void;

  /** Resolve a drag payload dropped onto the AI panel and queue it in the composer. */
  attachDragPayloadToComposer(dataTransfer: DataTransfer): Promise<boolean>;

  /** Pending citation waiting to be inserted into the composer. */
  readonly pendingCitation: ComposerInsertableCitation | null;

  /** Bumps whenever a new citation is queued for the composer. */
  readonly pendingCitationNonce: number;

  /** Pending images waiting to be inserted into the composer. */
  readonly pendingImages: readonly AgentImageAttachment[];

  /** Bumps whenever new images are queued for the composer. */
  readonly pendingImagesNonce: number;

  /** Pending file attachments waiting to be inserted into the composer. */
  readonly pendingFiles: readonly import("../features/chat/composer-file").AgentFileAttachment[];

  /** Bumps whenever new file attachments are queued for the composer. */
  readonly pendingFilesNonce: number;

  /** Switch to a browser tab and reveal a cited page excerpt. */
  navigateToPageCitation(citation: AgentPageCitation): Promise<void>;

  /** Scroll the chat viewport to a prior message, expanding the UI window if needed. */
  scrollToMessage(
    messageId: string,
    options?: {
      readonly blockId?: string | null;
      readonly startOffset?: number | null;
    }
  ): Promise<void>;

  /** Active citation jump request consumed by ChatView after the target is visible. */
  readonly citationScrollTarget: CitationScrollTarget | null;

  /** Called by ChatView once the viewport has landed on the cited message. */
  reportCitationScrollFinished(messageId: string): void;

  /** Briefly highlight a message after jumping to a citation source. */
  readonly citationHighlightMessageId: string | null;

  /** Expand the rendered chat window with older messages. */
  loadEarlierMessages(request: MessageWindowBudgetRequest): Promise<void>;

  /** Size the initial/latest visible window from an adaptive height budget. */
  syncMessageWindowBudget(request: MessageWindowBudgetRequest): Promise<void>;

  /** Capture the active Workbench tab as an image attachment. */
  captureWorkspaceScreenshot(): Promise<AgentImageAttachment | null>;

  /** Capture the current Lyra window as an image attachment. */
  captureWindowScreenshot(): Promise<AgentImageAttachment | null>;

  /** Pick a file from the Lyra file manager and return an image or file attachment. */
  pickFileFromFileManager(): Promise<
    | { readonly kind: "image"; readonly attachment: AgentImageAttachment }
    | { readonly kind: "file"; readonly attachment: import("../features/chat/composer-file").AgentFileAttachment }
    | null
  >;

  /** Workspace tabs available for inline citation from the composer attach menu. */
  readonly workspaceTabs: readonly import("../../../workspace-tabs/types").WorkspaceTab[];

  /** Terminal tabs available for inline citation from the composer attach menu. */
  readonly terminalTabs: readonly import("../../../terminal-dock/types").TerminalDockTab[];

  /** Cancel the currently running turn when available. */
  cancelTurn(): Promise<void>;

  /** Preview what a user-message rollback would restore/remove. */
  previewRollback(messageId: string): Promise<AgentRollbackPreviewResponse>;

  /** Restore files and conversation to before a user message. */
  rollbackMessage(messageId: string): Promise<void>;

  /** Create a new Lyra Agent-backed session and make it active. */
  createSession(): Promise<void>;

  /** Bind the current Lyra Agent session to a real workspace directory. */
  bindProject(): Promise<void>;

  /** Open the current bound project in a workspace file tree. */
  openProjectTree(): Promise<void>;

  /** Start Lyra Agent improvement mode from the GUI. */
  runImprove(options?: { planOnly?: boolean; focus?: string | null }): Promise<void>;

  /** Start Lyra Agent refactor mode from the GUI. */
  runRefactor(options?: { planOnly?: boolean; focus?: string | null }): Promise<void>;

  /** Poke the model to continue unfinished Lyra Agent todos. */
  pokeTodos(): Promise<void>;

  /** Launch a one-shot Lyra Agent review session from the GUI. */
  runReview(): Promise<void>;

  /** Launch a one-shot Lyra Agent judge session from the GUI. */
  runJudge(): Promise<void>;

  /** Rename the current Lyra Agent session. */
  renameSession(): void;

  /** Archive the current Lyra Agent session. */
  archiveSession(): Promise<void>;

  /** Delete the current Lyra Agent session. */
  deleteSession(): void;

  /** Answer one or more decision questions. */
  submitDecisions(answers: Record<string, string>): Promise<void>;

  /** Approve a permission request by id. */
  approvePermission(id: string): Promise<void>;

  /** Deny a permission request by id. */
  denyPermission(id: string): Promise<void>;

  /** True if this provider is backed by mock data. */
  readonly isMock: boolean;

  /** True while the agent turn is still running. */
  readonly isTurnRunning: boolean;

  /** Current turn activity state from the runtime, e.g. calling_model or waiting_for_tool. */
  readonly followActivity: string | null;
}

const DataContext = createContext<DataProviderValue | null>(null);

export function useData(): DataProviderValue {
  const ctx = useContext(DataContext);
  if (!ctx) {
    throw new Error(
      "useData() must be used inside a <MockDataProvider> or <ApiDataProvider>."
    );
  }
  return ctx;
}

export function DataContextProvider({
  value,
  children,
}: {
  value: DataProviderValue;
  children: ReactNode;
}) {
  return <DataContext.Provider value={value}>{children}</DataContext.Provider>;
}
