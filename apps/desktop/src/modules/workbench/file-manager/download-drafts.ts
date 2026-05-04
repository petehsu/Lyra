import type {
  DownloadManagerChecksum,
  DownloadManagerEnqueueRequest,
  DownloadManagerProxySettings,
  DownloadManagerRemoteApiStatus,
  DownloadManagerSaveRule,
  DownloadManagerSettings,
  DownloadManagerUpdateSettingsRequest
} from "../../../shared/download-manager";
import type {
  FileManagerDownloadAdvancedDraft,
  FileManagerDownloadSaveRuleDraft,
  FileManagerDownloadSettingsDraft
} from "./types";

const createDraftId = (prefix: string): string => {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return `${prefix}-${crypto.randomUUID()}`;
  }
  return `${prefix}-${Math.random().toString(16).slice(2, 10)}`;
};

const splitListDraft = (value: string): readonly string[] | undefined => {
  const items = value
    .split(/[,\n]/u)
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
  return items.length === 0 ? undefined : [...new Set(items)];
};

const splitPositiveIntegerDraft = (value: string): readonly number[] | undefined => {
  const items = value
    .split(/[,\n]/u)
    .map((item) => item.trim())
    .filter((item) => item.length > 0)
    .map((item) => Number(item));
  if (items.length === 0) {
    return undefined;
  }
  if (items.some((item) => Number.isInteger(item) === false || item <= 0)) {
    throw new Error("BT file indexes must be positive integers.");
  }
  return [...new Set(items.map((item) => Math.min(10_000, item)))];
};

const joinListDraft = (value: readonly string[] | undefined): string =>
  value === undefined ? "" : value.join(", ");

const parsePositiveKibPerSecond = (
  value: string,
  errorMessage: string
): number | null => {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return null;
  }
  const kibPerSecond = Number(trimmed);
  if (Number.isFinite(kibPerSecond) === false || kibPerSecond <= 0) {
    throw new Error(errorMessage);
  }
  return Math.round(kibPerSecond * 1024);
};

const formatKibPerSecond = (value: number | null | undefined): string =>
  value === null || value === undefined ? "" : String(Math.round(value / 1024));

const formatMinuteOfDay = (value: number): string => {
  const clamped = Math.max(0, Math.min(1439, Math.round(value)));
  const hours = Math.floor(clamped / 60);
  const minutes = clamped % 60;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
};

const parseMinuteOfDay = (value: string): number => {
  const match = /^([01]?\d|2[0-3]):([0-5]\d)$/u.exec(value.trim());
  if (match === null) {
    throw new Error("Schedule time must use HH:MM.");
  }
  return Number(match[1]) * 60 + Number(match[2]);
};

const parseOptionalInteger = (
  value: string,
  options: {
    readonly min: number;
    readonly max: number;
    readonly multiplier?: number;
    readonly errorMessage: string;
  }
): number | undefined => {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return undefined;
  }
  const parsed = Number(trimmed);
  if (
    Number.isInteger(parsed) === false
    || parsed < options.min
    || parsed > options.max
  ) {
    throw new Error(options.errorMessage);
  }
  return parsed * (options.multiplier ?? 1);
};

const parseHeadersDraft = (value: string): Readonly<Record<string, string>> | undefined => {
  const headers: Record<string, string> = {};
  for (const rawLine of value.split(/\r?\n/u)) {
    const line = rawLine.trim();
    if (line.length === 0) {
      continue;
    }
    const separatorIndex = line.indexOf(":");
    if (separatorIndex <= 0) {
      throw new Error("Header lines must use Name: Value.");
    }
    const name = line.slice(0, separatorIndex).trim();
    const headerValue = line.slice(separatorIndex + 1).trim();
    if (name.length === 0 || headerValue.length === 0) {
      continue;
    }
    headers[name] = headerValue;
  }
  return Object.keys(headers).length === 0 ? undefined : headers;
};

const buildProxyDraft = (
  mode: DownloadManagerProxySettings["mode"],
  url: string
): DownloadManagerProxySettings | undefined => {
  if (mode === "system") {
    return undefined;
  }
  const trimmed = url.trim();
  return {
    mode,
    ...(trimmed.length === 0 ? {} : { url: trimmed })
  };
};

const buildChecksumDraft = (
  draft: FileManagerDownloadAdvancedDraft
): DownloadManagerChecksum | undefined => {
  if (draft.checksumAlgorithm === "none") {
    return undefined;
  }
  const expected = draft.checksumExpected.trim();
  if (expected.length === 0) {
    throw new Error("Checksum value is required.");
  }
  return {
    algorithm: draft.checksumAlgorithm,
    expected
  };
};

export const createDownloadAdvancedDraft = (): FileManagerDownloadAdvancedDraft => ({
  advancedOpen: false,
  cookieHeader: "",
  headersText: "",
  mirrorsText: "",
  btSelectedFileIndexesText: "",
  btTrackerUrlsText: "",
  partialFilePath: "",
  checksumAlgorithm: "none",
  checksumExpected: "",
  maxRetries: "",
  retryDelaySeconds: "",
  proxyMode: "system",
  proxyUrl: ""
});

export const createDownloadSaveRuleDraft = (
  rule?: DownloadManagerSaveRule
): FileManagerDownloadSaveRuleDraft => ({
  id: rule?.id ?? createDraftId("download-rule"),
  enabled: rule?.enabled ?? true,
  name: rule?.name ?? "",
  directory: rule?.directory ?? "",
  extensionsText: joinListDraft(rule?.extensions),
  hostContainsText: joinListDraft(rule?.hostContains),
  protocolsText: joinListDraft(rule?.protocols),
  tagsText: joinListDraft(rule?.tags)
});

export const createDownloadSettingsDraft = (
  settings: DownloadManagerSettings | null,
  remoteApiStatus: DownloadManagerRemoteApiStatus | null
): FileManagerDownloadSettingsDraft => ({
  speedLimitKibPerSecond: formatKibPerSecond(settings?.speedLimitBytesPerSecond),
  scheduleEnabled: settings?.schedule?.enabled ?? false,
  scheduleStartTime: formatMinuteOfDay(settings?.schedule?.startMinuteOfDay ?? 0),
  scheduleEndTime: formatMinuteOfDay(settings?.schedule?.endMinuteOfDay ?? 1439),
  scheduleOutsideAction: settings?.schedule?.outsideAction ?? "pause",
  scheduleOutsideSpeedLimitKibPerSecond: formatKibPerSecond(
    settings?.schedule?.outsideSpeedLimitBytesPerSecond
  ),
  proxyMode: settings?.proxy.mode ?? "system",
  proxyUrl: settings?.proxy.url ?? "",
  defaultCookieHeader: settings?.defaultCookieHeader ?? "",
  defaultHeadersText: Object.entries(settings?.defaultHeaders ?? {})
    .map(([name, value]) => `${name}: ${value}`)
    .join("\n"),
  autoExtract: settings?.postProcessing.autoExtract ?? false,
  deleteArchiveAfterExtract: settings?.postProcessing.deleteArchiveAfterExtract ?? false,
  detectSplitArchives: settings?.postProcessing.detectSplitArchives ?? true,
  extractDirectory: settings?.postProcessing.extractDirectory ?? "",
  btDhtEnabled: settings?.bt?.dhtEnabled ?? true,
  btPeerExchangeEnabled: settings?.bt?.peerExchangeEnabled ?? true,
  btLocalPeerDiscoveryEnabled: settings?.bt?.localPeerDiscoveryEnabled ?? true,
  btSeedTimeMinutes: String(settings?.bt?.seedTimeMinutes ?? 0),
  btTrackerUrlsText: joinListDraft(settings?.bt?.trackerUrls),
  btUploadLimitKibPerSecond: formatKibPerSecond(settings?.bt?.maxUploadBytesPerSecond),
  remoteHost: remoteApiStatus?.host ?? "127.0.0.1",
  remotePort: remoteApiStatus?.port === null || remoteApiStatus?.port === undefined
    ? ""
    : String(remoteApiStatus.port),
  remoteAllowLan: false,
  saveRules: (settings?.saveRules ?? []).map(createDownloadSaveRuleDraft)
});

export const buildDownloadEnqueueRequest = (
  text: string,
  draft: FileManagerDownloadAdvancedDraft
): DownloadManagerEnqueueRequest => {
  const headers = parseHeadersDraft(draft.headersText);
  const mirrors = splitListDraft(draft.mirrorsText);
  const btSelectedFileIndexes = splitPositiveIntegerDraft(draft.btSelectedFileIndexesText);
  const btTrackerUrls = splitListDraft(draft.btTrackerUrlsText);
  const partialFilePath = draft.partialFilePath.trim();
  const cookieHeader = draft.cookieHeader.trim();
  const proxy = buildProxyDraft(draft.proxyMode, draft.proxyUrl);
  const checksum = buildChecksumDraft(draft);
  const maxRetries = parseOptionalInteger(draft.maxRetries, {
    min: 0,
    max: 20,
    errorMessage: "Max retries must be between 0 and 20."
  });
  const retryDelayMs = parseOptionalInteger(draft.retryDelaySeconds, {
    min: 0,
    max: 60,
    multiplier: 1000,
    errorMessage: "Retry delay must be between 0 and 60 seconds."
  });
  return {
    text,
    ...(headers === undefined ? {} : { headers }),
    ...(cookieHeader.length === 0 ? {} : { cookieHeader }),
    ...(mirrors === undefined ? {} : { mirrors }),
    ...(btSelectedFileIndexes === undefined && btTrackerUrls === undefined
      ? {}
      : {
          bt: {
            ...(btSelectedFileIndexes === undefined
              ? {}
              : { selectedFileIndexes: btSelectedFileIndexes }),
            ...(btTrackerUrls === undefined ? {} : { trackerUrls: btTrackerUrls })
          }
        }),
    ...(partialFilePath.length === 0 ? {} : { partialFilePath }),
    ...(checksum === undefined ? {} : { checksum }),
    ...(maxRetries === undefined ? {} : { maxRetries }),
    ...(retryDelayMs === undefined ? {} : { retryDelayMs }),
    ...(proxy === undefined ? {} : { proxy })
  };
};

export const buildDownloadSettingsUpdate = (
  draft: FileManagerDownloadSettingsDraft
): DownloadManagerUpdateSettingsRequest => {
  const proxyUrl = draft.proxyUrl.trim();
  const extractDirectory = draft.extractDirectory.trim();
  const scheduleSpeedLimit = parsePositiveKibPerSecond(
    draft.scheduleOutsideSpeedLimitKibPerSecond,
    "Schedule speed limit must be a positive number."
  );
  return {
    speedLimitBytesPerSecond: parsePositiveKibPerSecond(
      draft.speedLimitKibPerSecond,
      "Speed limit must be a positive number."
    ),
    schedule: draft.scheduleEnabled
      ? {
          enabled: true,
          startMinuteOfDay: parseMinuteOfDay(draft.scheduleStartTime),
          endMinuteOfDay: parseMinuteOfDay(draft.scheduleEndTime),
          outsideAction: draft.scheduleOutsideAction,
          outsideSpeedLimitBytesPerSecond: scheduleSpeedLimit
        }
      : null,
    proxy: {
      mode: draft.proxyMode,
      ...(proxyUrl.length === 0 ? {} : { url: proxyUrl })
    },
    defaultHeaders: parseHeadersDraft(draft.defaultHeadersText) ?? {},
    defaultCookieHeader:
      draft.defaultCookieHeader.trim().length === 0
        ? null
        : draft.defaultCookieHeader.trim(),
    postProcessing: {
      autoExtract: draft.autoExtract,
      ...(extractDirectory.length === 0 ? {} : { extractDirectory }),
      deleteArchiveAfterExtract: draft.deleteArchiveAfterExtract,
      detectSplitArchives: draft.detectSplitArchives
    },
    bt: {
      dhtEnabled: draft.btDhtEnabled,
      peerExchangeEnabled: draft.btPeerExchangeEnabled,
      localPeerDiscoveryEnabled: draft.btLocalPeerDiscoveryEnabled,
      seedTimeMinutes: parseOptionalInteger(draft.btSeedTimeMinutes, {
        min: 0,
        max: 10_080,
        errorMessage: "Seed time must be between 0 and 10080 minutes."
      }) ?? 0,
      trackerUrls: splitListDraft(draft.btTrackerUrlsText) ?? [],
      maxUploadBytesPerSecond: parsePositiveKibPerSecond(
        draft.btUploadLimitKibPerSecond,
        "BT upload limit must be a positive number."
      )
    },
    saveRules: draft.saveRules
      .map((rule): DownloadManagerSaveRule | null => {
        const name = rule.name.trim();
        const directory = rule.directory.trim();
        if (name.length === 0 || directory.length === 0) {
          return null;
        }
        const extensions = splitListDraft(rule.extensionsText);
        const hostContains = splitListDraft(rule.hostContainsText);
        const protocols = splitListDraft(rule.protocolsText);
        const tags = splitListDraft(rule.tagsText);
        return {
          id: rule.id,
          enabled: rule.enabled,
          name,
          directory,
          ...(extensions === undefined ? {} : { extensions }),
          ...(hostContains === undefined ? {} : { hostContains }),
          ...(protocols === undefined ? {} : { protocols }),
          ...(tags === undefined ? {} : { tags })
        };
      })
      .filter((rule): rule is DownloadManagerSaveRule => rule !== null)
  };
};
