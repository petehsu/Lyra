import { useEffect, useMemo } from "react";

import { AiHistorySurfaceView } from "./surface-view";
import type { AiHistorySurfaceProps } from "./types";
import { useAiHistoryRuntime } from "./use-ai-history-runtime";
import { useWorkbenchTitlebarContribution } from "../shell/titlebar-context";

export const AiHistorySurface = (surfaceProps: AiHistorySurfaceProps) => {
  const runtime = useAiHistoryRuntime({
    desktopApi: surfaceProps.desktopApi,
    openDialog: surfaceProps.openDialog,
    deleteArchivedConversationTitle: surfaceProps.deleteArchivedConversationTitle,
    deleteArchivedConversationDescription: surfaceProps.deleteArchivedConversationDescription,
    deleteArchivedConversationConfirm: surfaceProps.deleteArchivedConversationConfirm,
    deleteArchivedConversationCancel: surfaceProps.deleteArchivedConversationCancel,
    threadPreviewEmptyLabel: surfaceProps.threadPreviewEmptyLabel
  });
  const totalThreadCount = runtime.activeThreads.length + runtime.archivedThreads.length;
  const selectHistoryScope = runtime.actions.selectScope;

  useEffect(() => {
    if (
      runtime.lyraAvailable === false ||
      runtime.hasLoadedThreads === false ||
      runtime.isLoading ||
      totalThreadCount > 0
    ) {
      return;
    }
    surfaceProps.onHistoryEmptied?.();
  }, [
    runtime.hasLoadedThreads,
    runtime.isLoading,
    runtime.lyraAvailable,
    surfaceProps.onHistoryEmptied,
    totalThreadCount
  ]);

  const titlebarContribution = useMemo(
    () => ({
      ariaLabel: surfaceProps.title,
      content: (
        <div className="lyra-titlebar-context-controls">
          {([
            ["global", surfaceProps.scopeGlobalLabel, runtime.activeThreads.length],
            ["project", surfaceProps.scopeProjectLabel, runtime.activeProjectGroupCount],
            ["archivedGlobal", surfaceProps.archivedConversationLabel, runtime.archivedThreads.length],
            ["archivedProject", surfaceProps.archivedProjectLabel, runtime.archivedProjectGroupCount]
          ] as const).map(([scope, label, count]) => (
            <button
              key={scope}
              type="button"
              role="tab"
              aria-selected={runtime.scope === scope}
              className={
                runtime.scope === scope
                  ? "lyra-titlebar-context-text-button lyra-titlebar-context-button-active"
                  : "lyra-titlebar-context-text-button"
              }
              onClick={() => {
                selectHistoryScope(scope);
              }}
            >
              {label}
              <span>{count}</span>
            </button>
          ))}
        </div>
      )
    }),
    [
      runtime.activeProjectGroupCount,
      runtime.activeThreads.length,
      runtime.archivedProjectGroupCount,
      runtime.archivedThreads.length,
      runtime.scope,
      selectHistoryScope,
      surfaceProps.archivedConversationLabel,
      surfaceProps.archivedProjectLabel,
      surfaceProps.scopeGlobalLabel,
      surfaceProps.scopeProjectLabel,
      surfaceProps.title
    ]
  );
  useWorkbenchTitlebarContribution(titlebarContribution);

  return (
    <AiHistorySurfaceView
      surfaceProps={surfaceProps}
      runtime={runtime}
    />
  );
};
