import type { WorkbenchBrowserElementPickerDisableCause } from "../../../shared/desktop-bridge";
import {
  WORKBENCH_ELEMENT_PICKER_CONSOLE_PREFIX,
  type WorkbenchElementPickerConsoleMessage
} from "./types";

const readString = (value: unknown, maxLength?: number): string | undefined => {
  if (typeof value !== "string") {
    return undefined;
  }
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length === 0) {
    return undefined;
  }
  if (maxLength === undefined || normalized.length <= maxLength) {
    return normalized;
  }
  return normalized.slice(0, maxLength);
};

const readNumber = (value: unknown): number | undefined => {
  if (typeof value !== "number" || Number.isFinite(value) === false) {
    return undefined;
  }
  return Math.round(value);
};

const readBounds = (value: unknown) => {
  if (value === null || typeof value !== "object") {
    return undefined;
  }
  const record = value as Record<string, unknown>;
  const x = readNumber(record.x);
  const y = readNumber(record.y);
  const width = readNumber(record.width);
  const height = readNumber(record.height);
  if (x === undefined || y === undefined || width === undefined || height === undefined) {
    return undefined;
  }
  return { x, y, width: Math.max(0, width), height: Math.max(0, height) };
};

export const parseElementPickerConsoleMessage = (
  message: string
): WorkbenchElementPickerConsoleMessage | null => {
  if (message.startsWith(WORKBENCH_ELEMENT_PICKER_CONSOLE_PREFIX) === false) {
    return null;
  }

  const payloadText = message.slice(WORKBENCH_ELEMENT_PICKER_CONSOLE_PREFIX.length);
  let payload: unknown;
  try {
    payload = JSON.parse(payloadText);
  } catch (_error) {
    return null;
  }

  if (payload === null || typeof payload !== "object") {
    return null;
  }
  const record = payload as Record<string, unknown>;
  if (record.kind === "state") {
    if (typeof record.enabled !== "boolean") {
      return null;
    }
    const cause = readString(record.cause) as WorkbenchBrowserElementPickerDisableCause | undefined;
    return {
      kind: "state",
      enabled: record.enabled,
      ...(cause === undefined ? {} : { cause })
    };
  }

  if (record.kind === "hover") {
    const frameTreeNodeId = readNumber(record.frameTreeNodeId);
    const tagName = readString(record.tagName, 64);
    const selectorPreview = readString(record.selectorPreview, 120);
    const bounds = readBounds(record.bounds);
    const role = readString(record.role, 64);
    const inputType = readString(record.inputType, 64);
    const ariaLabel = readString(record.ariaLabel, 160);
    const placeholder = readString(record.placeholder, 160);
    const textSnippet = readString(record.textSnippet, 160);
    const frameUrl = readString(record.frameUrl, 400);
    if (
      frameTreeNodeId === undefined
      || tagName === undefined
      || selectorPreview === undefined
      || bounds === undefined
    ) {
      return null;
    }

    return {
      kind: "hover",
      frameTreeNodeId,
      tagName,
      selectorPreview,
      bounds,
      ...(role === undefined ? {} : { role }),
      ...(inputType === undefined ? {} : { inputType }),
      ...(ariaLabel === undefined ? {} : { ariaLabel }),
      ...(placeholder === undefined ? {} : { placeholder }),
      ...(textSnippet === undefined ? {} : { textSnippet }),
      ...(frameUrl === undefined ? {} : { frameUrl }),
      ...(record.crossOriginBoundary === true ? { crossOriginBoundary: true } : {})
    };
  }

  return null;
};
