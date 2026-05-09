import { useEffect, useMemo, useRef, useState } from "react";
import { Monitor, Play, Square } from "lucide-react";
import RFB from "@novnc/novnc";

import type { AgentVmSummary, LyraDesktopApi } from "../../../shared/desktop-bridge";
import type { AgentVmSurfaceLabels } from "./types";

type ConsoleState = "idle" | "connecting" | "connected" | "disconnected" | "error";

type AgentVmConsoleFrameProps = {
  readonly desktopApi: LyraDesktopApi | null;
  readonly labels: AgentVmSurfaceLabels;
  readonly vm: AgentVmSummary | null;
  readonly busy: boolean;
  readonly onStart: (vmId: string) => void;
  readonly onStop: (vmId: string) => void;
};

const isRunning = (vm: AgentVmSummary | null): boolean => vm?.state === "running";

const compactValue = (value: unknown): string =>
  typeof value === "string" && value.trim().length > 0 ? value.trim() : "-";

const resolveConsoleStatus = (
  state: ConsoleState,
  labels: AgentVmSurfaceLabels
): string => {
  switch (state) {
    case "connecting":
      return labels.consoleConnecting;
    case "connected":
      return labels.consoleConnected;
    case "disconnected":
      return labels.consoleDisconnected;
    case "error":
      return labels.consoleUnavailable;
    case "idle":
    default:
      return labels.console;
  }
};

export const AgentVmConsoleFrame = ({
  desktopApi,
  labels,
  vm,
  busy,
  onStart,
  onStop
}: AgentVmConsoleFrameProps) => {
  const targetRef = useRef<HTMLDivElement | null>(null);
  const [consoleState, setConsoleState] = useState<ConsoleState>("idle");
  const [message, setMessage] = useState<string | null>(null);
  const [desktopName, setDesktopName] = useState<string | null>(null);
  const vmId = vm?.vmId ?? "";
  const hasVm = vm !== null;
  const running = isRunning(vm);
  const vncPort = vm?.vncPort ?? null;
  const api = desktopApi?.ai;

  const statusLabel = useMemo(
    () => resolveConsoleStatus(consoleState, labels),
    [consoleState, labels]
  );

  useEffect(() => {
    const target = targetRef.current;
    setDesktopName(null);
    setMessage(null);
    if (target !== null) {
      target.replaceChildren();
    }
    if (!hasVm) {
      setConsoleState("idle");
      setMessage(labels.empty);
      return;
    }
    if (!running) {
      setConsoleState("idle");
      setMessage(labels.consoleStopped);
      return;
    }
    if (typeof vncPort !== "number") {
      setConsoleState("error");
      setMessage(labels.consoleNoPort);
      return;
    }
    if (api?.connectAgentVmConsole === undefined || target === null) {
      setConsoleState("error");
      setMessage(labels.consoleUnavailable);
      return;
    }

    let disposed = false;
    let rfb: RFB | null = null;
    setConsoleState("connecting");
    setMessage(labels.consoleConnecting);

    const connect = async (): Promise<void> => {
      try {
        const consoleSession = await api.connectAgentVmConsole({ vmId });
        if (disposed) {
          return;
        }
        const nextRfb = new RFB(target, consoleSession.url, { shared: true });
        rfb = nextRfb;
        nextRfb.scaleViewport = true;
        nextRfb.resizeSession = true;
        nextRfb.showDotCursor = true;
        nextRfb.qualityLevel = 7;
        nextRfb.compressionLevel = 4;
        nextRfb.background =
          window.getComputedStyle(target).getPropertyValue("--lyra-bg-editor").trim() || "black";
        nextRfb.addEventListener("connect", () => {
          if (disposed) {
            return;
          }
          setConsoleState("connected");
          setMessage(null);
        });
        nextRfb.addEventListener("disconnect", (event) => {
          if (disposed) {
            return;
          }
          setConsoleState(event.detail?.clean === true ? "disconnected" : "error");
          setMessage(labels.consoleDisconnected);
        });
        nextRfb.addEventListener("desktopname", (event) => {
          if (disposed) {
            return;
          }
          setDesktopName(event.detail?.name ?? null);
        });
        nextRfb.addEventListener("securityfailure", () => {
          if (disposed) {
            return;
          }
          setConsoleState("error");
          setMessage(labels.consoleUnavailable);
        });
      } catch (error) {
        if (disposed) {
          return;
        }
        setConsoleState("error");
        setMessage(error instanceof Error ? error.message : labels.consoleUnavailable);
      }
    };

    void connect();

    return () => {
      disposed = true;
      rfb?.disconnect();
      target.replaceChildren();
    };
  }, [
    api,
    labels.consoleConnecting,
    labels.consoleDisconnected,
    labels.consoleNoPort,
    labels.consoleStopped,
    labels.consoleUnavailable,
    labels.empty,
    running,
    hasVm,
    vmId,
    vncPort
  ]);

  return (
    <section className="lyra-agent-vm-console-frame" aria-label={labels.console}>
      <div className="lyra-agent-vm-console-toolbar">
        <div className="lyra-agent-vm-console-title">
          <Monitor size={15} aria-hidden="true" />
          <span>{desktopName ?? labels.console}</span>
        </div>
        <div className="lyra-agent-vm-console-status">
          <span className={`lyra-agent-vm-console-dot lyra-agent-vm-console-dot-${consoleState}`} />
          <span>{statusLabel}</span>
        </div>
        <div className="lyra-agent-vm-console-controls">
          <span className="lyra-agent-vm-console-port">
            {labels.vncPort}: {typeof vncPort === "number" ? `127.0.0.1:${vncPort}` : "-"}
          </span>
          <span className="lyra-agent-vm-console-port">
            {labels.sshPort}: {typeof vm?.sshPort === "number" ? `127.0.0.1:${vm.sshPort}` : "-"}
          </span>
          <button
            type="button"
            className="lyra-agent-vm-icon-action"
            disabled={vm === null || busy || running}
            onClick={() => {
              if (vm !== null) {
                onStart(vm.vmId);
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
            disabled={vm === null || busy || !running}
            onClick={() => {
              if (vm !== null) {
                onStop(vm.vmId);
              }
            }}
            title={labels.stop}
            aria-label={labels.stop}
          >
            <Square size={12} aria-hidden="true" />
          </button>
        </div>
      </div>
      <div className="lyra-agent-vm-console-stage">
        <div className="lyra-agent-vm-console-target" ref={targetRef} />
        {message === null ? null : (
          <div className="lyra-agent-vm-console-overlay">
            <span>{message}</span>
            <span>{compactValue(vm?.imageId)}</span>
          </div>
        )}
      </div>
    </section>
  );
};
