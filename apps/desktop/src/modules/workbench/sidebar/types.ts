import type { FileManagerEntryIconKind } from "../file-manager/entry-icon-classifier";

export type SidebarProps = {
  readonly title: string;
  readonly entries: readonly string[];
};

export type SidebarComposerMode = "chat" | "agent" | "oma";

export type SidebarComposerModeOption = {
  readonly id: SidebarComposerMode;
  readonly label: string;
  readonly disabled?: boolean;
  readonly description?: string;
};

export type SidebarQuestionPanelOption = {
  readonly id: string;
  readonly label: string;
};

export type SidebarQuestionPanelViewModel = {
  readonly questionId: string;
  readonly prompt: string;
  readonly options: readonly SidebarQuestionPanelOption[];
  readonly customDraft: string;
  readonly currentIndex: number;
  readonly totalCount: number;
  readonly canNavigateUp: boolean;
  readonly canNavigateDown: boolean;
};

export type SidebarUpperPanelTab = "question" | "change";

export type SidebarChangeApprovalView = "pending" | "all";

export type SidebarChangeApprovalDecision = "accepted" | "rejected";

export type SidebarChangeApprovalItem = {
  readonly id: string;
  readonly filePath: string;
  readonly fileName: string;
  readonly addedLines: number;
  readonly removedLines: number;
  readonly decision?: SidebarChangeApprovalDecision;
};

export type SidebarChangeApprovalSummary = {
  readonly fileCount: number;
  readonly addedLines: number;
  readonly removedLines: number;
};

export type SidebarChangeApprovalPanelViewModel = {
  readonly view: SidebarChangeApprovalView;
  readonly pendingItems: readonly SidebarChangeApprovalItem[];
  readonly allItems: readonly SidebarChangeApprovalItem[];
  readonly pendingSummary: SidebarChangeApprovalSummary;
  readonly allSummary: SidebarChangeApprovalSummary;
};

export type SidebarChangeApprovalLabels = {
  readonly tabQuestion: string;
  readonly tabChange: string;
  readonly viewPending: string;
  readonly viewAll: string;
  readonly filesUnit: string;
  readonly acceptAll: string;
  readonly openFile: string;
  readonly emptyPending: string;
  readonly emptyAll: string;
};

export type SidebarComposerFileToken = {
  readonly kind: "file";
  readonly name: string;
  readonly entryKind: "file" | "directory";
  readonly source: "directory" | "trash";
  readonly path?: string;
  readonly iconKind?: FileManagerEntryIconKind;
};

export type SidebarComposerTextToken = {
  readonly kind: "text";
  readonly value: string;
};

export type SidebarComposerToken =
  | SidebarComposerTextToken
  | SidebarComposerFileToken;

export type SidebarComposerSubmitPayload = {
  readonly text: string;
  readonly tokens: readonly SidebarComposerToken[];
};

export type SidebarComposerProps = {
  readonly ariaLabel: string;
  readonly placeholder: string;
  readonly sendLabel: string;
  readonly pauseLabel?: string;
  readonly questionPanel?: SidebarQuestionPanelViewModel;
  readonly changeApprovalPanel?: SidebarChangeApprovalPanelViewModel;
  readonly upperPanelTab?: SidebarUpperPanelTab;
  readonly changeApprovalLabels?: SidebarChangeApprovalLabels;
  readonly questionNavigateUpLabel?: string;
  readonly questionNavigateDownLabel?: string;
  readonly questionCloseLabel?: string;
  readonly questionCustomPlaceholder?: string;
  readonly questionSubmitCustomLabel?: string;
  readonly quotedMessage?: string;
  readonly modeOptions?: readonly SidebarComposerModeOption[];
  readonly defaultMode?: SidebarComposerMode;
  readonly isResponding?: boolean;
  readonly onQuestionNavigateUp?: () => void;
  readonly onQuestionNavigateDown?: () => void;
  readonly onQuestionClose?: () => void;
  readonly onQuestionSelectOption?: (questionId: string, optionId: string) => void;
  readonly onQuestionCustomDraftChange?: (questionId: string, value: string) => void;
  readonly onQuestionSubmitCustom?: (questionId: string) => void;
  readonly onUpperPanelTabChange?: (tab: SidebarUpperPanelTab) => void;
  readonly onChangeApprovalViewChange?: (view: SidebarChangeApprovalView) => void;
  readonly onAcceptAllChanges?: () => void;
  readonly onOpenChangedFile?: (filePath: string) => void;
  readonly onModeChange?: (mode: SidebarComposerMode) => void;
  readonly onRequestPause?: () => void;
  readonly onSend?: (value: string, mode: SidebarComposerMode) => void;
  readonly onSendPayload?: (
    payload: SidebarComposerSubmitPayload,
    mode: SidebarComposerMode
  ) => void;
};
