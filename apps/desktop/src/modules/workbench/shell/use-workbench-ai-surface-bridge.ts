import { useCallback, useMemo, useRef } from "react";

import type {
  AiPanelSurfaceProps,
  AiPanelWriteStreamEvent
} from "../ai-panel";
import type {
  FileEditorChangeReviewItem,
  FileEditorModel
} from "../file-editor";
import type { WorkbenchOpenFileFromManager } from "./use-workbench-file-actions";

export type WorkbenchSidebarAiSurfaceProps = Omit<AiPanelSurfaceProps, "variant">;

type WriteStreamEntry = {
  instanceId: string;
  toolCallId: string;
  filePath: string;
  turnId: string;
  toolName: string;
  startedAt: number;
  baselineContent?: string;
  created?: boolean;
  content: string;
  bytesWritten?: number;
  bytesTotal?: number;
  chunkQueue: string[];
  paceTimerId: ReturnType<typeof setInterval> | null;
  finished: boolean;
  firstChangedLine?: number;
  addedLines?: number;
  removedLines?: number;
  completedAt?: number;
};

type UseWorkbenchAiSurfaceBridgeParams = {
  readonly sidebarAiSurfaceProps: WorkbenchSidebarAiSurfaceProps | null;
  readonly fileEditorModel: FileEditorModel;
  readonly onOpenFileFromManager: WorkbenchOpenFileFromManager;
  readonly recordCompletedEditorWorkItem: (item: FileEditorChangeReviewItem) => void;
};

export const useWorkbenchAiSurfaceBridge = ({
  sidebarAiSurfaceProps,
  fileEditorModel,
  onOpenFileFromManager,
  recordCompletedEditorWorkItem
}: UseWorkbenchAiSurfaceBridgeParams): WorkbenchSidebarAiSurfaceProps | null => {
  const writeStreamByToolCallRef = useRef<Record<string, WriteStreamEntry>>({});

  const onAiWriteStreamEvent = useCallback((event: AiPanelWriteStreamEvent): void => {
    const applyContent = (entry: WriteStreamEntry) => {
      fileEditorModel.applyExternalContent(entry.instanceId, entry.content, {
        markHydrated: true
      });
      const lineCount = entry.content.split("\n").length;
      fileEditorModel.revealLocation(entry.instanceId, { line: Math.max(0, lineCount - 1) });
    };

    const runPostCompletion = (entry: WriteStreamEntry) => {
      if (entry.paceTimerId !== null) {
        clearInterval(entry.paceTimerId);
        entry.paceTimerId = null;
      }

      onOpenFileFromManager(
        entry.filePath,
        entry.firstChangedLine === undefined ? undefined : { line: entry.firstChangedLine },
        { forceReloadIfOpen: true }
      );

      recordCompletedEditorWorkItem({
        id: `editor-work-${entry.toolCallId}`,
        status: "completed",
        filePath: entry.filePath,
        created: entry.created,
        addedLines: entry.addedLines ?? 0,
        removedLines: entry.removedLines ?? 0,
        createdAt: entry.completedAt ?? entry.startedAt,
        ...(entry.firstChangedLine === undefined
          ? {}
          : { firstChangedLine: entry.firstChangedLine }),
        ...(entry.baselineContent !== undefined
          ? { baselineContent: entry.baselineContent }
          : {})
      });

      delete writeStreamByToolCallRef.current[entry.toolCallId];
    };

    const ensurePaceTimer = (entry: WriteStreamEntry) => {
      if (entry.paceTimerId !== null) {
        return;
      }
      entry.paceTimerId = setInterval(() => {
        if (entry.chunkQueue.length === 0) {
          if (entry.finished) {
            runPostCompletion(entry);
          }
          return;
        }
        const chunk = entry.chunkQueue.shift()!;
        entry.content += chunk;
        applyContent(entry);
      }, 60);
    };

    const ensureStreamEntry = (): WriteStreamEntry | null => {
      const existing = writeStreamByToolCallRef.current[event.toolCallId];
      if (existing !== undefined) {
        return existing;
      }
      if (event.kind !== "finished" && event.reveal === false) {
        return null;
      }
      const instanceId = onOpenFileFromManager(event.filePath, undefined, { allowMissing: true });
      if (instanceId === null) {
        return null;
      }
      const createdEntry: WriteStreamEntry = {
        instanceId,
        toolCallId: event.toolCallId,
        filePath: event.filePath,
        turnId: event.turnId,
        toolName: event.toolName,
        startedAt: event.timestamp,
        content: "",
        chunkQueue: [],
        paceTimerId: null,
        finished: false
      };
      writeStreamByToolCallRef.current[event.toolCallId] = createdEntry;
      return createdEntry;
    };

    if (event.kind === "started") {
      const entry = ensureStreamEntry();
      if (entry === null) {
        return;
      }
      if (event.baselineContent !== undefined) {
        entry.baselineContent = event.baselineContent;
        entry.content = event.baselineContent;
        fileEditorModel.applyExternalContent(entry.instanceId, entry.content, {
          markHydrated: true
        });
      }
      if (typeof event.created === "boolean") {
        entry.created = event.created;
      }
      return;
    }

    if (event.kind === "delta") {
      const entry = ensureStreamEntry();
      if (entry === null) {
        return;
      }
      entry.chunkQueue.push(event.chunkText);
      if (typeof event.firstChangedLine === "number") {
        entry.firstChangedLine = event.firstChangedLine;
      }
      if (typeof event.bytesWritten === "number") {
        entry.bytesWritten = event.bytesWritten;
      }
      if (typeof event.bytesTotal === "number") {
        entry.bytesTotal = event.bytesTotal;
      }
      ensurePaceTimer(entry);
      return;
    }

    const entry = ensureStreamEntry();
    if (entry === null) {
      return;
    }

    entry.finished = true;
    entry.completedAt = event.timestamp;
    if (event.baselineContent !== undefined) {
      entry.baselineContent = event.baselineContent;
    }
    if (typeof event.created === "boolean") {
      entry.created = event.created;
    }
    if (typeof event.firstChangedLine === "number") {
      entry.firstChangedLine = event.firstChangedLine;
    }
    if (typeof event.addedLines === "number") {
      entry.addedLines = event.addedLines;
    }
    if (typeof event.removedLines === "number") {
      entry.removedLines = event.removedLines;
    }

    if (event.status === "failed") {
      if (entry.paceTimerId !== null) {
        clearInterval(entry.paceTimerId);
        entry.paceTimerId = null;
      }
      while (entry.chunkQueue.length > 0) {
        entry.content += entry.chunkQueue.shift()!;
      }
      applyContent(entry);
      delete writeStreamByToolCallRef.current[event.toolCallId];
      return;
    }

    if (entry.paceTimerId === null && entry.chunkQueue.length === 0) {
      runPostCompletion(entry);
    }
  }, [fileEditorModel, onOpenFileFromManager, recordCompletedEditorWorkItem]);

  return useMemo(
    () =>
      sidebarAiSurfaceProps === null
        ? null
        : {
            ...sidebarAiSurfaceProps,
            onWriteStreamEvent: onAiWriteStreamEvent,
            onOpenFilePath: (filePath, options) => {
              onOpenFileFromManager(filePath, options?.location, options);
            }
          },
    [onAiWriteStreamEvent, onOpenFileFromManager, sidebarAiSurfaceProps]
  );
};
