import { ipcMain, type BrowserWindow, type IpcMainInvokeEvent } from "electron";
import os from "node:os";

import {
  LYRA_CHANNELS,
  type AiComputerCloseAppRequest,
  type AiComputerFocusAppRequest,
  type AiComputerHostPlatform,
  type AiComputerHostStatus,
  type AiComputerOpenAppRequest,
  type AiComputerPowerOffRequest,
  type AiComputerPowerRequest,
  type AiComputerReadSessionRequest,
  type AiComputerSessionState,
  type AiComputerUpdateWindowFrameRequest,
  type AiComputerWindowActionRequest,
  type AiComputerWindowFrame
} from "../../shared/desktop-bridge";
import { loadComputerNativeBindings } from "./native-loader";
import type {
  ComputerNativeBindings,
  ComputerNativeLoadResult,
  NativeComputerCloseAppRequest,
  NativeComputerFinishPowerTransitionRequest,
  NativeComputerFocusAppRequest,
  NativeComputerOpenAppRequest,
  NativeComputerPowerOffRequest,
  NativeComputerPowerRequest,
  NativeComputerReadSessionRequest,
  NativeComputerUpdateWindowFrameRequest,
  NativeComputerWindowActionRequest
} from "./types";

const BOOT_TRANSITION_MS = 760;
const SHUTDOWN_TRANSITION_MS = 520;

const normalizeSessionId = (value: string): string => {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    throw new Error("computer sessionId is required");
  }
  return trimmed;
};

const normalizeAppInstanceId = (value: string): string => {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    throw new Error("computer appInstanceId is required");
  }
  return trimmed;
};

const normalizeWindowFrame = (frame: AiComputerWindowFrame): AiComputerWindowFrame => ({
  x: Number.isFinite(frame.x) ? Number(frame.x) : 0,
  y: Number.isFinite(frame.y) ? Number(frame.y) : 0,
  width: Number.isFinite(frame.width) ? Number(frame.width) : 0,
  height: Number.isFinite(frame.height) ? Number(frame.height) : 0
});

const normalizeOptionalText = (value: unknown): string | undefined => {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
};

const resolveHostPlatform = (platform: NodeJS.Platform): AiComputerHostPlatform => {
  if (platform === "darwin") {
    return "macos";
  }
  if (platform === "win32") {
    return "windows";
  }
  return "linux";
};

const resolveHostStatus = (): AiComputerHostStatus => {
  const platform = resolveHostPlatform(process.platform);
  return {
    platform,
    platformLabel:
      platform === "macos"
        ? "macOS"
        : platform === "windows"
          ? "Windows"
          : "Linux",
    hostname: os.hostname(),
    release: os.release(),
    osFlavor: platform === "macos" ? "macos" : platform === "windows" ? "windows" : "linux"
  };
};

export type ComputerIpcBridge = {
  readonly dispose: () => void;
  readonly loadResult: Extract<ComputerNativeLoadResult, { readonly ok: true }>;
  readonly nativeBindings: ComputerNativeBindings;
  readonly hostStatus: AiComputerHostStatus;
};

export const createComputerIpcBridge = (
  storageRoot: string,
  getWindow: () => BrowserWindow | null
): ComputerIpcBridge => {
  const loadResult = loadComputerNativeBindings();
  if (loadResult.ok === false) {
    throw new Error(
      `computer native unavailable: ${loadResult.errorMessage}\ntried paths:\n${loadResult.triedPaths.join("\n")}`
    );
  }

  const bindings = loadResult.bindings;
  const hostStatus = resolveHostStatus();
  const transitionTimers = new Map<string, NodeJS.Timeout>();

  const publishState = (state: AiComputerSessionState): void => {
    const window = getWindow();
    if (window === null || window.isDestroyed()) {
      return;
    }
    window.webContents.send(LYRA_CHANNELS.computerEvent, {
      sessionId: state.sessionId,
      state
    });
  };

  const clearTransitionTimer = (sessionId: string): void => {
    const existing = transitionTimers.get(sessionId);
    if (existing === undefined) {
      return;
    }
    clearTimeout(existing);
    transitionTimers.delete(sessionId);
  };

  const finishTransition = (request: NativeComputerFinishPowerTransitionRequest): void => {
    clearTransitionTimer(request.sessionId);
    try {
      const nextState = bindings.finishPowerTransition(request);
      publishState(nextState);
    } catch (error) {
      console.error(`[lyra-computer] failed to finish transition: ${String(error)}`);
    }
  };

  const scheduleTransitionFinish = (
    sessionId: string,
    targetState: Extract<AiComputerSessionState["powerState"], "on" | "off">
  ): void => {
    clearTransitionTimer(sessionId);
    const timeout = setTimeout(() => {
      finishTransition({
        sessionId,
        storageRoot,
        targetState
      });
    }, targetState === "on" ? BOOT_TRANSITION_MS : SHUTDOWN_TRANSITION_MS);
    transitionTimers.set(sessionId, timeout);
  };

  const normalizeReadRequest = (payload: AiComputerReadSessionRequest): NativeComputerReadSessionRequest => ({
    storageRoot,
    sessionId: normalizeSessionId(payload.sessionId)
  });

  const normalizePowerRequest = (payload: AiComputerPowerRequest): NativeComputerPowerRequest => ({
    storageRoot,
    sessionId: normalizeSessionId(payload.sessionId),
    reason: payload.reason
  });

  const normalizePowerOffRequest = (
    payload: AiComputerPowerOffRequest
  ): NativeComputerPowerOffRequest => ({
    storageRoot,
    sessionId: normalizeSessionId(payload.sessionId)
  });

  const normalizeOpenAppRequest = (payload: AiComputerOpenAppRequest): NativeComputerOpenAppRequest => {
    const title = normalizeOptionalText(payload.title);
    const appInstanceId = normalizeOptionalText(payload.appInstanceId);
    const filePath = normalizeOptionalText(payload.filePath);
    const directoryPath = normalizeOptionalText(payload.directoryPath);
    const address = normalizeOptionalText(payload.address);

    return {
      storageRoot,
      sessionId: normalizeSessionId(payload.sessionId),
      kind: payload.kind,
      ...(title === undefined ? {} : { title }),
      ...(appInstanceId === undefined ? {} : { appInstanceId }),
      ...(filePath === undefined ? {} : { filePath }),
      ...(directoryPath === undefined ? {} : { directoryPath }),
      ...(address === undefined ? {} : { address })
    };
  };

  const normalizeFocusRequest = (
    payload: AiComputerFocusAppRequest
  ): NativeComputerFocusAppRequest => ({
    storageRoot,
    sessionId: normalizeSessionId(payload.sessionId),
    appInstanceId: normalizeAppInstanceId(payload.appInstanceId)
  });

  const normalizeCloseRequest = (
    payload: AiComputerCloseAppRequest
  ): NativeComputerCloseAppRequest => ({
    storageRoot,
    sessionId: normalizeSessionId(payload.sessionId),
    appInstanceId: normalizeAppInstanceId(payload.appInstanceId)
  });

  const normalizeWindowActionRequest = (
    payload: AiComputerWindowActionRequest
  ): NativeComputerWindowActionRequest => ({
    storageRoot,
    sessionId: normalizeSessionId(payload.sessionId),
    appInstanceId: normalizeAppInstanceId(payload.appInstanceId)
  });

  const normalizeUpdateWindowFrameRequest = (
    payload: AiComputerUpdateWindowFrameRequest
  ): NativeComputerUpdateWindowFrameRequest => ({
    storageRoot,
    sessionId: normalizeSessionId(payload.sessionId),
    appInstanceId: normalizeAppInstanceId(payload.appInstanceId),
    frame: normalizeWindowFrame(payload.frame)
  });

  const handlers: Array<
    readonly [string, (event: IpcMainInvokeEvent, payload?: unknown) => unknown]
  > = [
    [
      LYRA_CHANNELS.computerReadSession,
      (_event, payload) => bindings.readSession(normalizeReadRequest(payload as AiComputerReadSessionRequest))
    ],
    [
      LYRA_CHANNELS.computerReadHostStatus,
      () => hostStatus
    ],
    [
      LYRA_CHANNELS.computerPowerOn,
      (_event, payload) => {
        const nextState = bindings.powerOnSession(normalizePowerRequest(payload as AiComputerPowerRequest));
        publishState(nextState);
        if (nextState.powerState === "booting") {
          scheduleTransitionFinish(nextState.sessionId, "on");
        }
        return nextState;
      }
    ],
    [
      LYRA_CHANNELS.computerPowerOff,
      (_event, payload) => {
        const nextState = bindings.powerOffSession(normalizePowerOffRequest(payload as AiComputerPowerOffRequest));
        publishState(nextState);
        if (nextState.powerState === "shutting_down") {
          scheduleTransitionFinish(nextState.sessionId, "off");
        }
        return nextState;
      }
    ],
    [
      LYRA_CHANNELS.computerOpenApp,
      (_event, payload) => {
        const nextState = bindings.openApp(normalizeOpenAppRequest(payload as AiComputerOpenAppRequest));
        publishState(nextState);
        return nextState;
      }
    ],
    [
      LYRA_CHANNELS.computerFocusApp,
      (_event, payload) => {
        const nextState = bindings.focusApp(normalizeFocusRequest(payload as AiComputerFocusAppRequest));
        publishState(nextState);
        return nextState;
      }
    ],
    [
      LYRA_CHANNELS.computerCloseApp,
      (_event, payload) => {
        const nextState = bindings.closeApp(normalizeCloseRequest(payload as AiComputerCloseAppRequest));
        publishState(nextState);
        return nextState;
      }
    ],
    [
      LYRA_CHANNELS.computerMoveAppWindow,
      (_event, payload) => {
        const nextState = bindings.moveAppWindow(
          normalizeUpdateWindowFrameRequest(payload as AiComputerUpdateWindowFrameRequest)
        );
        publishState(nextState);
        return nextState;
      }
    ],
    [
      LYRA_CHANNELS.computerResizeAppWindow,
      (_event, payload) => {
        const nextState = bindings.resizeAppWindow(
          normalizeUpdateWindowFrameRequest(payload as AiComputerUpdateWindowFrameRequest)
        );
        publishState(nextState);
        return nextState;
      }
    ],
    [
      LYRA_CHANNELS.computerMinimizeApp,
      (_event, payload) => {
        const nextState = bindings.minimizeApp(
          normalizeWindowActionRequest(payload as AiComputerWindowActionRequest)
        );
        publishState(nextState);
        return nextState;
      }
    ],
    [
      LYRA_CHANNELS.computerMaximizeApp,
      (_event, payload) => {
        const nextState = bindings.maximizeApp(
          normalizeWindowActionRequest(payload as AiComputerWindowActionRequest)
        );
        publishState(nextState);
        return nextState;
      }
    ],
    [
      LYRA_CHANNELS.computerRestoreApp,
      (_event, payload) => {
        const nextState = bindings.restoreApp(
          normalizeWindowActionRequest(payload as AiComputerWindowActionRequest)
        );
        publishState(nextState);
        return nextState;
      }
    ]
  ];

  for (const [channel, handler] of handlers) {
    ipcMain.handle(channel, handler);
  }

  return {
    dispose: () => {
      for (const [channel] of handlers) {
        ipcMain.removeHandler(channel);
      }
      for (const timer of transitionTimers.values()) {
        clearTimeout(timer);
      }
      transitionTimers.clear();
    },
    loadResult,
    nativeBindings: bindings,
    hostStatus
  };
};
