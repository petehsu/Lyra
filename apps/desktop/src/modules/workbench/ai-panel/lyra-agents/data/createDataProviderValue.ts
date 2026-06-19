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
import { t } from "../core/i18n";
import type {
  AgentFileCitation,
  AgentPageCitation,
  AgentRollbackPreviewResponse,
  AgentTranscriptCitation
} from "../../../../../shared/agent";
import type { TerminalDockTab } from "../../../terminal-dock/types";
import type { WorkspaceTab } from "../../../workspace-tabs/types";
import type { AgentFileAttachment } from "../features/chat/composer-file";
import type { ComposerInsertableCitation, ComposerSegment } from "../features/chat/message-citation";
import type { LyraSensitiveValueRef } from "../../../../../shared/desktop-bridge";
import type { WorkbenchLocationControls } from "../../../location";
import type {
  CitationScrollTarget,
  DataProviderValue,
  MessageWindowBudgetRequest,
  MessageWindowState
} from "./DataProvider";

export interface CreateDataProviderValueInput {
  session: SessionMeta;
  messages: ChatMessage[];
  messageWindow?: MessageWindowState;
  todos?: TodoItem[];
  diffFiles?: DiffFileEntry[];
  decisions?: DecisionQuestion[];
  permissions?: PermissionRequest[];
  modelControls?: ComposerModelControls | null;
  permissionModeControls?: ComposerPermissionModeControls | null;
  locationControls?: WorkbenchLocationControls | null;
  openModelSettings?: () => Promise<void>;
  aiRichRenderingEnabled?: boolean;
  browserFollowModeEnabled?: boolean;
  setBrowserFollowMode?: (enabled: boolean) => Promise<void>;
  openUrlInWorkbench?: (url: string, title?: string) => Promise<void>;
  openFileInWorkbench?: (filePath: string) => Promise<void>;
  openTerminalLiveSession?: (request: {
    readonly sessionId?: string | null;
    readonly terminalTabId?: string | null;
    readonly paneId?: string | null;
  }) => Promise<void>;
  openImageInWorkbench?: (image: AgentImageAttachment) => Promise<void>;
  canOpenImageInWorkbench?: (image: AgentImageAttachment) => boolean;
  revealSensitiveValueToUser?: (ref: LyraSensitiveValueRef) => Promise<string>;
  sendMessage?: (
    text: string,
    images?: readonly AgentImageAttachment[],
    citations?: readonly AgentTranscriptCitation[],
    pageCitations?: readonly AgentPageCitation[],
    fileCitations?: readonly AgentFileCitation[],
    segments?: readonly ComposerSegment[]
  ) => Promise<void>;
  addCitationToComposer?: (citation: AgentTranscriptCitation) => void;
  addPageCitationToComposer?: (citation: AgentPageCitation) => void;
  attachDragPayloadToComposer?: (dataTransfer: DataTransfer) => Promise<boolean>;
  pendingCitation?: ComposerInsertableCitation | null;
  pendingCitationNonce?: number;
  pendingImages?: readonly AgentImageAttachment[];
  pendingImagesNonce?: number;
  pendingFiles?: readonly AgentFileAttachment[];
  pendingFilesNonce?: number;
  navigateToPageCitation?: (citation: AgentPageCitation) => Promise<void>;
  scrollToMessage?: DataProviderValue["scrollToMessage"];
  citationScrollTarget?: CitationScrollTarget | null;
  reportCitationScrollFinished?: DataProviderValue["reportCitationScrollFinished"];
  citationHighlightMessageId?: string | null;
  loadEarlierMessages?: (request: MessageWindowBudgetRequest) => Promise<void>;
  syncMessageWindowBudget?: (request: MessageWindowBudgetRequest) => Promise<void>;
  captureWorkspaceScreenshot?: () => Promise<AgentImageAttachment | null>;
  captureWindowScreenshot?: () => Promise<AgentImageAttachment | null>;
  pickFileFromFileManager?: () => Promise<
    | { readonly kind: "image"; readonly attachment: AgentImageAttachment }
    | { readonly kind: "file"; readonly attachment: AgentFileAttachment }
    | null
  >;
  workspaceTabs?: readonly WorkspaceTab[];
  terminalTabs?: readonly TerminalDockTab[];
  cancelTurn?: () => Promise<void>;
  previewRollback?: (messageId: string) => Promise<AgentRollbackPreviewResponse>;
  rollbackMessage?: (messageId: string) => Promise<void>;
  createSession?: () => Promise<void>;
  bindProject?: () => Promise<void>;
  openProjectTree?: () => Promise<void>;
  runImprove?: (options?: { planOnly?: boolean; focus?: string | null }) => Promise<void>;
  runRefactor?: (options?: { planOnly?: boolean; focus?: string | null }) => Promise<void>;
  pokeTodos?: () => Promise<void>;
  runReview?: () => Promise<void>;
  runJudge?: () => Promise<void>;
  renameSession?: () => void;
  archiveSession?: () => Promise<void>;
  deleteSession?: () => void;
  submitDecisions?: (answers: Record<string, string>) => Promise<void>;
  approvePermission?: (id: string) => Promise<void>;
  denyPermission?: (id: string) => Promise<void>;
  isMock?: boolean;
  isTurnRunning?: boolean;
  followActivity?: string | null;
}

const resolved = Promise.resolve();

export function createDataProviderValue({
  session,
  messages,
  messageWindow = {
    visibleCount: messages.length,
    hiddenBefore: 0,
    totalCount: messages.length,
    canLoadEarlier: false
  },
  todos = [],
  diffFiles = [],
  decisions = [],
  permissions = [],
  modelControls = null,
  permissionModeControls = null,
  locationControls = null,
  openModelSettings = () => resolved,
  aiRichRenderingEnabled = true,
  browserFollowModeEnabled = false,
  setBrowserFollowMode = () => resolved,
  openUrlInWorkbench = () => resolved,
  openFileInWorkbench = () => resolved,
  openTerminalLiveSession = () => resolved,
  openImageInWorkbench = () => resolved,
  canOpenImageInWorkbench = () => false,
  revealSensitiveValueToUser = async () => {
    throw new Error("Sensitive value bridge is unavailable.");
  },
  sendMessage = () => resolved,
  addCitationToComposer = () => undefined,
  addPageCitationToComposer = () => undefined,
  attachDragPayloadToComposer = async () => false,
  pendingCitation = null,
  pendingCitationNonce = 0,
  pendingImages = [],
  pendingImagesNonce = 0,
  pendingFiles = [],
  pendingFilesNonce = 0,
  navigateToPageCitation = () => resolved,
  scrollToMessage = () => resolved,
  citationScrollTarget = null,
  reportCitationScrollFinished = () => undefined,
  citationHighlightMessageId = null,
  loadEarlierMessages = () => resolved,
  syncMessageWindowBudget = () => resolved,
  captureWorkspaceScreenshot = () => Promise.resolve(null),
  captureWindowScreenshot = () => Promise.resolve(null),
  pickFileFromFileManager = () => Promise.resolve(null),
  workspaceTabs = [],
  terminalTabs = [],
  cancelTurn = () => resolved,
  previewRollback = () => Promise.resolve({
    sessionId: "",
    messageId: "",
    available: false,
    removedMessageCount: 0,
    changedFiles: [],
    unavailableReason: t("lyra-agents-message.rollbackUnavailable")
  }),
  rollbackMessage = () => resolved,
  createSession = () => resolved,
  bindProject = () => resolved,
  openProjectTree = () => resolved,
  runImprove = () => resolved,
  runRefactor = () => resolved,
  pokeTodos = () => resolved,
  runReview = () => resolved,
  runJudge = () => resolved,
  renameSession = () => undefined,
  archiveSession = () => resolved,
  deleteSession = () => undefined,
  submitDecisions = () => resolved,
  approvePermission = () => resolved,
  denyPermission = () => resolved,
  isMock = false,
  isTurnRunning = false,
  followActivity = null,
}: CreateDataProviderValueInput): DataProviderValue {
  return {
    session,
    messages,
    messageWindow,
    todos,
    diffFiles,
    decisions,
    permissions,
    modelControls,
    permissionModeControls,
    locationControls,
    openModelSettings,
    aiRichRenderingEnabled,
    browserFollowModeEnabled,
    setBrowserFollowMode,
    openUrlInWorkbench,
    openFileInWorkbench,
    openTerminalLiveSession,
    openImageInWorkbench,
    canOpenImageInWorkbench,
    revealSensitiveValueToUser,
    sendMessage,
    addCitationToComposer,
    addPageCitationToComposer,
    attachDragPayloadToComposer,
    pendingCitation,
    pendingCitationNonce,
    pendingImages,
    pendingImagesNonce,
    pendingFiles,
    pendingFilesNonce,
    navigateToPageCitation,
    scrollToMessage,
    citationScrollTarget,
    reportCitationScrollFinished,
    citationHighlightMessageId,
    loadEarlierMessages,
    syncMessageWindowBudget,
    captureWorkspaceScreenshot,
    captureWindowScreenshot,
    pickFileFromFileManager,
    workspaceTabs,
    terminalTabs,
    cancelTurn,
    previewRollback,
    rollbackMessage,
    createSession,
    bindProject,
    openProjectTree,
    runImprove,
    runRefactor,
    pokeTodos,
    runReview,
    runJudge,
    renameSession,
    archiveSession,
    deleteSession,
    submitDecisions,
    approvePermission,
    denyPermission,
    isMock,
    isTurnRunning,
    followActivity,
  };
}