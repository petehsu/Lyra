import type { WorkbenchLocale } from "../i18n";

export type AgentComposerModelOption = {
  readonly value: string;
  readonly label: string;
};

export type AgentComposerReasoningEffort = "none" | "minimal" | "low" | "medium" | "high" | "xhigh";
export type AgentComposerVerbosity = "low" | "medium" | "high";

export type AgentComposerModelControlOption<Value extends string> = {
  readonly value: Value;
  readonly label: string;
  readonly disabled?: boolean;
  readonly disabledReason?: string;
};

export type AgentComposerAppendRequest = {
  readonly id: number;
  readonly text: string;
};

export type AgentComposerAttachmentKind =
  | "file"
  | "directory"
  | "local_image"
  | "image"
  | "workbench_tab"
  | "ai_thread";

export type AgentComposerFileAttachment = {
  readonly id: string;
  readonly name: string;
  readonly path: string;
  readonly kind: AgentComposerAttachmentKind;
  readonly source:
    | "lyra-file-manager"
    | "system-picker"
    | "system-drag"
    | "clipboard"
    | "fuzzy-mention"
    | "mention-panel";
  readonly contextText?: string;
};

export type AgentComposerInlineAttachment = AgentComposerFileAttachment & {
  readonly placeholder: string;
};

export type AgentComposerContentPart =
  | {
    readonly type: "text";
    readonly text: string;
  }
  | {
    readonly type: "attachment";
    readonly attachment: AgentComposerFileAttachment;
  };

export type AgentComposerSubmitPayload = {
  readonly text: string;
  readonly attachments: readonly AgentComposerFileAttachment[];
  readonly parts: readonly AgentComposerContentPart[];
};

export type AgentComposerFileMentionSearchResult = {
  readonly id: string;
  readonly name: string;
  readonly path: string;
  readonly kind: "file" | "directory";
  readonly root?: string;
  readonly score?: number;
  readonly indices?: readonly number[] | null;
};

export type AgentComposerWorkbenchTabMention = {
  readonly tabId: string;
  readonly title: string;
  readonly kind: string;
  readonly active: boolean;
  readonly visible: boolean;
  readonly address?: string | undefined;
  readonly inputValue?: string | undefined;
  readonly query?: string | undefined;
  readonly filePath?: string | undefined;
  readonly appId?: string | undefined;
  readonly appIconKey?: string | undefined;
  readonly terminalTabId?: string | undefined;
  readonly faviconUrl?: string | undefined;
  readonly preview?: string | undefined;
};

export type AgentComposerAiThreadMention = {
  readonly tabId: string;
  readonly threadId: string;
  readonly title: string;
  readonly status: string;
  readonly active: boolean;
  readonly preview?: string | undefined;
  readonly projectRoot?: string | undefined;
  readonly recentMessages?: readonly string[] | undefined;
};

export type AgentComposerProps = {
  readonly locale?: WorkbenchLocale;
  readonly currentThreadId?: string | null;
  readonly modelNames?: readonly string[];
  readonly modelOptions?: readonly AgentComposerModelOption[];
  readonly selectedModelName?: string | null;
  readonly modelAriaLabel?: string;
  readonly modelSwitchDisabled?: boolean;
  readonly onModelSelect?: (modelName: string) => void;
  readonly reasoningEffortOptions?: readonly AgentComposerModelControlOption<AgentComposerReasoningEffort>[];
  readonly selectedReasoningEffort?: AgentComposerReasoningEffort | null;
  readonly reasoningEffortLabel?: string;
  readonly onReasoningEffortSelect?: (value: AgentComposerReasoningEffort | null) => void;
  readonly verbosityOptions?: readonly AgentComposerModelControlOption<AgentComposerVerbosity>[];
  readonly selectedVerbosity?: AgentComposerVerbosity | null;
  readonly verbosityLabel?: string;
  readonly onVerbositySelect?: (value: AgentComposerVerbosity | null) => void;
  readonly initialValue?: string;
  readonly appendRequest?: AgentComposerAppendRequest | null;
  readonly ariaLabel: string;
  readonly placeholder: string;
  readonly sendLabel: string;
  readonly followLabel?: string;
  readonly followEnabled?: boolean;
  readonly inputDisabled: boolean;
  readonly sendDisabled: boolean;
  readonly sending: boolean;
  readonly surfaceDimmed?: boolean;
  readonly planModeEnabled?: boolean;
  readonly planModeLocked?: boolean;
  readonly planModeLabel?: string;
  readonly onPlanModeToggle?: () => void;
  readonly onHeightChange?: (height: number) => void;
  readonly onSend: (payload: AgentComposerSubmitPayload) => void | Promise<void>;
  readonly onSendWithFollow?: (() => void) | undefined;
  readonly onFollowToggle?: (() => void) | undefined;
  readonly onSteer?: (payload: AgentComposerSubmitPayload) => void | Promise<void>;
  readonly steerLabel?: string;
  readonly steerDisabled?: boolean;
  readonly onStop?: () => void;
  readonly stopDisabled?: boolean;
  readonly addFileLabel?: string;
  readonly removeAttachmentLabel?: string;
  readonly onRequestFileAttachments?: (() => Promise<readonly AgentComposerFileAttachment[]>) | undefined;
  readonly fileMentionSearchRoots?: readonly string[] | undefined;
  readonly fileMentionSearchResults?: readonly AgentComposerFileMentionSearchResult[] | undefined;
  readonly workbenchTabMentions?: readonly AgentComposerWorkbenchTabMention[] | undefined;
  readonly aiThreadMentions?: readonly AgentComposerAiThreadMention[] | undefined;
  readonly onFileMentionSearchStart?: (
    sessionId: string,
    roots: readonly string[]
  ) => void | Promise<void>;
  readonly onFileMentionSearchUpdate?: (
    sessionId: string,
    query: string
  ) => void | Promise<void>;
  readonly onFileMentionSearchStop?: (sessionId: string) => void | Promise<void>;
};

export type AgentComposerSubmitAction = "send" | "steer";
