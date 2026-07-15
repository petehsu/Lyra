import type { WorkbenchVisualCaptureResult } from "../../../shared/workbench-observation";
import type {
  WorkbenchBrowserAgentElementBounds,
  WorkbenchBrowserAgentModeRequest,
  WorkbenchBrowserAgentQrDetectResult,
  WorkbenchBrowserAgentTargetMode
} from "../types";
import type { WorkbenchBrowserAgentControllerHost } from "./agent-controller-types";
import {
  cropQrCodeFromPngBase64,
  detectQrCodesInPngBase64
} from "./qr-detection-runtime";
import type { WorkbenchBrowserDetectedQrCode } from "../types";
import type { BrowserAgentPageTarget } from "./types";

type BrowserAgentQrControllerDeps = Pick<
  WorkbenchBrowserAgentControllerHost,
  | "captureTargetPage"
  | "createVisualFrame"
  | "publishBrowserAgentActivity"
  | "rememberVisualFrame"
  | "resolveBrowserAgentTarget"
>;

const coerceRegion = (value: unknown): WorkbenchBrowserAgentElementBounds | undefined => {
  if (value === null || typeof value !== "object") {
    return undefined;
  }
  const record = value as Record<string, unknown>;
  const x = Number(record.x);
  const y = Number(record.y);
  const width = Number(record.width);
  const height = Number(record.height);
  if (
    Number.isFinite(x) === false
    || Number.isFinite(y) === false
    || Number.isFinite(width) === false
    || Number.isFinite(height) === false
    || width <= 0
    || height <= 0
  ) {
    return undefined;
  }
  return {
    x: Math.round(x),
    y: Math.round(y),
    width: Math.round(width),
    height: Math.round(height)
  };
};

export const createBrowserAgentQrController = (deps: BrowserAgentQrControllerDeps) => {
  const {
    captureTargetPage,
    createVisualFrame,
    publishBrowserAgentActivity,
    rememberVisualFrame,
    resolveBrowserAgentTarget
  } = deps;

  const detectAgentPageQr = async (
    tabId: string,
    request?: WorkbenchBrowserAgentModeRequest & {
      readonly region?: WorkbenchBrowserAgentElementBounds;
      readonly maxCodes?: number;
      readonly cropQr?: boolean;
      readonly includePageCapture?: boolean;
      readonly cropPadding?: number;
    }
  ): Promise<WorkbenchBrowserAgentQrDetectResult> => {
    const target = await resolveBrowserAgentTarget(tabId, request, undefined);
    publishBrowserAgentActivity({
      tabId,
      targetMode: target.targetMode,
      action: "observe",
      visibleFollow: target.browserMode.visibleFollow,
      durationMs: 1_200
    });

    let capture: WorkbenchVisualCaptureResult;
    try {
      capture = await captureTargetPage(tabId, target);
    } catch (error) {
      if (
        error !== null
        && typeof error === "object"
        && (error as { readonly code?: unknown }).code === "background_visual_capture_unsupported"
      ) {
        return {
          ok: false,
          kind: "lyraLumenDetectQr",
          tabId,
          targetMode: target.targetMode,
          browserMode: target.browserMode,
          codes: [],
          coordinateSpace: "device-pixels",
          width: 0,
          height: 0,
          message: "QR detection requires a visible browser tab screenshot; background tabs cannot be captured.",
          nextRecommendedAction: "lyra_lumen.map"
        };
      }
      throw error;
    }

    const visualFrame = await createVisualFrame({
      tabId,
      target,
      imageWidth: capture.width,
      imageHeight: capture.height
    });
    rememberVisualFrame(tabId, target.targetMode, visualFrame);

    const region = request?.region ?? coerceRegion((request as Record<string, unknown> | undefined)?.region);
    const maxCodes = request?.maxCodes;
    const shouldCrop = request?.cropQr !== false;
    const cropPadding = request?.cropPadding ?? 8;
    const rawCodes = detectQrCodesInPngBase64(capture.imageBase64, {
      ...(region === undefined ? {} : { region }),
      ...(maxCodes === undefined ? {} : { maxCodes })
    });

    const codes: WorkbenchBrowserDetectedQrCode[] = [];
    for (const code of rawCodes) {
      if (shouldCrop) {
        const cropped = cropQrCodeFromPngBase64(capture.imageBase64, code.bounds, cropPadding);
        codes.push({
          ...code,
          cropArtifact: {
            mimeType: "image/png",
            imageBase64: cropped.imageBase64,
            width: cropped.width,
            height: cropped.height
          }
        });
      } else {
        codes.push(code);
      }
    }

    const nextRecommendedAction =
      codes.length > 0 ? "lyra_lumen.vact" : region === undefined ? "lyra_lumen.map" : "lyra_lumen.see";

    return {
      ok: true,
      kind: "lyraLumenDetectQr",
      tabId,
      targetMode: target.targetMode,
      browserMode: target.browserMode,
      codes,
      coordinateSpace: "device-pixels",
      captureId: visualFrame.captureId,
      width: capture.width,
      height: capture.height,
      visualFrame,
      ...(request?.includePageCapture === true
        ? {
            pageCapture: {
              mimeType: capture.mimeType,
              imageBase64: capture.imageBase64,
              width: capture.width,
              height: capture.height,
              visibleOnly: capture.visibleOnly
            }
          }
        : {}),
      message: codes.length > 0
        ? `Detected ${codes.length} QR code(s) in the current browser screenshot. Bounds are device-pixel coordinates compatible with lyra_lumen.vact via captureId ${visualFrame.captureId}.`
        : region === undefined
          ? "No QR codes were detected in the current browser screenshot."
          : "No QR codes were detected in the requested screenshot region.",
      nextRecommendedAction
    };
  };

  return {
    detectAgentPageQr
  };
};

export type { BrowserAgentQrControllerDeps };
