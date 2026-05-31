import { useCallback, useState } from "react";

import type {
  GlobalDialogAction,
  GlobalDialogActionContext,
  GlobalDialogCopyItem,
  GlobalDialogDefaults,
  GlobalDialogInput,
  GlobalDialogSource,
  GlobalDialogModel,
  GlobalDialogOpenRequest,
  GlobalDialogState
} from "./types";

const MAX_DIALOG_ACTIONS = 3;
const DEFAULT_COPY_ACTION_LABEL = "Copy";
const DEFAULT_COPIED_ACTION_LABEL = "Copied";

const FALLBACK_DEFAULTS: GlobalDialogDefaults = {
  copyActionLabel: DEFAULT_COPY_ACTION_LABEL,
  copiedActionLabel: DEFAULT_COPIED_ACTION_LABEL
};

const createClosedState = (defaults: GlobalDialogDefaults): GlobalDialogState => ({
  isOpen: false,
  title: "",
  copyItems: [],
  copyActionLabel: defaults.copyActionLabel,
  copiedActionLabel: defaults.copiedActionLabel,
  actions: []
});

const normalizeText = (value: string, field: string): string => {
  const normalized = value.trim();
  if (normalized.length === 0) {
    throw new Error(`${field} is required`);
  }
  return normalized;
};

const normalizeOptionalText = (value: string | undefined): string | undefined => {
  if (value === undefined) {
    return undefined;
  }
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : undefined;
};

const normalizeSource = (
  source: GlobalDialogSource | undefined
): GlobalDialogSource | undefined => {
  if (source === undefined) {
    return undefined;
  }

  const title = normalizeText(source.title, "source.title");
  const subtitle = normalizeOptionalText(source.subtitle);
  const iconLabel = normalizeOptionalText(source.iconLabel);

  return {
    title,
    ...(subtitle === undefined ? {} : { subtitle }),
    ...(iconLabel === undefined ? {} : { iconLabel }),
    ...(source.iconTone === undefined ? {} : { iconTone: source.iconTone })
  };
};

const normalizeInput = (
  input: GlobalDialogInput | undefined
): GlobalDialogInput | undefined => {
  if (input === undefined) {
    return undefined;
  }

  const id = normalizeText(input.id, "input.id");
  const label = normalizeText(input.label, "input.label");
  const placeholder = normalizeOptionalText(input.placeholder);
  const submitActionId = normalizeOptionalText(input.submitActionId);

  return {
    id,
    label,
    value: input.value ?? "",
    ...(placeholder === undefined ? {} : { placeholder }),
    ...(submitActionId === undefined ? {} : { submitActionId })
  };
};

const normalizeCopyItems = (
  copyItems: readonly GlobalDialogCopyItem[] | undefined
): readonly GlobalDialogCopyItem[] => {
  if (copyItems === undefined) {
    return [];
  }

  return copyItems.map((item, index) => ({
    id: normalizeText(item.id, `copyItems[${index}].id`),
    label: normalizeText(item.label, `copyItems[${index}].label`),
    value: normalizeText(item.value, `copyItems[${index}].value`)
  }));
};

const normalizeActions = (
  actions: readonly GlobalDialogAction[] | undefined
): readonly GlobalDialogAction[] => {
  if (actions === undefined) {
    return [];
  }
  if (actions.length > MAX_DIALOG_ACTIONS) {
    throw new Error(`global dialog supports at most ${MAX_DIALOG_ACTIONS} actions`);
  }

  return actions.map((action, index) => ({
    ...action,
    id: normalizeText(action.id, `actions[${index}].id`),
    label: normalizeText(action.label, `actions[${index}].label`)
  }));
};

export const useGlobalDialogModel = (
  defaults: GlobalDialogDefaults = FALLBACK_DEFAULTS
): GlobalDialogModel => {
  const [state, setState] = useState<GlobalDialogState>(() => createClosedState(defaults));

  const openDialog = useCallback((request: GlobalDialogOpenRequest): void => {
    const title = normalizeText(request.title, "title");
    const description = normalizeOptionalText(request.description);
    const source = normalizeSource(request.source);
    const input = normalizeInput(request.input);
    const copyItems = normalizeCopyItems(request.copyItems);
    const copyActionLabel = normalizeOptionalText(request.copyActionLabel)
      ?? defaults.copyActionLabel;
    const copiedActionLabel = normalizeOptionalText(request.copiedActionLabel)
      ?? defaults.copiedActionLabel;
    const actions = normalizeActions(request.actions);

    setState({
      isOpen: true,
      title,
      ...(description === undefined || description.length === 0
        ? {}
        : { description }),
      ...(source === undefined ? {} : { source }),
      ...(input === undefined ? {} : { input }),
      copyItems,
      copyActionLabel,
      copiedActionLabel,
      actions
    });
  }, [defaults.copiedActionLabel, defaults.copyActionLabel]);

  const closeDialog = useCallback((): void => {
    setState(createClosedState(defaults));
  }, [defaults]);

  const selectAction = useCallback((
    actionId: string,
    context: GlobalDialogActionContext = {}
  ): void => {
    const target = state.actions.find((action) => action.id === actionId);
    if (target === undefined || target.disabled) {
      return;
    }

    if (target.closeOnSelect === false) {
      void target.onSelect?.(context);
      return;
    }

    try {
      void target.onSelect?.(context);
    } finally {
      closeDialog();
    }
  }, [closeDialog, state.actions]);

  return {
    state,
    openDialog,
    closeDialog,
    selectAction
  };
};
