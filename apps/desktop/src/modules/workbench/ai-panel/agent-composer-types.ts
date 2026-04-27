import type { WorkbenchLocale } from "../i18n";

export type AgentComposerModelOption = {
  readonly value: string;
  readonly label: string;
};

export type AgentPermissionMode = "default" | "auto_review" | "full_access";

export type AgentComposerAppendRequest = {
  readonly id: number;
  readonly text: string;
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
  readonly initialValue?: string;
  readonly appendRequest?: AgentComposerAppendRequest | null;
  readonly ariaLabel: string;
  readonly placeholder: string;
  readonly sendLabel: string;
  readonly inputDisabled: boolean;
  readonly sendDisabled: boolean;
  readonly sending: boolean;
  readonly surfaceDimmed?: boolean;
  readonly planModeEnabled?: boolean;
  readonly planModeLocked?: boolean;
  readonly planModeLabel?: string;
  readonly onPlanModeToggle?: () => void;
  readonly permissionMode?: AgentPermissionMode;
  readonly permissionModeDisabled?: boolean;
  readonly onPermissionModeSelect?: (mode: AgentPermissionMode) => void;
  readonly onHeightChange?: (height: number) => void;
  readonly onSend: (value: string) => void | Promise<void>;
  readonly onSteer?: (value: string) => void | Promise<void>;
  readonly steerLabel?: string;
  readonly steerDisabled?: boolean;
  readonly onStop?: () => void;
  readonly stopDisabled?: boolean;
};

export type ComposerTextEffect = {
  readonly id: number;
  readonly kind: "insert" | "delete";
  readonly text: string;
  readonly left: number;
  readonly top: number;
};

export type ComposerTextEffectDraft = Omit<ComposerTextEffect, "id">;

export type AgentComposerSubmitAction = "send" | "steer";
