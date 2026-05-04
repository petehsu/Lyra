import { loadDownloadNativeBindings } from "./native-loader";
import type { DownloadNativeBindings } from "./native-types";

export type PlannedDownloadSegment = {
  readonly index: number;
  readonly start: number;
  readonly end: number | null;
};

type NativePlanSegment = {
  readonly index?: unknown;
  readonly start?: unknown;
  readonly endInclusive?: unknown;
};

type NativePlanResponse = {
  readonly segments?: unknown;
};

type NativePlanRequest = {
  readonly url: string;
  readonly totalBytes: number;
  readonly requestedConnections: number;
  readonly minSegmentBytes: number;
};

let cachedNativeBindings: DownloadNativeBindings | null | undefined;

const readNativeBindings = (): DownloadNativeBindings | null => {
  if (cachedNativeBindings !== undefined) {
    return cachedNativeBindings;
  }
  const loadResult = loadDownloadNativeBindings();
  cachedNativeBindings = loadResult.ok ? loadResult.bindings : null;
  return cachedNativeBindings;
};

const isValidNumber = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value) && value >= 0;

export const decodeNativeDownloadSegments = (value: unknown): readonly PlannedDownloadSegment[] | null => {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const response = value as NativePlanResponse;
  if (Array.isArray(response.segments) === false) {
    return null;
  }
  const segments: PlannedDownloadSegment[] = [];
  for (const entry of response.segments) {
    if (entry === null || typeof entry !== "object" || Array.isArray(entry)) {
      return null;
    }
    const segment = entry as NativePlanSegment;
    if (isValidNumber(segment.index) === false || isValidNumber(segment.start) === false) {
      return null;
    }
    if (segment.endInclusive !== null && segment.endInclusive !== undefined && isValidNumber(segment.endInclusive) === false) {
      return null;
    }
    segments.push({
      index: Math.round(segment.index),
      start: Math.round(segment.start),
      end: segment.endInclusive === null || segment.endInclusive === undefined
        ? null
        : Math.round(segment.endInclusive)
    });
  }
  return segments.length === 0 ? null : segments;
};

export const planDownloadSegmentsWithNativeFallback = (
  request: NativePlanRequest,
  fallback: () => readonly PlannedDownloadSegment[]
): readonly PlannedDownloadSegment[] => {
  const bindings = readNativeBindings();
  if (bindings === null) {
    return fallback();
  }
  try {
    const payload = JSON.stringify({
      url: request.url,
      totalBytes: request.totalBytes,
      requestedConnections: request.requestedConnections,
      minSegmentBytes: request.minSegmentBytes
    });
    const decoded = decodeNativeDownloadSegments(JSON.parse(bindings.planNativeDownloadJson(payload)));
    return decoded ?? fallback();
  } catch {
    return fallback();
  }
};
