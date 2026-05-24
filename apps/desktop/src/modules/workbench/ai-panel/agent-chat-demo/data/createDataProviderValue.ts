import type {
  AgentAutomationSettings,
  AgentSidePanel,
  ChatMessage,
  ComposerModelControls,
  DecisionQuestion,
  DiffFileEntry,
  PermissionRequest,
  SessionMeta,
  TodoItem
} from "../core/types";
import { t } from "../core/i18n";
import type { AgentRollbackPreviewResponse } from "../../../../../shared/agent";
import type { DataProviderValue } from "./DataProvider";

export interface CreateDataProviderValueInput {
  session: SessionMeta;
  messages: ChatMessage[];
  todos?: TodoItem[];
  diffFiles?: DiffFileEntry[];
  decisions?: DecisionQuestion[];
  permissions?: PermissionRequest[];
  modelControls?: ComposerModelControls | null;
  openModelSettings?: () => Promise<void>;
  sidePanel?: AgentSidePanel | null;
  sendMessage?: (text: string) => Promise<void>;
  cancelTurn?: () => Promise<void>;
  previewRollback?: (messageId: string) => Promise<AgentRollbackPreviewResponse>;
  rollbackMessage?: (messageId: string) => Promise<void>;
  createSession?: () => Promise<void>;
  bindProject?: () => Promise<void>;
  openProjectTree?: () => Promise<void>;
  openSelfDevLab?: () => Promise<void>;
  openOvernightLab?: () => Promise<void>;
  runImprove?: (options?: { planOnly?: boolean; focus?: string | null }) => Promise<void>;
  runRefactor?: (options?: { planOnly?: boolean; focus?: string | null }) => Promise<void>;
  pokeTodos?: () => Promise<void>;
  runReview?: () => Promise<void>;
  runJudge?: () => Promise<void>;
  runSubagent?: (options: {
    prompt: string;
    subagentType?: string | null;
    model?: string | null;
    continueSessionId?: string | null;
  }) => Promise<void>;
  askSideQuestion?: (question: string) => Promise<void>;
  splitSession?: () => Promise<void>;
  transferSession?: () => Promise<void>;
  compactContext?: () => Promise<void>;
  openGoals?: () => Promise<void>;
  resumeGoal?: () => Promise<void>;
  updateAutomation?: (settings: AgentAutomationSettings) => Promise<void>;
  submitDecisions?: (answers: Record<string, string>) => Promise<void>;
  approvePermission?: (id: string) => Promise<void>;
  denyPermission?: (id: string) => Promise<void>;
  isMock?: boolean;
  isTurnRunning?: boolean;
}

const resolved = Promise.resolve();

export function createDataProviderValue({
  session,
  messages,
  todos = [],
  diffFiles = [],
  decisions = [],
  permissions = [],
  modelControls = null,
  openModelSettings = () => resolved,
  sidePanel = null,
  sendMessage = () => resolved,
  cancelTurn = () => resolved,
  previewRollback = () => Promise.resolve({
    sessionId: "",
    messageId: "",
    available: false,
    removedMessageCount: 0,
    changedFiles: [],
    unavailableReason: t("msg.rollbackUnavailable")
  }),
  rollbackMessage = () => resolved,
  createSession = () => resolved,
  bindProject = () => resolved,
  openProjectTree = () => resolved,
  openSelfDevLab = () => resolved,
  openOvernightLab = () => resolved,
  runImprove = () => resolved,
  runRefactor = () => resolved,
  pokeTodos = () => resolved,
  runReview = () => resolved,
  runJudge = () => resolved,
  runSubagent = () => resolved,
  askSideQuestion = () => resolved,
  splitSession = () => resolved,
  transferSession = () => resolved,
  compactContext = () => resolved,
  openGoals = () => resolved,
  resumeGoal = () => resolved,
  updateAutomation = () => resolved,
  submitDecisions = () => resolved,
  approvePermission = () => resolved,
  denyPermission = () => resolved,
  isMock = false,
  isTurnRunning = false,
}: CreateDataProviderValueInput): DataProviderValue {
  return {
    session,
    messages,
    todos,
    diffFiles,
    decisions,
    permissions,
    modelControls,
    openModelSettings,
    sidePanel,
    sendMessage,
    cancelTurn,
    previewRollback,
    rollbackMessage,
    createSession,
    bindProject,
    openProjectTree,
    openSelfDevLab,
    openOvernightLab,
    runImprove,
    runRefactor,
    pokeTodos,
    runReview,
    runJudge,
    runSubagent,
    askSideQuestion,
    splitSession,
    transferSession,
    compactContext,
    openGoals,
    resumeGoal,
    updateAutomation,
    submitDecisions,
    approvePermission,
    denyPermission,
    isMock,
    isTurnRunning,
  };
}
