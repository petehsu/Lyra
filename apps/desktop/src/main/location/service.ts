import { app, BrowserWindow, ipcMain, shell, type WebContents } from "electron";
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import {
  LYRA_CHANNELS,
  type LocationCandidate,
  type LocationHostCandidatesRequest,
  type LocationHostCandidatesResponse,
  type LocationResolvedAddress,
  type LocationResolvedCandidate,
  type LocationReverseGeocodeRequest,
  type LocationReverseGeocodeResponse
} from "../../shared/desktop-bridge";

const execFileAsync = promisify(execFile);
const REQUEST_TIMEOUT_MS = 10000;
const BROWSER_LOCATION_TIMEOUT_MS = 15000;
const BROWSER_LOCATION_MAXIMUM_AGE_MS = 10 * 60 * 1000;
const BROWSER_LOCATION_RETRY_DELAY_MS = 1500;
const BROWSER_LOCATION_HIGH_ACCURACY_TIMEOUT_MS = 10000;
const NOMINATIM_MIN_INTERVAL_MS = 1100;
const NOMINATIM_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const NOMINATIM_REVERSE_URL = "https://nominatim.openstreetmap.org/reverse";
const NOMINATIM_ATTRIBUTION = "OpenStreetMap contributors";
const USER_AGENT = "Lyra Desktop/0.1 location-permission";
const GEOCLUE_POLL_INTERVAL_MS = 500;

type ReverseCacheEntry = {
  readonly capturedAtMs: number;
  readonly address: LocationResolvedAddress | null;
};

let lastNominatimRequestAt = 0;
const reverseCache = new Map<string, ReverseCacheEntry>();

const nowIso = (): string => new Date().toISOString();

const sleep = async (ms: number): Promise<void> => {
  await new Promise((resolve) => setTimeout(resolve, ms));
};

const isFiniteLatitude = (value: number): boolean =>
  Number.isFinite(value) && value >= -90 && value <= 90;

const isFiniteLongitude = (value: number): boolean =>
  Number.isFinite(value) && value >= -180 && value <= 180;

const readNumber = (value: unknown): number | undefined =>
  typeof value === "number" && Number.isFinite(value) ? value : undefined;

const readString = (value: unknown): string | undefined =>
  typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;

const isPhysicalCandidate = (candidate: LocationCandidate): boolean =>
  candidate.source === "browser" || candidate.source === "os";

const candidateError = (
  source: LocationCandidate["source"],
  code: string,
  message: string
): LocationCandidate => ({
  id: `${source}-error`,
  source,
  status: code === "UNSUPPORTED" ? "unsupported" : "error",
  capturedAt: nowIso(),
  errorCode: code,
  errorMessage: message
});

const okCandidate = (
  source: LocationCandidate["source"],
  latitude: number,
  longitude: number,
  options: {
    readonly accuracyMeters?: number;
    readonly label?: string;
  } = {}
): LocationCandidate => ({
  id: `${source}-${Date.now()}`,
  source,
  status: "ok",
  latitude,
  longitude,
  ...(options.accuracyMeters === undefined ? {} : { accuracyMeters: options.accuracyMeters }),
  capturedAt: nowIso(),
  ...(options.label === undefined ? {} : { label: options.label })
});

const normalizeCandidate = (candidate: LocationCandidate): LocationCandidate | null => {
  if (candidate.status !== "ok") {
    return candidate;
  }
  if (
    typeof candidate.latitude !== "number" ||
    typeof candidate.longitude !== "number" ||
    isFiniteLatitude(candidate.latitude) === false ||
    isFiniteLongitude(candidate.longitude) === false
  ) {
    return null;
  }
  return candidate;
};

const resolveMacOsLocationExecutablePath = (): string | null => {
  const packagedBinary = join(process.resourcesPath, "location", "read-macos-location");
  if (app.isPackaged && existsSync(packagedBinary)) {
    return packagedBinary;
  }
  const stagedBinary = join(process.cwd(), "native/darwin-x64/read-macos-location");
  if (app.isPackaged && existsSync(stagedBinary)) {
    return stagedBinary;
  }
  const scriptPath = join(process.resourcesPath, "location", "read-macos-location.swift");
  if (app.isPackaged && existsSync(scriptPath)) {
    return scriptPath;
  }
  const adjacentScript = join(dirname(fileURLToPath(import.meta.url)), "read-macos-location.swift");
  if (app.isPackaged && existsSync(adjacentScript)) {
    return adjacentScript;
  }
  return null;
};

const readMacOsCandidate = async (): Promise<LocationCandidate> => {
  if (app.isPackaged === false) {
    return candidateError(
      "os",
      "OS_LOCATION_DEV_DEFERRED",
      "macOS OS location is provided by browser geolocation in dev; enable Location Services for Lyra"
    );
  }
  const executablePath = resolveMacOsLocationExecutablePath();
  if (executablePath === null) {
    return candidateError("os", "OS_LOCATION_UNAVAILABLE", "macOS location helper is missing");
  }
  const usesSwiftInterpreter = executablePath.endsWith(".swift");
  try {
    const { stdout } = await execFileAsync(
      usesSwiftInterpreter ? "swift" : executablePath,
      usesSwiftInterpreter ? [executablePath] : [],
      {
        timeout: REQUEST_TIMEOUT_MS + 2000
      }
    );
    const payload = JSON.parse(stdout.trim()) as Record<string, unknown>;
    const latitude = readNumber(payload.latitude);
    const longitude = readNumber(payload.longitude);
    if (latitude === undefined || longitude === undefined) {
      return candidateError("os", "OS_LOCATION_NO_COORDINATES", "macOS did not return coordinates");
    }
    const accuracyMeters = readNumber(payload.accuracyMeters);
    return okCandidate("os", latitude, longitude, {
      ...(accuracyMeters === undefined ? {} : { accuracyMeters })
    });
  } catch (error) {
    const stderrText = typeof error === "object" && error !== null && "stderr" in error
      ? String((error as { readonly stderr?: string }).stderr ?? "")
      : "";
    const message = stderrText.trim().length > 0
      ? stderrText.trim()
      : error instanceof Error
        ? error.message
        : String(error);
    return candidateError("os", "OS_LOCATION_UNAVAILABLE", message);
  }
};

const readWindowsCandidate = async (): Promise<LocationCandidate> => {
  const script = [
    "Add-Type -AssemblyName System.Device",
    "$watcher = New-Object System.Device.Location.GeoCoordinateWatcher",
    "$started = $watcher.TryStart($false, [TimeSpan]::FromSeconds(6))",
    "if (-not $started -or $watcher.Position.Location.IsUnknown) { throw 'no location available' }",
    "$loc = $watcher.Position.Location",
    "@{ latitude = $loc.Latitude; longitude = $loc.Longitude; accuracyMeters = $loc.HorizontalAccuracy } | ConvertTo-Json -Compress"
  ].join("; ");
  try {
    const { stdout } = await execFileAsync("powershell.exe", [
      "-NoProfile",
      "-NonInteractive",
      "-Command",
      script
    ], {
      timeout: REQUEST_TIMEOUT_MS
    });
    const payload = JSON.parse(stdout.trim()) as Record<string, unknown>;
    const latitude = readNumber(payload.latitude);
    const longitude = readNumber(payload.longitude);
    if (latitude === undefined || longitude === undefined) {
      return candidateError("os", "OS_LOCATION_NO_COORDINATES", "Windows did not return coordinates");
    }
    const accuracyMeters = readNumber(payload.accuracyMeters);
    return okCandidate("os", latitude, longitude, {
      ...(accuracyMeters === undefined ? {} : { accuracyMeters })
    });
  } catch (error) {
    return candidateError("os", "OS_LOCATION_UNAVAILABLE", error instanceof Error ? error.message : String(error));
  }
};

const parseGdbusObjectPath = (stdout: string): string | null => {
  const match = stdout.match(/objectpath '([^']+)'/);
  return match?.[1] ?? null;
};

const parseGdbusDouble = (stdout: string): number | null => {
  const match = stdout.match(/\(([+-]?\d+(?:\.\d+)?)/);
  const raw = match?.[1];
  if (raw === undefined) {
    return null;
  }
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
};

const readGeoClueProperty = async (
  clientPath: string,
  property: "Latitude" | "Longitude" | "Accuracy"
): Promise<number | null> => {
  const { stdout } = await execFileAsync("gdbus", [
    "call",
    "--system",
    "--dest",
    "org.freedesktop.GeoClue2",
    "--object-path",
    clientPath,
    "--method",
    "org.freedesktop.DBus.Properties.Get",
    "org.freedesktop.GeoClue2.Location",
    property
  ], {
    timeout: 2000
  });
  return parseGdbusDouble(stdout);
};

const readLinuxCandidate = async (): Promise<LocationCandidate> => {
  let clientPath: string | null = null;
  try {
    const { stdout: clientOut } = await execFileAsync("gdbus", [
      "call",
      "--system",
      "--dest",
      "org.freedesktop.GeoClue2",
      "--object-path",
      "/org/freedesktop/GeoClue2/Manager",
      "--method",
      "org.freedesktop.GeoClue2.Manager.GetClient",
      ""
    ], {
      timeout: REQUEST_TIMEOUT_MS
    });
    clientPath = parseGdbusObjectPath(clientOut);
    if (clientPath === null) {
      return candidateError("os", "OS_LOCATION_UNAVAILABLE", "GeoClue client path missing");
    }

    await execFileAsync("gdbus", [
      "call",
      "--system",
      "--dest",
      "org.freedesktop.GeoClue2",
      "--object-path",
      clientPath,
      "--method",
      "org.freedesktop.GeoClue2.Client.Start"
    ], {
      timeout: REQUEST_TIMEOUT_MS
    });

    const deadline = Date.now() + REQUEST_TIMEOUT_MS;
    while (Date.now() < deadline) {
      const latitude = await readGeoClueProperty(clientPath, "Latitude");
      const longitude = await readGeoClueProperty(clientPath, "Longitude");
      if (latitude !== null && longitude !== null && latitude !== 0 && longitude !== 0) {
        const accuracyMeters = await readGeoClueProperty(clientPath, "Accuracy");
        return okCandidate("os", latitude, longitude, {
          ...(accuracyMeters === null ? {} : { accuracyMeters })
        });
      }
      await sleep(GEOCLUE_POLL_INTERVAL_MS);
    }
    return candidateError("os", "OS_LOCATION_TIMEOUT", "GeoClue timed out waiting for coordinates");
  } catch (error) {
    return candidateError("os", "OS_LOCATION_UNAVAILABLE", error instanceof Error ? error.message : String(error));
  } finally {
    if (clientPath !== null) {
      try {
        await execFileAsync("gdbus", [
          "call",
          "--system",
          "--dest",
          "org.freedesktop.GeoClue2",
          "--object-path",
          clientPath,
          "--method",
          "org.freedesktop.GeoClue2.Client.Stop"
        ], {
          timeout: 2000
        });
      } catch {
        // Best-effort cleanup.
      }
    }
  }
};

const buildBrowserGeolocationScript = (
  timeoutMs: number,
  lowAccuracyFirst: boolean
): string => {
  const attempts = lowAccuracyFirst
    ? [
        `{ enableHighAccuracy: false, timeout: ${timeoutMs}, maximumAge: ${BROWSER_LOCATION_MAXIMUM_AGE_MS} }`,
        `{ enableHighAccuracy: true, timeout: ${BROWSER_LOCATION_HIGH_ACCURACY_TIMEOUT_MS}, maximumAge: 60000 }`
      ]
    : [
        `{ enableHighAccuracy: true, timeout: ${timeoutMs}, maximumAge: ${BROWSER_LOCATION_MAXIMUM_AGE_MS} }`
      ];
  return `new Promise((resolve, reject) => {
  if (!navigator.geolocation) {
    reject({ code: "UNSUPPORTED", message: "geolocation unavailable" });
    return;
  }
  const attempts = [${attempts.join(", ")}];
  const tryAttempt = (index) => {
    if (index >= attempts.length) {
      reject({ code: 3, message: "Timeout expired" });
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (position) => resolve({
        latitude: position.coords.latitude,
        longitude: position.coords.longitude,
        accuracyMeters: position.coords.accuracy
      }),
      (error) => {
        const canRetry = error.code === 3 && index < attempts.length - 1;
        if (canRetry) {
          tryAttempt(index + 1);
          return;
        }
        reject({ code: error.code, message: error.message });
      },
      attempts[index]
    );
  };
  tryAttempt(0);
})`;
};

const readBrowserPayloadFromWebContents = async (
  webContents: WebContents,
  timeoutMs = BROWSER_LOCATION_TIMEOUT_MS
): Promise<{
  readonly latitude: number;
  readonly longitude: number;
  readonly accuracyMeters: number;
}> => {
  const lowAccuracyFirst = process.platform === "darwin";
  return webContents.executeJavaScript(
    buildBrowserGeolocationScript(timeoutMs, lowAccuracyFirst),
    true
  ) as Promise<{
    readonly latitude: number;
    readonly longitude: number;
    readonly accuracyMeters: number;
  }>;
};

const readBrowserCandidateFromPayload = (
  payload: {
    readonly latitude: number;
    readonly longitude: number;
    readonly accuracyMeters: number;
  }
): LocationCandidate => {
  if (
    isFiniteLatitude(payload.latitude) === false ||
    isFiniteLongitude(payload.longitude) === false
  ) {
    return candidateError("browser", "BROWSER_LOCATION_INVALID", "Browser returned invalid coordinates");
  }
  return okCandidate("browser", payload.latitude, payload.longitude, {
    accuracyMeters: payload.accuracyMeters
  });
};

const readBrowserCandidateError = (error: unknown): LocationCandidate => {
  if (typeof error === "object" && error !== null && "code" in error && "message" in error) {
    const record = error as { readonly code: unknown; readonly message: unknown };
    const code = typeof record.code === "number" ? `GEOLOCATION_${record.code}` : "BROWSER_LOCATION_ERROR";
    const message = typeof record.message === "string" ? record.message : "Browser geolocation failed";
    return candidateError("browser", code, message);
  }
  return candidateError(
    "browser",
    "BROWSER_LOCATION_UNAVAILABLE",
    error instanceof Error ? error.message : String(error)
  );
};

const readBrowserCandidateInHiddenWindow = async (): Promise<LocationCandidate> => {
  let window: BrowserWindow | null = null;
  try {
    window = new BrowserWindow({
      show: false,
      width: 1,
      height: 1,
      skipTaskbar: true,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true
      }
    });
    await window.loadURL("about:blank");
    const payload = await readBrowserPayloadFromWebContents(window.webContents);
    return readBrowserCandidateFromPayload(payload);
  } catch (error) {
    return readBrowserCandidateError(error);
  } finally {
    if (window !== null && window.isDestroyed() === false) {
      window.destroy();
    }
  }
};

const shouldRetryBrowserGeolocation = (error: unknown): boolean => {
  if (typeof error !== "object" || error === null || !("code" in error)) {
    return false;
  }
  const code = (error as { readonly code: unknown }).code;
  return code === 1;
};

const annotateBrowserCandidateError = (candidate: LocationCandidate): LocationCandidate => {
  if (candidate.status !== "error" || process.platform !== "darwin" || app.isPackaged) {
    return candidate;
  }
  const devHint =
    "Enable Location Services for Lyra in System Settings > Privacy & Security > Location Services";
  const message = candidate.errorMessage ?? "Browser geolocation failed";
  return {
    ...candidate,
    errorMessage: message.includes("Lyra") ? message : `${message}. ${devHint}`
  };
};

const readBrowserCandidateInMain = async (
  readLocationConsentGranted: () => boolean,
  getWebContents: () => WebContents | null
): Promise<LocationCandidate> => {
  if (readLocationConsentGranted() === false) {
    return candidateError("browser", "PERMISSION_DENIED", "Lyra location consent is not granted");
  }
  const activeWebContents = getWebContents();
  if (activeWebContents !== null && activeWebContents.isDestroyed() === false) {
    let lastError: unknown = null;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const payload = await readBrowserPayloadFromWebContents(activeWebContents);
        return readBrowserCandidateFromPayload(payload);
      } catch (error) {
        lastError = error;
        if (attempt === 0 && shouldRetryBrowserGeolocation(error)) {
          console.warn("[lyra-location] main window geolocation failed, retrying after delay", error);
          await sleep(BROWSER_LOCATION_RETRY_DELAY_MS);
          continue;
        }
        break;
      }
    }
    if (process.platform === "darwin") {
      return annotateBrowserCandidateError(readBrowserCandidateError(lastError));
    }
    console.warn("[lyra-location] active window geolocation failed, retrying hidden window", lastError);
  }
  if (process.platform === "darwin") {
    return annotateBrowserCandidateError(
      candidateError("browser", "BROWSER_LOCATION_UNAVAILABLE", "Main window web contents unavailable")
    );
  }
  return readBrowserCandidateInHiddenWindow();
};

const readOsCandidate = async (): Promise<LocationCandidate> => {
  if (process.platform === "darwin") {
    return readMacOsCandidate();
  }
  if (process.platform === "win32") {
    return readWindowsCandidate();
  }
  if (process.platform === "linux") {
    return readLinuxCandidate();
  }
  return candidateError("os", "UNSUPPORTED", `OS location is unsupported on ${process.platform}`);
};

const cacheKeyForCandidate = (candidate: LocationCandidate): string | null => {
  if (candidate.status !== "ok" || candidate.latitude === undefined || candidate.longitude === undefined) {
    return null;
  }
  return `${candidate.latitude.toFixed(5)},${candidate.longitude.toFixed(5)}`;
};

const precisionRankFromAddress = (address: Record<string, unknown>): LocationResolvedAddress["precision"] => {
  if (readString(address.amenity) !== undefined || readString(address.shop) !== undefined) return "poi";
  if (readString(address.house_number) !== undefined) return "house";
  if (readString(address.road) !== undefined || readString(address.pedestrian) !== undefined) return "road";
  if (readString(address.neighbourhood) !== undefined || readString(address.suburb) !== undefined) return "neighbourhood";
  if (readString(address.city_district) !== undefined || readString(address.county) !== undefined) return "district";
  if (readString(address.city) !== undefined || readString(address.town) !== undefined || readString(address.village) !== undefined) return "city";
  if (readString(address.state) !== undefined || readString(address.region) !== undefined) return "region";
  return "country";
};

const displayNameFromNominatim = (payload: Record<string, unknown>): LocationResolvedAddress | null => {
  const address = payload.address;
  if (address === null || typeof address !== "object") {
    const displayName = readString(payload.display_name);
    return displayName === undefined
      ? null
      : {
          displayName,
          precision: "coordinate",
          attribution: NOMINATIM_ATTRIBUTION
        };
  }
  const record = address as Record<string, unknown>;
  const nameParts = [
    readString(record.amenity) ?? readString(record.shop) ?? readString(record.building),
    readString(record.house_number) === undefined || readString(record.road) === undefined
      ? readString(record.road) ?? readString(record.pedestrian)
      : `${readString(record.road)} ${readString(record.house_number)}`,
    readString(record.neighbourhood) ?? readString(record.suburb),
    readString(record.city_district) ?? readString(record.county),
    readString(record.city) ?? readString(record.town) ?? readString(record.village),
    readString(record.state),
    readString(record.country)
  ].filter((part): part is string => part !== undefined);
  const displayName = nameParts.length > 0 ? nameParts.slice(0, 4).join(", ") : readString(payload.display_name);
  if (displayName === undefined) {
    return null;
  }
  return {
    displayName,
    precision: precisionRankFromAddress(record),
    attribution: NOMINATIM_ATTRIBUTION
  };
};

const reverseGeocodeCandidate = async (
  candidate: LocationCandidate,
  locale: string | undefined
): Promise<LocationResolvedAddress | null> => {
  const key = cacheKeyForCandidate(candidate);
  if (key === null || candidate.latitude === undefined || candidate.longitude === undefined) {
    return null;
  }
  const cached = reverseCache.get(key);
  if (cached !== undefined && Date.now() - cached.capturedAtMs < NOMINATIM_CACHE_TTL_MS) {
    return cached.address;
  }
  const elapsed = Date.now() - lastNominatimRequestAt;
  if (elapsed < NOMINATIM_MIN_INTERVAL_MS) {
    await sleep(NOMINATIM_MIN_INTERVAL_MS - elapsed);
  }
  lastNominatimRequestAt = Date.now();
  try {
    const url = new URL(NOMINATIM_REVERSE_URL);
    url.searchParams.set("format", "jsonv2");
    url.searchParams.set("addressdetails", "1");
    url.searchParams.set("lat", String(candidate.latitude));
    url.searchParams.set("lon", String(candidate.longitude));
    url.searchParams.set("zoom", "18");
    if (locale !== undefined && locale.trim().length > 0) {
      url.searchParams.set("accept-language", locale.trim());
    }
    const response = await fetch(url, {
      headers: {
        accept: "application/json",
        "user-agent": USER_AGENT
      },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
    });
    if (!response.ok) {
      reverseCache.set(key, { capturedAtMs: Date.now(), address: null });
      return null;
    }
    const payload = await response.json() as Record<string, unknown>;
    const address = displayNameFromNominatim(payload);
    reverseCache.set(key, { capturedAtMs: Date.now(), address });
    return address;
  } catch {
    reverseCache.set(key, { capturedAtMs: Date.now(), address: null });
    return null;
  }
};

const normalizeLocale = (value: unknown): string | undefined =>
  typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;

const logLocationCandidates = (phase: string, candidates: readonly LocationCandidate[]): void => {
  const summary = candidates.map((candidate) => {
    if (candidate.status !== "ok") {
      const message = candidate.errorMessage === undefined
        ? ""
        : ` msg=${candidate.errorMessage}`;
      return `${candidate.source}:${candidate.status}:${candidate.errorCode ?? "unknown"}${message}`;
    }
    const accuracy = candidate.accuracyMeters === undefined
      ? "?"
      : Math.round(candidate.accuracyMeters);
    return `${candidate.source}:ok acc=${accuracy}`;
  });
  console.info(`[lyra-location] ${phase} ${summary.join(" | ") || "none"}`);
};

const selectBestPhysicalCandidate = (
  candidates: readonly LocationCandidate[]
): LocationCandidate | null => {
  const usable = candidates
    .map(normalizeCandidate)
    .filter((candidate): candidate is LocationCandidate => candidate !== null)
    .filter((candidate) =>
      candidate.status === "ok" &&
      isPhysicalCandidate(candidate) &&
      candidate.latitude !== undefined &&
      candidate.longitude !== undefined
    );
  if (usable.length === 0) {
    return null;
  }
  const sorted = [...usable].sort((a, b) => {
    const accuracyA = a.accuracyMeters ?? Number.POSITIVE_INFINITY;
    const accuracyB = b.accuracyMeters ?? Number.POSITIVE_INFINITY;
    if (accuracyA !== accuracyB) {
      return accuracyA - accuracyB;
    }
    return (a.source === "os" ? 0 : 1) - (b.source === "os" ? 0 : 1);
  });
  return sorted[0] ?? null;
};

const MAC_LOCATION_SETTINGS_TARGETS = [
  "x-apple.systempreferences:com.apple.settings.PrivacySecurity.extension?Privacy_LocationServices",
  "x-apple.systempreferences:com.apple.preference.security?Privacy_LocationServices"
] as const;

export const openSystemLocationSettings = async (): Promise<boolean> => {
  if (process.platform !== "darwin") {
    return false;
  }
  for (const target of MAC_LOCATION_SETTINGS_TARGETS) {
    try {
      await shell.openExternal(target);
      return true;
    } catch {
      // Try the next macOS settings deep link shape.
    }
  }
  return false;
};

export type LocationIpcBridgeOptions = {
  readonly readLocationConsentGranted: () => boolean;
  readonly getWebContents: () => WebContents | null;
};

export const createLocationIpcBridge = ({
  readLocationConsentGranted,
  getWebContents
}: LocationIpcBridgeOptions): { readonly dispose: () => void } => {
  ipcMain.handle(
    LYRA_CHANNELS.locationReadHostCandidates,
    async (_event, payload: unknown): Promise<LocationHostCandidatesResponse> => {
      const _request = payload as LocationHostCandidatesRequest | undefined;
      const [osCandidate, browserCandidate] = await Promise.all([
        readOsCandidate(),
        readBrowserCandidateInMain(readLocationConsentGranted, getWebContents)
      ]);
      const candidates = [osCandidate, browserCandidate]
        .map(normalizeCandidate)
        .filter((entry): entry is LocationCandidate => entry !== null);
      logLocationCandidates("host-candidates", candidates);
      return { candidates };
    }
  );

  ipcMain.handle(LYRA_CHANNELS.locationOpenSystemSettings, async (): Promise<boolean> =>
    openSystemLocationSettings()
  );

  ipcMain.handle(
    LYRA_CHANNELS.locationReverseGeocodeCandidates,
    async (_event, payload: unknown): Promise<LocationReverseGeocodeResponse> => {
      const request = payload as LocationReverseGeocodeRequest;
      const locale = normalizeLocale(request?.locale);
      const candidates = Array.isArray(request?.candidates)
        ? request.candidates
            .map(normalizeCandidate)
            .filter((candidate): candidate is LocationCandidate => candidate !== null)
            .filter(isPhysicalCandidate)
        : [];
      const best = selectBestPhysicalCandidate(candidates);
      if (best === null) {
        return { candidates: [] };
      }
      const address = await reverseGeocodeCandidate(best, locale);
      const resolved: LocationResolvedCandidate = {
        ...best,
        ...(address === null ? {} : { resolvedAddress: address })
      };
      return { candidates: [resolved] };
    }
  );

  return {
    dispose: () => {
      ipcMain.removeHandler(LYRA_CHANNELS.locationReadHostCandidates);
      ipcMain.removeHandler(LYRA_CHANNELS.locationOpenSystemSettings);
      ipcMain.removeHandler(LYRA_CHANNELS.locationReverseGeocodeCandidates);
    }
  };
};