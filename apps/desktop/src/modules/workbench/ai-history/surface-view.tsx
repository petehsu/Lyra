import {
  Archive,
  ArrowLeft,
  Check,
  ExternalLink,
  FolderOpen,
  Pencil,
  Plus,
  Trash2,
  X
} from "lucide-react";

import { AiPanelRichContent } from "../ai-panel/rich-content";
import {
  StatusBadge,
  StatusEmptyState,
  StatusIndicator
} from "../ai-panel/status-primitives";
import { resolveAssistantDisplayContent } from "../ai-panel/view-helpers";
import {
  buildPreviewDisplayMessages,
  createPreviewThreadSummary,
  formatSessionTime,
  resolveThreadPreviewText,
  resolveThreadRowTone,
  type HistoryScope,
  type LyraThreadSummary
} from "./model";
import type { AiHistorySurfaceProps } from "./types";
import type { AiHistoryRuntime } from "./use-ai-history-runtime";

type AiHistorySurfaceViewProps = {
  readonly surfaceProps: AiHistorySurfaceProps;
  readonly runtime: AiHistoryRuntime;
};

type AiHistoryLabels = {
  readonly title: string;
  readonly newConversationLabel: string;
  readonly openConversationLabel: string;
  readonly renameConversationLabel: string;
  readonly deleteConversationLabel: string;
  readonly archiveConversationLabel: string;
  readonly archivedConversationLabel: string;
  readonly archivedProjectLabel: string;
  readonly deleteArchivedConversationCancel: string;
  readonly loadingSessionsLabel: string;
  readonly emptyStateTitle: string;
  readonly emptyStateDescription: string;
  readonly scopeGlobalLabel: string;
  readonly scopeProjectLabel: string;
  readonly noProjectsEmptyLabel: string;
  readonly projectSessionCountLabel: string;
  readonly backToProjectsLabel: string;
  readonly projectPathLabel: string;
  readonly threadPreviewEmptyLabel: string;
  readonly previewEmptyTitle: string;
  readonly previewEmptyDescription: string;
  readonly previewLoadingLabel: string;
};

const toAiHistoryLabels = (props: AiHistorySurfaceProps): AiHistoryLabels => ({
  title: props.title,
  newConversationLabel: props.newConversationLabel,
  openConversationLabel: props.openConversationLabel,
  renameConversationLabel: props.renameConversationLabel ?? "Rename conversation",
  deleteConversationLabel: props.deleteConversationLabel,
  archiveConversationLabel: props.archiveConversationLabel,
  archivedConversationLabel: props.archivedConversationLabel,
  archivedProjectLabel: props.archivedProjectLabel,
  deleteArchivedConversationCancel: props.deleteArchivedConversationCancel,
  loadingSessionsLabel: props.loadingSessionsLabel,
  emptyStateTitle: props.emptyStateTitle,
  emptyStateDescription: props.emptyStateDescription,
  scopeGlobalLabel: props.scopeGlobalLabel,
  scopeProjectLabel: props.scopeProjectLabel,
  noProjectsEmptyLabel: props.noProjectsEmptyLabel,
  projectSessionCountLabel: props.projectSessionCountLabel,
  backToProjectsLabel: props.backToProjectsLabel,
  projectPathLabel: props.projectPathLabel,
  threadPreviewEmptyLabel: props.threadPreviewEmptyLabel,
  previewEmptyTitle: props.previewEmptyTitle,
  previewEmptyDescription: props.previewEmptyDescription,
  previewLoadingLabel: props.previewLoadingLabel
});

const AiHistoryTopbar = ({
  labels,
  runtime
}: {
  readonly labels: AiHistoryLabels;
  readonly runtime: AiHistoryRuntime;
}) => (
  <header className="lyra-ai-history-topbar">
    <div className="lyra-ai-history-topbar-title">{labels.title}</div>
    <div className="lyra-ai-history-topbar-actions">
      <button
        type="button"
        className="lyra-ai-history-topbar-action"
        onClick={() => {
          void runtime.actions.createThread();
        }}
        aria-label={labels.newConversationLabel}
        title={labels.newConversationLabel}
        disabled={runtime.isCreating}
      >
        <Plus size={14} />
      </button>
    </div>
  </header>
);

const AiHistoryUnavailableSurface = ({
  labels
}: {
  readonly labels: AiHistoryLabels;
}) => (
  <section className="lyra-ai-history-surface" aria-label={labels.title}>
    <header className="lyra-ai-history-topbar">
      <div className="lyra-ai-history-topbar-title">{labels.title}</div>
    </header>
    <StatusEmptyState
      title={labels.emptyStateTitle}
      description={labels.emptyStateDescription}
      className="lyra-ai-history-empty"
    />
  </section>
);

const AiHistoryScopeTabs = ({
  labels,
  runtime
}: {
  readonly labels: AiHistoryLabels;
  readonly runtime: AiHistoryRuntime;
}) => {
  const tabs: readonly {
    readonly scope: HistoryScope;
    readonly label: string;
    readonly count: number;
  }[] = [
    {
      scope: "global",
      label: labels.scopeGlobalLabel,
      count: runtime.activeThreads.length
    },
    {
      scope: "project",
      label: labels.scopeProjectLabel,
      count: runtime.activeProjectGroupCount
    },
    {
      scope: "archivedGlobal",
      label: labels.archivedConversationLabel,
      count: runtime.archivedThreads.length
    },
    {
      scope: "archivedProject",
      label: labels.archivedProjectLabel,
      count: runtime.archivedProjectGroupCount
    }
  ];

  return (
    <div className="lyra-ai-history-scope-tabs" role="tablist">
      {tabs.map((tab) => (
        <button
          key={tab.scope}
          type="button"
          role="tab"
          aria-selected={runtime.scope === tab.scope}
          className={
            runtime.scope === tab.scope
              ? "lyra-ai-history-scope-tab lyra-ai-history-scope-tab-active"
              : "lyra-ai-history-scope-tab"
          }
          onClick={() => {
            runtime.actions.selectScope(tab.scope);
          }}
        >
          {tab.label}
          <small>{tab.count}</small>
        </button>
      ))}
    </div>
  );
};

const AiHistoryThreadRow = ({
  thread,
  labels,
  runtime,
  locale
}: {
  readonly thread: LyraThreadSummary;
  readonly labels: AiHistoryLabels;
  readonly runtime: AiHistoryRuntime;
  readonly locale: string;
}) => {
  const previewText = resolveThreadPreviewText(thread, labels.threadPreviewEmptyLabel);
  const updatedAtMs = thread.updatedAt ?? Date.now();
  const tone = resolveThreadRowTone({
    activeThreadId: runtime.activeThreadId,
    firstThreadId: runtime.threads[0]?.id ?? null,
    threadId: thread.id
  });
  const rowClassName =
    runtime.activeThreadId === thread.id
      ? "lyra-ai-history-row lyra-ai-history-row-active"
      : "lyra-ai-history-row";

  if (runtime.editingThreadId === thread.id) {
    return (
      <form
        className={`${rowClassName} lyra-ai-history-row-editing`}
        onSubmit={(event) => {
          event.preventDefault();
          void runtime.actions.submitRenameThread(thread.id);
        }}
      >
        <label className="lyra-ai-history-row-edit">
          <input
            className="lyra-ai-history-row-edit-input"
            aria-label={labels.renameConversationLabel}
            value={runtime.editingThreadName}
            autoFocus
            disabled={runtime.isRenamingThread}
            onChange={(event) => {
              runtime.actions.setEditingThreadName(event.target.value);
            }}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                event.preventDefault();
                runtime.actions.cancelRenameThread();
              }
            }}
          />
        </label>
        <div className="lyra-ai-history-row-actions">
          <button
            type="submit"
            className="lyra-ai-history-row-action lyra-ai-history-row-action-open"
            disabled={runtime.isRenamingThread}
            aria-label={labels.renameConversationLabel}
            title={labels.renameConversationLabel}
          >
            <Check size={14} />
          </button>
          <button
            type="button"
            className="lyra-ai-history-row-action"
            disabled={runtime.isRenamingThread}
            aria-label={labels.deleteArchivedConversationCancel}
            title={labels.deleteArchivedConversationCancel}
            onClick={runtime.actions.cancelRenameThread}
          >
            <X size={14} />
          </button>
        </div>
      </form>
    );
  }

  return (
    <div className={rowClassName}>
      <button
        type="button"
        className="lyra-ai-history-row-main"
        onClick={() => {
          void runtime.actions.previewThread(thread.id);
        }}
      >
        <span className="lyra-ai-history-row-heading">
          <StatusIndicator
            tone={tone}
            variant="dot"
            ariaLabel={previewText}
          />
          <strong>{previewText}</strong>
        </span>
        <small>{formatSessionTime(updatedAtMs, locale)}</small>
      </button>
      <div className="lyra-ai-history-row-actions">
        <button
          type="button"
          className="lyra-ai-history-row-action lyra-ai-history-row-action-open"
          onClick={() => {
            runtime.actions.beginRenameThread(thread);
          }}
          aria-label={labels.renameConversationLabel}
          title={labels.renameConversationLabel}
        >
          <Pencil size={14} />
        </button>
        <button
          type="button"
          className="lyra-ai-history-row-action lyra-ai-history-row-action-open"
          onClick={() => {
            runtime.actions.openThread(thread.id);
          }}
          aria-label={labels.openConversationLabel}
          title={labels.openConversationLabel}
        >
          <ExternalLink size={14} />
        </button>
        <button
          type="button"
          className="lyra-ai-history-row-action"
          onClick={() => {
            if (runtime.isArchivedScope) {
              runtime.actions.requestDeleteThread(thread);
              return;
            }
            void runtime.actions.archiveThread(thread.id);
          }}
          aria-label={runtime.isArchivedScope ? labels.deleteConversationLabel : labels.archiveConversationLabel}
          title={runtime.isArchivedScope ? labels.deleteConversationLabel : labels.archiveConversationLabel}
        >
          {runtime.isArchivedScope ? <Trash2 size={14} /> : <Archive size={14} />}
        </button>
      </div>
    </div>
  );
};

const AiHistoryThreadRows = ({
  labels,
  runtime,
  locale,
  threads
}: {
  readonly labels: AiHistoryLabels;
  readonly runtime: AiHistoryRuntime;
  readonly locale: string;
  readonly threads: readonly LyraThreadSummary[];
}) => (
  <div className="lyra-ai-history-rows">
    {threads.map((thread) => (
      <AiHistoryThreadRow
        key={thread.id}
        thread={thread}
        labels={labels}
        runtime={runtime}
        locale={locale}
      />
    ))}
  </div>
);

const AiHistoryScopeBody = ({
  labels,
  runtime,
  locale
}: {
  readonly labels: AiHistoryLabels;
  readonly runtime: AiHistoryRuntime;
  readonly locale: string;
}) => {
  if (!runtime.isProjectScope) {
    if (runtime.isLoading && runtime.threads.length === 0) {
      return (
        <StatusEmptyState
          title={labels.loadingSessionsLabel}
          loading
          spinnerVariant="sand"
          tone="info"
          className="lyra-ai-history-empty-list"
        />
      );
    }
    if (runtime.threads.length === 0) {
      return (
        <StatusEmptyState
          title={labels.emptyStateTitle}
          description={labels.emptyStateDescription}
          className="lyra-ai-history-empty"
        />
      );
    }
    return (
      <AiHistoryThreadRows
        labels={labels}
        runtime={runtime}
        locale={locale}
        threads={runtime.threads}
      />
    );
  }

  if (runtime.selectedProject !== null) {
    return (
      <div className="lyra-ai-history-project-detail">
        <div className="lyra-ai-history-project-detail-head">
          <button
            type="button"
            className="lyra-ai-history-back-button"
            onClick={runtime.actions.clearSelectedProject}
          >
            <ArrowLeft size={14} />
            <span>{labels.backToProjectsLabel}</span>
          </button>
          <div className="lyra-ai-history-project-detail-meta">
            <strong>{runtime.selectedProject.displayName}</strong>
            <span title={runtime.selectedProject.projectRoot}>
              {labels.projectPathLabel}
              {"\uff1a"}
              {runtime.selectedProject.projectRoot}
            </span>
          </div>
        </div>
        <AiHistoryThreadRows
          labels={labels}
          runtime={runtime}
          locale={locale}
          threads={runtime.selectedProject.threads}
        />
      </div>
    );
  }

  if (runtime.isLoading && runtime.threads.length === 0) {
    return (
      <StatusEmptyState
        title={labels.loadingSessionsLabel}
        loading
        spinnerVariant="sand"
        tone="info"
        className="lyra-ai-history-empty-list"
      />
    );
  }

  if (runtime.projectGroups.length === 0) {
    return (
      <StatusEmptyState
        title={labels.noProjectsEmptyLabel}
        className="lyra-ai-history-empty"
      />
    );
  }

  return (
    <div className="lyra-ai-history-project-grid">
      {runtime.projectGroups.map((group) => (
        <button
          key={group.projectRoot}
          type="button"
          className={
            runtime.selectedProjectRoot === group.projectRoot
              ? "lyra-ai-history-project-card lyra-ai-history-project-card-active"
              : "lyra-ai-history-project-card"
          }
          onClick={() => {
            runtime.actions.selectProject(group.projectRoot);
          }}
        >
          <span className="lyra-ai-history-project-card-head">
            <StatusIndicator
              tone={runtime.selectedProjectRoot === group.projectRoot ? "success" : "info"}
              variant="bar"
              ariaLabel={group.displayName}
            />
          </span>
          <span className="lyra-ai-history-project-card-icon">
            <FolderOpen size={16} />
          </span>
          <span className="lyra-ai-history-project-card-main">
            <strong>{group.displayName}</strong>
            <small title={group.projectRoot}>{group.projectRoot}</small>
          </span>
          <StatusBadge
            tone={runtime.selectedProjectRoot === group.projectRoot ? "info" : "muted"}
            label={`${String(group.threads.length)} ${labels.projectSessionCountLabel}`}
            className="lyra-ai-history-project-card-count"
          />
        </button>
      ))}
    </div>
  );
};

const AiHistoryPreviewPane = ({
  labels,
  runtime,
  locale,
  richRenderingEnabled,
  themeSignature
}: {
  readonly labels: AiHistoryLabels;
  readonly runtime: AiHistoryRuntime;
  readonly locale: string;
  readonly richRenderingEnabled: boolean;
  readonly themeSignature?: string | undefined;
}) => {
  if (runtime.isPreviewLoading) {
    return (
      <StatusEmptyState
        title={labels.previewLoadingLabel}
        loading
        spinnerVariant="sand"
        tone="info"
        className="lyra-ai-history-preview-empty"
      />
    );
  }

  if (runtime.previewError !== null) {
    return (
      <div className="lyra-ai-history-preview-error">
        {runtime.previewError}
      </div>
    );
  }

  if (runtime.previewDetail === null) {
    return (
      <StatusEmptyState
        title={labels.previewEmptyTitle}
        description={labels.previewEmptyDescription}
        className="lyra-ai-history-preview-empty"
      />
    );
  }

  const livePreview = runtime.activeThreadId === null
    ? null
    : (runtime.livePreviewByThread.get(runtime.activeThreadId) ?? null);
  const displayMessages = buildPreviewDisplayMessages(runtime.previewDetail, livePreview);
  const updatedAtMs = runtime.previewDetail.session.updatedAt;

  return (
    <article className="lyra-ai-history-preview-card">
      <header className="lyra-ai-history-preview-head">
        <div className="lyra-ai-history-preview-title">
          <strong>{runtime.previewDetail.session.title || labels.threadPreviewEmptyLabel}</strong>
          <small>{formatSessionTime(updatedAtMs, locale)}</small>
        </div>
        <div className="lyra-ai-history-preview-actions">
          <button
            type="button"
            className="lyra-ai-history-preview-open"
            onClick={() => {
              const sourceThread =
                runtime.getThreadSummaryById(runtime.previewDetail!.session.id)
                ?? createPreviewThreadSummary(runtime.previewDetail!);
              runtime.actions.beginRenameThread(sourceThread);
            }}
            aria-label={labels.renameConversationLabel}
            title={labels.renameConversationLabel}
          >
            <Pencil size={14} />
            <span>{labels.renameConversationLabel}</span>
          </button>
          <button
            type="button"
            className="lyra-ai-history-preview-open"
            onClick={() => {
              runtime.actions.openThread(runtime.previewDetail!.session.id);
            }}
            aria-label={labels.openConversationLabel}
            title={labels.openConversationLabel}
          >
            <ExternalLink size={14} />
            <span>{labels.openConversationLabel}</span>
          </button>
        </div>
      </header>
      {runtime.previewDetail.session.projectRoot === undefined ? null : (
        <div
          className="lyra-ai-history-preview-meta"
          title={runtime.previewDetail.session.projectRoot}
        >
          {labels.projectPathLabel}
          {"\uff1a"}
          {runtime.previewDetail.session.projectRoot}
        </div>
      )}
      {displayMessages.length === 0 ? (
        <StatusEmptyState
          title={labels.threadPreviewEmptyLabel}
          className="lyra-ai-history-preview-empty"
        />
      ) : (
        <div className="lyra-ai-history-preview-messages">
          {displayMessages.map((message) => {
            const displayContent = message.role === "assistant"
              ? resolveAssistantDisplayContent(message)
              : message.content;
            return (
              <div
                key={message.id}
                className={
                  message.role === "user"
                    ? "lyra-ai-history-preview-message lyra-ai-history-preview-message-user"
                    : "lyra-ai-history-preview-message lyra-ai-history-preview-message-assistant"
                }
              >
                <div className="lyra-ai-history-preview-message-content">
                  {message.role === "assistant" && richRenderingEnabled ? (
                    <AiPanelRichContent
                      content={displayContent}
                      locale={locale === "zh-CN" ? "zh-CN" : "en-US"}
                      {...(themeSignature === undefined ? {} : { themeSignature })}
                    />
                  ) : (
                    displayContent
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </article>
  );
};

export const AiHistorySurfaceView = ({
  surfaceProps,
  runtime
}: AiHistorySurfaceViewProps) => {
  const labels = toAiHistoryLabels(surfaceProps);
  if (!runtime.lyraAvailable) {
    return <AiHistoryUnavailableSurface labels={labels} />;
  }

  return (
    <section className="lyra-ai-history-surface" aria-label={labels.title}>
      <AiHistoryTopbar labels={labels} runtime={runtime} />
      <AiHistoryScopeTabs labels={labels} runtime={runtime} />

      <div className="lyra-ai-history-body">
        <div className="lyra-ai-history-list-pane">
          <AiHistoryScopeBody
            labels={labels}
            runtime={runtime}
            locale={surfaceProps.locale}
          />
          {runtime.errorMessage === null ? null : (
            <div className="lyra-ai-history-error">{runtime.errorMessage}</div>
          )}
        </div>
        <aside className="lyra-ai-history-preview-pane">
          <AiHistoryPreviewPane
            labels={labels}
            runtime={runtime}
            locale={surfaceProps.locale}
            richRenderingEnabled={surfaceProps.richRenderingEnabled ?? true}
            themeSignature={surfaceProps.themeSignature}
          />
        </aside>
      </div>
    </section>
  );
};
