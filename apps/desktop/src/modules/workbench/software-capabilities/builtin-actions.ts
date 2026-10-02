import type {
  LoginManagerAuthMethod,
  LoginManagerSnapshot,
  LyraDesktopApi,
  LyraSoftwareActionHandler,
  LyraSoftwareManifest
} from "../../../shared/desktop-bridge";
import { isLyraSensitiveValueRef } from "../../../shared/sensitive-value";
import type { BrowserSettingsCategoryId } from "../browser-tabs/settings-surface-types";
import { resolveWebSearchTarget } from "../browser-search/service";
import { WORKBENCH_CONFIG } from "../config";
import type { FileManagerModel } from "../file-manager";
import { isImageViewerSupportedPath, type ImageViewerModel } from "../image-viewer";
import { requestSoftwareStoreDetail } from "../software-store/service";
import type { SoftwareStoreLabels } from "../software-store/types";
import type { WorkspaceTabsModel } from "../workspace-tabs";
import {
  SETTING_CATEGORY_IDS
} from "./manifest";
import type { SoftwareStateReaders } from "./state-readers";
import {
  baseName,
  nonEmptyString,
  optionalBoolean,
  optionalLoginAuthMethodKind,
  optionalNumber,
  optionalString,
  parentDirectoryPath,
  requiredString,
  requirePermissionGranted,
  toRecord
} from "./validation";

export const createBuiltinHandlers = ({
  desktopApi,
  labels,
  tabsModel,
  fileManagerModel,
  imageViewerModel,
  software,
  stateReaders,
  refreshLoginManagerState,
  updateLoginManagerSnapshot,
  refreshSoftwarePacks,
  onOpenSettingsSection
}: {
  readonly desktopApi: LyraDesktopApi | null;
  readonly labels: SoftwareStoreLabels;
  readonly tabsModel: WorkspaceTabsModel;
  readonly fileManagerModel: FileManagerModel;
  readonly imageViewerModel?: ImageViewerModel | undefined;
  readonly software: readonly LyraSoftwareManifest[];
  readonly stateReaders: SoftwareStateReaders;
  readonly refreshLoginManagerState: () => Promise<unknown>;
  readonly updateLoginManagerSnapshot: (snapshot: LoginManagerSnapshot) => unknown;
  readonly refreshSoftwarePacks: () => Promise<void>;
  readonly onOpenSettingsSection: (categoryId: BrowserSettingsCategoryId) => void;
}): Map<string, LyraSoftwareActionHandler> => {
  const handlers = new Map<string, LyraSoftwareActionHandler>();
  const {
    readFileManagerState,
    readSoftwareState,
    readTerminalState
  } = stateReaders;

  handlers.set("browser-search.search", async (input) => {
    const query = requiredString(input, "query");
    const target = await resolveWebSearchTarget({
      desktopApi,
      query,
      searchEngines: WORKBENCH_CONFIG.browser.searchEngines
    });
    const selection = { mode: "auto" as const, engineIds: [] };
    const tabId = target === null
      ? ""
      : tabsModel.openWebSearchTabs(
          {
            query,
            targets: [{
              address: target.searchUrl,
              engineId: target.engine.id,
              title: target.engine.label
            }],
            selection
          },
          { target: "new-tab" }
        )[0] ?? "";
    return { opened: true, tabId, query };
  });
  handlers.set("browser-search.readState", () =>
    readSoftwareState({ softwareId: "browser-search" }));
  handlers.set("browser-search.readCurrentPage", async (input) => {
    const tabId = optionalString(input, "tabId");
    const state = await desktopApi?.browser?.readPageState(
      tabId === undefined ? {} : { tabId }
    );
    return {
      available: state !== null && state !== undefined,
      ...(state === null || state === undefined ? {} : { page: state })
    };
  });
  handlers.set("browser-search.searchInPage", async (input) => {
    const searchInPage = desktopApi?.browser?.searchInPage;
    if (searchInPage === undefined) {
      throw new Error("Browser search-in-page bridge is unavailable.");
    }
    const tabId = optionalString(input, "tabId");
    const maxMatches = optionalNumber(input, "maxMatches");
    const caseSensitive = optionalBoolean(input, "caseSensitive");
    return await searchInPage({
      query: requiredString(input, "query"),
      ...(tabId === undefined ? {} : { tabId }),
      ...(caseSensitive === undefined ? {} : { caseSensitive }),
      ...(maxMatches === undefined ? {} : { maxMatches })
    });
  });
  handlers.set("browser-search.readDownloads", async () => {
    const listDownloads = desktopApi?.downloads?.list;
    if (listDownloads === undefined) {
      return {
        available: false,
        message: "Download Manager bridge is unavailable.",
        fallback: readFileManagerState()
      };
    }
    const snapshot = await listDownloads();
    return {
      available: true,
      tasks: snapshot.tasks.map((task) => ({
        id: task.id,
        url: task.url,
        fileName: task.fileName,
        savePath: task.savePath,
        directory: task.directory,
        source: task.source,
        sourceTabId: task.sourceTabId,
        state: task.state,
        receivedBytes: task.receivedBytes,
        totalBytes: task.totalBytes,
        speedBytesPerSecond: task.speedBytesPerSecond,
        createdAt: task.createdAt,
        updatedAt: task.updatedAt,
        completedAt: task.completedAt,
        errorMessage: task.errorMessage,
        openTarget: task.state === "completed"
          ? {
              kind: "file",
              path: task.savePath
            }
          : undefined
      }))
    };
  });

  handlers.set("file-manager.openHome", async () => {
    const nextApp = fileManagerModel.createInstance();
    tabsModel.openAppTab(nextApp);
    await fileManagerModel.openHome(nextApp.appInstanceId);
    return { opened: true, appInstanceId: nextApp.appInstanceId };
  });
  handlers.set("file-manager.openPath", async (input) => {
    const path = requiredString(input, "path");
    const nextApp = fileManagerModel.createInstance();
    tabsModel.openAppTab(nextApp);
    await fileManagerModel.openDirectory(nextApp.appInstanceId, path, false);
    return {
      opened: true,
      appInstanceId: nextApp.appInstanceId,
      path,
      openTarget: {
        kind: "file",
        path
      }
    };
  });
  handlers.set("file-manager.readCurrentDirectory", () =>
    readSoftwareState({ softwareId: "file-manager" }));
  handlers.set("file-manager.revealPath", async (input) => {
    const path = requiredString(input, "path");
    const nextApp = fileManagerModel.createInstance();
    tabsModel.openAppTab(nextApp);
    await fileManagerModel.openDirectory(nextApp.appInstanceId, parentDirectoryPath(path), false);
    const state = fileManagerModel.getState(nextApp.appInstanceId);
    const entry = state?.entries.find((item) =>
      item.path === path || item.name === baseName(path)
    );
    if (entry !== undefined) {
      fileManagerModel.selectEntry(nextApp.appInstanceId, entry.id);
    }
    return {
      opened: true,
      appInstanceId: nextApp.appInstanceId,
      path,
      openTarget: {
        kind: "file",
        path
      },
      ...(entry === undefined ? {} : { selectedEntryId: entry.id })
    };
  });

  handlers.set("image-viewer.open", async (input) => {
    const path = requiredString(input, "path");
    if (!isImageViewerSupportedPath(path)) {
      throw new Error(`Not an image the viewer can open: ${path}`);
    }
    if (imageViewerModel === undefined) {
      throw new Error("Image viewer is unavailable.");
    }
    const existingInstanceId = imageViewerModel.findInstanceByPath(path);
    const existingTab = tabsModel.tabs.find((tab) =>
      tab.pageKind === "app"
      && tab.appId === "image-viewer"
      && tab.appInstanceId !== undefined
      && (existingInstanceId !== null
        ? tab.appInstanceId === existingInstanceId
        : tab.filePath === path)
    );
    if (existingTab?.appInstanceId !== undefined) {
      tabsModel.setActiveTab(existingTab.id);
      await imageViewerModel.openImage(existingTab.appInstanceId, path);
      return {
        opened: true,
        appInstanceId: existingTab.appInstanceId,
        tabId: existingTab.id,
        path,
        openTarget: { kind: "file" as const, path }
      };
    }
    const nextViewer = imageViewerModel.createInstance(path);
    const tabId = tabsModel.openAppTab(nextViewer);
    await imageViewerModel.openImage(nextViewer.appInstanceId, path);
    return {
      opened: true,
      appInstanceId: nextViewer.appInstanceId,
      tabId,
      path,
      openTarget: { kind: "file" as const, path }
    };
  });

  handlers.set("settings.openSection", (input) => {
    const section = optionalString(input, "section") ?? "general";
    const categoryId = SETTING_CATEGORY_IDS.has(section as BrowserSettingsCategoryId)
      ? section as BrowserSettingsCategoryId
      : "general";
    onOpenSettingsSection(categoryId);
    return { opened: true, section: categoryId };
  });

  handlers.set("login-manager.readState", async () => await refreshLoginManagerState());
  handlers.set("login-manager.logoutSite", async (input) => {
    requirePermissionGranted(input, "login-manager.logoutSite");
    if (desktopApi?.loginManager === undefined) {
      throw new Error("Login Manager bridge is unavailable.");
    }
    const request: {
      origin?: string;
      sessionId?: string;
      hostname?: string;
    } = {};
    const origin = optionalString(input, "origin");
    const sessionId = optionalString(input, "sessionId");
    const hostname = optionalString(input, "hostname");
    if (origin !== undefined) request.origin = origin;
    if (sessionId !== undefined) request.sessionId = sessionId;
    if (hostname !== undefined) request.hostname = hostname;
    const result = await desktopApi.loginManager.clearSite(request);
    await refreshLoginManagerState().catch(() => undefined);
    return result;
  });
  handlers.set("login-manager.updateAuthMethod", async (input) => {
    if (desktopApi?.loginManager === undefined) {
      throw new Error("Login Manager bridge is unavailable.");
    }
    const methodKind = optionalLoginAuthMethodKind(input, "methodKind");
    const methodLabel = optionalString(input, "methodLabel");
    const providerDomain = optionalString(input, "providerDomain");
    const request: {
      origin?: string;
      sessionId?: string;
      accountHint?: string;
      notes?: string;
      authMethod?: Partial<LoginManagerAuthMethod>;
    } = {};
    const origin = optionalString(input, "origin");
    const sessionId = optionalString(input, "sessionId");
    const accountHint = optionalString(input, "accountHint");
    const notes = optionalString(input, "notes");
    if (origin !== undefined) request.origin = origin;
    if (sessionId !== undefined) request.sessionId = sessionId;
    if (accountHint !== undefined) request.accountHint = accountHint;
    if (notes !== undefined) request.notes = notes;
    if (methodKind !== undefined) {
      request.authMethod = {
        kind: methodKind,
        label: methodLabel ?? methodKind,
        source: "manual",
        confidence: 1,
        ...(providerDomain === undefined ? {} : { providerDomain })
      };
    }
    const snapshot = await desktopApi.loginManager.updateSession(request);
    return updateLoginManagerSnapshot(snapshot);
  });
  handlers.set("login-manager.fillCredential", async (input) => {
    requirePermissionGranted(input, "login-manager.fillCredential");
    if (desktopApi?.loginManager === undefined) {
      throw new Error("Login Manager bridge is unavailable.");
    }
    const request: {
      credentialId?: string;
      origin?: string;
      tabId?: string;
      reason: string;
    } = { reason: "agent-request" };
    const credentialId = optionalString(input, "credentialId");
    const sensitiveValueRef = toRecord(input).sensitiveValueRef;
    const origin = optionalString(input, "origin");
    const tabId = optionalString(input, "tabId");
    if (
      isLyraSensitiveValueRef(sensitiveValueRef)
      && sensitiveValueRef.owner === "login-manager"
      && sensitiveValueRef.ownerRef.kind === "login-manager-credential"
      && sensitiveValueRef.capabilities.includes("fill")
    ) {
      request.credentialId = sensitiveValueRef.ownerRef.credentialId;
    } else if (credentialId !== undefined) {
      request.credentialId = credentialId;
    }
    if (origin !== undefined) request.origin = origin;
    if (tabId !== undefined) request.tabId = tabId;
    const result = await desktopApi.loginManager.fillCredential(request);
    await refreshLoginManagerState().catch(() => undefined);
    return {
      filled: result.filled,
      tabId: result.tabId,
      origin: result.origin,
      username: result.username,
      message: result.message
    };
  });

  handlers.set("software-store.open", () => {
    onOpenSettingsSection("softwareStore");
    return { opened: true };
  });
  handlers.set("software-store.listInstalledApps", () =>
    readSoftwareState({ softwareId: "software-store" }));
  handlers.set("software-store.openDetail", (input) => {
    const packId = optionalString(input, "packId");
    const softwareId = optionalString(input, "softwareId");
    const selected = packId === undefined
      ? (softwareId === undefined
          ? { kind: "software" as const, id: "software-store" }
          : { kind: "software" as const, id: softwareId })
      : { kind: "uiux" as const, id: packId };
    requestSoftwareStoreDetail(selected);
    onOpenSettingsSection("softwareStore");
    return {
      opened: true,
      selected,
      detail: selected.kind === "software"
        ? software.find((entry) => entry.id === selected.id)
        : toRecord(readSoftwareState({ softwareId: "software-store" }).state)
            .installed
    };
  });
  handlers.set("software-store.install", async (input) => {
    requirePermissionGranted(input, "software-store.install");
    if (desktopApi?.uiux === undefined) {
      throw new Error("UIUX bridge is unavailable.");
    }
    const sourceKind = requiredString(input, "sourceKind");
    const ref = optionalString(input, "ref");
    const subdir = optionalString(input, "subdir");
    const version = optionalString(input, "version");
    const installed =
      sourceKind === "local"
        ? await desktopApi.uiux.installFromLocal({
            sourcePath: requiredString(input, "sourcePath")
          })
        : sourceKind === "git"
          ? await desktopApi.uiux.installFromGit({
              url: requiredString(input, "url"),
              ...(ref === undefined ? {} : { ref }),
              ...(subdir === undefined ? {} : { subdir })
            })
          : sourceKind === "npm"
            ? await desktopApi.uiux.installFromNpm({
                packageName: requiredString(input, "packageName"),
                ...(version === undefined ? {} : { version }),
                ...(subdir === undefined ? {} : { subdir })
              })
            : null;
    if (installed === null) {
      throw new Error("sourceKind must be local, git, or npm.");
    }
    requestSoftwareStoreDetail({ kind: "uiux", id: installed.id });
    onOpenSettingsSection("softwareStore");
    await refreshSoftwarePacks();
    return {
      installed: true,
      packId: installed.id,
      trustState: installed.trustState,
      openTarget: {
        kind: "software-store-detail",
        packId: installed.id
      }
    };
  });
  handlers.set("software-store.uninstall", async (input) => {
    requirePermissionGranted(input, "software-store.uninstall");
    if (desktopApi?.uiux?.uninstall === undefined) {
      throw new Error("UIUX uninstall bridge is unavailable.");
    }
    const packId = requiredString(input, "packId");
    const result = await desktopApi.uiux.uninstall({ packId });
    await refreshSoftwarePacks();
    return {
      uninstalled: true,
      packId: result.packId
    };
  });

  handlers.set("terminal.readVisibleBuffer", async (input) => {
    const state = readTerminalState();
    const stateRecord = toRecord(state);
    const panes = Array.isArray(stateRecord.panes) ? stateRecord.panes : [];
    const requestedSessionId = optionalString(input, "sessionId");
    const activePaneId = nonEmptyString(stateRecord.activePaneId);
    const activePaneSessionId =
      activePaneId === null
        ? null
        : panes
          .map((pane) => toRecord(pane))
          .find((pane) => nonEmptyString(pane.paneId) === activePaneId)
          ?.sessionId;
    const activeSessionId =
      requestedSessionId
      ?? nonEmptyString(activePaneSessionId)
      ?? panes
        .map((pane) => nonEmptyString(toRecord(pane).sessionId))
        .find((sessionId) => sessionId !== null)
      ?? null;
    if (activeSessionId === null) {
      return {
        ...stateRecord,
        activeOutput: "",
        visibleBufferUnavailable: true,
        message: "No active terminal session is available."
      };
    }
    const read = desktopApi?.terminal?.read;
    if (read === undefined) {
      return {
        ...stateRecord,
        activeOutput: "",
        visibleBufferUnavailable: true,
        message: "Terminal read bridge is unavailable."
      };
    }
    const maxBytes = optionalNumber(input, "maxBytes");
    const waitMs = optionalNumber(input, "waitMs");
    const output = await read({
      sessionId: activeSessionId,
      cursor: "0",
      ...(maxBytes === undefined ? {} : { maxBytes }),
      ...(waitMs === undefined ? {} : { waitMs })
    });
    const matchedPane = requestedSessionId === null
      ? undefined
      : panes
        .map((pane) => toRecord(pane))
        .find((pane) => nonEmptyString(pane.sessionId) === requestedSessionId);
    return {
      ...stateRecord,
      ...(requestedSessionId === null
        ? {}
        : {
          activePaneId: matchedPane === undefined ? null : nonEmptyString(matchedPane.paneId)
        }),
      activeSessionId,
      activeOutput: output.output,
      visibleBufferUnavailable: false,
      cursor: output.cursor,
      running: output.running,
      exitCode: output.exitCode,
      truncated: output.truncated,
      source: output.source,
      mode: output.mode
    };
  });
  handlers.set("terminal.sendControlledInput", async (input) => {
    if (optionalBoolean(input, "riskPolicyAccepted") !== true) {
      throw new Error("riskPolicyAccepted must be true before sending terminal input.");
    }
    const write = desktopApi?.terminal?.write;
    if (write === undefined) {
      throw new Error("Terminal write bridge is unavailable.");
    }
    const sessionId = requiredString(input, "sessionId");
    const inputRecord = toRecord(input);
    const text = typeof inputRecord.text === "string" ? inputRecord.text : undefined;
    const state = readTerminalState();
    const panes = Array.isArray(toRecord(state).panes) ? toRecord(state).panes as unknown[] : [];
    const pane = panes
      .map((entry) => toRecord(entry))
      .find((entry) => nonEmptyString(entry.sessionId) === sessionId);
    if (pane !== undefined && nonEmptyString(pane.sourceAgentSessionId) === null) {
      throw new Error(
        "That terminal belongs to the user. Use write_stdin and omit sessionId to use this task's private terminal."
      );
    }
    await write({
      sessionId,
      ...(text === undefined ? {} : { text }),
      source: "agent"
    });
    return { sent: true, sessionId, textLength: text?.length ?? 0 };
  });
  handlers.set("read", async (input) => {
    const office = desktopApi?.office;
    if (office === undefined) {
      throw new Error("Office bridge is unavailable.");
    }
    return office.read({ path: requiredString(input, "path") });
  });
  handlers.set("apply", async (input) => {
    const office = desktopApi?.office;
    if (office === undefined) {
      throw new Error("Office bridge is unavailable.");
    }
    const ops = toRecord(input).ops;
    if (!Array.isArray(ops)) {
      throw new Error("ops must be an array");
    }
    return office.apply({ path: requiredString(input, "path"), ops });
  });

  return handlers;
};
