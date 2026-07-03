import { useEffect, useRef } from "react";

import type {
  AgentRuntimeEvent,
  AgentSessionSnapshot,
  AgentToolActivity
} from "../../../shared/agent";
import type { LyraDesktopApi } from "../../../shared/desktop-bridge";
import {
  editFilePathFromTool,
  firstEditHunkLine,
  isEditToolActivity,
  previewContentFromEditTool
} from "../agent-session-view-model/tool-parsing/edit";
import {
  createAgentProjectTreeInstanceId,
  resolveAgentProjectTreeEditorInstanceId,
  type AgentProjectTreeModel
} from "../agent-project-tree";
import type { FileEditorModel } from "../file-editor";
import { readBrowserFollowModeEnabled } from "../workspace-tabs/tab-activation-coordinator";
import type { WorkbenchOpenFileFromManager } from "./use-workbench-file-actions";
import { reportWorkbenchError } from "@renderer/ui/components";
import { t } from "@workbench/i18n";

type UseAgentEditFollowParams = {
  readonly desktopApi: LyraDesktopApi | null;
  readonly activeSessionId: string | null;
  readonly fileEditorModel: FileEditorModel;
  readonly agentProjectTreeModel: AgentProjectTreeModel;
  readonly onOpenFileFromManager: WorkbenchOpenFileFromManager;
  readonly onRevealAgentProjectPath: (request: {
    readonly sessionId: string;
    readonly workingDir: string;
    readonly path: string;
    readonly location?: { readonly line: number; readonly endLine?: number };
    readonly mode: "open-file";
  }) => void;
};

type FollowedEdit = {
  readonly editorInstanceId: string;
  readonly filePath: string;
};

const EDITOR_PREVIEW_THROTTLE_MS = 80;

const normalizePath = (value: string): string =>
  value.trim().replace(/\\/g, "/").replace(/\/+$/u, "");

const isPathInsideProjectRoot = (filePath: string, rootPath: string): boolean => {
  const file = normalizePath(filePath);
  const root = normalizePath(rootPath);
  if (file.length === 0 || root.length === 0) return false;
  return file === root || file.startsWith(`${root}/`);
};

const resolveAbsolutePath = (filePath: string, workingDir?: string): string => {
  const trimmed = filePath.trim();
  if (trimmed.length === 0) return trimmed;
  if (/^(?:\/|~\/|[A-Za-z]:[\\/])/u.test(trimmed)) {
    return trimmed;
  }
  const root = workingDir?.trim().replace(/\\/g, "/").replace(/\/+$/u, "");
  if (root === undefined || root.length === 0) {
    return trimmed;
  }
  return `${root}/${trimmed.replace(/^\.{1,2}\//u, "")}`;
};

const shouldHandleToolEvent = (
  event: AgentRuntimeEvent,
  activeSessionId: string | null
): event is Extract<AgentRuntimeEvent, { kind: "toolStarted" | "toolUpdated" | "toolFinished" }> => {
  if (activeSessionId === null || activeSessionId.trim().length === 0) {
    return false;
  }
  if (event.kind !== "toolStarted" && event.kind !== "toolUpdated" && event.kind !== "toolFinished") {
    return false;
  }
  return event.sessionId === activeSessionId;
};

export const useAgentEditFollow = ({
  desktopApi,
  activeSessionId,
  fileEditorModel,
  agentProjectTreeModel,
  onOpenFileFromManager,
  onRevealAgentProjectPath
}: UseAgentEditFollowParams): void => {
  const sessionCacheRef = useRef<Map<string, AgentSessionSnapshot>>(new Map());
  const followedEditsRef = useRef<Map<string, FollowedEdit>>(new Map());
  const previewSyncRef = useRef<Map<string, { readonly content: string; readonly at: number }>>(
    new Map()
  );
  // Disk-original baseline per editor instance. The Rust side computes every
  // streaming diff against the on-disk file (new file ⇒ old ""), so the only
  // correct base to reconstruct against is that disk snapshot — never the live
  // editor buffer, which already holds our previous preview. Reconstructing
  // against the grown buffer re-prepended each full-content hunk every ~32ms
  // and snowballed the preview to tens of thousands of lines.
  const diskBaselineRef = useRef<Map<string, string>>(new Map());
  // Tracks editor instances that have already received a non-null streaming
  // preview this session. Once set, the editor content is ours, so we freeze
  // the disk baseline and stop re-capturing from state (which would otherwise
  // snapshot our own preview as the "disk" baseline).
  const previewAppliedRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    followedEditsRef.current.clear();
    previewSyncRef.current.clear();
    diskBaselineRef.current.clear();
    previewAppliedRef.current.clear();
  }, [activeSessionId]);

  useEffect(() => {
    if (desktopApi?.agent === undefined) {
      return;
    }

    const openFollowedEditor = (
      session: AgentSessionSnapshot | undefined,
      tool: AgentToolActivity,
      location?: { readonly line: number; readonly endLine?: number }
    ): string | null => {
      const filePath = resolveAbsolutePath(editFilePathFromTool(tool), session?.workingDir);
      if (filePath.length === 0) {
        return null;
      }

      const existing = followedEditsRef.current.get(tool.id);
      if (existing !== undefined && existing.filePath === filePath) {
        return existing.editorInstanceId;
      }

      const useProjectTree =
        session?.projectBound === true &&
        session.workingDirIsHome !== true &&
        session.workingDir.trim().length > 0 &&
        isPathInsideProjectRoot(filePath, session.workingDir);

      if (useProjectTree) {
        const treeInstanceId = createAgentProjectTreeInstanceId(session.id);
        onRevealAgentProjectPath({
          sessionId: session.id,
          workingDir: session.workingDir,
          path: filePath,
          mode: "open-file",
          ...(location === undefined ? {} : { location })
        });
        const editorInstanceId = resolveAgentProjectTreeEditorInstanceId(
          treeInstanceId,
          agentProjectTreeModel.getState(treeInstanceId)?.editorInstanceId
        );
        fileEditorModel.ensureInstance(editorInstanceId, {
          filePath,
          fileSessionId: `agent-project-tree:${session.id}`
        });
        followedEditsRef.current.set(tool.id, { editorInstanceId, filePath });
        return editorInstanceId;
      }

      const editorInstanceId = onOpenFileFromManager(filePath, location, {
        allowMissing: true
      });
      if (editorInstanceId === null) {
        return null;
      }
      followedEditsRef.current.set(tool.id, { editorInstanceId, filePath });
      return editorInstanceId;
    };

    const syncPreviewToEditor = (
      editorInstanceId: string,
      tool: AgentToolActivity
    ): void => {
      const state = fileEditorModel.getState(editorInstanceId);
      // Re-capture the disk baseline from a genuine hydration (readFile result)
      // as long as we have not yet applied a streaming preview for this
      // instance. Once a preview is applied, the editor content is ours, so we
      // freeze the baseline to stop the streaming diff (always computed against
      // disk) from being re-applied onto the already-mutated buffer.
      if (
        !previewAppliedRef.current.has(editorInstanceId)
        && state !== null
        && state.isHydrated
        && state.content === state.lastSavedContent
      ) {
        diskBaselineRef.current.set(editorInstanceId, state.lastSavedContent);
      }
      const before = diskBaselineRef.current.get(editorInstanceId) ?? "";
      const preview = previewContentFromEditTool(tool, before);
      if (preview === null) {
        if (tool.status === "running" && state !== null && !state.isHydrated) {
          fileEditorModel.applyExternalContent(editorInstanceId, before, {
            markHydrated: true,
            readOnly: true
          });
        }
        return;
      }
      const now = Date.now();
      const lastSync = previewSyncRef.current.get(tool.id);
      if (
        tool.status === "running" &&
        lastSync !== undefined &&
        now - lastSync.at < EDITOR_PREVIEW_THROTTLE_MS
      ) {
        return;
      }
      previewSyncRef.current.set(tool.id, { content: preview, at: now });
      fileEditorModel.applyExternalContent(editorInstanceId, preview, {
        markHydrated: true,
        readOnly: tool.status === "running"
      });
      // The editor buffer now holds our preview; freeze the disk baseline so
      // subsequent streaming frames keep reconstructing against disk (not the
      // grown buffer).
      previewAppliedRef.current.add(editorInstanceId);
      const line = firstEditHunkLine(tool);
      if (line !== undefined) {
        fileEditorModel.revealLocation(editorInstanceId, { line });
      }
    };

    const handleToolEvent = (event: Extract<AgentRuntimeEvent, { kind: "toolStarted" | "toolUpdated" | "toolFinished" }>) => {
      if (!readBrowserFollowModeEnabled()) {
        return;
      }
      const tool = event.tool;
      if (!isEditToolActivity(tool)) {
        return;
      }

      const session = sessionCacheRef.current.get(event.sessionId);
      const line = firstEditHunkLine(tool);
      const location = line === undefined ? undefined : { line };

      if (event.kind === "toolFinished") {
        previewSyncRef.current.delete(tool.id);
        const followed = followedEditsRef.current.get(tool.id);
        followedEditsRef.current.delete(tool.id);
        if (followed === undefined) {
          return;
        }
        // The real write has landed; reopen from disk and reset the per-instance
        // preview bookkeeping so a later edit re-captures a fresh disk baseline.
        diskBaselineRef.current.delete(followed.editorInstanceId);
        previewAppliedRef.current.delete(followed.editorInstanceId);
        void fileEditorModel.openFile(followed.editorInstanceId, followed.filePath).catch((error: unknown) => {
          reportWorkbenchError(error, t("appStatus.openFileFailed"));
        });
        if (location !== undefined) {
          fileEditorModel.revealLocation(followed.editorInstanceId, location);
        }
        return;
      }

      const editorInstanceId = openFollowedEditor(session, tool, location);
      if (editorInstanceId === null) {
        return;
      }
      syncPreviewToEditor(editorInstanceId, tool);
    };

    const unsubscribe = desktopApi.agent.onEvent((event) => {
      if (event.kind === "sessionSnapshot") {
        sessionCacheRef.current.set(event.snapshot.id, event.snapshot);
        return;
      }
      if (!shouldHandleToolEvent(event, activeSessionId)) {
        return;
      }
      handleToolEvent(event);
    });

    void desktopApi.agent.readSession({ sessionId: activeSessionId })
      .then((snapshot) => {
        sessionCacheRef.current.set(snapshot.id, snapshot);
      })
      .catch(() => undefined);

    return () => {
      unsubscribe();
    };
  }, [
    activeSessionId,
    agentProjectTreeModel,
    desktopApi,
    fileEditorModel,
    onOpenFileFromManager,
    onRevealAgentProjectPath
  ]);
};
