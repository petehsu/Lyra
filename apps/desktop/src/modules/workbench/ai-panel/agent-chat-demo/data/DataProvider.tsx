/* eslint-disable react-refresh/only-export-components */
// ============================================================================
// Lyra Agent UI — Data Provider
// ============================================================================
//
// The entire app consumes data through a single React Context so switching
// between mock data and a real backend is a one-line change in App.tsx:
//
//   <MockDataProvider>...</MockDataProvider>   →   <ApiDataProvider>...</ApiDataProvider>
//
// Implementors of a real provider only need to match the DataProviderValue
// shape. See `MockDataProvider.tsx` for the reference implementation.

import { createContext, useContext, type ReactNode } from "react";
import type { AgentRollbackPreviewResponse } from "../../../../../shared/agent";
import type {
  AgentAutomationSettings,
  AgentGoalItem,
  AgentImageAttachment,
  AgentSidePanel,
  ChatMessage,
  ComposerModelControls,
  DecisionQuestion,
  DiffFileEntry,
  PermissionRequest,
  SessionMeta,
  TodoItem
} from "../core/types";

export interface DataProviderValue {
  /** Session-level metadata (title, project, total diff). */
  session: SessionMeta;

  /** Chat messages in chronological order. */
  messages: ChatMessage[];

  /** Global todo list aggregated from all task tool calls in the session. */
  todos: TodoItem[];

  /** Files modified in the current work session. */
  diffFiles: DiffFileEntry[];

  /** Pending decision questions from the agent. */
  decisions: DecisionQuestion[];

  /** Pending permission requests from the agent. */
  permissions: PermissionRequest[];

  /** Lyra Agent-backed model and provider controls rendered in the composer toolbar. */
  modelControls?: ComposerModelControls | null;

  /** Open Lyra Agent model/provider settings. */
  openModelSettings(): Promise<void>;

  /** True when Agent browser actions should follow the visible Workbench page. */
  readonly browserFollowModeEnabled: boolean;

  /** Toggle visible Workbench browser following for Agent browser actions. */
  setBrowserFollowMode(enabled: boolean): Promise<void>;

  /** Open a web URL in the center Workbench browser area. */
  openUrlInWorkbench(url: string, title?: string): Promise<void>;

  /** Open a local file path in the center Workbench area. */
  openFileInWorkbench(filePath: string): Promise<void>;

  /** Open an inline or attached image in the center Workbench image viewer. */
  openImageInWorkbench(image: AgentImageAttachment): Promise<void>;

  /** Whether an inline or attached image has a working route into the Workbench. */
  canOpenImageInWorkbench(image: AgentImageAttachment): boolean;

  /** Lyra Agent side-panel pages such as `/btw` answers and goals. */
  sidePanel?: AgentSidePanel | null;

  /** Send a new user message. Returns a promise that resolves when delivered. */
  sendMessage(text: string, images?: readonly AgentImageAttachment[]): Promise<void>;

  /** Capture the active Workbench browser page as an image attachment. */
  captureBrowserScreenshot(): Promise<AgentImageAttachment | null>;

  /** Capture the current Lyra window as an image attachment. */
  captureWindowScreenshot(): Promise<AgentImageAttachment | null>;

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

  /** Open the Lyra Agent self-development workspace. */
  openSelfDevLab(): Promise<void>;

  /** Open the long-running supervised task workspace. */
  openOvernightLab(): Promise<void>;

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

  /** Run a manual Lyra Agent subagent tool action. */
  runSubagent(options: {
    prompt: string;
    subagentType?: string | null;
    model?: string | null;
    continueSessionId?: string | null;
  }): Promise<void>;

  /** Ask a side question and render the answer in the Lyra Agent side panel. */
  askSideQuestion(question: string): Promise<void>;

  /** Clone this session into a new session and make it active. */
  splitSession(): Promise<void>;

  /** Create a compacted handoff child session and make it active. */
  transferSession(): Promise<void>;

  /** Request manual Lyra Agent context compaction. */
  compactContext(): Promise<void>;

  /** Open Lyra Agent goals overview in the side panel. */
  openGoals(): Promise<void>;

  /** Read selectable Lyra Agent goals. */
  listGoals(): Promise<readonly AgentGoalItem[]>;

  /** Open one Lyra Agent goal in the side panel. */
  showGoal(goalId: string): Promise<void>;

  /** Resume the best current Lyra Agent goal in the side panel. */
  resumeGoal(): Promise<void>;

  /** Update current-session automation settings. */
  updateAutomation(settings: AgentAutomationSettings): Promise<void>;

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
