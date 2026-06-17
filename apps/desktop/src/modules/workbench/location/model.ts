import type {
  LocationCandidate,
  LocationCandidateSource,
  LocationResolvedAddress,
  LocationResolvedCandidate
} from "../../../shared/desktop-bridge";
import type {
  WorkbenchLocationFix,
  WorkbenchLocationSelection,
  WorkbenchLocationState
} from "./types";

export const LOCATION_CACHE_TTL_MS = 24 * 60 * 60 * 1000;

const PRECISION_SCORE: Record<LocationResolvedAddress["precision"], number> = {
  coordinate: 0,
  country: 1,
  region: 2,
  city: 3,
  district: 4,
  neighbourhood: 5,
  road: 6,
  house: 7,
  poi: 8
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object";

const readString = (record: Record<string, unknown>, key: string): string | undefined => {
  const value = record[key];
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
};

const readNumber = (record: Record<string, unknown>, key: string): number | undefined => {
  const value = record[key];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
};

const isConsent = (value: unknown): value is WorkbenchLocationState["consent"] =>
  value === "unknown" || value === "granted" || value === "denied";

const isValidCoordinate = (latitude: number, longitude: number): boolean =>
  latitude >= -90 && latitude <= 90 && longitude >= -180 && longitude <= 180;

export const formatCoordinateDisplayName = (latitude: number, longitude: number): string =>
  `${latitude.toFixed(5)}, ${longitude.toFixed(5)}`;

export const normalizeLocationState = (
  raw: string | null,
  nowMs = Date.now()
): WorkbenchLocationState => {
  if (raw === null || raw.trim().length === 0) {
    return {
      consent: "unknown",
      startupPromptAnswered: false
    };
  }
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!isRecord(parsed)) {
      throw new Error("invalid location state");
    }
    const consent = isConsent(parsed.consent) ? parsed.consent : "unknown";
    const startupPromptAnswered = parsed.startupPromptAnswered === true;
    const rawFix = parsed.fix;
    if (!isRecord(rawFix)) {
      return { consent, startupPromptAnswered };
    }
    const latitude = readNumber(rawFix, "latitude");
    const longitude = readNumber(rawFix, "longitude");
    const displayName = readString(rawFix, "displayName");
    const source = rawFix.source === "browser" || rawFix.source === "os" || rawFix.source === "ip"
      ? rawFix.source
      : undefined;
    const capturedAt = readString(rawFix, "capturedAt");
    const expiresAt = readString(rawFix, "expiresAt");
    const expiresAtMs = expiresAt === undefined ? NaN : Date.parse(expiresAt);
    if (
      latitude === undefined ||
      longitude === undefined ||
      displayName === undefined ||
      source === undefined ||
      capturedAt === undefined ||
      expiresAt === undefined ||
      Number.isFinite(expiresAtMs) === false ||
      expiresAtMs <= nowMs ||
      isValidCoordinate(latitude, longitude) === false
    ) {
      return { consent, startupPromptAnswered };
    }
    const accuracyMeters = readNumber(rawFix, "accuracyMeters");
    return {
      consent,
      startupPromptAnswered,
      fix: {
        displayName,
        latitude,
        longitude,
        source,
        capturedAt,
        expiresAt,
        ...(accuracyMeters === undefined ? {} : { accuracyMeters }),
        ...(isRecord(rawFix.address)
          ? { address: rawFix.address as LocationResolvedAddress }
          : {})
      }
    };
  } catch {
    return {
      consent: "unknown",
      startupPromptAnswered: false
    };
  }
};

export const serializeLocationState = (state: WorkbenchLocationState): string =>
  JSON.stringify(state);

const candidatePrecisionScore = (candidate: LocationResolvedCandidate): number =>
  candidate.source === "ip"
    ? Math.min(
        candidate.resolvedAddress === undefined
          ? 0
          : PRECISION_SCORE[candidate.resolvedAddress.precision] ?? 0,
        PRECISION_SCORE.city
      )
    : candidate.resolvedAddress === undefined
      ? 0
      : PRECISION_SCORE[candidate.resolvedAddress.precision] ?? 0;

const candidateSourceNameScore = (candidate: LocationResolvedCandidate): number => {
  const hasResolvedAddress = candidate.resolvedAddress !== undefined;
  const hasLabel = candidate.label !== undefined && candidate.label.trim().length > 0;
  if (candidate.source !== "ip" && hasResolvedAddress) return 5;
  if (candidate.source !== "ip" && hasLabel) return 2;
  if (candidate.source !== "ip") return 1;
  if (candidate.source === "ip" && (hasResolvedAddress || hasLabel)) return 0;
  return 0;
};

const candidateAccuracy = (candidate: LocationResolvedCandidate): number =>
  typeof candidate.accuracyMeters === "number" && Number.isFinite(candidate.accuracyMeters)
    ? candidate.accuracyMeters
    : Number.POSITIVE_INFINITY;

const candidateAccuracyRaw = (candidate: LocationCandidate): number =>
  typeof candidate.accuracyMeters === "number" && Number.isFinite(candidate.accuracyMeters)
    ? candidate.accuracyMeters
    : Number.POSITIVE_INFINITY;

export const isPhysicalLocationSource = (
  source: LocationCandidateSource
): boolean => source === "browser" || source === "os";

export const selectBestPhysicalLocationCandidate = (
  candidates: readonly LocationCandidate[]
): LocationCandidate | null => {
  const usable = candidates.filter((candidate) =>
    candidate.status === "ok" &&
    isPhysicalLocationSource(candidate.source) &&
    typeof candidate.latitude === "number" &&
    typeof candidate.longitude === "number" &&
    isValidCoordinate(candidate.latitude, candidate.longitude)
  );
  if (usable.length === 0) {
    return null;
  }
  const sorted = [...usable].sort((a, b) => {
    const accuracyDelta = candidateAccuracyRaw(a) - candidateAccuracyRaw(b);
    if (accuracyDelta !== 0) {
      return accuracyDelta;
    }
    const sourceDelta = (a.source === "os" ? 0 : 1) - (b.source === "os" ? 0 : 1);
    return sourceDelta;
  });
  return sorted[0] ?? null;
};

const candidateDisplayName = (candidate: LocationResolvedCandidate): string | null => {
  if (candidate.resolvedAddress?.displayName !== undefined) {
    return candidate.resolvedAddress.displayName;
  }
  if (candidate.label !== undefined && candidate.label.trim().length > 0) {
    return candidate.label.trim();
  }
  if (candidate.latitude !== undefined && candidate.longitude !== undefined) {
    return formatCoordinateDisplayName(candidate.latitude, candidate.longitude);
  }
  return null;
};

export const selectBestLocationCandidate = (
  candidates: readonly LocationResolvedCandidate[]
): WorkbenchLocationSelection | null => {
  const usable = candidates.filter((candidate) =>
    candidate.status === "ok" &&
    isPhysicalLocationSource(candidate.source) &&
    typeof candidate.latitude === "number" &&
    typeof candidate.longitude === "number" &&
    isValidCoordinate(candidate.latitude, candidate.longitude)
  );
  if (usable.length === 0) {
    return null;
  }
  const sorted = [...usable].sort((a, b) => {
    const nameScoreDelta = candidateSourceNameScore(b) - candidateSourceNameScore(a);
    if (nameScoreDelta !== 0) return nameScoreDelta;
    const precisionDelta = candidatePrecisionScore(b) - candidatePrecisionScore(a);
    if (precisionDelta !== 0) return precisionDelta;
    return candidateAccuracy(a) - candidateAccuracy(b);
  });
  const candidate = sorted[0];
  if (candidate === undefined) {
    return null;
  }
  const displayName = candidateDisplayName(candidate);
  return displayName === null ? null : { candidate, displayName };
};

export const createLocationFix = (
  selection: WorkbenchLocationSelection,
  now = new Date()
): WorkbenchLocationFix | null => {
  const { candidate, displayName } = selection;
  if (candidate.latitude === undefined || candidate.longitude === undefined) {
    return null;
  }
  const expiresAt = new Date(now.getTime() + LOCATION_CACHE_TTL_MS).toISOString();
  return {
    displayName,
    latitude: candidate.latitude,
    longitude: candidate.longitude,
    source: candidate.source,
    capturedAt: candidate.capturedAt,
    expiresAt,
    ...(candidate.accuracyMeters === undefined ? {} : { accuracyMeters: candidate.accuracyMeters }),
    ...(candidate.resolvedAddress === undefined ? {} : { address: candidate.resolvedAddress })
  };
};

export const normalizeBrowserPosition = (
  position: GeolocationPosition
): LocationCandidate => ({
  id: `browser-${Date.now()}`,
  source: "browser",
  status: "ok",
  latitude: position.coords.latitude,
  longitude: position.coords.longitude,
  accuracyMeters: position.coords.accuracy,
  capturedAt: new Date(position.timestamp || Date.now()).toISOString()
});
