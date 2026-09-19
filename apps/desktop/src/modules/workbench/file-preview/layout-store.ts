import { useSyncExternalStore } from "react";

import {
  defaultPreviewLayout,
  previewKindFromPath,
  type FilePreviewLayout
} from "./kinds";

const layouts = new Map<string, FilePreviewLayout>();
const listeners = new Set<() => void>();

const emit = (): void => {
  for (const listener of listeners) {
    listener();
  }
};

export const getFilePreviewLayout = (
  filePath: string,
  fallback: FilePreviewLayout
): FilePreviewLayout => layouts.get(filePath) ?? fallback;

export const setFilePreviewLayout = (
  filePath: string,
  layout: FilePreviewLayout
): void => {
  if (filePath.length === 0) {
    return;
  }
  if (layouts.get(filePath) === layout) {
    return;
  }
  layouts.set(filePath, layout);
  emit();
};

export const useFilePreviewLayout = (filePath: string): FilePreviewLayout => {
  const fallback = defaultPreviewLayout(previewKindFromPath(filePath));
  return useSyncExternalStore(
    (onStoreChange) => {
      listeners.add(onStoreChange);
      return () => {
        listeners.delete(onStoreChange);
      };
    },
    () => getFilePreviewLayout(filePath, fallback),
    () => getFilePreviewLayout(filePath, fallback)
  );
};
