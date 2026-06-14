import type * as Monaco from "monaco-editor/esm/vs/editor/editor.api";

import type { FileEditorAppState } from "./types";

type StoredTextModel = {
  readonly instanceId: string;
  readonly model: Monaco.editor.ITextModel;
};

const textModels = new Map<string, StoredTextModel>();
const disposedTextModels = new WeakSet<Monaco.editor.ITextModel>();

const shouldRetainTextModel = (state: FileEditorAppState): boolean =>
  state.isHydrated &&
  state.status !== "unsupported" &&
  state.status !== "error";

export const isFileEditorTextModelDisposed = (
  model: Monaco.editor.ITextModel | null | undefined
): boolean => {
  if (model === null || model === undefined) {
    return true;
  }
  const maybeDisposed = model as Monaco.editor.ITextModel & {
    readonly isDisposed?: () => boolean;
  };
  return disposedTextModels.has(model) || maybeDisposed.isDisposed?.() === true;
};

const trackTextModelDisposal = (
  model: Monaco.editor.ITextModel
): Monaco.editor.ITextModel => {
  const dispose = model.dispose.bind(model);
  model.dispose = () => {
    disposedTextModels.add(model);
    dispose();
  };
  return model;
};

export const syncFileEditorTextModel = (
  monaco: typeof Monaco,
  model: Monaco.editor.ITextModel,
  state: FileEditorAppState
): void => {
  if (isFileEditorTextModelDisposed(model)) {
    return;
  }
  if (model.getLanguageId() !== state.languageId) {
    monaco.editor.setModelLanguage(model, state.languageId);
  }
  if (model.getValue() !== state.content) {
    model.setValue(state.content);
  }
};

export const acquireFileEditorTextModel = (
  monaco: typeof Monaco,
  state: FileEditorAppState
): Monaco.editor.ITextModel => {
  const existing = textModels.get(state.instanceId);
  if (existing !== undefined) {
    if (isFileEditorTextModelDisposed(existing.model)) {
      textModels.delete(state.instanceId);
    } else {
      syncFileEditorTextModel(monaco, existing.model, state);
      return existing.model;
    }
  }

  const model = trackTextModelDisposal(
    monaco.editor.createModel(state.content, state.languageId)
  );
  textModels.set(state.instanceId, {
    instanceId: state.instanceId,
    model
  });
  return model;
};

export const disposeFileEditorTextModel = (instanceId: string): void => {
  const entry = textModels.get(instanceId);
  if (entry === undefined) {
    return;
  }
  textModels.delete(instanceId);
  if (!isFileEditorTextModelDisposed(entry.model)) {
    entry.model.dispose();
  }
};

export const disposeInactiveFileEditorTextModels = (
  states: Record<string, FileEditorAppState>
): void => {
  const retainedInstanceIds = new Set(
    Object.values(states)
      .filter(shouldRetainTextModel)
      .map((state) => state.instanceId)
  );
  for (const instanceId of textModels.keys()) {
    if (retainedInstanceIds.has(instanceId) === false) {
      disposeFileEditorTextModel(instanceId);
    }
  }
};

export const readFileEditorTextModelCountForTests = (): number => textModels.size;
