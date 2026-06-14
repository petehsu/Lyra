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
  readonly metadata?: unknown;
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
  readonly toolPath?: string | null;
  readonly domain?: string | null;
  readonly operation?: string | null;
  readonly manifestTitle?: string | null;
  readonly activityKind?: string | null;
  readonly rendererHint?: string | null;
  readonly traceId?: string | null;
  readonly trace?: readonly unknown[];
  readonly artifactRefs?: readonly unknown[];
  readonly changes?: readonly unknown[];
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
  readonly memory?: AgentMemorySnapshot | null;
};

export type AgentMemoryVisibility =
  | "user_visible"
  | "model_context_only"
  | "audit_only"
  | "internal"
  | "debug_only";

export type AgentMemoryModelContextPolicy =
  | "include"
  | "include_summarized"
  | "exclude"
  | "include_as_runtime_state";

export type AgentMemoryUiPolicy =
  | "show_in_timeline"
  | "show_as_status"
  | "show_in_details_only"
  | "hide_from_user";

export type AgentMemoryEventRole = "user" | "assistant" | "tool" | "runtime" | "system";

export type AgentRuntimeTurnState =
  | "queued"
  | "assembling_context"
  | "calling_model"
  | "streaming_model"
  | "waiting_for_tool"
  | "waiting_for_permission"
  | "waiting_for_user"
  | "recovering_after_reload"
  | "recovering_after_crash"
  | "interrupted"
  | "completed"
  | "failed_recoverable"
  | "failed_terminal"
  | "cancelled_by_user";

export type AgentMemorySessionRecord = {
  readonly sessionId: string;
  readonly title: string;
  readonly workingDir?: string | null;
  readonly providerKey?: string | null;
  readonly model?: string | null;
  readonly status: string;
  readonly schemaVersion: number;
  readonly createdAtMs: number;
  readonly createdAtIso: string;
  readonly updatedAtMs: number;
  readonly updatedAtIso: string;
};

export type AgentRuntimeTurn = {
  readonly runtimeTurnId: string;
  readonly sessionId: string;
  readonly parentRuntimeTurnId?: string | null;
  readonly userMessageId?: string | null;
  readonly state: AgentRuntimeTurnState;
  readonly startedAtMs: number;
  readonly startedAtIso: string;
  readonly updatedAtMs: number;
  readonly updatedAtIso: string;
  readonly completedAtMs?: number | null;
  readonly completedAtIso?: string | null;
  readonly failureKind?: string | null;
  readonly failureDetailRef?: string | null;
  readonly latestUserIntentRef?: string | null;
  readonly activeTaskRef?: string | null;
  readonly providerRequestRef?: string | null;
  readonly contextSnapshotRef?: string | null;
  readonly completionAuditRef?: string | null;
};

export type AgentTimelineProjectionItem = {
  readonly eventId: string;
  readonly runtimeTurnId?: string | null;
  readonly kind: string;
  readonly role: AgentMemoryEventRole;
  readonly payloadJson?: unknown;
  readonly createdAtMs: number;
  readonly createdAtIso: string;
};

export type AgentContextLayerKind =
  | "system_contract"
  | "runtime_state"
  | "latest_user_intent"
  | "pinned"
  | "tail"
  | "tool_capability_snapshot"
  | "middle_anchors"
  | "head"
  | "retrieved_archives"
  | "shared_frozen_memory";

export type AgentContextLayer = {
  readonly kind: AgentContextLayerKind;
  readonly priority: number;
  readonly tokenBudget: number;
  readonly payloadJson?: unknown;
  readonly sourceRefs: readonly string[];
};

export type AgentContextSnapshot = {
  readonly contextSnapshotId: string;
  readonly sessionId: string;
  readonly runtimeTurnId: string;
  readonly modelContextWindow: number;
  readonly createdAtMs: number;
  readonly createdAtIso: string;
  readonly layers: readonly AgentContextLayer[];
};

export type AgentTypedToolStatus =
  | "running"
  | "success"
  | "success_partial"
  | "failed_retryable"
  | "failed_terminal"
  | "timed_out_partial"
  | "cancelled"
  | "unknown_after_recovery";

export type AgentTypedToolResult = {
  readonly toolCallId: string;
  readonly toolResultId?: string | null;
  readonly runtimeTurnId?: string | null;
  readonly name: string;
  readonly status: AgentTypedToolStatus;
  readonly input?: unknown;
  readonly output?: unknown;
  readonly recommendedNextActions?: readonly string[];
};

export type AgentBrowserTargetProjection = Readonly<Record<string, unknown>>;

export type AgentClarificationProjection = {
  readonly clarificationId?: string | null;
  readonly question?: string | null;
  readonly options?: readonly AgentClarificationOption[];
  readonly allowCustomAnswer?: boolean | null;
  readonly detail?: string | null;
};

export type AgentMemorySnapshot = {
  readonly session?: AgentMemorySessionRecord | null;
  readonly runtimeTurns: readonly AgentRuntimeTurn[];
  readonly timelineProjection: readonly AgentTimelineProjectionItem[];
  readonly activeTodos: readonly unknown[];
  readonly activeBrowserTargets: readonly AgentBrowserTargetProjection[];
  readonly activeClarification?: AgentClarificationProjection | null;
  readonly status: string;
  readonly providerLabel?: string | null;
  readonly modelLabel?: string | null;
};

export type AgentMemoryAuditResponse = {
  readonly sessionId: string;
  readonly events: readonly unknown[];
  readonly runtimeTurns: readonly AgentRuntimeTurn[];
};

export type AgentMemoryTrimRunRequest = {
  readonly sessionId?: string | null;
  readonly tokenBudget?: number | null;
  readonly charBudget?: number | null;
};

export type AgentMemorySharedSearchRequest = {
  readonly query?: string | null;
};

export type AgentMemorySharedUpdateRequest = {
  readonly scope?: string | null;
  readonly content: unknown;
  readonly evidenceRefs?: readonly string[];
  readonly status?: string | null;
  readonly negative?: boolean;
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

export type AgentActionRunRequest = {
  readonly sessionId?: string | null;
  readonly planOnly?: boolean;
  readonly focus?: string | null;
};

export type AgentPokeRequest = {
  readonly sessionId?: string | null;
};

export type AgentFeedbackRunRequest = {
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

export type AgentOvernightStartRequest = {
  readonly sessionId?: string | null;
  readonly durationMinutes: number;
  readonly mission?: string | null;
  readonly inheritContext?: boolean;
};

export type AgentOvernightRunRequest = {
  readonly runId?: string | null;
};

export type AgentOvernightRunSnapshot = {
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

export type AgentOvernightStartResponse = {
  readonly run: AgentOvernightRunSnapshot;
  readonly inheritedContext: boolean;
};

export type AgentOvernightListResponse = {
  readonly runs: readonly AgentOvernightRunSnapshot[];
  readonly latestRunId?: string | null;
};

export type AgentOvernightRunResponse = {
  readonly run?: AgentOvernightRunSnapshot | null;
};

export type AgentSubagentRunRequest = {
  readonly sessionId?: string | null;
  readonly prompt: string;
  readonly subagentType?: string | null;
  readonly model?: string | null;
  readonly continueSessionId?: string | null;
};

export type AgentSubagentRunResponse = {
  readonly sessionId: string;
  readonly toolId: string;
  readonly snapshot: AgentSessionSnapshot;
};

export type AgentBtwRunRequest = {
  readonly sessionId?: string | null;
  readonly question: string;
};

export type AgentSidePanelActionResponse = {
  readonly sessionId: string;
  readonly turnId?: string | null;
  readonly status: "idle" | "running";
  readonly sidePanel: AgentSidePanelSnapshot;
};

export type AgentSessionActionRequest = {
  readonly sessionId?: string | null;
};

export type AgentSessionForkResponse = {
  readonly sessionId: string;
  readonly parentSessionId: string;
  readonly snapshot: AgentSessionSnapshot;
};

export type AgentCompactResponse = {
  readonly sessionId: string;
  readonly message: string;
  readonly success: boolean;
  readonly snapshot: AgentSessionSnapshot;
};

export type AgentAutomationUpdateRequest = {
  readonly sessionId?: string | null;
  readonly subagentModel?: string | null;
  readonly autoreviewEnabled?: boolean | null;
  readonly autojudgeEnabled?: boolean | null;
};

export type AgentAutomationUpdateResponse = {
  readonly sessionId: string;
  readonly automation: AgentSessionAutomationSnapshot;
  readonly snapshot: AgentSessionSnapshot;
};

export type AgentGoalsRequest = {
  readonly sessionId?: string | null;
  readonly goalId?: string | null;
};

export type AgentGoalsResponse = {
  readonly sessionId: string;
  readonly goals: readonly unknown[];
  readonly focusedGoal?: unknown;
  readonly sidePanel: AgentSidePanelSnapshot;
};

export type AgentAccountSnapshot = {
  readonly provider: string;
  readonly label: string;
  readonly kind: string;
  readonly active: boolean;
  readonly configured: boolean;
  readonly detail?: string | null;
};

export type AgentAccountsSnapshot = {
  readonly defaultProvider?: string | null;
  readonly defaultModel?: string | null;
  readonly authStatus: unknown;
  readonly accounts: readonly AgentAccountSnapshot[];
};

export type AgentAccountRequest = {
  readonly provider?: string | null;
  readonly label?: string | null;
};

export type AgentAccountLoginRequest = {
  readonly provider?: string | null;
  readonly profileName?: string | null;
  readonly label?: string | null;
  readonly baseUrl?: string | null;
  readonly apiKey?: string | null;
  readonly defaultModel?: string | null;
  readonly setDefault?: boolean;
};

export type AgentLoginProviderSnapshot = {
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

export type AgentLoginProviderCatalogSnapshot = {
  readonly providers: readonly AgentLoginProviderSnapshot[];
  readonly authStatus: unknown;
};

export type AgentAccountLoginStartRequest = {
  readonly provider: string;
  readonly label?: string | null;
  readonly googleClientId?: string | null;
  readonly googleClientSecret?: string | null;
  readonly gmailAccessTier?: "readonly" | "full" | string | null;
};

export type AgentAccountLoginStartResponse = {
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

export type AgentAccountLoginCompleteRequest = {
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

export type AgentAccountLoginCompleteResponse = {
  readonly accounts: AgentAccountsSnapshot;
  readonly message: string;
};

export type AgentPokeResponse = {
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

export type AgentPermissionPolicyMode = "approval" | "full_auto" | "custom";

export type AgentPermissionPolicyEffectiveMode = "approval" | "full_auto";

export type AgentPermissionPolicySnapshot = {
  readonly mode: AgentPermissionPolicyMode;
  readonly effectiveMode: AgentPermissionPolicyEffectiveMode;
  readonly valid: boolean;
  readonly configPath: string;
  readonly exists: boolean;
  readonly warning?: string | null;
  readonly elevationCredentialRef?: unknown;
};

export type AgentPermissionPolicySetModeRequest = {
  readonly mode: AgentPermissionPolicyEffectiveMode;
  readonly elevationCredentialRef?: unknown;
};

export type AgentRuntimeEvent =
  | {
      readonly kind: "sessionSnapshot";
      readonly snapshot: AgentSessionSnapshot;
    }
  | {
      readonly kind: "messageCommitted";
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
      readonly kind: "memoryUpdated";
      readonly sessionId: string;
      readonly snapshot: AgentMemorySnapshot;
    }
  | {
      readonly kind: "turnStarted" | "turnStateChanged";
      readonly sessionId: string;
      readonly turnId: string;
      readonly state: AgentRuntimeTurnState;
      readonly reason?: string;
    }
  | {
      readonly kind: "toolUpdated";
      readonly sessionId: string;
      readonly turnId: string;
      readonly tool: AgentToolActivity;
    }
  | {
      readonly kind: "contextTrimmed";
      readonly sessionId: string;
      readonly detail: unknown;
    }
  | {
      readonly kind: "turnRecovered";
      readonly sessionId: string;
      readonly turnId: string;
    }
  | {
      readonly kind: "turnCompleted";
      readonly sessionId: string;
      readonly turnId: string;
    }
  | {
      readonly kind: "todoUpdated";
      readonly sessionId: string;
      readonly todos: readonly AgentTodoItem[];
    }
  | {
      readonly kind: "clarificationRequested";
      readonly sessionId: string;
      readonly clarificationId: string;
      readonly question: string;
      readonly options?: readonly AgentClarificationOption[];
      readonly allowCustomAnswer: boolean;
      readonly detail?: string | null;
    }
  | {
      readonly kind: "clarificationResolved";
      readonly sessionId: string;
      readonly clarificationId: string;
    }
  | {
      readonly kind: "browserActivityChanged";
      readonly sessionId: string;
      readonly turnId: string;
      readonly target: unknown;
    }
  | {
      readonly kind: "permissionRequested";
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
      readonly kind: "turnInterrupted";
      readonly sessionId: string;
      readonly turnId: string;
      readonly reason: string;
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

export type AgentRegisteredCommand = {
  readonly name: string;
  readonly help: string;
  readonly autocomplete: boolean;
  readonly remoteOnly: boolean;
};

export type AgentConfigSnapshot = {
  readonly agentHome?: string | null;
  readonly configPath?: string | null;
  readonly config: unknown;
  readonly commands: readonly AgentRegisteredCommand[];
};

export type AgentProviderProtocolEntry = {
  readonly id: string;
  readonly family: string;
  readonly label: string;
  readonly transport: string;
  readonly runtimeSupported: boolean;
  readonly streamingSupported: boolean;
  readonly toolCallingSupported: boolean;
};

export type AgentProviderRouteEntry = {
  readonly id: string;
  readonly providerId: string;
  readonly protocolId: string;
  readonly protocolFamily: string;
  readonly label: string;
  readonly description: string;
  readonly defaultBaseUrl?: string | null;
  readonly apiMethod: string;
  readonly authKind: string;
  readonly runtimeSupported: boolean;
  readonly modelDiscoverySupported: boolean;
  readonly customHeadersSupported: boolean;
  readonly localBackend?: string | null;
  readonly catalogSection: string;
  readonly quickSetupSupported: boolean;
};

export type AgentProviderCapabilitySummary = {
  readonly supportsImageInput: boolean;
  readonly supportsToolCalling: boolean;
  readonly supportsStreaming: boolean;
};

export type AgentProviderCatalogProfile = {
  readonly id: string;
  readonly label: string;
  readonly routeId: string;
  readonly protocolId: string;
  readonly protocolFamily: string;
  readonly baseUrl?: string | null;
  readonly defaultModel?: string | null;
  readonly configured: boolean;
  readonly authHeader?: string | null;
  readonly modelCount: number;
  readonly capabilities: AgentProviderCapabilitySummary;
};

export type AgentProviderCatalogSnapshot = {
  readonly schemaVersion: string;
  readonly defaultProvider?: string | null;
  readonly defaultModel?: string | null;
  readonly protocols: readonly AgentProviderProtocolEntry[];
  readonly routes: readonly AgentProviderRouteEntry[];
  readonly profiles: readonly AgentProviderCatalogProfile[];
};

export type AgentConfigUpdateRequest = {
  readonly defaultModel?: string | null;
  readonly defaultProvider?: string | null;
  readonly openaiReasoningEffort?: string | null;
  readonly openaiServiceTier?: string | null;
  readonly openaiVerbosity?: string | null;
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

export type AgentProviderProfileModelRequest = {
  readonly id: string;
  readonly contextWindow?: number | null;
  readonly supportsImageInput?: boolean;
  readonly supportsToolCalling?: boolean;
  readonly supportsStreaming?: boolean;
};

export type AgentProviderProfileSaveRequest = {
  readonly profileName: string;
  readonly routeId: string;
  readonly baseUrl: string;
  readonly defaultModel?: string | null;
  readonly apiKey?: string | null;
  readonly apiKeyEnv?: string | null;
  readonly envFile?: string | null;
  readonly auth?: "bearer" | "header" | "none";
  readonly authHeader?: string | null;
  readonly setDefault?: boolean;
  readonly models?: readonly AgentProviderProfileModelRequest[];
};


export type AgentSessionSummary = {
  readonly id: string;
  readonly title: string;
  readonly shortName?: string | null;
  readonly status: string;
  readonly providerKey?: string | null;
  readonly providerLabel?: string | null;
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

export type AgentSessionListRequest = {
  readonly limit?: number;
};

export type AgentSessionListResponse = {
  readonly sessionsDir: string;
  readonly sessions: readonly AgentSessionSummary[];
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

export type AgentModelRoute = {
  readonly model: string;
  readonly provider: string;
  readonly apiMethod: string;
  readonly available: boolean;
  readonly detail: string;
};

export type AgentModelEntry = {
  readonly id: string;
  readonly label: string;
  readonly model: string;
  readonly provider?: string | null;
  readonly providerId?: string | null;
  readonly providerLabel?: string | null;
  readonly providerKey?: string | null;
  readonly apiMethod?: string | null;
  readonly detail?: string | null;
  readonly contextWindow?: number | null;
  readonly supportsImageInput?: boolean;
  readonly supportsToolCalling?: boolean;
  readonly available: boolean;
};

export type AgentProviderOptionState = {
  readonly current?: string | null;
  readonly options: readonly string[];
  readonly supported: boolean;
};

export type AgentModelCatalogRequest = {
  readonly sessionId?: string | null;
};

export type AgentModelCatalogSnapshot = {
  readonly sessionId?: string | null;
  readonly currentModel: string;
  readonly currentProvider: string;
  readonly defaultModel?: string | null;
  readonly defaultProvider?: string | null;
  readonly models: readonly AgentModelEntry[];
  readonly routes: readonly AgentModelRoute[];
  readonly reasoningEffort: AgentProviderOptionState;
  readonly verbosity: AgentProviderOptionState;
  readonly serviceTier: AgentProviderOptionState;
};

export type AgentModelSwitchRequest = {
  readonly sessionId?: string | null;
  readonly model: string;
  readonly provider?: string | null;
};

export type AgentModelRefreshRequest = {
  readonly sessionId?: string | null;
  readonly provider?: string | null;
};

export type AgentProviderOptionsUpdateRequest = {
  readonly sessionId?: string | null;
  readonly reasoningEffort?: string | null;
  readonly verbosity?: string | null;
  readonly serviceTier?: string | null;
};

export type AgentRolesUpdateRequest = {
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
    request?: AgentSessionListRequest
  ) => Promise<AgentSessionListResponse>;
  readonly saveSession: (request: AgentSessionSaveRequest) => Promise<AgentSessionSummary>;
  readonly unsaveSession: (request: AgentSessionDeleteRequest) => Promise<AgentSessionSummary>;
  readonly renameSession: (request: AgentSessionRenameRequest) => Promise<AgentSessionSummary>;
  readonly archiveSession: (request: AgentSessionArchiveRequest) => Promise<AgentSessionSummary>;
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
    request: AgentOvernightStartRequest
  ) => Promise<AgentOvernightStartResponse>;
  readonly listOvernightRuns: () => Promise<AgentOvernightListResponse>;
  readonly readOvernightStatus: (
    request?: AgentOvernightRunRequest
  ) => Promise<AgentOvernightRunResponse>;
  readonly readOvernightLog: (
    request?: AgentOvernightRunRequest
  ) => Promise<AgentOvernightRunResponse>;
  readonly readOvernightReview: (
    request?: AgentOvernightRunRequest
  ) => Promise<AgentOvernightRunResponse>;
  readonly cancelOvernight: (
    request?: AgentOvernightRunRequest
  ) => Promise<AgentOvernightRunResponse>;
  readonly startTurn: (request: AgentTurnSendRequest) => Promise<AgentTurnSendResponse>;
  readonly sendTurn: (request: AgentTurnSendRequest) => Promise<AgentTurnSendResponse>;
  readonly resumeTurn: (request: AgentTurnSendRequest) => Promise<AgentTurnSendResponse>;
  readonly cancelTurn: (request: AgentTurnCancelRequest) => Promise<AgentTurnCancelResponse>;
  readonly retryTurn: (request: AgentTurnSendRequest) => Promise<AgentTurnSendResponse>;
  readonly readMemorySnapshot: (request?: AgentSessionReadRequest) => Promise<AgentMemorySnapshot>;
  readonly readMemoryAudit: (request?: AgentSessionReadRequest) => Promise<AgentMemoryAuditResponse>;
  readonly runMemoryTrim: (request?: AgentMemoryTrimRunRequest) => Promise<unknown>;
  readonly runMemoryRecovery: (request?: AgentSessionReadRequest) => Promise<unknown>;
  readonly searchSharedMemory: (
    request?: AgentMemorySharedSearchRequest
  ) => Promise<{ readonly records: readonly unknown[] }>;
  readonly updateSharedMemory: (request: AgentMemorySharedUpdateRequest) => Promise<unknown>;
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
  readonly readPermissionPolicy: () => Promise<AgentPermissionPolicySnapshot>;
  readonly setPermissionPolicyMode: (
    request: AgentPermissionPolicySetModeRequest
  ) => Promise<AgentPermissionPolicySnapshot>;
  readonly readAgentConfig: () => Promise<AgentConfigSnapshot>;
  readonly readAgentProviderCatalog: () => Promise<AgentProviderCatalogSnapshot>;
  readonly updateAgentConfig: (
    request: AgentConfigUpdateRequest
  ) => Promise<AgentConfigSnapshot>;
  readonly saveAgentProviderProfile: (
    request: AgentProviderProfileSaveRequest
  ) => Promise<AgentConfigSnapshot>;
  readonly listAgentModels: (
    request?: AgentModelCatalogRequest
  ) => Promise<AgentModelCatalogSnapshot>;
  readonly switchAgentModel: (
    request: AgentModelSwitchRequest
  ) => Promise<AgentModelCatalogSnapshot>;
  readonly refreshAgentModels: (
    request?: AgentModelRefreshRequest
  ) => Promise<AgentModelCatalogSnapshot>;
  readonly updateAgentProviderOptions: (
    request: AgentProviderOptionsUpdateRequest
  ) => Promise<AgentModelCatalogSnapshot>;
  readonly updateAgentRoles: (
    request: AgentRolesUpdateRequest
  ) => Promise<AgentConfigSnapshot>;
  readonly runImprove: (
    request?: AgentActionRunRequest
  ) => Promise<AgentTurnSendResponse>;
  readonly runRefactor: (
    request?: AgentActionRunRequest
  ) => Promise<AgentTurnSendResponse>;
  readonly triggerPoke: (request?: AgentPokeRequest) => Promise<AgentPokeResponse>;
  readonly runReview: (
    request?: AgentFeedbackRunRequest
  ) => Promise<AgentTurnSendResponse>;
  readonly runJudge: (
    request?: AgentFeedbackRunRequest
  ) => Promise<AgentTurnSendResponse>;
  readonly runSubagent: (
    request: AgentSubagentRunRequest
  ) => Promise<AgentSubagentRunResponse>;
  readonly runBtw: (request: AgentBtwRunRequest) => Promise<AgentSidePanelActionResponse>;
  readonly splitSession: (
    request?: AgentSessionActionRequest
  ) => Promise<AgentSessionForkResponse>;
  readonly transferSession: (
    request?: AgentSessionActionRequest
  ) => Promise<AgentSessionForkResponse>;
  readonly compactSession: (
    request?: AgentSessionActionRequest
  ) => Promise<AgentCompactResponse>;
  readonly updateSessionAutomation: (
    request: AgentAutomationUpdateRequest
  ) => Promise<AgentAutomationUpdateResponse>;
  readonly listGoals: (request?: AgentGoalsRequest) => Promise<AgentGoalsResponse>;
  readonly openGoals: (request?: AgentGoalsRequest) => Promise<AgentGoalsResponse>;
  readonly resumeGoal: (request?: AgentGoalsRequest) => Promise<AgentGoalsResponse>;
  readonly showGoal: (request: AgentGoalsRequest) => Promise<AgentGoalsResponse>;
  readonly listAccounts: () => Promise<AgentAccountsSnapshot>;
  readonly loginAccount: (request: AgentAccountLoginRequest) => Promise<AgentAccountsSnapshot>;
  readonly listLoginProviders: () => Promise<AgentLoginProviderCatalogSnapshot>;
  readonly startAccountLogin: (
    request: AgentAccountLoginStartRequest
  ) => Promise<AgentAccountLoginStartResponse>;
  readonly completeAccountLogin: (
    request: AgentAccountLoginCompleteRequest
  ) => Promise<AgentAccountLoginCompleteResponse>;
  readonly switchAccount: (request: AgentAccountRequest) => Promise<AgentAccountsSnapshot>;
  readonly removeAccount: (request: AgentAccountRequest) => Promise<AgentAccountsSnapshot>;
  readonly readBrowserFollowMode: () => Promise<AgentBrowserFollowModeSnapshot>;
  readonly updateBrowserFollowMode: (
    request: AgentBrowserFollowModeUpdateRequest
  ) => Promise<AgentBrowserFollowModeSnapshot>;
  readonly materializeImageAttachment: (
    request: AgentImageAttachmentMaterializeRequest
  ) => Promise<AgentImageAttachmentMaterializeResponse>;
  readonly onEvent: (listener: (event: AgentRuntimeEvent) => void) => () => void;
};
