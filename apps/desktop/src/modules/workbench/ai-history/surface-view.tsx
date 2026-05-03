import {
  Archive,
  ArchiveRestore,
  ArrowLeft,
  Check,
  ExternalLink,
  Pencil,
  Trash2,
  X
} from "lucide-react";

import { AiPanelRichContent } from "../ai-panel/rich-content";
import { InlineMessageContent } from "../ai-panel/inline-message-content";
import { StatusEmptyState } from "../ai-panel/status-primitives";
import { resolveAssistantDisplayContent } from "../ai-panel/view-helpers";
import {
  ProjectIdentityIcon,
  normalizeProjectRoot
} from "../project-identity";
import {
  buildPreviewDisplayMessages,
  formatSessionTime,
  resolveThreadPreviewText,
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
  readonly openConversationLabel: string;
  readonly renameConversationLabel: string;
  readonly deleteConversationLabel: string;
  readonly archiveConversationLabel: string;
  readonly unarchiveConversationLabel: string;
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
  readonly previewLoadingLabel: string;
};

const toAiHistoryLabels = (props: AiHistorySurfaceProps): AiHistoryLabels => ({
  title: props.title,
  openConversationLabel: props.openConversationLabel,
  renameConversationLabel: props.renameConversationLabel ?? "Rename conversation",
  deleteConversationLabel: props.deleteConversationLabel,
  archiveConversationLabel: props.archiveConversationLabel,
  unarchiveConversationLabel: props.unarchiveConversationLabel,
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
  previewLoadingLabel: props.previewLoadingLabel
});

const AiHistoryUnavailableSurface = ({
  labels
}: {
  readonly labels: AiHistoryLabels;
}) => (
  <section className="lyra-ai-history-surface" aria-label={labels.title}>
    <StatusEmptyState
      title={labels.emptyStateTitle}
      description={labels.emptyStateDescription}
      className="lyra-ai-history-empty"
    />
  </section>
);

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
  const projectRoot = normalizeProjectRoot(thread.boundProjectRoot);
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
          <ProjectIdentityIcon
            className="lyra-ai-history-row-project-icon"
            projectRoot={projectRoot}
            projectLogoUrl={null}
            title={projectRoot ?? previewText}
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
        {runtime.isArchivedScope ? (
          <>
            <button
              type="button"
              className="lyra-ai-history-row-action"
              onClick={() => {
                void runtime.actions.unarchiveThread(thread.id);
              }}
              aria-label={labels.unarchiveConversationLabel}
              title={labels.unarchiveConversationLabel}
            >
              <ArchiveRestore size={14} />
            </button>
            <button
              type="button"
              className="lyra-ai-history-row-action"
              onClick={() => {
                runtime.actions.requestDeleteThread(thread);
              }}
              aria-label={labels.deleteConversationLabel}
              title={labels.deleteConversationLabel}
            >
              <Trash2 size={14} />
            </button>
          </>
        ) : (
          <button
            type="button"
            className="lyra-ai-history-row-action"
            onClick={() => {
              void runtime.actions.archiveThread(thread.id);
            }}
            aria-label={labels.archiveConversationLabel}
            title={labels.archiveConversationLabel}
          >
            <Archive size={14} />
          </button>
        )}
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
          <ProjectIdentityIcon
            className="lyra-ai-history-project-card-icon"
            projectRoot={group.projectRoot}
            projectLogoUrl={null}
            title={group.displayName}
          />
          <span className="lyra-ai-history-project-card-main">
            <strong>{group.displayName}</strong>
            <small title={group.projectRoot}>{group.projectRoot}</small>
          </span>
          <small className="lyra-ai-history-project-card-count">
            {String(group.threads.length)}
            {" "}
            {labels.projectSessionCountLabel}
          </small>
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
        title={labels.previewLoadingLabel}
        loading
        spinnerVariant="sand"
        tone="info"
        className="lyra-ai-history-preview-empty"
      />
    );
  }

  const livePreview = runtime.activeThreadId === null
    ? null
    : (runtime.livePreviewByThread.get(runtime.activeThreadId) ?? null);
  const displayMessages = buildPreviewDisplayMessages(runtime.previewDetail, livePreview);

  return (
    <article className="lyra-ai-history-preview-card">
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
                  ) : message.role === "user" ? (
                    <InlineMessageContent
                      content={displayContent}
                      parts={message.contentParts}
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
