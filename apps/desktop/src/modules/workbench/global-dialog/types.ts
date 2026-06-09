export type GlobalDialogActionTone = "default" | "primary" | "danger";

export type GlobalDialogSourceTone = "default" | "accent" | "success" | "danger";

export type GlobalDialogSource = {
  readonly title: string;
  readonly subtitle?: string;
  readonly iconLabel?: string;
  readonly iconTone?: GlobalDialogSourceTone;
};

export type GlobalDialogCopyItem = {
  readonly id: string;
  readonly label: string;
  readonly value: string;
};

export type GlobalDialogInput = {
  readonly id: string;
  readonly label: string;
  readonly type?: "text" | "password";
  readonly value?: string;
  readonly placeholder?: string;
  readonly submitActionId?: string;
};

export type GlobalDialogActionContext = {
  readonly inputValue?: string;
};

export type GlobalDialogAction = {
  readonly id: string;
  readonly label: string;
  readonly tone?: GlobalDialogActionTone;
  readonly disabled?: boolean;
  readonly closeOnSelect?: boolean;
  readonly onSelect?: (context: GlobalDialogActionContext) => void | Promise<void>;
};

export type GlobalDialogOpenRequest = {
  readonly title: string;
  readonly description?: string;
  readonly source?: GlobalDialogSource;
  readonly input?: GlobalDialogInput;
  readonly copyItems?: readonly GlobalDialogCopyItem[];
  readonly copyActionLabel?: string;
  readonly copiedActionLabel?: string;
  readonly actions?: readonly GlobalDialogAction[];
};

export type GlobalDialogState = {
  readonly isOpen: boolean;
  readonly title: string;
  readonly description?: string;
  readonly source?: GlobalDialogSource;
  readonly input?: GlobalDialogInput;
  readonly copyItems: readonly GlobalDialogCopyItem[];
  readonly copyActionLabel: string;
  readonly copiedActionLabel: string;
  readonly actions: readonly GlobalDialogAction[];
};

export type GlobalDialogModel = {
  readonly state: GlobalDialogState;
  readonly openDialog: (request: GlobalDialogOpenRequest) => void;
  readonly closeDialog: () => void;
  readonly selectAction: (actionId: string, context?: GlobalDialogActionContext) => void;
};

export type GlobalDialogDefaults = {
  readonly copyActionLabel: string;
  readonly copiedActionLabel: string;
};
