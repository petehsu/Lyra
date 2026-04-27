import { useCallback, useEffect, useMemo, useState } from "react";

import type { FileEditorChangeReviewItem } from "../file-editor";
import type { LyraDesktopApi } from "../../../shared/desktop-bridge";
import type { WorkbenchOpenFileFromManager } from "./use-workbench-file-actions";

type UseWorkbenchEditorReviewModelParams = {
  readonly desktopApi: LyraDesktopApi | null;
  readonly onOpenFileFromManager: WorkbenchOpenFileFromManager;
};

export type WorkbenchEditorReviewModel = {
  readonly editorReviewItems: readonly FileEditorChangeReviewItem[];
  readonly activeEditorReviewIndex: number;
  readonly resolveActiveEditorWorkItem: (filePath: string) => FileEditorChangeReviewItem | undefined;
  readonly onGoToPreviousEditorWorkItem: () => void;
  readonly onGoToNextEditorWorkItem: () => void;
  readonly onAcceptAllEditorWorkItems: () => void;
  readonly onAcceptEditorWorkItem: (item: FileEditorChangeReviewItem) => void;
  readonly onRejectEditorWorkItem: (item: FileEditorChangeReviewItem) => void;
  readonly onUndoEditorWorkItem: (item: FileEditorChangeReviewItem) => void;
  readonly recordCompletedEditorWorkItem: (item: FileEditorChangeReviewItem) => void;
};

export const useWorkbenchEditorReviewModel = ({
  desktopApi,
  onOpenFileFromManager
}: UseWorkbenchEditorReviewModelParams): WorkbenchEditorReviewModel => {
  const [editorReviewItems, setEditorReviewItems] = useState<readonly FileEditorChangeReviewItem[]>([]);
  const [activeEditorReviewId, setActiveEditorReviewId] = useState<string | null>(null);

  const activeEditorReviewIndex = useMemo(
    () => editorReviewItems.findIndex((item) => item.id === activeEditorReviewId),
    [activeEditorReviewId, editorReviewItems]
  );
  const activeEditorReviewItem = useMemo(
    () =>
      activeEditorReviewIndex === -1
        ? null
        : (editorReviewItems[activeEditorReviewIndex] ?? null),
    [activeEditorReviewIndex, editorReviewItems]
  );

  useEffect(() => {
    if (editorReviewItems.length === 0) {
      if (activeEditorReviewId !== null) {
        setActiveEditorReviewId(null);
      }
      return;
    }
    if (
      activeEditorReviewId === null ||
      editorReviewItems.some((item) => item.id === activeEditorReviewId) === false
    ) {
      setActiveEditorReviewId(editorReviewItems[editorReviewItems.length - 1]!.id);
    }
  }, [activeEditorReviewId, editorReviewItems]);

  const focusEditorReviewItem = useCallback((item: FileEditorChangeReviewItem): void => {
    setActiveEditorReviewId(item.id);
    onOpenFileFromManager(
      item.filePath,
      item.firstChangedLine === undefined ? undefined : { line: item.firstChangedLine },
      { forceReloadIfOpen: true }
    );
  }, [onOpenFileFromManager]);

  const onGoToPreviousEditorWorkItem = useCallback((): void => {
    if (editorReviewItems.length === 0 || activeEditorReviewIndex <= 0) {
      return;
    }
    const next = editorReviewItems[activeEditorReviewIndex - 1];
    if (next === undefined) {
      return;
    }
    focusEditorReviewItem(next);
  }, [activeEditorReviewIndex, editorReviewItems, focusEditorReviewItem]);

  const onGoToNextEditorWorkItem = useCallback((): void => {
    if (
      editorReviewItems.length === 0 ||
      activeEditorReviewIndex < 0 ||
      activeEditorReviewIndex >= editorReviewItems.length - 1
    ) {
      return;
    }
    const next = editorReviewItems[activeEditorReviewIndex + 1];
    if (next === undefined) {
      return;
    }
    focusEditorReviewItem(next);
  }, [activeEditorReviewIndex, editorReviewItems, focusEditorReviewItem]);

  const onAcceptEditorWorkItem = useCallback((item: FileEditorChangeReviewItem): void => {
    setEditorReviewItems((current) =>
      current.map((entry) =>
        entry.id === item.id
          ? { ...entry, decision: "accepted" as const }
          : entry
      )
    );
  }, []);

  const onUndoEditorWorkItem = useCallback((item: FileEditorChangeReviewItem): void => {
    setEditorReviewItems((current) =>
      current.map((entry) => {
        if (entry.id !== item.id) {
          return entry;
        }
        const nextEntry = { ...entry };
        delete nextEntry.decision;
        return nextEntry;
      })
    );
  }, []);

  const onRejectEditorWorkItem = useCallback((item: FileEditorChangeReviewItem): void => {
    setEditorReviewItems((current) =>
      current.map((entry) =>
        entry.id === item.id
          ? { ...entry, decision: "rejected" as const }
          : entry
      )
    );

    if (desktopApi === null) {
      return;
    }

    void (async () => {
      try {
        if (item.created) {
          await desktopApi.files.moveToTrash({ paths: [item.filePath] });
        } else {
          await desktopApi.files.writeTextFile({
            path: item.filePath,
            content: item.baselineContent ?? "",
            encoding: "utf8"
          });
        }
      } catch (_error) {
        // Ignore rollback errors; keep the review decision visible to the user.
      } finally {
        if (item.created) {
          return;
        }
        onOpenFileFromManager(
          item.filePath,
          item.firstChangedLine === undefined ? undefined : { line: item.firstChangedLine },
          { forceReloadIfOpen: true }
        );
      }
    })();
  }, [desktopApi, onOpenFileFromManager]);

  const onAcceptAllEditorWorkItems = useCallback((): void => {
    setEditorReviewItems((current) =>
      current.map((entry) =>
        entry.status === "completed"
          ? { ...entry, decision: "accepted" as const }
          : entry
      )
    );
  }, []);

  const resolveActiveEditorWorkItem = useCallback(
    (filePath: string): FileEditorChangeReviewItem | undefined => {
      if (activeEditorReviewItem === null) {
        return undefined;
      }
      return activeEditorReviewItem.filePath === filePath
        ? activeEditorReviewItem
        : undefined;
    },
    [activeEditorReviewItem]
  );

  const recordCompletedEditorWorkItem = useCallback((item: FileEditorChangeReviewItem): void => {
    setEditorReviewItems((current) => {
      const existingIndex = current.findIndex((entry) => entry.id === item.id);
      if (existingIndex === -1) {
        return [...current, item];
      }
      const next = [...current];
      next[existingIndex] = item;
      return next;
    });
    setActiveEditorReviewId(item.id);
  }, []);

  return useMemo(
    () => ({
      editorReviewItems,
      activeEditorReviewIndex,
      resolveActiveEditorWorkItem,
      onGoToPreviousEditorWorkItem,
      onGoToNextEditorWorkItem,
      onAcceptAllEditorWorkItems,
      onAcceptEditorWorkItem,
      onRejectEditorWorkItem,
      onUndoEditorWorkItem,
      recordCompletedEditorWorkItem
    }),
    [
      activeEditorReviewIndex,
      editorReviewItems,
      onAcceptAllEditorWorkItems,
      onAcceptEditorWorkItem,
      onGoToNextEditorWorkItem,
      onGoToPreviousEditorWorkItem,
      onRejectEditorWorkItem,
      onUndoEditorWorkItem,
      recordCompletedEditorWorkItem,
      resolveActiveEditorWorkItem
    ]
  );
};
