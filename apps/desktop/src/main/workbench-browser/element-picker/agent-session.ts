import type {
  WorkbenchBrowserAgentTargetInfo,
  WorkbenchBrowserElementPickerAppearance,
  WorkbenchBrowserElementPickerDisableCause,
  WorkbenchBrowserElementPickerState,
  WorkbenchBrowserEvent
} from "../../../shared/desktop-bridge";
import { createWorkbenchElementPickerOverlayRuntime } from "./overlay-runtime";
import type {
  WorkbenchAgentElementPickerSession,
  WorkbenchElementPickerDisableOptions,
  WorkbenchElementPickerSessionHost
} from "./types";

const DEFAULT_APPEARANCE: WorkbenchBrowserElementPickerAppearance = {
  fontFamily: '"IBM Plex Sans", "Noto Sans SC", "PingFang SC", "Segoe UI", sans-serif',
  surfaceBackground:
    "linear-gradient(180deg, color-mix(in srgb, #ebebec 92%, transparent) 0%, color-mix(in srgb, #fafafa 88%, transparent) 100%)",
  surfaceBorder: "color-mix(in srgb, #c9c9ca 74%, transparent)",
  surfaceShadow: "0 7px 22px color-mix(in srgb, #dcdcdd 18%, transparent)",
  surfaceBackdropFilter: "blur(10px) saturate(1.08)",
  accentColor: "#7e8086",
  accentFill: "color-mix(in srgb, #7e8086 14%, transparent)",
  tagBackground: "color-mix(in srgb, #7e8086 12%, transparent)",
  tagText: "#58585a",
  textPrimary: "#242529",
  textSecondary: "#58585a",
  textMuted: "#7e8086",
  frameRadius: "8px",
  bubbleRadius: "10px",
  strokeWidth: "0.5px"
};

const publishState = (
  publishEvent: (event: WorkbenchBrowserEvent) => void,
  state: WorkbenchBrowserElementPickerState
): void => {
  publishEvent({ kind: "element-picker-state", state });
};

export const createWorkbenchAgentElementPickerSession = ({
  host,
  tabId
}: {
  readonly host: WorkbenchElementPickerSessionHost;
  readonly tabId: string;
}): WorkbenchAgentElementPickerSession => {
  const runtime = createWorkbenchElementPickerOverlayRuntime({ host, tabId });

  return {
    tabId,
    ensureMounted: async () => {
      const result = await runtime.prime(DEFAULT_APPEARANCE);
      return {
        ok: result.mainFrameSucceeded,
        hadUnavailableFrame: result.hadUnavailableFrame
      };
    },
    showTarget: async (target, appearance) => {
      const result = await runtime.setAgentTarget(target, appearance ?? DEFAULT_APPEARANCE);
      if (result.mainFrameSucceeded === false) {
        publishState(host.publishEvent, {
          tabId,
          enabled: false,
          cause: "script_error",
          errorCode: "script_injection_failed"
        });
        return false;
      }
      host.publishEvent({ kind: "element-picker-agent-target", target });
      publishState(host.publishEvent, {
        tabId,
        enabled: true,
        owner: target.owner,
        phase: target.phase,
        toolCallId: target.toolCallId,
        ...(result.hadUnavailableFrame ? { errorCode: "frame_unavailable" as const } : {})
      });
      return true;
    },
    clearTarget: async (publishStateAfter = true) => {
      await runtime.clearAgentTarget().catch(() => undefined);
      if (publishStateAfter) {
        publishState(host.publishEvent, {
          tabId,
          enabled: false,
          cause: "user_toggle"
        });
      }
    },
    disable: async (
      cause: WorkbenchBrowserElementPickerDisableCause,
      options?: WorkbenchElementPickerDisableOptions
    ) => {
      await runtime.disable().catch(() => undefined);
      if (options?.publishState === false) {
        return;
      }
      publishState(host.publishEvent, {
        tabId,
        enabled: false,
        cause,
        ...(options?.errorCode === undefined ? {} : { errorCode: options.errorCode })
      });
    }
  };
};
