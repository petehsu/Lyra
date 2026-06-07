import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState
} from "react";

import type {
  LoginManagerAuthMethod,
  LoginManagerAuthMethodKind,
  LoginManagerSnapshot,
  LyraCapabilityRisk,
  LyraDesktopApi,
  LyraSoftwareActionHandler,
  LyraSoftwareActionManifest,
  LyraSoftwareCapabilitiesContext,
  LyraSoftwareManifest,
  SoftwareCapabilitiesQueryRequest,
  SoftwareCapabilitiesQueryResult,
  SoftwareInspectCapabilityRequest,
  SoftwareInspectCapabilityResponse,
  SoftwareInvokeCapabilityRequest,
  SoftwareInvokeCapabilityResponse,
  SoftwareReadStateRequest,
  SoftwareReadStateResponse,
  SoftwareListCapabilitiesResponse,
  UiuxListPacksResponse
} from "../../../shared/desktop-bridge";
import { isLyraSensitiveValueRef } from "../../../shared/sensitive-value";
import type { BrowserSettingsCategoryId } from "../browser-tabs/settings-surface-types";
import type { FileManagerModel } from "../file-manager";
import type { ImageViewerModel } from "../image-viewer";
import { createLoginManagerAppRequest } from "../login-manager";
import {
  createSoftwareStoreAppRequest,
  requestSoftwareStoreDetail
} from "../software-store/service";
import type { SoftwareStoreLabels } from "../software-store/types";
import type { TerminalDockModel } from "../terminal-dock/types";
import type { WorkspaceTabsModel } from "../workspace-tabs";
import { resolveWebSearchTarget } from "../browser-search/service";
import { WORKBENCH_CONFIG } from "../config";
import type { SoftwareCapabilitiesRegistryModel } from "./types";

type ExternalHandlerRegistration = {
  readonly packId: string;
  readonly softwareId: string;
  readonly actionId: string;
  readonly handler: LyraSoftwareActionHandler;
};

type UseSoftwareCapabilitiesRegistryArgs = {
  readonly desktopApi: LyraDesktopApi | null;
  readonly labels: SoftwareStoreLabels;
  readonly activeUiPackId: string;
  readonly tabsModel: WorkspaceTabsModel;
  readonly fileManagerModel: FileManagerModel;
  readonly imageViewerModel?: ImageViewerModel;
  readonly terminalModel?: TerminalDockModel;
  readonly onOpenSettingsSection: (categoryId: BrowserSettingsCategoryId) => void;
};

const SETTING_CATEGORY_IDS = new Set<BrowserSettingsCategoryId>([
  "general",
  "appearance",
  "workspace",
  "notifications",
  "linux",
  "search",
  "ai"
]);

const LOGIN_MANAGER_AUTH_METHOD_KINDS: readonly LoginManagerAuthMethodKind[] = [
  "site_session",
  "password",
  "passkey",
  "oauth",
  "sso",
  "magic_link",
  "unknown"
];

const HIGH_RISK_CAPABILITIES = new Set<LyraCapabilityRisk>([
  "write",
  "external",
  "destructive"
]);

const toRecord = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === "object" && Array.isArray(value) === false
    ? value as Record<string, unknown>
    : {};

const nonEmptyString = (value: unknown): string | null =>
  typeof value === "string" && value.trim().length > 0 ? value.trim() : null;

const requiredString = (input: unknown, field: string): string => {
  const value = nonEmptyString(toRecord(input)[field]);
  if (value === null) {
    throw new Error(`${field} is required`);
  }
  return value;
};

const optionalString = (input: unknown, field: string): string | undefined =>
  nonEmptyString(toRecord(input)[field]) ?? undefined;

const optionalBoolean = (input: unknown, field: string): boolean | undefined => {
  const value = toRecord(input)[field];
  return typeof value === "boolean" ? value : undefined;
};

const optionalNumber = (input: unknown, field: string): number | undefined => {
  const value = toRecord(input)[field];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
};

const optionalLoginAuthMethodKind = (
  input: unknown,
  field: string
): LoginManagerAuthMethodKind | undefined => {
  const value = optionalString(input, field);
  return LOGIN_MANAGER_AUTH_METHOD_KINDS.includes(value as LoginManagerAuthMethodKind)
    ? value as LoginManagerAuthMethodKind
    : undefined;
};

const requirePermissionGranted = (input: unknown, actionId: string): void => {
  if (optionalBoolean(input, "permissionGranted") !== true) {
    throw new Error(`${actionId} requires runtime permission before it can run.`);
  }
};

const createAction = (
  action: LyraSoftwareActionManifest
): LyraSoftwareActionManifest => action;

const parentDirectoryPath = (filePath: string): string => {
  const normalized = filePath.replace(/\\/gu, "/");
  const index = normalized.lastIndexOf("/");
  if (index <= 0) return "/";
  return normalized.slice(0, index);
};

const baseName = (filePath: string): string => {
  const normalized = filePath.replace(/\\/gu, "/");
  const index = normalized.lastIndexOf("/");
  return index < 0 ? normalized : normalized.slice(index + 1);
};

const validateInputSchema = (
  input: unknown,
  schema: unknown
): readonly string[] => {
  if (schema === undefined) return [];
  const schemaRecord = toRecord(schema);
  if (schemaRecord.type !== "object") return [];
  const inputRecord = toRecord(input);
  const errors: string[] = [];
  const required = Array.isArray(schemaRecord.required)
    ? schemaRecord.required.filter((field): field is string => typeof field === "string")
    : [];
  for (const field of required) {
    if (inputRecord[field] === undefined) {
      errors.push(`${field} is required`);
    }
  }
  const properties = toRecord(schemaRecord.properties);
  for (const [field, propertySchema] of Object.entries(properties)) {
    if (inputRecord[field] === undefined) continue;
    const property = toRecord(propertySchema);
    const value = inputRecord[field];
    if (
      typeof property.type === "string" &&
      property.type !== "object" &&
      property.type !== "array" &&
      typeof value !== property.type
    ) {
      errors.push(`${field} must be ${property.type}`);
    }
    if (Array.isArray(property.enum) && property.enum.includes(value) === false) {
      errors.push(`${field} must be one of ${property.enum.join(", ")}`);
    }
  }
  return errors;
};

const softwareWithoutSchemas = (
  software: readonly LyraSoftwareManifest[]
): readonly LyraSoftwareManifest[] =>
  software.map((entry) => ({
    ...entry,
    actions: entry.actions.map((action) => ({
      id: action.id,
      title: action.title,
      description: action.description,
      risk: action.risk
    }))
  }));

const redactedLoginManagerSnapshot = (
  snapshot: LoginManagerSnapshot | null
) => {
  if (snapshot === null) {
    return {
      available: false,
      message: "Login Manager state is not loaded yet."
    };
  }
  return {
    available: true,
    generatedAt: snapshot.generatedAt,
    passwordsAvailable: snapshot.passwordsAvailable,
    passwordStorageReason: snapshot.passwordStorageReason,
    sessions: snapshot.sessions.map((session) => ({
      id: session.id,
      origin: session.origin,
      hostname: session.hostname,
      title: session.title,
      address: session.address,
      status: session.status,
      accountHint: session.accountHint,
      notes: session.notes,
      authMethod: session.authMethod,
      authMethodSource: session.authMethodSource,
      signals: session.signals,
      credentialIds: session.credentialIds,
      firstSeenAt: session.firstSeenAt,
      lastSeenAt: session.lastSeenAt,
      updatedAt: session.updatedAt
    })),
    credentials: snapshot.credentials.map((credential) => ({
      id: credential.id,
      origin: credential.origin,
      hostname: credential.hostname,
      username: credential.username,
      usernameLabel: credential.usernameLabel,
      authMethod: credential.authMethod,
      hasPassword: credential.hasPassword,
      passwordAvailable: credential.passwordAvailable,
      passwordRef: credential.passwordRef,
      createdAt: credential.createdAt,
      updatedAt: credential.updatedAt,
      lastUsedAt: credential.lastUsedAt
    }))
  };
};

const createBuiltinSoftware = (
  labels: SoftwareStoreLabels
): readonly LyraSoftwareManifest[] => {
  const actionsBySoftwareId = new Map<string, readonly LyraSoftwareActionManifest[]>([
    [
      "browser-search",
      [
        createAction({
          id: "browser-search.openUrl",
          title: "Open URL",
          description: "Open a URL in a new Lyra browser tab.",
          risk: "navigate",
          inputSchema: {
            type: "object",
            required: ["url"],
            properties: {
              url: { type: "string" },
              title: { type: "string" }
            }
          }
        }),
        createAction({
          id: "browser-search.search",
          title: "Search",
          description: "Open Lyra search results for a query.",
          risk: "navigate",
          inputSchema: {
            type: "object",
            required: ["query"],
            properties: {
              query: { type: "string" }
            }
          }
        }),
        createAction({
          id: "browser-search.readState",
          title: "Read Browser State",
          description: "Read current Lyra browser and search tab state.",
          risk: "read"
        }),
        createAction({
          id: "browser-search.readCurrentPage",
          title: "Read Current Page",
          description: "Read the current Lyra browser page runtime state.",
          risk: "read",
          inputSchema: {
            type: "object",
            properties: {
              tabId: { type: "string" }
            }
          }
        }),
        createAction({
          id: "browser-search.searchInPage",
          title: "Search In Page",
          description: "Search text within the current Lyra browser page and highlight matches when the page is live.",
          risk: "read",
          inputSchema: {
            type: "object",
            required: ["query"],
            properties: {
              tabId: { type: "string" },
              query: { type: "string" },
              caseSensitive: { type: "boolean" },
              maxMatches: { type: "number" }
            }
          }
        }),
        createAction({
          id: "browser-search.readDownloads",
          title: "Read Downloads",
          description: "Read Lyra Download Manager tasks related to browser downloads.",
          risk: "read"
        })
      ]
    ],
    [
      "file-manager",
      [
        createAction({
          id: "file-manager.openHome",
          title: "Open Home",
          description: "Open the File Manager home view.",
          risk: "navigate"
        }),
        createAction({
          id: "file-manager.openPath",
          title: "Open Path",
          description: "Open a directory path in File Manager.",
          risk: "navigate",
          inputSchema: {
            type: "object",
            required: ["path"],
            properties: {
              path: { type: "string" }
            }
          }
        }),
        createAction({
          id: "file-manager.readCurrentDirectory",
          title: "Read Current Directory",
          description: "Read the current File Manager directory listing.",
          risk: "read"
        }),
        createAction({
          id: "file-manager.selectEntry",
          title: "Select Entry",
          description: "Select a visible File Manager entry by id.",
          risk: "navigate",
          inputSchema: {
            type: "object",
            required: ["entryId"],
            properties: {
              entryId: { type: "string" }
            }
          }
        }),
        createAction({
          id: "file-manager.revealPath",
          title: "Reveal Path",
          description: "Open a path's containing folder in File Manager and select the matching entry when visible.",
          risk: "navigate",
          inputSchema: {
            type: "object",
            required: ["path"],
            properties: {
              path: { type: "string" }
            }
          }
        })
      ]
    ],
    [
      "settings",
      [
        createAction({
          id: "settings.openSection",
          title: "Open Section",
          description: "Open a Workbench settings section.",
          risk: "navigate",
          inputSchema: {
            type: "object",
            properties: {
              section: {
                type: "string",
                enum: [...SETTING_CATEGORY_IDS]
              }
            }
          }
        })
      ]
    ],
    [
      "login-manager",
      [
        createAction({
          id: "login-manager.readState",
          title: "Read Login Manager",
          description: "Read Lyra Browser site sessions and saved credential metadata. Password text is never returned.",
          risk: "read"
        }),
        createAction({
          id: "login-manager.open",
          title: "Open Login Manager",
          description: "Open the Lyra Login Manager software tab.",
          risk: "navigate"
        }),
        createAction({
          id: "login-manager.logoutSite",
          title: "Log Out Site",
          description: "Clear cookies, storage, cache, and service-worker site data for a Lyra Browser site after runtime permission is granted.",
          risk: "destructive",
          inputSchema: {
            type: "object",
            properties: {
              origin: { type: "string" },
              sessionId: { type: "string" },
              hostname: { type: "string" }
            }
          }
        }),
        createAction({
          id: "login-manager.updateAuthMethod",
          title: "Update Login Method",
          description: "Update a Login Manager session's account note, notes, or manually confirmed login method.",
          risk: "write",
          inputSchema: {
            type: "object",
            properties: {
              origin: { type: "string" },
              sessionId: { type: "string" },
              accountHint: { type: "string" },
              notes: { type: "string" },
              methodKind: {
                type: "string",
                enum: [...LOGIN_MANAGER_AUTH_METHOD_KINDS]
              },
              methodLabel: { type: "string" },
              providerDomain: { type: "string" }
            }
          }
        }),
        createAction({
          id: "login-manager.fillCredential",
          title: "Request Credential Fill",
          description: "Fill a saved credential into the matching Lyra Browser login form after runtime permission is granted. Password text is not returned.",
          risk: "write",
          inputSchema: {
            type: "object",
            properties: {
              credentialId: { type: "string" },
              sensitiveValueRef: {
                type: "object",
                description: "A lyra-sensitive-value-ref returned by Login Manager readState. The plaintext is not required or returned."
              },
              origin: { type: "string" },
              tabId: { type: "string" }
            }
          }
        })
      ]
    ],
    [
      "software-store",
      [
        createAction({
          id: "software-store.open",
          title: "Open Software Store",
          description: "Open the Lyra Software Store.",
          risk: "navigate"
        }),
        createAction({
          id: "software-store.listInstalledApps",
          title: "List Installed Apps",
          description: "Read installed Lyra built-in and trusted UIUX software adapters.",
          risk: "read"
        }),
        createAction({
          id: "software-store.openDetail",
          title: "Open App Detail",
          description: "Open Software Store and select a built-in software or UIUX pack detail.",
          risk: "navigate",
          inputSchema: {
            type: "object",
            properties: {
              softwareId: { type: "string" },
              packId: { type: "string" }
            }
          }
        }),
        createAction({
          id: "software-store.install",
          title: "Install UIUX Pack",
          description: "Install a UIUX pack from local path, git, or npm after runtime permission is granted.",
          risk: "external",
          inputSchema: {
            type: "object",
            required: ["sourceKind"],
            properties: {
              sourceKind: { type: "string", enum: ["local", "git", "npm"] },
              sourcePath: { type: "string" },
              url: { type: "string" },
              ref: { type: "string" },
              subdir: { type: "string" },
              packageName: { type: "string" },
              version: { type: "string" }
            }
          }
        }),
        createAction({
          id: "software-store.uninstall",
          title: "Uninstall UIUX Pack",
          description: "Uninstall an installed UIUX pack after runtime permission is granted.",
          risk: "destructive",
          inputSchema: {
            type: "object",
            required: ["packId"],
            properties: {
              packId: { type: "string" }
            }
          }
        })
      ]
    ],
    [
      "terminal",
      [
        createAction({
          id: "terminal.readVisibleBuffer",
          title: "Read Visible Terminal",
          description: "Read visible terminal tab metadata and the retained output projection for the active terminal pane.",
          risk: "read",
          inputSchema: {
            type: "object",
            properties: {
              sessionId: { type: "string" },
              maxBytes: { type: "number" },
              waitMs: { type: "number" }
            }
          }
        }),
        createAction({
          id: "terminal.sendControlledInput",
          title: "Send Controlled Input",
          description: "Send controlled input to a terminal session after an explicit risk-policy acknowledgement.",
          risk: "write",
          inputSchema: {
            type: "object",
            required: ["sessionId", "riskPolicyAccepted"],
            properties: {
              sessionId: { type: "string" },
              text: { type: "string" },
              riskPolicyAccepted: { type: "boolean" }
            }
          }
        })
      ]
    ],
    [
      "image-viewer",
      [
        createAction({
          id: "image-viewer.readMetadata",
          title: "Read Image Metadata",
          description: "Read native image metadata, viewport, and source path from Image Viewer.",
          risk: "read"
        }),
        createAction({
          id: "image-viewer.zoomPan",
          title: "Zoom And Pan",
          description: "Set Image Viewer zoom, pan, rotation, or background.",
          risk: "navigate",
          inputSchema: {
            type: "object",
            properties: {
              instanceId: { type: "string" },
              zoom: { type: "number" },
              offsetX: { type: "number" },
              offsetY: { type: "number" },
              rotation: { type: "number" },
              background: { type: "string", enum: ["checkerboard", "dark", "light"] }
            }
          }
        }),
        createAction({
          id: "image-viewer.openSource",
          title: "Open Source",
          description: "Reveal the image source path in File Manager.",
          risk: "navigate",
          inputSchema: {
            type: "object",
            properties: {
              instanceId: { type: "string" },
              path: { type: "string" }
            }
          }
        }),
        createAction({
          id: "image-viewer.prepareVisionFallback",
          title: "Prepare Vision Fallback",
          description: "Prepare current Image Viewer source, metadata, viewport, and open target for OCR or model vision fallback.",
          risk: "read",
          inputSchema: {
            type: "object",
            properties: {
              instanceId: { type: "string" }
            }
          }
        })
      ]
    ]
  ]);

  return labels.builtinApps.map((app) => ({
    id: app.id,
    title: app.title,
    description: app.description,
    category: app.category,
    version: "1.0.0",
    source: "builtin" as const,
    actions: actionsBySoftwareId.get(app.id) ?? []
  }));
};

const trustedExternalSoftware = (
  response: UiuxListPacksResponse | null,
  activeUiPackId: string
): readonly LyraSoftwareManifest[] => {
  if (response === null) {
    return [];
  }
  return response.installed
    .filter((pack) => pack.trustState === "trusted" && pack.id === activeUiPackId)
    .flatMap((pack) => pack.manifest.software);
};

const findSoftware = (
  software: readonly LyraSoftwareManifest[],
  softwareId: string
): LyraSoftwareManifest => {
  const entry = software.find((item) => item.id === softwareId);
  if (entry === undefined) {
    throw new Error(`Unknown software capability: ${softwareId}`);
  }
  return entry;
};

const findAction = (
  software: LyraSoftwareManifest,
  actionId: string
): LyraSoftwareActionManifest => {
  const action = software.actions.find((item) => item.id === actionId);
  if (action === undefined) {
    throw new Error(`Unknown action ${actionId} for ${software.id}`);
  }
  return action;
};

const createSuccessResult = (
  requestId: string,
  result:
    | SoftwareListCapabilitiesResponse
    | SoftwareInspectCapabilityResponse
    | SoftwareReadStateResponse
    | SoftwareInvokeCapabilityResponse
): SoftwareCapabilitiesQueryResult => ({
  requestId,
  ok: true,
  result
});

const createErrorResult = (
  requestId: string,
  error: unknown
): SoftwareCapabilitiesQueryResult => ({
  requestId,
  ok: false,
  error: {
    code: "software_capability_failed",
    message: error instanceof Error ? error.message : String(error)
  }
});

export const useSoftwareCapabilitiesRegistry = ({
  desktopApi,
  labels,
  activeUiPackId,
  tabsModel,
  fileManagerModel,
  imageViewerModel,
  terminalModel,
  onOpenSettingsSection
}: UseSoftwareCapabilitiesRegistryArgs): SoftwareCapabilitiesRegistryModel => {
  const [packs, setPacks] = useState<UiuxListPacksResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loginManagerSnapshot, setLoginManagerSnapshot] =
    useState<LoginManagerSnapshot | null>(null);
  const [handlerRevision, setHandlerRevision] = useState(0);
  const externalHandlersRef = useRef(new Map<string, ExternalHandlerRegistration>());

  const builtinSoftware = useMemo(() => createBuiltinSoftware(labels), [labels]);
  const externalSoftware = useMemo(
    () => trustedExternalSoftware(packs, activeUiPackId),
    [activeUiPackId, packs]
  );
  const software = useMemo(
    () => [...builtinSoftware, ...externalSoftware],
    [builtinSoftware, externalSoftware, handlerRevision]
  );

  const findActiveSoftwareTab = useCallback((softwareId: string) =>
    tabsModel.tabs.find((tab) =>
      tab.id === tabsModel.activeTabId && tab.appId === softwareId
    )
    ?? tabsModel.tabs.find((tab) => tab.appId === softwareId)
    ?? null,
  [tabsModel.activeTabId, tabsModel.tabs]);

  const readFileManagerState = useCallback(() => {
    const tab = findActiveSoftwareTab("file-manager");
    if (tab?.appInstanceId === undefined) {
      return {
        available: false,
        message: "No File Manager tab is open."
      };
    }
    const state = fileManagerModel.getState(tab.appInstanceId);
    if (state === null) {
      return {
        available: false,
        tabId: tab.id,
        appInstanceId: tab.appInstanceId,
        message: "File Manager state is unavailable."
      };
    }
    return {
      available: true,
      tabId: tab.id,
      appInstanceId: tab.appInstanceId,
      viewKind: state.viewKind,
      currentLocation: state.currentLocation,
      selectedEntryId: state.selectedEntryId,
      entries: state.entries.slice(0, 100).map((entry) => ({
        id: entry.id,
        name: entry.name,
        path: entry.path,
        kind: entry.kind,
        sizeBytes: entry.sizeBytes,
        modifiedAt: entry.modifiedAt
      })),
      truncated: state.entries.length > 100
    };
  }, [fileManagerModel, findActiveSoftwareTab]);

  const readImageViewerState = useCallback((request?: SoftwareReadStateRequest) => {
    const requestedInstanceId = request?.softwareId === "image-viewer"
      ? nonEmptyString(toRecord(request).instanceId)
      : null;
    const tab =
      requestedInstanceId === null
        ? findActiveSoftwareTab("image-viewer")
        : tabsModel.tabs.find((entry) => entry.appInstanceId === requestedInstanceId) ?? null;
    const instanceId = requestedInstanceId ?? tab?.appInstanceId ?? null;
    if (imageViewerModel === undefined || instanceId === null) {
      return {
        available: false,
        message: "No Image Viewer tab is open."
      };
    }
    const state = imageViewerModel.getState(instanceId);
    if (state === null) {
      return {
        available: false,
        appInstanceId: instanceId,
        message: "Image Viewer state is unavailable."
      };
    }
    return {
      available: true,
      tabId: tab?.id,
      appInstanceId: instanceId,
      filePath: state.openResult?.path ?? state.filePath,
      status: state.status,
      metadata: state.openResult,
      viewport: state.view,
      siblingIndex: state.siblingIndex,
      siblingCount: state.siblingPaths.length
    };
  }, [findActiveSoftwareTab, imageViewerModel, tabsModel.tabs]);

  const readTerminalState = useCallback(() => {
    if (terminalModel === undefined) {
      return {
        available: false,
        message: "Terminal model is unavailable."
      };
    }
    const activeTab = terminalModel.activeDockTab
      ?? terminalModel.workspaceTabs.find((tab) => tab.id === tabsModel.activeTabId)
      ?? terminalModel.dockTabs[0]
      ?? terminalModel.workspaceTabs[0]
      ?? null;
    if (activeTab === null) {
      return {
        available: false,
        message: "No terminal tab is open."
      };
    }
    const panes = terminalModel.getTabPanes(activeTab.id);
    return {
      available: true,
      tabId: activeTab.id,
      activePaneId: activeTab.activePaneId,
      panes: panes.map((pane) => ({
        paneId: pane.id,
        sessionId: pane.sessionId,
        title: pane.title,
        cwd: pane.cwd,
        shell: pane.shell,
        active: pane.id === activeTab.activePaneId
      })),
      activeOutput: "",
      visibleBufferUnavailable: true,
      message:
        "Terminal pane metadata is available. Visible buffer projection is not exposed by the current terminal model."
    };
  }, [tabsModel.activeTabId, terminalModel]);

  const readBrowserState = useCallback(() => ({
    activeTabId: tabsModel.activeTabId,
    pages: tabsModel.tabs
      .filter((tab) => tab.pageKind === "page")
      .map((tab) => ({
        tabId: tab.id,
        title: tab.title,
        address: tab.displayAddress,
        active: tab.id === tabsModel.activeTabId
      })),
    searchTabs: tabsModel.tabs
      .filter((tab) => tab.pageKind === "search" || tab.pageKind === "results")
      .map((tab) => ({
        tabId: tab.id,
        title: tab.title,
        query: tab.query ?? tab.inputValue,
        active: tab.id === tabsModel.activeTabId
      })),
    downloadAwareness: {
      source: desktopApi?.downloads === undefined ? "file-manager" : "download-manager",
      bridgeAvailable: desktopApi?.downloads !== undefined,
      state: readFileManagerState()
    }
  }), [desktopApi, readFileManagerState, tabsModel.activeTabId, tabsModel.tabs]);

  const readLoginManagerState = useCallback(() =>
    redactedLoginManagerSnapshot(loginManagerSnapshot),
  [loginManagerSnapshot]);

  const refreshLoginManagerState = useCallback(async () => {
    if (desktopApi?.loginManager === undefined) {
      setLoginManagerSnapshot(null);
      return redactedLoginManagerSnapshot(null);
    }
    const snapshot = await desktopApi.loginManager.list();
    setLoginManagerSnapshot(snapshot);
    return redactedLoginManagerSnapshot(snapshot);
  }, [desktopApi]);

  useEffect(() => {
    if (desktopApi?.loginManager === undefined) {
      setLoginManagerSnapshot(null);
      return undefined;
    }
    void refreshLoginManagerState().catch(() => {
      setLoginManagerSnapshot(null);
    });
    return desktopApi.loginManager.onEvent((event) => {
      setLoginManagerSnapshot(event.snapshot);
    });
  }, [desktopApi, refreshLoginManagerState]);

  const readSoftwareState = useCallback((
    request: SoftwareReadStateRequest = {}
  ): SoftwareReadStateResponse => {
    const softwareId = nonEmptyString(request.softwareId);
    if (softwareId === "browser-search") {
      return { softwareId, state: readBrowserState() };
    }
    if (softwareId === "file-manager") {
      return { softwareId, state: readFileManagerState() };
    }
    if (softwareId === "image-viewer") {
      return { softwareId, state: readImageViewerState(request) };
    }
    if (softwareId === "terminal") {
      return { softwareId, state: readTerminalState() };
    }
    if (softwareId === "login-manager") {
      return { softwareId, state: readLoginManagerState() };
    }
    if (softwareId === "software-store") {
      return {
        softwareId,
        state: {
          installed: software.map((entry) => ({
            id: entry.id,
            title: entry.title,
            source: entry.source,
            actionCount: entry.actions.length
          }))
        }
      };
    }
    return {
      ...(softwareId === null ? {} : { softwareId }),
      state: {
        activeTabId: tabsModel.activeTabId,
        browser: readBrowserState(),
        fileManager: readFileManagerState(),
        imageViewer: readImageViewerState(request),
        loginManager: readLoginManagerState(),
        terminal: readTerminalState(),
        software: software.map((entry) => ({
          id: entry.id,
          title: entry.title,
          source: entry.source,
          actionCount: entry.actions.length
        }))
      }
    };
  }, [
    readBrowserState,
    readFileManagerState,
    readImageViewerState,
    readLoginManagerState,
    readTerminalState,
    software,
    tabsModel.activeTabId
  ]);

  const refresh = useCallback(async (): Promise<void> => {
    if (desktopApi?.uiux === undefined) {
      setPacks(null);
      setError("UIUX bridge unavailable");
      return;
    }
    setLoading(true);
    try {
      setPacks(await desktopApi.uiux.listPacks());
      setError(null);
    } catch (loadError: unknown) {
      setPacks(null);
      setError(loadError instanceof Error ? loadError.message : String(loadError));
    } finally {
      setLoading(false);
    }
  }, [desktopApi]);

  useEffect(() => {
    void refresh();
  }, [refresh, activeUiPackId]);

  const builtinHandlers = useMemo(() => {
    const handlers = new Map<string, LyraSoftwareActionHandler>();
    handlers.set("browser-search.openUrl", (input) => {
      const url = requiredString(input, "url");
      const title = optionalString(input, "title");
      tabsModel.openPageInNewTab(url, title);
      return {
        opened: true,
        url,
        openTarget: {
          kind: "url",
          url,
          ...(title === undefined ? {} : { label: title })
        }
      };
    });
    handlers.set("browser-search.search", async (input) => {
      const query = requiredString(input, "query");
      const target = await resolveWebSearchTarget({
        desktopApi,
        query,
        searchEngines: WORKBENCH_CONFIG.browser.searchEngines
      });
      const selection = { mode: "auto" as const, engineIds: [] };
      const tabId = target === null
        ? tabsModel.openLocalSearchTab({ query, selection }, { target: "new-tab" })
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
      const state = await desktopApi?.workbenchBrowser?.readPageState(
        tabId === undefined ? {} : { tabId }
      );
      return {
        available: state !== null && state !== undefined,
        ...(state === null || state === undefined ? {} : { page: state })
      };
    });
    handlers.set("browser-search.searchInPage", async (input) => {
      const searchInPage = desktopApi?.workbenchBrowser?.searchInPage;
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
    handlers.set("file-manager.selectEntry", (input) => {
      const entryId = requiredString(input, "entryId");
      const tab = findActiveSoftwareTab("file-manager");
      if (tab?.appInstanceId === undefined) {
        throw new Error("No File Manager tab is open.");
      }
      fileManagerModel.selectEntry(tab.appInstanceId, entryId);
      return { selected: true, appInstanceId: tab.appInstanceId, entryId };
    });
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
    handlers.set("settings.openSection", (input) => {
      const section = optionalString(input, "section") ?? "general";
      const categoryId = SETTING_CATEGORY_IDS.has(section as BrowserSettingsCategoryId)
        ? section as BrowserSettingsCategoryId
        : "general";
      onOpenSettingsSection(categoryId);
      return { opened: true, section: categoryId };
    });
    handlers.set("login-manager.readState", async () => await refreshLoginManagerState());
    handlers.set("login-manager.open", () => {
      const title =
        labels.builtinApps.find((app) => app.id === "login-manager")?.title
        ?? "Login Manager";
      tabsModel.openAppTab(createLoginManagerAppRequest(title));
      return {
        opened: true,
        openTarget: {
          kind: "software",
          id: "login-manager"
        }
      };
    });
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
      setLoginManagerSnapshot(snapshot);
      return redactedLoginManagerSnapshot(snapshot);
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
      tabsModel.openAppTab(createSoftwareStoreAppRequest(labels.tabTitle));
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
      tabsModel.openAppTab(createSoftwareStoreAppRequest(labels.tabTitle));
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
      tabsModel.openAppTab(createSoftwareStoreAppRequest(labels.tabTitle));
      await refresh();
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
      await refresh();
      return {
        uninstalled: true,
        packId: result.packId
      };
    });
    handlers.set("image-viewer.readMetadata", (input) => {
      const instanceId = optionalString(input, "instanceId");
      return readSoftwareState({
        softwareId: "image-viewer",
        ...(instanceId === undefined ? {} : { instanceId })
      });
    });
    handlers.set("image-viewer.zoomPan", (input) => {
      if (imageViewerModel === undefined) {
        throw new Error("Image Viewer model is unavailable.");
      }
      const instanceId =
        optionalString(input, "instanceId")
        ?? findActiveSoftwareTab("image-viewer")?.appInstanceId;
      if (instanceId === undefined) {
        throw new Error("No Image Viewer tab is open.");
      }
      const record = toRecord(input);
      imageViewerModel.setViewport(instanceId, {
        ...(typeof record.zoom === "number" ? { zoom: record.zoom } : {}),
        ...(typeof record.offsetX === "number" ? { offsetX: record.offsetX } : {}),
        ...(typeof record.offsetY === "number" ? { offsetY: record.offsetY } : {}),
        ...(typeof record.rotation === "number" ? { rotation: record.rotation } : {}),
        ...(record.background === "checkerboard" || record.background === "dark" || record.background === "light"
          ? { background: record.background }
          : {})
      });
      return { updated: true, instanceId, state: readImageViewerState({ softwareId: "image-viewer" }) };
    });
    handlers.set("image-viewer.openSource", async (input) => {
      const explicitPath = optionalString(input, "path");
      const instanceId = optionalString(input, "instanceId");
      const imageState = readImageViewerState({
        softwareId: "image-viewer",
        ...(instanceId === undefined ? {} : { instanceId })
      });
      const filePath = explicitPath ?? nonEmptyString(toRecord(imageState).filePath);
      if (filePath === null) {
        throw new Error("No Image Viewer source path is available.");
      }
      const nextApp = fileManagerModel.createInstance();
      tabsModel.openAppTab(nextApp);
      await fileManagerModel.openDirectory(nextApp.appInstanceId, parentDirectoryPath(filePath), false);
      const state = fileManagerModel.getState(nextApp.appInstanceId);
      const entry = state?.entries.find((item) =>
        item.path === filePath || item.name === baseName(filePath)
      );
      if (entry !== undefined) {
        fileManagerModel.selectEntry(nextApp.appInstanceId, entry.id);
      }
      return {
        opened: true,
        appInstanceId: nextApp.appInstanceId,
        path: filePath,
        openTarget: {
          kind: "file",
          path: filePath
        },
        ...(entry === undefined ? {} : { selectedEntryId: entry.id })
      };
    });
    handlers.set("image-viewer.prepareVisionFallback", (input) => {
      const instanceId = optionalString(input, "instanceId");
      const imageState = readImageViewerState({
        softwareId: "image-viewer",
        ...(instanceId === undefined ? {} : { instanceId })
      });
      const imageRecord = toRecord(imageState);
      const filePath = nonEmptyString(imageRecord.filePath);
      if (filePath === null) {
        return {
          available: false,
          message: "No Image Viewer source path is available for OCR or vision fallback.",
          state: imageState
        };
      }
      const metadata = toRecord(imageRecord.metadata);
      const mediaType =
        nonEmptyString(metadata.mimeType)
        ?? nonEmptyString(metadata.format)
        ?? "image/png";
      return {
        available: true,
        ocrAvailable: false,
        fallback: "model-vision",
        message:
          "Local OCR is not available; use this image source as model vision evidence.",
        imageArtifact: {
          id: `image-viewer-${imageRecord.appInstanceId ?? instanceId ?? "active"}`,
          kind: "image",
          mediaType,
          path: filePath,
          width: typeof metadata.width === "number" ? metadata.width : undefined,
          height: typeof metadata.height === "number" ? metadata.height : undefined,
          openTarget: {
            kind: "file",
            path: filePath
          }
        },
        viewport: imageRecord.viewport,
        metadata,
        nextRecommendedAction: "attach_image_to_model_vision_input"
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
          ...state,
          activeOutput: "",
          visibleBufferUnavailable: true,
          message: "No active terminal session is available."
        };
      }
      const read = desktopApi?.terminal?.read;
      if (read === undefined) {
        return {
          ...state,
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
      return {
        ...state,
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
      await write({
        sessionId,
        ...(text === undefined ? {} : { text }),
        source: "user"
      });
      return { sent: true, sessionId, textLength: text?.length ?? 0 };
    });
    return handlers;
  }, [
    desktopApi,
    fileManagerModel,
    findActiveSoftwareTab,
    imageViewerModel,
    labels.builtinApps,
    labels.tabTitle,
    onOpenSettingsSection,
    readImageViewerState,
    refreshLoginManagerState,
    readSoftwareState,
    tabsModel
  ]);

  const invoke = useCallback(async (
    request: SoftwareInvokeCapabilityRequest
  ): Promise<unknown> => {
    const selectedSoftware = findSoftware(software, request.softwareId);
    const action = findAction(selectedSoftware, request.actionId);
    const builtinHandler = builtinHandlers.get(action.id);
    const externalHandler = externalHandlersRef.current.get(action.id);
    const handler = builtinHandler ?? externalHandler?.handler;
    if (handler === undefined) {
      throw new Error(`No registered handler for ${action.id}`);
    }
    const requestRecord = toRecord(request);
    const handlerInput = requestRecord.permissionGranted === true
      ? {
          ...toRecord(request.input),
          permissionGranted: true
        }
      : request.input;
    const validationErrors = validateInputSchema(handlerInput, action.inputSchema);
    if (validationErrors.length > 0) {
      throw new Error(`Invalid input for ${action.id}: ${validationErrors.join("; ")}`);
    }
    return await handler(handlerInput, {
      softwareId: selectedSoftware.id,
      actionId: action.id,
      ...(request.reason === undefined ? {} : { reason: request.reason })
    });
  }, [builtinHandlers, software]);

  const inspect = useCallback((request: SoftwareInspectCapabilityRequest) => {
    const selectedSoftware = findSoftware(software, request.softwareId);
    const requestedActionId = request.actionId ?? request.capabilityId;
    const action = requestedActionId === undefined
      ? undefined
      : findAction(selectedSoftware, requestedActionId);
    const actionIds = action === undefined
      ? selectedSoftware.actions.map((item) => item.id)
      : [action.id];
    return {
      software: selectedSoftware,
      ...(action === undefined ? {} : { action }),
      handlerRegistered: actionIds.every((actionId) =>
        builtinHandlers.has(actionId) || externalHandlersRef.current.has(actionId)
      ),
      readableState: readSoftwareState({ softwareId: selectedSoftware.id }).state
    };
  }, [builtinHandlers, readSoftwareState, software]);

  const handleBridgeQuery = useCallback(async (
    request: SoftwareCapabilitiesQueryRequest
  ): Promise<SoftwareCapabilitiesQueryResult> => {
    try {
      if (request.method === "software.listCapabilities") {
        return createSuccessResult(request.requestId, {
          software: request.payload.includeSchemas === true
            ? software
            : softwareWithoutSchemas(software)
        });
      }
      if (request.method === "software.inspectCapability") {
        return createSuccessResult(request.requestId, inspect(request.payload));
      }
      if (request.method === "software.readState") {
        return createSuccessResult(request.requestId, readSoftwareState(request.payload));
      }
      const output = await invoke(request.payload);
      return createSuccessResult(request.requestId, {
        softwareId: request.payload.softwareId,
        actionId: request.payload.actionId,
        ...(output === undefined ? {} : { output })
      });
    } catch (queryError: unknown) {
      return createErrorResult(request.requestId, queryError);
    }
  }, [inspect, invoke, software]);

  useEffect(() => {
    if (desktopApi?.softwareCapabilities === undefined) {
      return undefined;
    }
    return desktopApi.softwareCapabilities.registerHandler(handleBridgeQuery);
  }, [desktopApi, handleBridgeQuery]);

  const createUiPackCapabilities = useCallback((
    packId: string,
    declaredSoftware: readonly LyraSoftwareManifest[]
  ): LyraSoftwareCapabilitiesContext => {
    const declaredActions = new Map<string, string>();
    for (const softwareEntry of declaredSoftware) {
      for (const action of softwareEntry.actions) {
        declaredActions.set(action.id, softwareEntry.id);
      }
    }
    return {
      software: declaredSoftware,
      registerActionHandler: (actionId, handler) => {
        const normalizedActionId = actionId.trim();
        const softwareId = declaredActions.get(normalizedActionId);
        if (softwareId === undefined) {
          throw new Error(`Action is not declared by ${packId}: ${normalizedActionId}`);
        }
        const registration: ExternalHandlerRegistration = {
          packId,
          softwareId,
          actionId: normalizedActionId,
          handler
        };
        externalHandlersRef.current.set(normalizedActionId, registration);
        setHandlerRevision((current) => current + 1);
        return () => {
          if (externalHandlersRef.current.get(normalizedActionId) === registration) {
            externalHandlersRef.current.delete(normalizedActionId);
            setHandlerRevision((current) => current + 1);
          }
        };
      }
    };
  }, []);

  useEffect(() => {
    const declaredActionIds = new Set(software.flatMap((entry) =>
      entry.actions.map((action) => action.id)
    ));
    let changed = false;
    for (const [actionId] of externalHandlersRef.current) {
      if (declaredActionIds.has(actionId) === false) {
        externalHandlersRef.current.delete(actionId);
        changed = true;
      }
    }
    if (changed) {
      setHandlerRevision((current) => current + 1);
    }
  }, [software]);

  useEffect(() => {
    let changed = false;
    for (const [actionId, registration] of externalHandlersRef.current) {
      if (registration.packId !== activeUiPackId) {
        externalHandlersRef.current.delete(actionId);
        changed = true;
      }
    }
    if (changed) {
      setHandlerRevision((current) => current + 1);
    }
  }, [activeUiPackId]);

  return {
    software,
    loading,
    error,
    refresh,
    handleBridgeQuery,
    createUiPackCapabilities
  };
};

export const isHighRiskCapability = (risk: LyraCapabilityRisk): boolean =>
  HIGH_RISK_CAPABILITIES.has(risk);
