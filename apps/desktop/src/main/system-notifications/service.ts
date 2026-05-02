import {
  BrowserWindow,
  Notification,
  ipcMain,
  shell,
  type NotificationConstructorOptions
} from "electron";

import {
  LYRA_CHANNELS,
  type SystemNotificationAction,
  type SystemNotificationActionId,
  type SystemNotificationActivation,
  type SystemNotificationClickBehavior,
  type SystemNotificationLevel,
  type SystemNotificationMode,
  type SystemNotificationOpenSettingsResult,
  type SystemNotificationShowResult,
  type SystemNotificationStatus
} from "../../shared/desktop-bridge";

const MAX_TITLE_LENGTH = 120;
const MAX_BODY_LENGTH = 360;
const MAX_SOURCE_LENGTH = 80;
const MAX_ACTIONS = 4;
const MAX_ACTION_TITLE_LENGTH = 40;

type NormalizedSystemNotificationRequest = {
  readonly id: string;
  readonly title: string;
  readonly body?: string;
  readonly sourceTitle?: string;
  readonly level: SystemNotificationLevel;
  readonly mode: SystemNotificationMode;
  readonly clickBehavior: SystemNotificationClickBehavior;
  readonly actions: readonly SystemNotificationAction[];
};

type SystemNotificationsIpcBridgeParams = {
  readonly getWindow: () => BrowserWindow | null;
  readonly iconPath: string | null;
  readonly appUserModelId: string;
};

export type SystemNotificationsIpcBridge = {
  readonly dispose: () => void;
  readonly readStatus: () => SystemNotificationStatus;
  readonly openSettings: () => Promise<SystemNotificationOpenSettingsResult>;
  readonly show: (request: unknown) => SystemNotificationShowResult;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const normalizeText = (
  value: unknown,
  maxLength: number
): string | undefined => {
  if (typeof value !== "string") {
    return undefined;
  }
  const normalized = value.replace(/\s+/gu, " ").trim();
  if (normalized.length === 0) {
    return undefined;
  }
  return normalized.length > maxLength
    ? `${normalized.slice(0, Math.max(0, maxLength - 3)).trimEnd()}...`
    : normalized;
};

const normalizeLevel = (value: unknown): SystemNotificationLevel =>
  value === "success" || value === "warning" || value === "error" ? value : "info";

const normalizeMode = (value: unknown): SystemNotificationMode =>
  value === "off" || value === "all" ? value : "background";

const normalizeClickBehavior = (value: unknown): SystemNotificationClickBehavior =>
  value === "open_source" ? "open_source" : "open_center";

const normalizeActionId = (value: unknown): SystemNotificationActionId | null =>
  value === "open-center" || value === "open-source" || value === "mark-read" ? value : null;

const normalizeActions = (
  value: unknown,
  actionsEnabled: boolean
): readonly SystemNotificationAction[] => {
  if (actionsEnabled === false || Array.isArray(value) === false) {
    return [];
  }

  const actions: SystemNotificationAction[] = [];
  const seen = new Set<SystemNotificationActionId>();
  for (const entry of value) {
    if (isRecord(entry) === false) {
      continue;
    }
    const id = normalizeActionId(entry.id);
    const title = normalizeText(entry.title, MAX_ACTION_TITLE_LENGTH);
    if (id === null || title === undefined || seen.has(id)) {
      continue;
    }
    seen.add(id);
    actions.push({ id, title });
    if (actions.length >= MAX_ACTIONS) {
      break;
    }
  }
  return actions;
};

export const normalizeSystemNotificationRequestForTests = (
  payload: unknown
): NormalizedSystemNotificationRequest | null => {
  if (isRecord(payload) === false) {
    return null;
  }

  const id = normalizeText(payload.id, 160);
  const title = normalizeText(payload.title, MAX_TITLE_LENGTH);
  if (id === undefined || title === undefined) {
    return null;
  }

  const actionsEnabled = typeof payload.actionsEnabled === "boolean" ? payload.actionsEnabled : false;
  const body = normalizeText(payload.body, MAX_BODY_LENGTH);
  const sourceTitle = normalizeText(payload.sourceTitle, MAX_SOURCE_LENGTH);

  return {
    id,
    title,
    ...(body === undefined ? {} : { body }),
    ...(sourceTitle === undefined ? {} : { sourceTitle }),
    level: normalizeLevel(payload.level),
    mode: normalizeMode(payload.mode),
    clickBehavior: normalizeClickBehavior(payload.clickBehavior),
    actions: normalizeActions(payload.actions, actionsEnabled)
  };
};

export const shouldShowSystemNotificationForMode = (
  mode: SystemNotificationMode,
  window: Pick<BrowserWindow, "isFocused" | "isMinimized" | "isVisible"> | null
): boolean => {
  if (mode === "off") {
    return false;
  }
  if (mode === "all") {
    return true;
  }
  if (window === null) {
    return true;
  }
  return window.isFocused() === false || window.isMinimized() || window.isVisible() === false;
};

const resolveDefaultActionId = (
  clickBehavior: SystemNotificationClickBehavior
): SystemNotificationActionId =>
  clickBehavior === "open_source" ? "open-source" : "open-center";

const resolveActionSupport = (): SystemNotificationStatus["actionSupport"] => {
  if (process.platform === "darwin") {
    return "native";
  }
  if (process.platform === "win32") {
    return "windows-toast";
  }
  return "none";
};

const resolveCanOpenNotificationSettings = (): boolean =>
  process.platform === "darwin" || process.platform === "win32" || process.platform === "linux";

const resolveNotificationSettingsTargets = (): readonly string[] => {
  if (process.platform === "darwin") {
    return [
      "x-apple.systempreferences:com.apple.preference.notifications",
      "x-apple.systempreferences:com.apple.Notifications-Settings.extension"
    ];
  }
  if (process.platform === "win32") {
    return ["ms-settings:notifications"];
  }
  if (process.platform === "linux") {
    return [
      "settings://notifications",
      "gnome-control-center://notifications"
    ];
  }
  return [];
};

export const openSystemNotificationSettingsForTests = async (): Promise<SystemNotificationOpenSettingsResult> => {
  const targets = resolveNotificationSettingsTargets();
  if (targets.length === 0) {
    return {
      opened: false,
      reason: "unsupported-platform"
    };
  }

  for (const target of targets) {
    try {
      await shell.openExternal(target);
      return {
        opened: true,
        target
      };
    } catch (_error) {
      continue;
    }
  }

  const fallbackTarget = targets[0];
  return {
    opened: false,
    ...(fallbackTarget === undefined ? {} : { target: fallbackTarget }),
    reason: "open-failed"
  };
};

const escapeXml = (value: string): string =>
  value
    .replace(/&/gu, "&amp;")
    .replace(/</gu, "&lt;")
    .replace(/>/gu, "&gt;")
    .replace(/"/gu, "&quot;")
    .replace(/'/gu, "&apos;");

const escapeToastArgument = (value: string): string =>
  encodeURIComponent(value).replace(/%20/gu, "+");

export const buildWindowsToastXmlForTests = (
  request: NormalizedSystemNotificationRequest
): string => {
  const bodyText = request.body ?? request.sourceTitle ?? "";
  const actionXml = request.actions
    .map((action) =>
      `<action content="${escapeXml(action.title)}" arguments="lyra-action=${escapeToastArgument(action.id)}" activationType="foreground"/>`
    )
    .join("");
  return [
    '<toast activationType="foreground">',
    '<visual><binding template="ToastGeneric">',
    `<text>${escapeXml(request.title)}</text>`,
    bodyText.length === 0 ? "" : `<text>${escapeXml(bodyText)}</text>`,
    "</binding></visual>",
    actionXml.length === 0 ? "" : `<actions>${actionXml}</actions>`,
    "</toast>"
  ].join("");
};

const mapLevelToUrgency = (level: SystemNotificationLevel): "normal" | "critical" | "low" => {
  if (level === "error") {
    return "critical";
  }
  if (level === "warning") {
    return "normal";
  }
  return "low";
};

const buildNotificationOptions = (
  request: NormalizedSystemNotificationRequest,
  iconPath: string | null
): NotificationConstructorOptions => {
  const body = request.body ?? request.sourceTitle;
  const baseOptions: NotificationConstructorOptions = {
    title: request.title,
    ...(body === undefined ? {} : { body }),
    silent: false,
    urgency: mapLevelToUrgency(request.level),
    timeoutType: request.level === "error" ? "never" : "default",
    ...(iconPath === null ? {} : { icon: iconPath })
  };

  if (request.actions.length === 0) {
    return baseOptions;
  }

  if (process.platform === "darwin") {
    return {
      ...baseOptions,
      actions: request.actions.map((action) => ({
        type: "button",
        text: action.title
      }))
    };
  }

  if (process.platform === "win32") {
    return {
      ...baseOptions,
      toastXml: buildWindowsToastXmlForTests(request)
    };
  }

  return baseOptions;
};

const focusWindow = (window: BrowserWindow): void => {
  if (window.isDestroyed()) {
    return;
  }
  if (window.isMinimized()) {
    window.restore();
  }
  if (window.isVisible() === false) {
    window.show();
  }
  window.focus();
};

export const createSystemNotificationsIpcBridge = ({
  getWindow,
  iconPath,
  appUserModelId
}: SystemNotificationsIpcBridgeParams): SystemNotificationsIpcBridge => {
  const activeNotifications = new Map<string, Notification>();

  const readStatus = (): SystemNotificationStatus => ({
    platform: process.platform,
    supported: Notification.isSupported(),
    permission: Notification.isSupported() ? "unknown" : "unsupported",
    canNotify: Notification.isSupported(),
    canOpenSettings: resolveCanOpenNotificationSettings(),
    ...(process.platform === "win32" ? { appUserModelId } : {}),
    actionSupport: resolveActionSupport()
  });

  const openSettings = async (): Promise<SystemNotificationOpenSettingsResult> =>
    openSystemNotificationSettingsForTests();

  const publishActivation = (
    notificationId: string,
    actionId: SystemNotificationActionId
  ): void => {
    const window = getWindow();
    if (window === null || window.isDestroyed()) {
      return;
    }
    focusWindow(window);
    const activation: SystemNotificationActivation = {
      notificationId,
      actionId,
      activatedAt: Date.now()
    };
    window.webContents.send(LYRA_CHANNELS.systemNotificationsActivated, activation);
  };

  const show = (payload: unknown): SystemNotificationShowResult => {
    const request = normalizeSystemNotificationRequestForTests(payload);
    if (request === null) {
      return { status: "skipped", reason: "invalid" };
    }
    if (request.mode === "off") {
      return { status: "skipped", reason: "disabled" };
    }
    if (Notification.isSupported() === false) {
      return { status: "skipped", reason: "unsupported" };
    }

    const window = getWindow();
    if (shouldShowSystemNotificationForMode(request.mode, window) === false) {
      return { status: "skipped", reason: "foreground" };
    }

    const existingNotification = activeNotifications.get(request.id);
    if (existingNotification !== undefined) {
      existingNotification.close();
      activeNotifications.delete(request.id);
    }

    try {
      const notification = new Notification(buildNotificationOptions(request, iconPath));
      activeNotifications.set(request.id, notification);
      notification.on("click", () => {
        publishActivation(request.id, resolveDefaultActionId(request.clickBehavior));
      });
      notification.on("action", (event, legacyActionIndex) => {
        const actionEvent = event as { readonly actionIndex?: unknown };
        const actionIndex =
          typeof actionEvent.actionIndex === "number" ? actionEvent.actionIndex : legacyActionIndex;
        const action = request.actions[actionIndex];
        publishActivation(
          request.id,
          action?.id ?? resolveDefaultActionId(request.clickBehavior)
        );
      });
      notification.on("close", () => {
        activeNotifications.delete(request.id);
      });
      notification.on("failed", (_event, error) => {
        console.warn(`[lyra-system-notifications] notification failed: ${error}`);
      });
      notification.show();
      return {
        status: "shown",
        notificationId: request.id
      };
    } catch (error) {
      activeNotifications.delete(request.id);
      return {
        status: "failed",
        reason: "show-error",
        message: error instanceof Error ? error.message : String(error)
      };
    }
  };

  ipcMain.handle(LYRA_CHANNELS.systemNotificationsReadStatus, readStatus);
  ipcMain.handle(LYRA_CHANNELS.systemNotificationsShow, (_event, payload: unknown) => show(payload));
  ipcMain.handle(LYRA_CHANNELS.systemNotificationsOpenSettings, openSettings);

  return {
    readStatus,
    openSettings,
    show,
    dispose: () => {
      ipcMain.removeHandler(LYRA_CHANNELS.systemNotificationsReadStatus);
      ipcMain.removeHandler(LYRA_CHANNELS.systemNotificationsShow);
      ipcMain.removeHandler(LYRA_CHANNELS.systemNotificationsOpenSettings);
      for (const notification of activeNotifications.values()) {
        notification.close();
      }
      activeNotifications.clear();
    }
  };
};
