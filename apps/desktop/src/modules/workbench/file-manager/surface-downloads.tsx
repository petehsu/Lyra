import {
  ClipboardPaste,
  ExternalLink,
  FolderOpen,
  Import,
  Pause,
  Play,
  Plus,
  RadioTower,
  RotateCcw,
  Save,
  Settings2,
  SlidersHorizontal,
  Trash2,
  X
} from "lucide-react";
import type { FormEvent } from "react";

import {
  AppBadge,
  AppEmptyState,
  AppIconButton,
  AppInput,
  AppSelect,
  AppSwitch,
  AppTextarea
} from "@renderer/ui/components";
import type { AppBadgeTone } from "@renderer/ui/components";
import type {
  DownloadManagerPriority,
  DownloadManagerTask
} from "../../../shared/download-manager";
import {
  formatDownloadBytes,
  formatDownloadEta,
  formatDownloadSpeed,
  getDownloadProgressRatio,
  resolveDownloadChecksumLabel,
  resolveDownloadPriorityLabel,
  resolveDownloadSourceLabel,
  resolveDownloadStateLabel
} from "./download-utils";
import { renderFileManagerSectionIcon } from "./icon-registry";
import type { FileManagerSurfaceViewProps } from "./surface-view-types";

const formatTaskSize = (
  task: DownloadManagerTask,
  labels: FileManagerSurfaceViewProps["labels"]
): string => {
  const received = formatDownloadBytes(task.receivedBytes, labels);
  const total = formatDownloadBytes(task.totalBytes, labels);
  return task.totalBytes > 0 ? `${received} / ${total}` : received;
};

const DOWNLOAD_PRIORITIES: readonly DownloadManagerPriority[] = ["high", "normal", "low"];

const DOWNLOAD_PROXY_MODES = ["system", "direct", "http", "socks5"] as const;
const DOWNLOAD_CHECKSUM_ALGORITHMS = ["none", "md5", "sha1", "sha256"] as const;

const isPausableDownload = (task: DownloadManagerTask): boolean =>
  task.state === "queued" || task.state === "downloading";

const isResumableDownload = (task: DownloadManagerTask): boolean =>
  task.state === "paused";

const isCancelableDownload = (task: DownloadManagerTask): boolean =>
  task.state === "queued" || task.state === "downloading" || task.state === "paused";

const resolveDownloadStateTone = (state: DownloadManagerTask["state"]): AppBadgeTone => {
  switch (state) {
    case "completed":
      return "success";
    case "failed":
      return "error";
    case "paused":
      return "warning";
    case "downloading":
      return "info";
    case "queued":
    case "canceled":
    default:
      return "neutral";
  }
};

const DownloadTaskActions = ({
  task,
  labels,
  actions
}: {
  readonly task: DownloadManagerTask;
  readonly labels: FileManagerSurfaceViewProps["labels"];
  readonly actions: FileManagerSurfaceViewProps["actions"];
}) => (
  <div className="lyra-file-manager-download-actions">
    {task.state === "downloading" ? (
      <AppIconButton
        aria-label={labels.downloadPause}
        title={labels.downloadPause}
        onClick={() => {
          actions.onPauseDownload(task.id);
        }}
      >
        <Pause size={14} aria-hidden="true" />
      </AppIconButton>
    ) : null}
    {task.state === "paused" ? (
      <AppIconButton
        aria-label={labels.downloadResume}
        title={labels.downloadResume}
        onClick={() => {
          actions.onResumeDownload(task.id);
        }}
      >
        <Play size={14} aria-hidden="true" />
      </AppIconButton>
    ) : null}
    {task.state === "queued" || task.state === "downloading" || task.state === "paused" ? (
      <AppIconButton
        tone="danger"
        aria-label={labels.downloadCancel}
        title={labels.downloadCancel}
        onClick={() => {
          actions.onCancelDownload(task.id);
        }}
      >
        <X size={14} aria-hidden="true" />
      </AppIconButton>
    ) : null}
    {task.state === "failed" || task.state === "canceled" ? (
      <AppIconButton
        aria-label={labels.downloadRetry}
        title={labels.downloadRetry}
        onClick={() => {
          actions.onRetryDownload(task.id);
        }}
      >
        <RotateCcw size={14} aria-hidden="true" />
      </AppIconButton>
    ) : null}
    {task.state === "completed" ? (
      <>
        <AppIconButton
          aria-label={labels.downloadOpenFile}
          title={labels.downloadOpenFile}
          onClick={() => {
            actions.onOpenDownloadedFile(task.id);
          }}
        >
          <ExternalLink size={14} aria-hidden="true" />
        </AppIconButton>
        <AppIconButton
          aria-label={labels.downloadRevealFile}
          title={labels.downloadRevealFile}
          onClick={() => {
            actions.onRevealDownloadedFile(task.id);
          }}
        >
          <FolderOpen size={14} aria-hidden="true" />
        </AppIconButton>
      </>
    ) : null}
    {task.state === "completed" || task.state === "failed" || task.state === "canceled" ? (
      <AppIconButton
        tone="danger"
        aria-label={labels.downloadRemove}
        title={labels.downloadRemove}
        onClick={() => {
          actions.onRemoveDownload(task.id);
        }}
      >
        <Trash2 size={14} aria-hidden="true" />
      </AppIconButton>
    ) : null}
  </div>
);

const DownloadTaskRow = ({
  task,
  labels,
  actions
}: {
  readonly task: DownloadManagerTask;
  readonly labels: FileManagerSurfaceViewProps["labels"];
  readonly actions: FileManagerSurfaceViewProps["actions"];
}) => {
  const progressRatio = getDownloadProgressRatio(task);
  const stateLabel = resolveDownloadStateLabel(task.state, labels);
  const sourceLabel = resolveDownloadSourceLabel(task.source, labels);
  const speedLabel = formatDownloadSpeed(task.speedBytesPerSecond, labels);
  const etaLabel = formatDownloadEta(task.estimatedRemainingMs, labels);
  const checksumLabel = resolveDownloadChecksumLabel(task.checksum, labels);
  const sizeLabel = formatTaskSize(task, labels);
  const connectionLabel = labels.downloadConnections.replace(
    "{count}",
    String(Math.max(task.connectionsActive, task.connectionsRequested))
  );
  const progressLabel = `${Math.round(progressRatio * 100)}%`;

  return (
    <div className="lyra-file-manager-download-row">
      <div className="lyra-file-manager-download-main">
        <div className="lyra-file-manager-download-name-line">
          <strong title={task.fileName}>{task.fileName}</strong>
          <AppBadge
            className="lyra-file-manager-download-state"
            tone={resolveDownloadStateTone(task.state)}
          >
            {stateLabel}
          </AppBadge>
        </div>
        <div className="lyra-file-manager-download-meta">
          <span title={task.url}>{sourceLabel}</span>
          <span>{connectionLabel}</span>
          <span>{sizeLabel}</span>
          <span>{speedLabel}</span>
          {etaLabel === null ? null : <span>{etaLabel}</span>}
          {checksumLabel === null ? null : <span>{checksumLabel}</span>}
        </div>
        <div
          className="lyra-file-manager-download-progress"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(progressRatio * 100)}
          aria-label={`${task.fileName} ${progressLabel}`}
        >
          <div
            className="lyra-file-manager-download-progress-fill"
            style={{ transform: `scaleX(${progressRatio})` }}
          />
        </div>
        {task.errorMessage === undefined ? null : (
          <div className="lyra-file-manager-download-error">{task.errorMessage}</div>
        )}
      </div>
      <AppSelect
        ariaLabel={`${labels.downloadPriority}: ${task.fileName}`}
        value={task.priority}
        options={DOWNLOAD_PRIORITIES.map((priority) => ({
          value: priority,
          label: resolveDownloadPriorityLabel(priority, labels)
        }))}
        onValueChange={(value) => {
          actions.onSetDownloadPriority(
            task.id,
            value as DownloadManagerPriority
          );
        }}
      />
      <DownloadTaskActions task={task} labels={labels} actions={actions} />
    </div>
  );
};

const resolveChecksumAlgorithmLabel = (
  algorithm: (typeof DOWNLOAD_CHECKSUM_ALGORITHMS)[number],
  labels: FileManagerSurfaceViewProps["labels"]
): string => algorithm === "none" ? labels.downloadAdvancedChecksumNone : algorithm.toUpperCase();

const resolveProxyModeLabel = (
  mode: (typeof DOWNLOAD_PROXY_MODES)[number],
  labels: FileManagerSurfaceViewProps["labels"]
): string => {
  switch (mode) {
    case "direct":
      return labels.downloadSettingsProxyDirect;
    case "http":
      return labels.downloadSettingsProxyHttp;
    case "socks5":
      return labels.downloadSettingsProxySocks5;
    case "system":
    default:
      return labels.downloadSettingsProxySystem;
  }
};

const DownloadAdvancedOptionsPanel = ({
  downloads,
  labels,
  actions
}: {
  readonly downloads: Extract<
    FileManagerSurfaceViewProps["renderModel"]["body"],
    { readonly kind: "downloads" }
  >["downloads"];
  readonly labels: FileManagerSurfaceViewProps["labels"];
  readonly actions: FileManagerSurfaceViewProps["actions"];
}) => {
  const draft = downloads.advancedDraft;
  if (draft.advancedOpen === false) {
    return null;
  }
  const proxyUrlVisible = draft.proxyMode === "http" || draft.proxyMode === "socks5";
  const checksumVisible = draft.checksumAlgorithm !== "none";

  return (
    <section
      className="lyra-app-group lyra-file-manager-download-advanced"
      aria-label={labels.downloadAdvancedOptions}
    >
      <div className="lyra-app-form-grid lyra-file-manager-download-settings-grid">
        <label className="lyra-app-form-field lyra-app-form-field-wide lyra-file-manager-download-setting-field lyra-file-manager-download-setting-field-wide">
          <span>{labels.downloadAdvancedCookie}</span>
          <AppInput
            value={draft.cookieHeader}
            onChange={(event) => {
              actions.onDownloadAdvancedDraftChange({
                cookieHeader: event.target.value
              });
            }}
          />
        </label>
        <label className="lyra-app-form-field lyra-app-form-field-wide lyra-file-manager-download-setting-field lyra-file-manager-download-setting-field-wide">
          <span>{labels.downloadAdvancedHeaders}</span>
          <AppTextarea
            value={draft.headersText}
            onChange={(event) => {
              actions.onDownloadAdvancedDraftChange({
                headersText: event.target.value
              });
            }}
          />
        </label>
        <label className="lyra-app-form-field lyra-app-form-field-wide lyra-file-manager-download-setting-field lyra-file-manager-download-setting-field-wide">
          <span>{labels.downloadAdvancedMirrors}</span>
          <AppTextarea
            value={draft.mirrorsText}
            onChange={(event) => {
              actions.onDownloadAdvancedDraftChange({
                mirrorsText: event.target.value
              });
            }}
          />
        </label>
        <label className="lyra-app-form-field lyra-file-manager-download-setting-field">
          <span>{labels.downloadAdvancedBtSelectedFiles}</span>
          <AppInput
            value={draft.btSelectedFileIndexesText}
            onChange={(event) => {
              actions.onDownloadAdvancedDraftChange({
                btSelectedFileIndexesText: event.target.value
              });
            }}
          />
        </label>
        <label className="lyra-app-form-field lyra-app-form-field-wide lyra-file-manager-download-setting-field lyra-file-manager-download-setting-field-wide">
          <span>{labels.downloadAdvancedBtTrackers}</span>
          <AppTextarea
            value={draft.btTrackerUrlsText}
            onChange={(event) => {
              actions.onDownloadAdvancedDraftChange({
                btTrackerUrlsText: event.target.value
              });
            }}
          />
        </label>
        <label className="lyra-app-form-field lyra-app-form-field-wide lyra-file-manager-download-setting-field lyra-file-manager-download-setting-field-wide">
          <span>{labels.downloadAdvancedPartialFile}</span>
          <AppInput
            value={draft.partialFilePath}
            onChange={(event) => {
              actions.onDownloadAdvancedDraftChange({
                partialFilePath: event.target.value
              });
            }}
          />
        </label>
        <label className="lyra-app-form-field lyra-file-manager-download-setting-field">
          <span>{labels.downloadAdvancedChecksumAlgorithm}</span>
          <AppSelect
            ariaLabel={labels.downloadAdvancedChecksumAlgorithm}
            value={draft.checksumAlgorithm}
            options={DOWNLOAD_CHECKSUM_ALGORITHMS.map((algorithm) => ({
              value: algorithm,
              label: resolveChecksumAlgorithmLabel(algorithm, labels)
            }))}
            onValueChange={(value) => {
              actions.onDownloadAdvancedDraftChange({
                checksumAlgorithm: value as typeof draft.checksumAlgorithm
              });
            }}
          />
        </label>
        {checksumVisible ? (
          <label className="lyra-app-form-field lyra-file-manager-download-setting-field">
            <span>{labels.downloadAdvancedChecksumExpected}</span>
            <AppInput
              value={draft.checksumExpected}
              onChange={(event) => {
                actions.onDownloadAdvancedDraftChange({
                  checksumExpected: event.target.value
                });
              }}
            />
          </label>
        ) : null}
        <label className="lyra-app-form-field lyra-file-manager-download-setting-field">
          <span>{labels.downloadAdvancedMaxRetries}</span>
          <AppInput
            value={draft.maxRetries}
            inputMode="numeric"
            onChange={(event) => {
              actions.onDownloadAdvancedDraftChange({
                maxRetries: event.target.value
              });
            }}
          />
        </label>
        <label className="lyra-app-form-field lyra-file-manager-download-setting-field">
          <span>{labels.downloadAdvancedRetryDelay}</span>
          <AppInput
            value={draft.retryDelaySeconds}
            inputMode="numeric"
            onChange={(event) => {
              actions.onDownloadAdvancedDraftChange({
                retryDelaySeconds: event.target.value
              });
            }}
          />
        </label>
        <label className="lyra-app-form-field lyra-file-manager-download-setting-field">
          <span>{labels.downloadAdvancedProxyMode}</span>
          <AppSelect
            ariaLabel={labels.downloadAdvancedProxyMode}
            value={draft.proxyMode}
            options={DOWNLOAD_PROXY_MODES.map((mode) => ({
              value: mode,
              label: resolveProxyModeLabel(mode, labels)
            }))}
            onValueChange={(value) => {
              actions.onDownloadAdvancedDraftChange({
                proxyMode: value as typeof draft.proxyMode
              });
            }}
          />
        </label>
        {proxyUrlVisible ? (
          <label className="lyra-app-form-field lyra-file-manager-download-setting-field">
            <span>{labels.downloadAdvancedProxyUrl}</span>
            <AppInput
              value={draft.proxyUrl}
              onChange={(event) => {
                actions.onDownloadAdvancedDraftChange({
                  proxyUrl: event.target.value
                });
              }}
            />
          </label>
        ) : null}
      </div>
    </section>
  );
};

const DownloadScheduleSettings = ({
  draft,
  labels,
  actions
}: {
  readonly draft: Extract<
    FileManagerSurfaceViewProps["renderModel"]["body"],
    { readonly kind: "downloads" }
  >["downloads"]["settingsDraft"];
  readonly labels: FileManagerSurfaceViewProps["labels"];
  readonly actions: FileManagerSurfaceViewProps["actions"];
}) => (
  <div className="lyra-file-manager-download-settings-row">
    <span className="lyra-file-manager-download-settings-row-title">
      {labels.downloadSettingsSchedule}
    </span>
    <label className="lyra-file-manager-download-setting-check">
      <AppSwitch
        checked={draft.scheduleEnabled}
        aria-label={labels.downloadSettingsScheduleEnabled}
        onCheckedChange={(checked) => {
          actions.onDownloadSettingsDraftChange({
            scheduleEnabled: checked
          });
        }}
      />
      <span>{labels.downloadSettingsScheduleEnabled}</span>
    </label>
    {draft.scheduleEnabled ? (
      <>
        <label className="lyra-app-form-field lyra-file-manager-download-setting-field lyra-file-manager-download-setting-field-compact">
          <span>{labels.downloadSettingsScheduleStart}</span>
          <AppInput
            type="time"
            value={draft.scheduleStartTime}
            onChange={(event) => {
              actions.onDownloadSettingsDraftChange({
                scheduleStartTime: event.target.value
              });
            }}
          />
        </label>
        <label className="lyra-app-form-field lyra-file-manager-download-setting-field lyra-file-manager-download-setting-field-compact">
          <span>{labels.downloadSettingsScheduleEnd}</span>
          <AppInput
            type="time"
            value={draft.scheduleEndTime}
            onChange={(event) => {
              actions.onDownloadSettingsDraftChange({
                scheduleEndTime: event.target.value
              });
            }}
          />
        </label>
        <label className="lyra-app-form-field lyra-file-manager-download-setting-field lyra-file-manager-download-setting-field-compact">
          <span>{labels.downloadSettingsScheduleOutsideAction}</span>
          <AppSelect
            ariaLabel={labels.downloadSettingsScheduleOutsideAction}
            value={draft.scheduleOutsideAction}
            options={[
              { value: "pause", label: labels.downloadSettingsSchedulePause },
              { value: "speed-limit", label: labels.downloadSettingsScheduleSpeedLimit }
            ]}
            onValueChange={(value) => {
              actions.onDownloadSettingsDraftChange({
                scheduleOutsideAction: value as typeof draft.scheduleOutsideAction
              });
            }}
          />
        </label>
        {draft.scheduleOutsideAction === "speed-limit" ? (
          <label className="lyra-app-form-field lyra-file-manager-download-setting-field lyra-file-manager-download-setting-field-compact">
            <span>{labels.downloadSettingsScheduleLimit}</span>
            <AppInput
              value={draft.scheduleOutsideSpeedLimitKibPerSecond}
              inputMode="numeric"
              onChange={(event) => {
                actions.onDownloadSettingsDraftChange({
                  scheduleOutsideSpeedLimitKibPerSecond: event.target.value
                });
              }}
            />
          </label>
        ) : null}
      </>
    ) : null}
  </div>
);

const DownloadSaveRulesSettings = ({
  draft,
  labels,
  actions
}: {
  readonly draft: Extract<
    FileManagerSurfaceViewProps["renderModel"]["body"],
    { readonly kind: "downloads" }
  >["downloads"]["settingsDraft"];
  readonly labels: FileManagerSurfaceViewProps["labels"];
  readonly actions: FileManagerSurfaceViewProps["actions"];
}) => (
  <div className="lyra-file-manager-download-save-rules">
    <div className="lyra-file-manager-download-save-rules-header">
      <span className="lyra-file-manager-download-settings-row-title">
        {labels.downloadSettingsSaveRules}
      </span>
      <AppIconButton
        type="button"
        aria-label={labels.downloadSettingsAddSaveRule}
        title={labels.downloadSettingsAddSaveRule}
        onClick={actions.onAddDownloadSaveRule}
      >
        <Plus size={14} aria-hidden="true" />
      </AppIconButton>
    </div>
    {draft.saveRules.map((rule) => {
      const ruleLabel = rule.name.trim().length === 0 ? rule.id : rule.name;
      return (
        <div className="lyra-file-manager-download-save-rule" key={rule.id}>
          <label className="lyra-file-manager-download-setting-check">
            <AppSwitch
              checked={rule.enabled}
              aria-label={`${labels.downloadSettingsRuleEnabled}: ${ruleLabel}`}
              onCheckedChange={(checked) => {
                actions.onDownloadSaveRuleDraftChange(rule.id, {
                  enabled: checked
                });
              }}
            />
            <span>{labels.downloadSettingsRuleEnabled}</span>
          </label>
          <AppIconButton
            type="button"
            tone="danger"
            aria-label={`${labels.downloadSettingsRemoveSaveRule}: ${ruleLabel}`}
            title={labels.downloadSettingsRemoveSaveRule}
            onClick={() => {
              actions.onRemoveDownloadSaveRule(rule.id);
            }}
          >
            <Trash2 size={14} aria-hidden="true" />
          </AppIconButton>
          <label className="lyra-app-form-field lyra-file-manager-download-setting-field">
            <span>{labels.downloadSettingsRuleName}</span>
            <AppInput
              value={rule.name}
              onChange={(event) => {
                actions.onDownloadSaveRuleDraftChange(rule.id, {
                  name: event.target.value
                });
              }}
            />
          </label>
          <label className="lyra-app-form-field lyra-file-manager-download-setting-field">
            <span>{labels.downloadSettingsRuleDirectory}</span>
            <AppInput
              value={rule.directory}
              onChange={(event) => {
                actions.onDownloadSaveRuleDraftChange(rule.id, {
                  directory: event.target.value
                });
              }}
            />
          </label>
          <label className="lyra-app-form-field lyra-file-manager-download-setting-field">
            <span>{labels.downloadSettingsRuleExtensions}</span>
            <AppInput
              value={rule.extensionsText}
              onChange={(event) => {
                actions.onDownloadSaveRuleDraftChange(rule.id, {
                  extensionsText: event.target.value
                });
              }}
            />
          </label>
          <label className="lyra-app-form-field lyra-file-manager-download-setting-field">
            <span>{labels.downloadSettingsRuleHosts}</span>
            <AppInput
              value={rule.hostContainsText}
              onChange={(event) => {
                actions.onDownloadSaveRuleDraftChange(rule.id, {
                  hostContainsText: event.target.value
                });
              }}
            />
          </label>
          <label className="lyra-app-form-field lyra-file-manager-download-setting-field">
            <span>{labels.downloadSettingsRuleProtocols}</span>
            <AppInput
              value={rule.protocolsText}
              onChange={(event) => {
                actions.onDownloadSaveRuleDraftChange(rule.id, {
                  protocolsText: event.target.value
                });
              }}
            />
          </label>
          <label className="lyra-app-form-field lyra-file-manager-download-setting-field">
            <span>{labels.downloadSettingsRuleTags}</span>
            <AppInput
              value={rule.tagsText}
              onChange={(event) => {
                actions.onDownloadSaveRuleDraftChange(rule.id, {
                  tagsText: event.target.value
                });
              }}
            />
          </label>
        </div>
      );
    })}
  </div>
);

const DownloadSettingsPanel = ({
  downloads,
  labels,
  actions
}: {
  readonly downloads: Extract<
    FileManagerSurfaceViewProps["renderModel"]["body"],
    { readonly kind: "downloads" }
  >["downloads"];
  readonly labels: FileManagerSurfaceViewProps["labels"];
  readonly actions: FileManagerSurfaceViewProps["actions"];
}) => {
  if (downloads.settingsOpen === false) {
    return null;
  }

  const draft = downloads.settingsDraft;
  const remoteStatus = downloads.remoteApiStatus;
  const proxyUrlVisible = draft.proxyMode === "http" || draft.proxyMode === "socks5";

  return (
    <section className="lyra-app-group lyra-file-manager-download-settings" aria-label={labels.downloadSettings}>
      <div className="lyra-app-form-grid lyra-file-manager-download-settings-grid">
        <label className="lyra-app-form-field lyra-file-manager-download-setting-field">
          <span>{labels.downloadSettingsSpeedLimit}</span>
          <AppInput
            value={draft.speedLimitKibPerSecond}
            inputMode="numeric"
            placeholder={labels.downloadSettingsNoLimit}
            onChange={(event) => {
              actions.onDownloadSettingsDraftChange({
                speedLimitKibPerSecond: event.target.value
              });
            }}
          />
        </label>
        <label className="lyra-app-form-field lyra-file-manager-download-setting-field">
          <span>{labels.downloadSettingsProxyMode}</span>
          <AppSelect
            ariaLabel={labels.downloadSettingsProxyMode}
            value={draft.proxyMode}
            options={DOWNLOAD_PROXY_MODES.map((mode) => ({
              value: mode,
              label: resolveProxyModeLabel(mode, labels)
            }))}
            onValueChange={(value) => {
              actions.onDownloadSettingsDraftChange({
                proxyMode: value as typeof draft.proxyMode
              });
            }}
          />
        </label>
        {proxyUrlVisible ? (
          <label className="lyra-app-form-field lyra-app-form-field-wide lyra-file-manager-download-setting-field lyra-file-manager-download-setting-field-wide">
            <span>{labels.downloadSettingsProxyUrl}</span>
            <AppInput
              value={draft.proxyUrl}
              onChange={(event) => {
                actions.onDownloadSettingsDraftChange({
                  proxyUrl: event.target.value
                });
              }}
            />
          </label>
        ) : null}
        <label className="lyra-app-form-field lyra-app-form-field-wide lyra-file-manager-download-setting-field lyra-file-manager-download-setting-field-wide">
          <span>{labels.downloadSettingsCookie}</span>
          <AppInput
            value={draft.defaultCookieHeader}
            onChange={(event) => {
              actions.onDownloadSettingsDraftChange({
                defaultCookieHeader: event.target.value
              });
            }}
          />
        </label>
        <label className="lyra-app-form-field lyra-app-form-field-wide lyra-file-manager-download-setting-field lyra-file-manager-download-setting-field-wide">
          <span>{labels.downloadSettingsHeaders}</span>
          <AppTextarea
            value={draft.defaultHeadersText}
            onChange={(event) => {
              actions.onDownloadSettingsDraftChange({
                defaultHeadersText: event.target.value
              });
            }}
          />
        </label>
      </div>

      <DownloadScheduleSettings
        draft={draft}
        labels={labels}
        actions={actions}
      />

      <div className="lyra-file-manager-download-settings-row">
        <span className="lyra-file-manager-download-settings-row-title">
          {labels.downloadSettingsPostProcessing}
        </span>
        <label className="lyra-file-manager-download-setting-check">
          <AppSwitch
            checked={draft.autoExtract}
            aria-label={labels.downloadSettingsAutoExtract}
            onCheckedChange={(checked) => {
              actions.onDownloadSettingsDraftChange({
                autoExtract: checked
              });
            }}
          />
          <span>{labels.downloadSettingsAutoExtract}</span>
        </label>
        <label className="lyra-file-manager-download-setting-check">
          <AppSwitch
            checked={draft.deleteArchiveAfterExtract}
            aria-label={labels.downloadSettingsDeleteArchive}
            onCheckedChange={(checked) => {
              actions.onDownloadSettingsDraftChange({
                deleteArchiveAfterExtract: checked
              });
            }}
          />
          <span>{labels.downloadSettingsDeleteArchive}</span>
        </label>
        <label className="lyra-file-manager-download-setting-check">
          <AppSwitch
            checked={draft.detectSplitArchives}
            aria-label={labels.downloadSettingsDetectSplitArchives}
            onCheckedChange={(checked) => {
              actions.onDownloadSettingsDraftChange({
                detectSplitArchives: checked
              });
            }}
          />
          <span>{labels.downloadSettingsDetectSplitArchives}</span>
        </label>
        <label className="lyra-app-form-field lyra-file-manager-download-setting-field lyra-file-manager-download-setting-field-flex">
          <span>{labels.downloadSettingsExtractDirectory}</span>
          <AppInput
            value={draft.extractDirectory}
            onChange={(event) => {
              actions.onDownloadSettingsDraftChange({
                extractDirectory: event.target.value
              });
            }}
          />
        </label>
      </div>

      <div className="lyra-file-manager-download-settings-row">
        <span className="lyra-file-manager-download-settings-row-title">
          {labels.downloadSettingsBt}
        </span>
        <label className="lyra-file-manager-download-setting-check">
          <AppSwitch
            checked={draft.btDhtEnabled}
            aria-label={labels.downloadSettingsBtDht}
            onCheckedChange={(checked) => {
              actions.onDownloadSettingsDraftChange({
                btDhtEnabled: checked
              });
            }}
          />
          <span>{labels.downloadSettingsBtDht}</span>
        </label>
        <label className="lyra-file-manager-download-setting-check">
          <AppSwitch
            checked={draft.btPeerExchangeEnabled}
            aria-label={labels.downloadSettingsBtPeerExchange}
            onCheckedChange={(checked) => {
              actions.onDownloadSettingsDraftChange({
                btPeerExchangeEnabled: checked
              });
            }}
          />
          <span>{labels.downloadSettingsBtPeerExchange}</span>
        </label>
        <label className="lyra-file-manager-download-setting-check">
          <AppSwitch
            checked={draft.btLocalPeerDiscoveryEnabled}
            aria-label={labels.downloadSettingsBtLocalPeerDiscovery}
            onCheckedChange={(checked) => {
              actions.onDownloadSettingsDraftChange({
                btLocalPeerDiscoveryEnabled: checked
              });
            }}
          />
          <span>{labels.downloadSettingsBtLocalPeerDiscovery}</span>
        </label>
        <label className="lyra-app-form-field lyra-file-manager-download-setting-field lyra-file-manager-download-setting-field-compact">
          <span>{labels.downloadSettingsBtSeedTime}</span>
          <AppInput
            value={draft.btSeedTimeMinutes}
            inputMode="numeric"
            onChange={(event) => {
              actions.onDownloadSettingsDraftChange({
                btSeedTimeMinutes: event.target.value
              });
            }}
          />
        </label>
        <label className="lyra-app-form-field lyra-file-manager-download-setting-field lyra-file-manager-download-setting-field-compact">
          <span>{labels.downloadSettingsBtUploadLimit}</span>
          <AppInput
            value={draft.btUploadLimitKibPerSecond}
            inputMode="numeric"
            placeholder={labels.downloadSettingsNoLimit}
            onChange={(event) => {
              actions.onDownloadSettingsDraftChange({
                btUploadLimitKibPerSecond: event.target.value
              });
            }}
          />
        </label>
        <label className="lyra-app-form-field lyra-file-manager-download-setting-field lyra-file-manager-download-setting-field-flex">
          <span>{labels.downloadSettingsBtTrackers}</span>
          <AppInput
            value={draft.btTrackerUrlsText}
            onChange={(event) => {
              actions.onDownloadSettingsDraftChange({
                btTrackerUrlsText: event.target.value
              });
            }}
          />
        </label>
      </div>

      <DownloadSaveRulesSettings
        draft={draft}
        labels={labels}
        actions={actions}
      />

      <div className="lyra-file-manager-download-settings-row">
        <span className="lyra-file-manager-download-settings-row-title">
          {labels.downloadRemoteApi}
        </span>
        <span className="lyra-file-manager-download-remote-state">
          <RadioTower size={14} aria-hidden="true" />
          {remoteStatus?.running === true
            ? labels.downloadRemoteApiRunning
            : labels.downloadRemoteApiStopped}
        </span>
        <label className="lyra-app-form-field lyra-file-manager-download-setting-field lyra-file-manager-download-setting-field-compact">
          <span>{labels.downloadRemoteApiHost}</span>
          <AppInput
            value={draft.remoteHost}
            onChange={(event) => {
              actions.onDownloadSettingsDraftChange({
                remoteHost: event.target.value
              });
            }}
          />
        </label>
        <label className="lyra-app-form-field lyra-file-manager-download-setting-field lyra-file-manager-download-setting-field-compact">
          <span>{labels.downloadRemoteApiPort}</span>
          <AppInput
            value={draft.remotePort}
            inputMode="numeric"
            onChange={(event) => {
              actions.onDownloadSettingsDraftChange({
                remotePort: event.target.value
              });
            }}
          />
        </label>
        <label className="lyra-file-manager-download-setting-check">
          <AppSwitch
            checked={draft.remoteAllowLan}
            aria-label={labels.downloadRemoteApiAllowLan}
            onCheckedChange={(checked) => {
              actions.onDownloadSettingsDraftChange({
                remoteAllowLan: checked
              });
            }}
          />
          <span>{labels.downloadRemoteApiAllowLan}</span>
        </label>
        {remoteStatus?.running === true ? (
          <AppIconButton
            type="button"
            tone="danger"
            aria-label={labels.downloadRemoteApiStop}
            title={labels.downloadRemoteApiStop}
            onClick={actions.onStopDownloadRemoteApi}
          >
            <X size={14} aria-hidden="true" />
          </AppIconButton>
        ) : (
          <AppIconButton
            type="button"
            aria-label={labels.downloadRemoteApiStart}
            title={labels.downloadRemoteApiStart}
            onClick={actions.onStartDownloadRemoteApi}
          >
            <Play size={14} aria-hidden="true" />
          </AppIconButton>
        )}
        {remoteStatus?.token === undefined ? null : (
          <span className="lyra-file-manager-download-remote-token" title={remoteStatus.token}>
            {labels.downloadRemoteApiToken}
          </span>
        )}
      </div>

      {downloads.settingsErrorMessage === undefined ? null : (
        <div className="lyra-file-manager-downloads-error">
          {downloads.settingsErrorMessage}
        </div>
      )}

      <div className="lyra-file-manager-download-settings-actions">
        <AppIconButton
          type="button"
          aria-label={labels.downloadSettingsSave}
          title={labels.downloadSettingsSave}
          onClick={actions.onSaveDownloadSettings}
        >
          <Save size={14} aria-hidden="true" />
        </AppIconButton>
      </div>
    </section>
  );
};

export const FileManagerDownloadsContent = ({
  renderModel,
  labels,
  actions
}: FileManagerSurfaceViewProps) => {
  if (renderModel.body.kind !== "downloads") {
    return null;
  }
  const downloads = renderModel.body.downloads;
  const canPauseAll = downloads.tasks.some(isPausableDownload);
  const canResumeAll = downloads.tasks.some(isResumableDownload);
  const canCancelAll = downloads.tasks.some(isCancelableDownload);
  const onSubmit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    actions.onSubmitDownloadUrlDraft();
  };

  return (
    <div className="lyra-app-content-column lyra-app-content-column-wide lyra-file-manager-downloads-page">
      <header className="lyra-app-group lyra-file-manager-downloads-header">
        <div className="lyra-file-manager-downloads-title">
          {renderFileManagerSectionIcon("downloads")}
          <h3>{labels.downloadManagerTitle}</h3>
        </div>
        <div className="lyra-file-manager-downloads-controls">
          <div className="lyra-file-manager-downloads-batch-actions">
            {canPauseAll ? (
              <AppIconButton
                type="button"
                aria-label={labels.downloadPauseAll}
                title={labels.downloadPauseAll}
                onClick={actions.onPauseAllDownloads}
              >
                <Pause size={14} aria-hidden="true" />
              </AppIconButton>
            ) : null}
            {canResumeAll ? (
              <AppIconButton
                type="button"
                aria-label={labels.downloadResumeAll}
                title={labels.downloadResumeAll}
                onClick={actions.onResumeAllDownloads}
              >
                <Play size={14} aria-hidden="true" />
              </AppIconButton>
            ) : null}
            {canCancelAll ? (
              <AppIconButton
                type="button"
                tone="danger"
                aria-label={labels.downloadCancelAll}
                title={labels.downloadCancelAll}
                onClick={actions.onCancelAllDownloads}
              >
                <X size={14} aria-hidden="true" />
              </AppIconButton>
            ) : null}
            <AppIconButton
              type="button"
              aria-label={labels.downloadSettings}
              title={labels.downloadSettings}
              onClick={actions.onToggleDownloadSettings}
            >
              <Settings2 size={14} aria-hidden="true" />
            </AppIconButton>
          </div>
          <form className="lyra-file-manager-downloads-form" onSubmit={onSubmit}>
            <AppInput
              value={downloads.urlDraft}
              placeholder={labels.downloadUrlPlaceholder}
              onChange={(event) => {
                actions.onDownloadUrlDraftChange(event.target.value);
              }}
            />
            <AppIconButton
              type="button"
              active={downloads.advancedDraft.advancedOpen}
              aria-label={labels.downloadAdvancedOptions}
              title={labels.downloadAdvancedOptions}
              onClick={actions.onToggleDownloadAdvancedOptions}
            >
              <SlidersHorizontal size={14} aria-hidden="true" />
            </AppIconButton>
            <AppIconButton
              type="button"
              aria-label={labels.downloadImportClipboard}
              title={labels.downloadImportClipboard}
              onClick={actions.onImportDownloadUrlsFromClipboard}
            >
              <ClipboardPaste size={14} aria-hidden="true" />
            </AppIconButton>
            <AppIconButton
              type="button"
              aria-label={labels.downloadImportExternalBrowser}
              title={labels.downloadImportExternalBrowser}
              onClick={actions.onImportExternalBrowserDownloads}
            >
              <Import size={14} aria-hidden="true" />
            </AppIconButton>
            <AppIconButton
              type="submit"
              aria-label={labels.downloadAddUrl}
              title={labels.downloadAddUrl}
              disabled={downloads.urlDraft.trim().length === 0}
            >
              <Plus size={14} aria-hidden="true" />
            </AppIconButton>
          </form>
        </div>
      </header>

      {downloads.errorMessage === undefined ? null : (
        <div className="lyra-file-manager-downloads-error">{downloads.errorMessage}</div>
      )}

      <DownloadAdvancedOptionsPanel
        downloads={downloads}
        labels={labels}
        actions={actions}
      />

      <DownloadSettingsPanel
        downloads={downloads}
        labels={labels}
        actions={actions}
      />

      {downloads.isEmpty ? (
        <AppEmptyState className="lyra-file-manager-empty-state" title={labels.emptyDownloads} />
      ) : (
        <div className="lyra-app-group lyra-app-row-list lyra-file-manager-download-list">
          {downloads.tasks.map((task) => (
            <DownloadTaskRow
              key={task.id}
              task={task}
              labels={labels}
              actions={actions}
            />
          ))}
        </div>
      )}
    </div>
  );
};
