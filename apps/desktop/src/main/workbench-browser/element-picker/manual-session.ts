import type {
  WorkbenchBrowserElementPickerDisableCause,
  WorkbenchBrowserElementPickerState,
  WorkbenchBrowserEvent,
  WorkbenchBrowserHoveredElementInfo
} from "../../../shared/desktop-bridge";
import { createWorkbenchElementPickerOverlayRuntime } from "./overlay-runtime";
import type {
  WorkbenchElementPickerConsoleMessage,
  WorkbenchElementPickerDisableOptions,
  WorkbenchElementPickerSessionDeps,
  WorkbenchManualElementPickerSession,
} from "./types";

const publishState = (
  publishEvent: (event: WorkbenchBrowserEvent) => void,
  tabId: string,
  enabled: boolean,
  cause?: WorkbenchBrowserElementPickerDisableCause,
  errorCode?: WorkbenchBrowserElementPickerState["errorCode"]
): void => {
  publishEvent({
    kind: "element-picker-state",
    state: {
      tabId,
      enabled,
      ...(enabled ? { owner: "manual", phase: "idle" as const } : {}),
      ...(cause === undefined ? {} : { cause }),
      ...(errorCode === undefined ? {} : { errorCode })
    }
  });
};

export const createWorkbenchManualElementPickerSession = ({
  host,
  tabId,
  appearance,
  onDisableRequested
}: WorkbenchElementPickerSessionDeps): WorkbenchManualElementPickerSession => {
  let enabled = false;
  const runtime = createWorkbenchElementPickerOverlayRuntime({ host, tabId });

  const disable = async (
    cause: WorkbenchBrowserElementPickerDisableCause,
    options?: WorkbenchElementPickerDisableOptions
  ): Promise<void> => {
    const wasEnabled = enabled;
    enabled = false;
    await runtime.disable().catch(() => undefined);
    if (options?.publishState === false || wasEnabled === false) {
      return;
    }
    publishState(host.publishEvent, tabId, false, cause, options?.errorCode);
  };

  return {
    tabId,
    enable: async () => {
      const result = await runtime.enableManualMode(appearance);
      if (result.mainFrameSucceeded === false) {
        publishState(host.publishEvent, tabId, false, "script_error", "script_injection_failed");
        return {
          ok: false,
          hadUnavailableFrame: result.hadUnavailableFrame
        };
      }
      enabled = true;
      publishState(host.publishEvent, tabId, true);
      return {
        ok: true,
        hadUnavailableFrame: result.hadUnavailableFrame
      };
    },
    disable,
    handleConsoleMessage: (message: WorkbenchElementPickerConsoleMessage) => {
      if (enabled === false) {
        return { disableRequested: false };
      }
      if (message.kind === "hover") {
        const hover: WorkbenchBrowserHoveredElementInfo = {
          tabId,
          frameTreeNodeId: message.frameTreeNodeId,
          tagName: message.tagName,
          selectorPreview: message.selectorPreview,
          bounds: message.bounds,
          ...(message.role === undefined ? {} : { role: message.role }),
          ...(message.inputType === undefined ? {} : { inputType: message.inputType }),
          ...(message.ariaLabel === undefined ? {} : { ariaLabel: message.ariaLabel }),
          ...(message.placeholder === undefined ? {} : { placeholder: message.placeholder }),
          ...(message.textSnippet === undefined ? {} : { textSnippet: message.textSnippet }),
          ...(message.frameUrl === undefined ? {} : { frameUrl: message.frameUrl }),
          ...(message.crossOriginBoundary === true ? { crossOriginBoundary: true } : {})
        };
        host.publishEvent({ kind: "element-picker-hover", hover });
        return { disableRequested: false };
      }

      if (message.enabled === false) {
        const cause = message.cause ?? "script_error";
        onDisableRequested(cause);
        return { disableRequested: true, cause };
      }

      return { disableRequested: false };
    }
  };
};
