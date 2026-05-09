import { useMemo, useState } from "react";
import {
  Copy,
  Download,
  GitFork,
  KeyRound,
  Play,
  RefreshCw,
  Server,
  ShieldCheck,
  Square,
  Upload
} from "lucide-react";

import type { AgentVmPasswordRevealResult, AgentVmSummary } from "../../../shared/desktop-bridge";
import type { AgentVmProvisioningStage, AgentVmSurfaceLabels, AgentVmSurfaceProps } from "./types";
import { AgentVmConsoleFrame } from "./console-frame";
import {
  hasInstalledDefaultImage,
  mergeVmBindings,
  useAgentVmRuntime
} from "./use-agent-vm-runtime";

const compactValue = (value: unknown): string =>
  typeof value === "string" && value.trim().length > 0 ? value.trim() : "-";

const compactList = (values: readonly string[] | undefined): string =>
  values === undefined || values.length === 0 ? "-" : values.join(", ");

const isRunning = (vm: AgentVmSummary): boolean => vm.state === "running";

const isVmScopedToSession = (vm: AgentVmSummary, sessionId: string): boolean =>
  sessionId.length === 0 ||
  vm.binding?.ownerSessionId === sessionId ||
  vm.binding?.attachedSessionIds.includes(sessionId) === true;

const selectActiveVm = (
  vms: readonly AgentVmSummary[],
  selectedVmId: string | null,
  scopedSessionId: string
): AgentVmSummary | null => {
  const selected = vms.find((vm) => vm.vmId === selectedVmId);
  if (selected !== undefined) {
    return selected;
  }
  return (
    vms.find((vm) => isRunning(vm) && isVmScopedToSession(vm, scopedSessionId)) ??
    vms.find(isRunning) ??
    vms.find((vm) => isVmScopedToSession(vm, scopedSessionId)) ??
    vms[0] ??
    null
  );
};

const formatBytes = (value: number): string => {
  if (value <= 0 || Number.isFinite(value) === false) {
    return "0 B";
  }
  const units = ["B", "KB", "MB", "GB"];
  let unitIndex = 0;
  let next = value;
  while (next >= 1024 && unitIndex < units.length - 1) {
    next /= 1024;
    unitIndex += 1;
  }
  return `${next.toFixed(unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`;
};

const formatSpeed = (value: number): string =>
  value > 0 ? `${formatBytes(value)}/s` : "-";

const resolveProvisionLabel = (
  stage: AgentVmProvisioningStage,
  labels: AgentVmSurfaceLabels
): string => {
  switch (stage) {
    case "checking_image":
      return labels.checkingImage;
    case "downloading_image":
      return labels.downloadingImage;
    case "creating_vm":
      return labels.creatingVm;
    case "starting_vm":
      return labels.startingVm;
    case "idle":
    default:
      return labels.downloadAndStart;
  }
};

export const AgentVmSurface = (props: AgentVmSurfaceProps) => {
  const [selectedVmId, setSelectedVmId] = useState<string | null>(null);
  const [copiedPasswordVmId, setCopiedPasswordVmId] = useState<string | null>(null);
  const runtime = useAgentVmRuntime({
    desktopApi: props.desktopApi,
    labels: props.labels,
    ...(props.sessionId === undefined ? {} : { sessionId: props.sessionId }),
  });
  const labels = props.labels;
  const scopedSessionId = props.sessionId?.trim() ?? "";
  const vms = mergeVmBindings(runtime.state.vms, runtime.state.bindings);
  const activeVm = useMemo(
    () => selectActiveVm(vms, selectedVmId, scopedSessionId),
    [scopedSessionId, selectedVmId, vms]
  );
  const revealedPassword = activeVm === null
    ? null
    : runtime.state.revealedPasswords[activeVm.vmId] ?? null;
  const passwordBusy = activeVm !== null && runtime.state.revealingPasswordVmId === activeVm.vmId;
  const passwordCopied = activeVm !== null && copiedPasswordVmId === activeVm.vmId;
  const defaultImageInstalled = hasInstalledDefaultImage(runtime.state.images);
  const provisioning = runtime.state.creating || runtime.state.downloadingImage;
  const downloadStartDisabled = provisioning || !runtime.available;
  const importDisabled = runtime.state.importingImage || !runtime.available || props.desktopApi?.files === undefined;
  const provisionLabel = provisioning
    ? resolveProvisionLabel(runtime.state.provisioningStage, labels)
    : labels.downloadAndStart;
  const downloadPercent = runtime.state.downloadTotalBytes > 0
    ? Math.min(100, Math.round((runtime.state.downloadReceivedBytes / runtime.state.downloadTotalBytes) * 100))
    : 0;
  const showDownloadProgress = runtime.state.provisioningStage === "downloading_image";
  const copyRevealedPassword = async (
    password: AgentVmPasswordRevealResult
  ): Promise<void> => {
    if (navigator.clipboard === undefined) {
      return;
    }
    await navigator.clipboard.writeText(password.password);
    setCopiedPasswordVmId(password.vmId);
    window.setTimeout(() => {
      setCopiedPasswordVmId((current) => current === password.vmId ? null : current);
    }, 1200);
  };

  return (
    <section className="lyra-agent-vm-surface" aria-label={labels.title}>
      <header className="lyra-agent-vm-header">
        <div className="lyra-agent-vm-title-block">
          <span className="lyra-agent-vm-title-icon" aria-hidden="true">
            <Server size={16} />
          </span>
          <div>
            <h2>{labels.title}</h2>
            <p>{labels.subtitle}</p>
          </div>
        </div>
        <div className="lyra-agent-vm-header-actions">
          <span className="lyra-agent-vm-scope">
            {labels.scopedSession}: {scopedSessionId.length === 0 ? labels.noSessionScope : scopedSessionId}
          </span>
          <button
            type="button"
            className="lyra-agent-vm-action"
            disabled={importDisabled}
            onClick={() => {
              void runtime.actions.importDefaultImage();
            }}
          >
            <Upload size={13} aria-hidden="true" />
            <span>{labels.importImage}</span>
          </button>
          <button
            type="button"
            className="lyra-agent-vm-action lyra-agent-vm-action-primary"
            disabled={downloadStartDisabled}
            onClick={() => {
              void runtime.actions.downloadAndStart();
            }}
          >
            <Download size={13} aria-hidden="true" />
            <span>{provisionLabel}</span>
          </button>
          <button
            type="button"
            className="lyra-agent-vm-action"
            disabled={provisioning}
            onClick={() => {
              void runtime.actions.refresh();
            }}
          >
            <RefreshCw size={13} aria-hidden="true" />
            <span>{labels.refresh}</span>
          </button>
        </div>
      </header>

      {runtime.available ? null : (
        <div className="lyra-agent-vm-banner">{labels.unavailable}</div>
      )}
      {runtime.state.errorMessage === null ? null : (
        <div className="lyra-agent-vm-banner lyra-agent-vm-banner-error">
          {labels.actionFailed}: {runtime.state.errorMessage}
        </div>
      )}
      {provisioning ? (
        <div className="lyra-agent-vm-banner lyra-agent-vm-banner-progress">
          <span>{provisionLabel}</span>
          {showDownloadProgress ? (
            <span className="lyra-agent-vm-download-meter">
              <span className="lyra-agent-vm-download-track" aria-hidden="true">
                <span
                  className="lyra-agent-vm-download-fill"
                  style={{ width: `${downloadPercent}%` }}
                />
              </span>
              <span>
                {labels.downloadProgress}: {formatBytes(runtime.state.downloadReceivedBytes)}
                {runtime.state.downloadTotalBytes > 0
                  ? ` / ${formatBytes(runtime.state.downloadTotalBytes)}`
                  : ""}
                {" - "}
                {formatSpeed(runtime.state.downloadSpeedBytesPerSecond)}
              </span>
            </span>
          ) : null}
        </div>
      ) : null}
      {defaultImageInstalled ? (
        <div className="lyra-agent-vm-banner">
          {labels.defaultImage}: {labels.imageInstalled}
        </div>
      ) : (
        <div className="lyra-agent-vm-banner lyra-agent-vm-banner-row">
          <span>{labels.imageMissing}</span>
          <button
            type="button"
            className="lyra-agent-vm-action lyra-agent-vm-action-primary"
            disabled={downloadStartDisabled}
            onClick={() => {
              void runtime.actions.downloadAndStart();
            }}
          >
            <Download size={13} aria-hidden="true" />
            <span>{provisionLabel}</span>
          </button>
        </div>
      )}

      <div className="lyra-agent-vm-workbench">
        <div className="lyra-agent-vm-main">
          <AgentVmConsoleFrame
            desktopApi={props.desktopApi}
            labels={labels}
            vm={activeVm}
            busy={activeVm !== null && runtime.state.busyVmId === activeVm.vmId}
            onStart={(vmId) => {
              void runtime.actions.start(vmId);
            }}
            onStop={(vmId) => {
              void runtime.actions.stop(vmId);
            }}
          />
          <div className="lyra-agent-vm-console-note">{labels.liteProfile}</div>
        </div>
        <aside className="lyra-agent-vm-side" aria-label={labels.vmList}>
          <div className="lyra-agent-vm-side-section">
            <div className="lyra-agent-vm-side-heading">
              <span>{labels.activeVm}</span>
              <span>{compactValue(activeVm?.state)}</span>
            </div>
            <div className="lyra-agent-vm-detail-grid">
              <span>{labels.vmId}</span>
              <strong title={activeVm?.vmId ?? "-"}>{compactValue(activeVm?.vmId)}</strong>
              <span>{labels.image}</span>
              <strong title={compactValue(activeVm?.imageId)}>{compactValue(activeVm?.imageId)}</strong>
              <span>{labels.workspace}</span>
              <strong title={compactValue(activeVm?.workspaceRoot)}>
                {compactValue(activeVm?.workspaceRoot)}
              </strong>
              <span>{labels.ownerSession}</span>
              <strong title={activeVm?.binding?.ownerSessionId ?? "-"}>
                {compactValue(activeVm?.binding?.ownerSessionId)}
              </strong>
              <span>{labels.attachedSessions}</span>
              <strong title={compactList(activeVm?.binding?.attachedSessionIds)}>
                {compactList(activeVm?.binding?.attachedSessionIds)}
              </strong>
              <span>{labels.loginUser}</span>
              <strong title={revealedPassword?.username ?? labels.passwordUnavailable}>
                {revealedPassword?.username ?? "-"}
              </strong>
              <span>{labels.loginPassword}</span>
              <strong
                className="lyra-agent-vm-password-value"
                title={revealedPassword?.password ?? labels.passwordUnavailable}
              >
                {revealedPassword?.password ?? labels.passwordUnavailable}
              </strong>
            </div>
            <div className="lyra-agent-vm-side-actions">
              <button
                type="button"
                className="lyra-agent-vm-icon-action"
                disabled={activeVm === null || runtime.state.busyVmId === activeVm.vmId || isRunning(activeVm)}
                onClick={() => {
                  if (activeVm !== null) {
                    void runtime.actions.start(activeVm.vmId);
                  }
                }}
                title={labels.start}
                aria-label={labels.start}
              >
                <Play size={13} aria-hidden="true" />
              </button>
              <button
                type="button"
                className="lyra-agent-vm-icon-action"
                disabled={activeVm === null || runtime.state.busyVmId === activeVm.vmId || !isRunning(activeVm)}
                onClick={() => {
                  if (activeVm !== null) {
                    void runtime.actions.stop(activeVm.vmId);
                  }
                }}
                title={labels.stop}
                aria-label={labels.stop}
              >
                <Square size={12} aria-hidden="true" />
              </button>
              <button
                type="button"
                className="lyra-agent-vm-icon-action"
                disabled={activeVm === null || passwordBusy}
                onClick={() => {
                  if (activeVm !== null) {
                    void runtime.actions.revealPassword(activeVm.vmId);
                  }
                }}
                title={labels.showPassword}
                aria-label={labels.showPassword}
              >
                <KeyRound size={13} aria-hidden="true" />
              </button>
              <button
                type="button"
                className="lyra-agent-vm-icon-action"
                disabled={revealedPassword === null}
                onClick={() => {
                  if (revealedPassword !== null) {
                    void copyRevealedPassword(revealedPassword);
                  }
                }}
                title={passwordCopied ? labels.passwordCopied : labels.copyPassword}
                aria-label={passwordCopied ? labels.passwordCopied : labels.copyPassword}
              >
                <Copy size={13} aria-hidden="true" />
              </button>
              <button
                type="button"
                className="lyra-agent-vm-icon-action"
                disabled={activeVm === null || runtime.state.busyVmId === activeVm.vmId || scopedSessionId.length === 0}
                onClick={() => {
                  if (activeVm !== null) {
                    void runtime.actions.attach(activeVm.vmId);
                  }
                }}
                title={labels.attach}
                aria-label={labels.attach}
              >
                <Server size={13} aria-hidden="true" />
              </button>
              <button
                type="button"
                className="lyra-agent-vm-icon-action"
                disabled={activeVm === null || runtime.state.busyVmId === activeVm.vmId || scopedSessionId.length === 0}
                onClick={() => {
                  if (activeVm !== null) {
                    void runtime.actions.takeover(activeVm.vmId);
                  }
                }}
                title={labels.takeover}
                aria-label={labels.takeover}
              >
                <ShieldCheck size={13} aria-hidden="true" />
              </button>
              <button
                type="button"
                className="lyra-agent-vm-icon-action"
                disabled={activeVm === null || runtime.state.busyVmId === activeVm.vmId || scopedSessionId.length === 0}
                onClick={() => {
                  if (activeVm !== null) {
                    void runtime.actions.fork(activeVm.vmId);
                  }
                }}
                title={labels.fork}
                aria-label={labels.fork}
              >
                <GitFork size={13} aria-hidden="true" />
              </button>
              <button
                type="button"
                className="lyra-agent-vm-text-action"
                disabled={activeVm === null || runtime.state.busyVmId === activeVm.vmId || scopedSessionId.length === 0}
                onClick={() => {
                  if (activeVm !== null) {
                    void runtime.actions.inherit(activeVm.vmId);
                  }
                }}
              >
                {labels.inherit}
              </button>
            </div>
          </div>
          <div className="lyra-agent-vm-side-section lyra-agent-vm-side-section-fill">
            <div className="lyra-agent-vm-side-heading">
              <span>{labels.vmList}</span>
              <span>{vms.length}</span>
            </div>
            {runtime.state.status === "loading" ? (
              <div className="lyra-agent-vm-side-empty">{labels.loading}</div>
            ) : vms.length === 0 ? (
              <div className="lyra-agent-vm-side-empty">
                <span>{labels.empty}</span>
                <button
                  type="button"
                  className="lyra-agent-vm-action lyra-agent-vm-action-primary"
                  disabled={downloadStartDisabled}
                  onClick={() => {
                    void runtime.actions.downloadAndStart();
                  }}
                >
                  <Download size={13} aria-hidden="true" />
                  <span>{provisionLabel}</span>
                </button>
              </div>
            ) : (
              <div className="lyra-agent-vm-list" role="listbox" aria-label={labels.vmList}>
                {vms.map((vm) => (
                  <button
                    type="button"
                    className={
                      activeVm?.vmId === vm.vmId
                        ? "lyra-agent-vm-list-item lyra-agent-vm-list-item-active"
                        : "lyra-agent-vm-list-item"
                    }
                    key={vm.vmId}
                    onClick={() => {
                      setSelectedVmId(vm.vmId);
                    }}
                    role="option"
                    aria-selected={activeVm?.vmId === vm.vmId}
                  >
                    <span className="lyra-agent-vm-list-main">
                      <span className="lyra-agent-vm-state">
                        {isRunning(vm) ? <Play size={11} aria-hidden="true" /> : <Square size={10} aria-hidden="true" />}
                        {vm.vmId}
                      </span>
                      <span>{compactValue(vm.imageId)}</span>
                    </span>
                    <span>{compactValue(vm.state)}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </aside>
      </div>
    </section>
  );
};
