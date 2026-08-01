import {
  HOST_API_VERSION,
  type HostEventHandlerV1,
  type HostHandlerV1,
  type HostRegistrationV1,
  type JsonValue,
  type LyraHostApiV1
} from "@lyra/app-runtime";

export const CORE_HOST_COMMANDS = {
  readPresentation: "lyra.core.presentation.read",
  openResource: "lyra.core.open-resource",
  navigate: "lyra.core.navigate",
  openNestedApp: "lyra.core.open-nested-app",
  openSettings: "lyra.core.open-settings",
  notify: "lyra.core.notify",
  executeCommand: "lyra.core.execute-command",
  readNotifications: "lyra.core.notifications.read",
  selectNotification: "lyra.core.notifications.select",
  markAllNotificationsRead: "lyra.core.notifications.mark-all-read",
  openNotificationSource: "lyra.core.notifications.open-source",
  requestClearNotifications: "lyra.core.notifications.request-clear",
  readImage: "lyra.core.images.read",
  openImage: "lyra.core.images.open",
  openAdjacentImage: "lyra.core.images.open-adjacent",
  setImageViewport: "lyra.core.images.set-viewport",
  resetImageViewport: "lyra.core.images.reset-viewport",
  readFiles: "lyra.core.files.read",
  openFilesHome: "lyra.core.files.open-home",
  openFilesDirectory: "lyra.core.files.open-directory",
  openFilesTrash: "lyra.core.files.open-trash",
  openFilesDownloads: "lyra.core.files.open-downloads",
  openFilesFavorite: "lyra.core.files.open-favorite",
  navigateFiles: "lyra.core.files.navigate",
  setFilesPresentation: "lyra.core.files.set-presentation",
  selectFilesEntry: "lyra.core.files.select-entry",
  selectFilesTrashEntry: "lyra.core.files.select-trash-entry",
  createFilesEntry: "lyra.core.files.create-entry",
  moveFilesSelectionToTrash: "lyra.core.files.move-selection-to-trash",
  restoreFilesSelection: "lyra.core.files.restore-selection",
  emptyFilesTrash: "lyra.core.files.empty-trash",
  toggleFilesFavorite: "lyra.core.files.toggle-favorite",
  readEditor: "lyra.core.editor.read",
  openEditor: "lyra.core.editor.open",
  setEditorContent: "lyra.core.editor.set-content",
  saveEditor: "lyra.core.editor.save",
  statEditorFile: "lyra.core.editor.stat",
  requestEditorCompletion: "lyra.core.editor.complete",
  readBrowser: "lyra.core.browser.read",
  navigateBrowser: "lyra.core.browser.navigate",
  activateBrowserTab: "lyra.core.browser.activate-tab",
  openBrowserTab: "lyra.core.browser.open-tab",
  closeBrowserTab: "lyra.core.browser.close-tab",
  goBackBrowser: "lyra.core.browser.go-back",
  goForwardBrowser: "lyra.core.browser.go-forward",
  reloadBrowser: "lyra.core.browser.reload",
  readTerminal: "lyra.core.terminal.read",
  createTerminal: "lyra.core.terminal.create",
  focusTerminalPane: "lyra.core.terminal.focus-pane",
  closeTerminalPane: "lyra.core.terminal.close-pane",
  readTerminalSession: "lyra.core.terminal.read-session",
  writeTerminalSession: "lyra.core.terminal.write-session",
  readDownloads: "lyra.core.downloads.read",
  enqueueDownload: "lyra.core.downloads.enqueue",
  pauseDownload: "lyra.core.downloads.pause",
  resumeDownload: "lyra.core.downloads.resume",
  cancelDownload: "lyra.core.downloads.cancel",
  retryDownload: "lyra.core.downloads.retry",
  removeDownload: "lyra.core.downloads.remove",
  pauseAllDownloads: "lyra.core.downloads.pause-all",
  resumeAllDownloads: "lyra.core.downloads.resume-all",
  cancelAllDownloads: "lyra.core.downloads.cancel-all",
  openDownloadedFile: "lyra.core.downloads.open-file",
  revealDownloadedFile: "lyra.core.downloads.reveal-file",
  readCredentials: "lyra.core.credentials.read",
  deleteCredential: "lyra.core.credentials.delete",
  revealCredential: "lyra.core.credentials.reveal",
  copyCredential: "lyra.core.credentials.copy",
  fillCredential: "lyra.core.credentials.fill",
  clearCredentialSite: "lyra.core.credentials.clear-site"
} as const;

export const CORE_HOST_EVENTS = {
  notificationsChanged: "lyra.core.notifications-changed",
  filesChanged: "lyra.core.files-changed",
  browserChanged: "lyra.core.browser-changed",
  terminalChanged: "lyra.core.terminal-changed",
  downloadsChanged: "lyra.core.downloads-changed",
  credentialsChanged: "lyra.core.credentials-changed",
  themeChanged: "lyra.core.theme-changed",
  localeChanged: "lyra.core.locale-changed"
} as const;

type HostEntry = {
  readonly ownerId: string;
  readonly handler: HostHandlerV1;
  readonly requiredCapability?: string;
};

type HostEventEntry = {
  readonly ownerId: string;
  readonly requiredCapability?: string;
  readonly listeners: Map<symbol, HostEventHandlerV1>;
};

export type CoreEventRegistration = HostRegistrationV1 & {
  readonly emit: (input: JsonValue) => Promise<void>;
};

export type LyraHostBus = {
  readonly createHost: (options: {
    readonly moduleId: string;
    readonly allowedCapabilities?: ReadonlySet<string>;
  }) => LyraHostApiV1 & HostRegistrationV1;
  readonly registerCoreCommand: (
    commandId: string,
    handler: HostHandlerV1,
    requiredCapability?: string | null
  ) => HostRegistrationV1;
  readonly registerCoreCapability: (
    capabilityId: string,
    handler: HostHandlerV1,
    requiredCapability?: string | null
  ) => HostRegistrationV1;
  readonly registerCoreEvent: (
    eventId: string,
    requiredCapability?: string | null
  ) => CoreEventRegistration;
  /** Executes a registered contribution from trusted Core UI after the owning module is activated. */
  readonly executeRegisteredCommand: (
    commandId: string,
    input: JsonValue
  ) => Promise<JsonValue>;
  readonly dispose: () => void;
};

const MODULE_ID_PATTERN = /^[a-z0-9]+(?:[.-][a-z0-9]+)*$/u;

const assertModuleId = (moduleId: string): void => {
  if (!MODULE_ID_PATTERN.test(moduleId)) {
    throw new Error(`Invalid Lyra module id: ${moduleId}`);
  }
};

const assertOwnedId = (ownerId: string, contributionId: string): void => {
  if (contributionId !== ownerId && !contributionId.startsWith(`${ownerId}.`)) {
    throw new Error(`${ownerId} cannot register another module's contribution: ${contributionId}`);
  }
};

const createRegistration = (
  entries: Map<string, HostEntry>,
  id: string,
  entry: HostEntry
): HostRegistrationV1 => {
  if (entries.has(id)) {
    throw new Error(`Host contribution is already registered: ${id}`);
  }
  entries.set(id, entry);
  let disposed = false;
  return {
    dispose: () => {
      if (!disposed && entries.get(id) === entry) {
        disposed = true;
        entries.delete(id);
      }
    }
  };
};

const invoke = async (
  entries: Map<string, HostEntry>,
  id: string,
  input: JsonValue,
  allowedCapabilities: ReadonlySet<string>
): Promise<JsonValue> => {
  const entry = entries.get(id);
  if (entry === undefined) {
    throw new Error(`Host contribution is unavailable: ${id}`);
  }
  if (
    entry.requiredCapability !== undefined
    && !allowedCapabilities.has(entry.requiredCapability)
  ) {
    throw new Error(`Host capability is not granted: ${entry.requiredCapability}`);
  }
  return entry.handler(input);
};

export const createLyraHostBus = (): LyraHostBus => {
  const commands = new Map<string, HostEntry>();
  const capabilities = new Map<string, HostEntry>();
  const events = new Map<string, HostEventEntry>();
  let disposed = false;

  const assertActive = (): void => {
    if (disposed) {
      throw new Error("Lyra Host API has been disposed.");
    }
  };

  const registerCore = (
    entries: Map<string, HostEntry>,
    id: string,
    handler: HostHandlerV1,
    requiredCapability?: string | null
  ): HostRegistrationV1 => {
    assertActive();
    assertOwnedId("lyra.core", id);
    return createRegistration(entries, id, {
      ownerId: "lyra.core",
      handler,
      ...(requiredCapability === undefined || requiredCapability === null
        ? {}
        : { requiredCapability })
    });
  };

  return {
    createHost: ({ moduleId, allowedCapabilities = new Set<string>() }) => {
      assertActive();
      assertModuleId(moduleId);
      const ownedRegistrations = new Set<HostRegistrationV1>();
      let hostDisposed = false;
      const assertHostActive = (): void => {
        assertActive();
        if (hostDisposed) {
          throw new Error(`Lyra Host API has been disposed for ${moduleId}.`);
        }
      };
      const track = (registration: HostRegistrationV1): HostRegistrationV1 => {
        const tracked: HostRegistrationV1 = {
          dispose: () => {
            registration.dispose();
            ownedRegistrations.delete(tracked);
          }
        };
        ownedRegistrations.add(tracked);
        return tracked;
      };
      const registerOwned = (
        entries: Map<string, HostEntry>,
        id: string,
        handler: HostHandlerV1
      ): HostRegistrationV1 => {
        assertHostActive();
        assertOwnedId(moduleId, id);
        return track(createRegistration(entries, id, { ownerId: moduleId, handler }));
      };
      return {
        apiVersion: HOST_API_VERSION,
        executeCommand: async (commandId, input) => {
          assertHostActive();
          return invoke(commands, commandId, input, allowedCapabilities);
        },
        invokeCapability: async (capabilityId, input) => {
          assertHostActive();
          return invoke(capabilities, capabilityId, input, allowedCapabilities);
        },
        registerCommand: (commandId, handler) => registerOwned(commands, commandId, handler),
        registerCapability: (capabilityId, handler) =>
          registerOwned(capabilities, capabilityId, handler),
        subscribeEvent: (eventId, handler) => {
          assertHostActive();
          const event = events.get(eventId);
          if (event === undefined) {
            throw new Error(`Host event is unavailable: ${eventId}`);
          }
          if (
            event.requiredCapability !== undefined
            && !allowedCapabilities.has(event.requiredCapability)
          ) {
            throw new Error(`Host capability is not granted: ${event.requiredCapability}`);
          }
          const token = Symbol(eventId);
          event.listeners.set(token, handler);
          let disposed = false;
          return track({
            dispose: () => {
              if (!disposed) {
                disposed = true;
                event.listeners.delete(token);
              }
            }
          });
        },
        dispose: () => {
          if (!hostDisposed) {
            hostDisposed = true;
            for (const registration of [...ownedRegistrations]) {
              registration.dispose();
            }
            ownedRegistrations.clear();
          }
        }
      };
    },
    registerCoreCommand: (commandId, handler, requiredCapability) =>
      registerCore(commands, commandId, handler, requiredCapability),
    registerCoreCapability: (capabilityId, handler, requiredCapability) =>
      registerCore(capabilities, capabilityId, handler, requiredCapability),
    registerCoreEvent: (eventId, requiredCapability) => {
      assertActive();
      assertOwnedId("lyra.core", eventId);
      if (events.has(eventId)) {
        throw new Error(`Host event is already registered: ${eventId}`);
      }
      const event: HostEventEntry = {
        ownerId: "lyra.core",
        ...(requiredCapability === undefined || requiredCapability === null
          ? {}
          : { requiredCapability }),
        listeners: new Map()
      };
      events.set(eventId, event);
      let disposed = false;
      return {
        emit: async (input) => {
          assertActive();
          if (events.get(eventId) !== event) {
            throw new Error(`Host event is unavailable: ${eventId}`);
          }
          await Promise.all([...event.listeners.values()].map((listener) => listener(input)));
        },
        dispose: () => {
          if (!disposed && events.get(eventId) === event) {
            disposed = true;
            events.delete(eventId);
            event.listeners.clear();
          }
        }
      };
    },
    executeRegisteredCommand: async (commandId, input) => {
      assertActive();
      const entry = commands.get(commandId);
      if (entry === undefined) {
        throw new Error(`Host contribution is unavailable: ${commandId}`);
      }
      return entry.handler(input);
    },
    dispose: () => {
      disposed = true;
      commands.clear();
      capabilities.clear();
      for (const event of events.values()) {
        event.listeners.clear();
      }
      events.clear();
    }
  };
};
