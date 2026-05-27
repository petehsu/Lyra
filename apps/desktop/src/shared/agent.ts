export type AgentRole = "user" | "assistant" | "system";
export type AgentTurnStatus = "idle" | "running" | "cancelled" | "finished" | "failed";
export type AgentToolStatus = "running" | "completed" | "failed" | "cancelled";
export type AgentSessionKind = "normal" | "selfdev" | "overnight";

export type AgentMessage = {
  readonly id: string;
  readonly role: AgentRole;
  readonly text: string;
  readonly blocks?: readonly AgentMessageBlock[];
  readonly createdAt: string;
  readonly rollback?: AgentMessageRollback | null;
};

export type AgentMessageBlock =
  | {
      readonly type: "text";
      readonly id: string;
      readonly text: string;
    }
  | {
      readonly type: "image";
      readonly id: string;
      readonly mediaType: string;
      readonly data: string;
      readonly label?: string | null;
      readonly source?: string | null;
      readonly width?: number | null;
      readonly height?: number | null;
    }
  | {
      readonly type: "tool";
      readonly id: string;
      readonly toolId: string;
    };

export type AgentImageInput = {
  readonly mediaType: string;
  readonly data: string;
  readonly label?: string | null;
  readonly source?: string | null;
  readonly width?: number | null;
  readonly height?: number | null;
};

export type AgentImageAttachmentMaterializeRequest = {
  readonly id?: string | null;
  readonly mediaType: string;
  readonly data: string;
  readonly label?: string | null;
};

export type AgentImageAttachmentMaterializeResponse = {
  readonly path: string;
};

export type AgentMessageRollback = {
  readonly available: boolean;
  readonly anchorId?: string | null;
  readonly checkpointAt?: string | null;
  readonly unavailableReason?: string | null;
};

export type AgentToolActivity = {
  readonly id: string;
  readonly name: string;
  readonly label: string;
  readonly status: AgentToolStatus;
  readonly input: unknown;
  readonly output?: unknown;
  readonly startedAt: string;
  readonly finishedAt?: string;
};

export type AgentTodoItem = {
  readonly id: string;
  readonly content: string;
  readonly status: string;
  readonly priority: string;
  readonly blockedBy?: readonly string[];
  readonly assignedTo?: string | null;
};

export type AgentFollowState = {
  readonly running: boolean;
  readonly activity?: string | null;
};

export type AgentBrowserFollowModeSnapshot = {
  readonly enabled: boolean;
};

export type AgentBrowserFollowModeUpdateRequest = {
  readonly enabled: boolean;
};

export type AgentSessionAutomationSnapshot = {
  readonly subagentModel?: string | null;
  readonly autoreviewEnabled?: boolean | null;
  readonly autojudgeEnabled?: boolean | null;
};

export type AgentSidePanelPageSnapshot = {
  readonly id: string;
  readonly title: string;
  readonly filePath: string;
  readonly format: string;
  readonly source: string;
  readonly content: string;
  readonly updatedAtMs: number;
};

export type AgentSidePanelSnapshot = {
  readonly focusedPageId?: string | null;
  readonly pages: readonly AgentSidePanelPageSnapshot[];
};

export type AgentSessionSnapshot = {
  readonly id: string;
  readonly title: string;
  readonly sessionKind: AgentSessionKind;
  readonly workingDir: string;
  readonly projectBound: boolean;
  readonly messages: readonly AgentMessage[];
  readonly tools: readonly AgentToolActivity[];
  readonly todos: readonly AgentTodoItem[];
  readonly automation: AgentSessionAutomationSnapshot;
  readonly sidePanel: AgentSidePanelSnapshot;
  readonly turnStatus: AgentTurnStatus;
  readonly activeTurnId?: string | null;
  readonly follow: AgentFollowState;
  readonly updatedAt: string;
};

export type AgentSessionCreateRequest = {
  readonly title?: string;
  readonly workingDir?: string | null;
};

export type AgentSessionReadRequest = {
  readonly sessionId?: string | null;
};

export type AgentSessionBindProjectRequest = {
  readonly sessionId?: string | null;
  readonly workingDir: string | null;
};

export type AgentTurnSendRequest = {
  readonly sessionId?: string | null;
  readonly text: string;
  readonly images?: readonly AgentImageInput[];
  /**
   * Deprecated compatibility fields. Provider/account/model selection is owned
   * by Lyra Agent config now; new UI must use the Agent config/profile APIs below.
   */
  readonly providerProfileId?: string | null;
  readonly providerProfile?: unknown;
};

export type AgentTurnSendResponse = {
  readonly sessionId: string;
  readonly turnId?: string | null;
  readonly status: "running";
};

export type AgentTurnCancelRequest = {
  readonly sessionId: string;
};

export type AgentTurnCancelResponse = {
  readonly sessionId: string;
  readonly status: "cancelling";
};

export type JcodeAgentActionRunRequest = {
  readonly sessionId?: string | null;
  readonly planOnly?: boolean;
  readonly focus?: string | null;
};

export type JcodePokeRequest = {
  readonly sessionId?: string | null;
};

export type JcodeFeedbackRunRequest = {
  readonly sessionId?: string | null;
};

export type AgentSelfDevStartRequest = {
  readonly prompt?: string | null;
  readonly target?: "agent-core" | "desktop-gui" | "validation" | "general" | null;
  readonly inheritContext?: boolean;
  readonly parentSessionId?: string | null;
};

export type AgentSelfDevStartResponse = {
  readonly sessionId: string;
  readonly repoDir: string;
  readonly snapshot: AgentSessionSnapshot;
  readonly turnId?: string | null;
  readonly status: "idle" | "running";
  readonly inheritedContext: boolean;
};

export type AgentSelfDevStatusRequest = {
  readonly sessionId?: string | null;
};

export type AgentSelfDevStatusResponse = {
  readonly available: boolean;
  readonly repoDir?: string | null;
  readonly sessionId?: string | null;
  readonly output: string;
  readonly title?: string | null;
  readonly metadata?: unknown;
};

export type JcodeOvernightStartRequest = {
  readonly sessionId?: string | null;
  readonly durationMinutes: number;
  readonly mission?: string | null;
  readonly inheritContext?: boolean;
};

export type JcodeOvernightRunRequest = {
  readonly runId?: string | null;
};

export type JcodeOvernightRunSnapshot = {
  readonly runId: string;
  readonly parentSessionId: string;
  readonly coordinatorSessionId: string;
  readonly coordinatorSessionName: string;
  readonly status: string;
  readonly mission?: string | null;
  readonly workingDir?: string | null;
  readonly providerName: string;
  readonly model: string;
  readonly startedAt: string;
  readonly targetWakeAt: string;
  readonly handoffReadyAt: string;
  readonly postWakeGraceUntil: string;
  readonly lastActivityAt: string;
  readonly completedAt?: string | null;
  readonly cancelRequestedAt?: string | null;
  readonly runDir: string;
  readonly logPath: string;
  readonly reviewPath: string;
  readonly manifest: unknown;
  readonly progress: unknown;
  readonly events: readonly unknown[];
  readonly taskCards: readonly unknown[];
  readonly statusMarkdown: string;
  readonly logMarkdown: string;
  readonly reviewHtml?: string | null;
  readonly coordinatorSnapshot?: AgentSessionSnapshot | null;
};

export type JcodeOvernightStartResponse = {
  readonly run: JcodeOvernightRunSnapshot;
  readonly inheritedContext: boolean;
};

export type JcodeOvernightListResponse = {
  readonly runs: readonly JcodeOvernightRunSnapshot[];
  readonly latestRunId?: string | null;
};

export type JcodeOvernightRunResponse = {
  readonly run?: JcodeOvernightRunSnapshot | null;
};

export type JcodeSubagentRunRequest = {
  readonly sessionId?: string | null;
  readonly prompt: string;
  readonly subagentType?: string | null;
  readonly model?: string | null;
  readonly continueSessionId?: string | null;
};

export type JcodeSubagentRunResponse = {
  readonly sessionId: string;
  readonly toolId: string;
  readonly snapshot: AgentSessionSnapshot;
};

export type JcodeBtwRunRequest = {
  readonly sessionId?: string | null;
  readonly question: string;
};

export type JcodeSidePanelActionResponse = {
  readonly sessionId: string;
  readonly turnId?: string | null;
  readonly status: "idle" | "running";
  readonly sidePanel: AgentSidePanelSnapshot;
};

export type JcodeSessionActionRequest = {
  readonly sessionId?: string | null;
};

export type JcodeSessionForkResponse = {
  readonly sessionId: string;
  readonly parentSessionId: string;
  readonly snapshot: AgentSessionSnapshot;
};

export type JcodeCompactResponse = {
  readonly sessionId: string;
  readonly message: string;
  readonly success: boolean;
  readonly snapshot: AgentSessionSnapshot;
};

export type JcodeAutomationUpdateRequest = {
  readonly sessionId?: string | null;
  readonly subagentModel?: string | null;
  readonly autoreviewEnabled?: boolean | null;
  readonly autojudgeEnabled?: boolean | null;
};

export type JcodeAutomationUpdateResponse = {
  readonly sessionId: string;
  readonly automation: AgentSessionAutomationSnapshot;
  readonly snapshot: AgentSessionSnapshot;
};

export type JcodeGoalsRequest = {
  readonly sessionId?: string | null;
  readonly goalId?: string | null;
};

export type JcodeGoalsResponse = {
  readonly sessionId: string;
  readonly goals: readonly unknown[];
  readonly focusedGoal?: unknown;
  readonly sidePanel: AgentSidePanelSnapshot;
};

export type JcodeAccountSnapshot = {
  readonly provider: string;
  readonly label: string;
  readonly kind: string;
  readonly active: boolean;
  readonly configured: boolean;
  readonly detail?: string | null;
};

export type JcodeAccountsResponse = {
  readonly defaultProvider?: string | null;
  readonly defaultModel?: string | null;
  readonly authStatus: unknown;
  readonly accounts: readonly JcodeAccountSnapshot[];
};

export type JcodeAccountRequest = {
  readonly provider?: string | null;
  readonly label?: string | null;
};

export type JcodeAccountLoginRequest = {
  readonly provider?: string | null;
  readonly profileName?: string | null;
  readonly label?: string | null;
  readonly baseUrl?: string | null;
  readonly apiKey?: string | null;
  readonly defaultModel?: string | null;
  readonly setDefault?: boolean;
};

export type JcodeLoginProviderSnapshot = {
  readonly id: string;
  readonly displayName: string;
  readonly authKind: string;
  readonly statusMethod: string;
  readonly detail: string;
  readonly recommended: boolean;
  readonly configured: boolean;
  readonly state: string;
  readonly requiresCallback: boolean;
  readonly requiresApiKey: boolean;
};

export type JcodeLoginProvidersResponse = {
  readonly providers: readonly JcodeLoginProviderSnapshot[];
  readonly authStatus: unknown;
};

export type JcodeAccountLoginStartRequest = {
  readonly provider: string;
  readonly label?: string | null;
  readonly googleClientId?: string | null;
  readonly googleClientSecret?: string | null;
  readonly gmailAccessTier?: "readonly" | "full" | string | null;
};

export type JcodeAccountLoginStartResponse = {
  readonly provider: string;
  readonly label?: string | null;
  readonly flowId: string;
  readonly authUrl?: string | null;
  readonly callbackHint?: string | null;
  readonly authKind: string;
  readonly instructions: string;
  readonly requiresCallback: boolean;
  readonly requiresApiKey: boolean;
};

export type JcodeAccountLoginCompleteRequest = {
  readonly provider: string;
  readonly flowId?: string | null;
  readonly label?: string | null;
  readonly callbackInput?: string | null;
  readonly apiKey?: string | null;
  readonly profileName?: string | null;
  readonly baseUrl?: string | null;
  readonly defaultModel?: string | null;
  readonly authHeader?: string | null;
  readonly setDefault?: boolean;
};

export type JcodeAccountLoginCompleteResponse = {
  readonly accounts: JcodeAccountsResponse;
  readonly message: string;
};

export type JcodePokeResponse = {
  readonly sessionId: string;
  readonly turnId?: string | null;
  readonly status: "idle" | "running";
  readonly sent: boolean;
  readonly incompleteTodoCount: number;
};

export type AgentRollbackRequest = {
  readonly sessionId: string;
  readonly messageId: string;
  readonly mode?: "taskAndWorkspace";
};

export type AgentRollbackChangedFile = {
  readonly path: string;
};

export type AgentRollbackPreviewResponse = {
  readonly sessionId: string;
  readonly messageId: string;
  readonly available: boolean;
  readonly checkpointAt?: string | null;
  readonly removedMessageCount: number;
  readonly changedFiles: readonly AgentRollbackChangedFile[];
  readonly unavailableReason?: string | null;
};

export type AgentRollbackRestoreResponse = {
  readonly sessionId: string;
  readonly messageId: string;
  readonly snapshot: AgentSessionSnapshot;
  readonly removedMessageCount: number;
  readonly restoredFileCount: number;
};

export type AgentGitFileStatus =
  | "added"
  | "copied"
  | "deleted"
  | "modified"
  | "renamed"
  | "typeChanged"
  | "untracked"
  | "conflicted";

export type AgentGitDiffScope = "auto" | "unstaged" | "staged";

export type AgentGitStatusRequest = {
  readonly workingDir: string;
};

export type AgentGitFileRequest = {
  readonly workingDir: string;
  readonly path: string;
};

export type AgentGitDiffRequest = AgentGitFileRequest & {
  readonly scope?: AgentGitDiffScope;
};

export type AgentGitChangedFile = {
  readonly path: string;
  readonly absolutePath: string;
  readonly originalPath?: string | null;
  readonly status: AgentGitFileStatus;
  readonly indexStatus: string;
  readonly workingTreeStatus: string;
  readonly staged: boolean;
  readonly unstaged: boolean;
  readonly untracked: boolean;
  readonly conflicted: boolean;
};

export type AgentGitStatusSummary = {
  readonly changed: number;
  readonly staged: number;
  readonly unstaged: number;
  readonly untracked: number;
  readonly conflicts: number;
};

export type AgentGitStatusSnapshot = {
  readonly workingDir: string;
  readonly isRepository: boolean;
  readonly repositoryRoot?: string | null;
  readonly branch?: string | null;
  readonly upstream?: string | null;
  readonly ahead: number;
  readonly behind: number;
  readonly entries: readonly AgentGitChangedFile[];
  readonly summary: AgentGitStatusSummary;
  readonly updatedAt: string;
  readonly message?: string | null;
};

export type AgentGitDiffResponse = {
  readonly workingDir: string;
  readonly repositoryRoot: string;
  readonly path: string;
  readonly scope: Exclude<AgentGitDiffScope, "auto">;
  readonly diff: string;
  readonly isBinary: boolean;
};

export type AgentGitMutationResponse = {
  readonly snapshot: AgentGitStatusSnapshot;
};

export type AgentClarificationRespondRequest = {
  readonly sessionId: string;
  readonly clarificationId: string;
  readonly answer: string;
  readonly selectedOption?: string | null;
};

export type AgentClarificationOption =
  | string
  | {
      readonly label: string;
      readonly description?: string | null;
    };

export type AgentPermissionRespondRequest = {
  readonly sessionId: string;
  readonly permissionId: string;
  readonly allowed: boolean;
};

export type AgentRuntimeEvent =
  | {
      readonly kind: "sessionSnapshot";
      readonly snapshot: AgentSessionSnapshot;
    }
  | {
      readonly kind: "messageAppended";
      readonly sessionId: string;
      readonly message: AgentMessage;
    }
  | {
      readonly kind: "messageDelta";
      readonly sessionId: string;
      readonly messageId: string;
      readonly blockId?: string | null;
      readonly replace?: boolean;
      readonly delta: string;
    }
  | {
      readonly kind: "toolStarted" | "toolFinished";
      readonly sessionId: string;
      readonly messageId?: string | null;
      readonly tool: AgentToolActivity;
    }
  | {
      readonly kind: "todoUpdated";
      readonly sessionId: string;
      readonly todos: readonly AgentTodoItem[];
    }
  | {
      readonly kind: "clarificationRequired";
      readonly sessionId: string;
      readonly clarificationId: string;
      readonly question: string;
      readonly options?: readonly AgentClarificationOption[];
      readonly allowCustomAnswer: boolean;
      readonly detail?: string | null;
    }
  | {
      readonly kind: "permissionRequired";
      readonly sessionId: string;
      readonly permissionId: string;
      readonly title: string;
      readonly detail: string;
    }
  | {
      readonly kind: "turnFinished";
      readonly sessionId: string;
      readonly turnId: string;
      readonly status: AgentTurnStatus;
    }
  | {
      readonly kind: "turnFailed";
      readonly sessionId: string;
      readonly turnId: string;
      readonly message: string;
    }
  | {
      readonly kind: "followStateChanged";
      readonly sessionId: string;
      readonly follow: AgentFollowState;
    }
  | {
      readonly kind: "rollbackStarted";
      readonly sessionId: string;
      readonly messageId: string;
    }
  | {
      readonly kind: "rollbackFinished";
      readonly sessionId: string;
      readonly messageId: string;
      readonly removedMessageCount: number;
      readonly restoredFileCount: number;
    }
  | {
      readonly kind: "rollbackFailed";
      readonly sessionId: string;
      readonly messageId: string;
      readonly message: string;
    };

export type JcodeRegisteredCommand = {
  readonly name: string;
  readonly help: string;
  readonly autocomplete: boolean;
  readonly remoteOnly: boolean;
};

export type JcodeConfigSnapshot = {
  readonly jcodeHome?: string | null;
  readonly configPath?: string | null;
  readonly config: unknown;
  readonly commands: readonly JcodeRegisteredCommand[];
};

export type JcodeConfigUpdateRequest = {
  readonly defaultModel?: string | null;
  readonly defaultProvider?: string | null;
  readonly openaiReasoningEffort?: string | null;
  readonly openaiServiceTier?: string | null;
  readonly ntfyTopic?: string | null;
  readonly ntfyServer?: string | null;
  readonly desktopNotifications?: boolean;
  readonly emailEnabled?: boolean;
  readonly emailTo?: string | null;
  readonly emailSmtpHost?: string | null;
  readonly emailSmtpPort?: number;
  readonly emailFrom?: string | null;
  readonly emailPassword?: string | null;
  readonly emailImapHost?: string | null;
  readonly emailImapPort?: number;
  readonly emailReplyEnabled?: boolean;
  readonly telegramEnabled?: boolean;
  readonly telegramBotToken?: string | null;
  readonly telegramChatId?: string | null;
  readonly telegramReplyEnabled?: boolean;
  readonly discordEnabled?: boolean;
  readonly discordBotToken?: string | null;
  readonly discordChannelId?: string | null;
  readonly discordBotUserId?: string | null;
  readonly discordReplyEnabled?: boolean;
};

export type JcodeProviderProfileModelRequest = {
  readonly id: string;
  readonly contextWindow?: number | null;
};

export type JcodeProviderProfileSaveRequest = {
  readonly profileName: string;
  readonly baseUrl: string;
  readonly defaultModel?: string | null;
  readonly apiKey?: string | null;
  readonly apiKeyEnv?: string | null;
  readonly envFile?: string | null;
  readonly auth?: "bearer" | "header" | "none";
  readonly authHeader?: string | null;
  readonly providerType?: "openai-compatible" | "openrouter";
  readonly setDefault?: boolean;
  readonly models?: readonly JcodeProviderProfileModelRequest[];
};


export type JcodeSessionSummary = {
  readonly id: string;
  readonly title: string;
  readonly shortName?: string | null;
  readonly status: string;
  readonly providerKey?: string | null;
  readonly model?: string | null;
  readonly messageCount: number;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly lastActiveAt?: string | null;
  readonly saved: boolean;
  readonly saveLabel?: string | null;
  readonly archived: boolean;
  readonly customTitle?: string | null;
  readonly workingDir?: string | null;
};

export type JcodeSessionsListRequest = {
  readonly limit?: number;
};

export type JcodeSessionsListResponse = {
  readonly sessionsDir: string;
  readonly sessions: readonly JcodeSessionSummary[];
};

export type AgentSessionSaveRequest = {
  readonly sessionId: string;
  readonly label?: string | null;
};

export type AgentSessionRenameRequest = {
  readonly sessionId: string;
  readonly title?: string | null;
};

export type AgentSessionArchiveRequest = {
  readonly sessionId: string;
  readonly archived: boolean;
};

export type AgentSessionDeleteRequest = {
  readonly sessionId: string;
};

export type AgentSessionDeleteResponse = {
  readonly sessionId: string;
  readonly deleted: true;
};

export type JcodeModelRoute = {
  readonly model: string;
  readonly provider: string;
  readonly apiMethod: string;
  readonly available: boolean;
  readonly detail: string;
};

export type JcodeModelEntry = {
  readonly id: string;
  readonly label: string;
  readonly model: string;
  readonly provider?: string | null;
  readonly providerKey?: string | null;
  readonly apiMethod?: string | null;
  readonly detail?: string | null;
  readonly available: boolean;
};

export type JcodeProviderOptionState = {
  readonly current?: string | null;
  readonly options: readonly string[];
  readonly supported: boolean;
};

export type JcodeModelsListRequest = {
  readonly sessionId?: string | null;
};

export type JcodeModelsListResponse = {
  readonly sessionId?: string | null;
  readonly currentModel: string;
  readonly currentProvider: string;
  readonly defaultModel?: string | null;
  readonly defaultProvider?: string | null;
  readonly models: readonly JcodeModelEntry[];
  readonly routes: readonly JcodeModelRoute[];
  readonly reasoningEffort: JcodeProviderOptionState;
  readonly serviceTier: JcodeProviderOptionState;
};

export type JcodeModelSwitchRequest = {
  readonly sessionId?: string | null;
  readonly model: string;
  readonly provider?: string | null;
};

export type JcodeModelRefreshRequest = {
  readonly sessionId?: string | null;
};

export type JcodeProviderOptionsUpdateRequest = {
  readonly sessionId?: string | null;
  readonly reasoningEffort?: string | null;
  readonly serviceTier?: string | null;
};

export type JcodeAgentRolesUpdateRequest = {
  readonly swarmModel?: string | null;
  readonly reviewModel?: string | null;
  readonly judgeModel?: string | null;
  readonly memoryModel?: string | null;
  readonly ambientModel?: string | null;
};

export type AgentApi = {
  readonly createSession: (request?: AgentSessionCreateRequest) => Promise<AgentSessionSnapshot>;
  readonly readSession: (request?: AgentSessionReadRequest) => Promise<AgentSessionSnapshot>;
  readonly listSessions: (
    request?: JcodeSessionsListRequest
  ) => Promise<JcodeSessionsListResponse>;
  readonly saveSession: (request: AgentSessionSaveRequest) => Promise<JcodeSessionSummary>;
  readonly unsaveSession: (request: AgentSessionDeleteRequest) => Promise<JcodeSessionSummary>;
  readonly renameSession: (request: AgentSessionRenameRequest) => Promise<JcodeSessionSummary>;
  readonly archiveSession: (request: AgentSessionArchiveRequest) => Promise<JcodeSessionSummary>;
  readonly deleteSession: (
    request: AgentSessionDeleteRequest
  ) => Promise<AgentSessionDeleteResponse>;
  readonly bindProject: (request: AgentSessionBindProjectRequest) => Promise<AgentSessionSnapshot>;
  readonly startSelfDev: (
    request?: AgentSelfDevStartRequest
  ) => Promise<AgentSelfDevStartResponse>;
  readonly readSelfDevStatus: (
    request?: AgentSelfDevStatusRequest
  ) => Promise<AgentSelfDevStatusResponse>;
  readonly sendSelfDevTurn: (
    request: AgentTurnSendRequest
  ) => Promise<AgentTurnSendResponse>;
  readonly startOvernight: (
    request: JcodeOvernightStartRequest
  ) => Promise<JcodeOvernightStartResponse>;
  readonly listOvernightRuns: () => Promise<JcodeOvernightListResponse>;
  readonly readOvernightStatus: (
    request?: JcodeOvernightRunRequest
  ) => Promise<JcodeOvernightRunResponse>;
  readonly readOvernightLog: (
    request?: JcodeOvernightRunRequest
  ) => Promise<JcodeOvernightRunResponse>;
  readonly readOvernightReview: (
    request?: JcodeOvernightRunRequest
  ) => Promise<JcodeOvernightRunResponse>;
  readonly cancelOvernight: (
    request?: JcodeOvernightRunRequest
  ) => Promise<JcodeOvernightRunResponse>;
  readonly sendTurn: (request: AgentTurnSendRequest) => Promise<AgentTurnSendResponse>;
  readonly cancelTurn: (request: AgentTurnCancelRequest) => Promise<AgentTurnCancelResponse>;
  readonly previewRollback: (
    request: AgentRollbackRequest
  ) => Promise<AgentRollbackPreviewResponse>;
  readonly restoreRollback: (
    request: AgentRollbackRequest
  ) => Promise<AgentRollbackRestoreResponse>;
  readonly readGitStatus: (
    request: AgentGitStatusRequest
  ) => Promise<AgentGitStatusSnapshot>;
  readonly readGitDiff: (
    request: AgentGitDiffRequest
  ) => Promise<AgentGitDiffResponse>;
  readonly stageGitFile: (
    request: AgentGitFileRequest
  ) => Promise<AgentGitMutationResponse>;
  readonly unstageGitFile: (
    request: AgentGitFileRequest
  ) => Promise<AgentGitMutationResponse>;
  readonly discardGitFile: (
    request: AgentGitFileRequest
  ) => Promise<AgentGitMutationResponse>;
  readonly respondClarification: (
    request: AgentClarificationRespondRequest
  ) => Promise<unknown>;
  readonly respondPermission: (request: AgentPermissionRespondRequest) => Promise<unknown>;
  readonly readJcodeConfig: () => Promise<JcodeConfigSnapshot>;
  readonly updateJcodeConfig: (
    request: JcodeConfigUpdateRequest
  ) => Promise<JcodeConfigSnapshot>;
  readonly saveJcodeProviderProfile: (
    request: JcodeProviderProfileSaveRequest
  ) => Promise<JcodeConfigSnapshot>;
  readonly listJcodeModels: (
    request?: JcodeModelsListRequest
  ) => Promise<JcodeModelsListResponse>;
  readonly switchJcodeModel: (
    request: JcodeModelSwitchRequest
  ) => Promise<JcodeModelsListResponse>;
  readonly refreshJcodeModels: (
    request?: JcodeModelRefreshRequest
  ) => Promise<JcodeModelsListResponse>;
  readonly updateJcodeProviderOptions: (
    request: JcodeProviderOptionsUpdateRequest
  ) => Promise<JcodeModelsListResponse>;
  readonly updateJcodeAgentRoles: (
    request: JcodeAgentRolesUpdateRequest
  ) => Promise<JcodeConfigSnapshot>;
  readonly runImprove: (
    request?: JcodeAgentActionRunRequest
  ) => Promise<AgentTurnSendResponse>;
  readonly runRefactor: (
    request?: JcodeAgentActionRunRequest
  ) => Promise<AgentTurnSendResponse>;
  readonly triggerPoke: (request?: JcodePokeRequest) => Promise<JcodePokeResponse>;
  readonly runReview: (
    request?: JcodeFeedbackRunRequest
  ) => Promise<AgentTurnSendResponse>;
  readonly runJudge: (
    request?: JcodeFeedbackRunRequest
  ) => Promise<AgentTurnSendResponse>;
  readonly runSubagent: (
    request: JcodeSubagentRunRequest
  ) => Promise<JcodeSubagentRunResponse>;
  readonly runBtw: (request: JcodeBtwRunRequest) => Promise<JcodeSidePanelActionResponse>;
  readonly splitSession: (
    request?: JcodeSessionActionRequest
  ) => Promise<JcodeSessionForkResponse>;
  readonly transferSession: (
    request?: JcodeSessionActionRequest
  ) => Promise<JcodeSessionForkResponse>;
  readonly compactSession: (
    request?: JcodeSessionActionRequest
  ) => Promise<JcodeCompactResponse>;
  readonly updateSessionAutomation: (
    request: JcodeAutomationUpdateRequest
  ) => Promise<JcodeAutomationUpdateResponse>;
  readonly listGoals: (request?: JcodeGoalsRequest) => Promise<JcodeGoalsResponse>;
  readonly openGoals: (request?: JcodeGoalsRequest) => Promise<JcodeGoalsResponse>;
  readonly resumeGoal: (request?: JcodeGoalsRequest) => Promise<JcodeGoalsResponse>;
  readonly showGoal: (request: JcodeGoalsRequest) => Promise<JcodeGoalsResponse>;
  readonly listAccounts: () => Promise<JcodeAccountsResponse>;
  readonly loginAccount: (request: JcodeAccountLoginRequest) => Promise<JcodeAccountsResponse>;
  readonly listLoginProviders: () => Promise<JcodeLoginProvidersResponse>;
  readonly startAccountLogin: (
    request: JcodeAccountLoginStartRequest
  ) => Promise<JcodeAccountLoginStartResponse>;
  readonly completeAccountLogin: (
    request: JcodeAccountLoginCompleteRequest
  ) => Promise<JcodeAccountLoginCompleteResponse>;
  readonly switchAccount: (request: JcodeAccountRequest) => Promise<JcodeAccountsResponse>;
  readonly removeAccount: (request: JcodeAccountRequest) => Promise<JcodeAccountsResponse>;
  readonly readBrowserFollowMode: () => Promise<AgentBrowserFollowModeSnapshot>;
  readonly updateBrowserFollowMode: (
    request: AgentBrowserFollowModeUpdateRequest
  ) => Promise<AgentBrowserFollowModeSnapshot>;
  readonly materializeImageAttachment: (
    request: AgentImageAttachmentMaterializeRequest
  ) => Promise<AgentImageAttachmentMaterializeResponse>;
  readonly onEvent: (listener: (event: AgentRuntimeEvent) => void) => () => void;
};
