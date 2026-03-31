import { useCallback, useState } from "react";

import type {
  GlobalDialogAction,
  GlobalDialogCopyItem,
  GlobalDialogSource,
  GlobalDialogModel,
  GlobalDialogOpenRequest,
  GlobalDialogState
} from "./types";

const MAX_DIALOG_ACTIONS = 3;
const DEFAULT_COPY_ACTION_LABEL = "Copy";
const DEFAULT_COPIED_ACTION_LABEL = "Copied";

const CLOSED_STATE: GlobalDialogState = {
  isOpen: false,
  title: "",
  copyItems: [],
  copyActionLabel: DEFAULT_COPY_ACTION_LABEL,
  copiedActionLabel: DEFAULT_COPIED_ACTION_LABEL,
  actions: []
};

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

export const useGlobalDialogModel = (): GlobalDialogModel => {
  const [state, setState] = useState<GlobalDialogState>(CLOSED_STATE);

  const openDialog = useCallback((request: GlobalDialogOpenRequest): void => {
    const title = normalizeText(request.title, "title");
    const description = normalizeOptionalText(request.description);
    const source = normalizeSource(request.source);
    const copyItems = normalizeCopyItems(request.copyItems);
    const copyActionLabel = normalizeOptionalText(request.copyActionLabel)
      ?? DEFAULT_COPY_ACTION_LABEL;
    const copiedActionLabel = normalizeOptionalText(request.copiedActionLabel)
      ?? DEFAULT_COPIED_ACTION_LABEL;
    const actions = normalizeActions(request.actions);

    setState({
      isOpen: true,
      title,
      ...(description === undefined || description.length === 0
        ? {}
        : { description }),
      ...(source === undefined ? {} : { source }),
      copyItems,
      copyActionLabel,
      copiedActionLabel,
      actions
    });
  }, []);

  const closeDialog = useCallback((): void => {
    setState(CLOSED_STATE);
  }, []);

  const selectAction = useCallback((actionId: string): void => {
    const target = state.actions.find((action) => action.id === actionId);
    if (target === undefined || target.disabled) {
      return;
    }

    if (target.closeOnSelect === false) {
      target.onSelect?.();
      return;
    }

    try {
      target.onSelect?.();
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
