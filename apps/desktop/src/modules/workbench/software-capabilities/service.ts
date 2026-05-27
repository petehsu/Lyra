import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState
} from "react";

import type {
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
  SoftwareListCapabilitiesResponse,
  UiuxListPacksResponse
} from "../../../shared/desktop-bridge";
import type { BrowserSettingsCategoryId } from "../browser-tabs/settings-surface-types";
import type { FileManagerModel } from "../file-manager";
import { createSoftwareStoreAppRequest } from "../software-store/service";
import type { SoftwareStoreLabels } from "../software-store/types";
import type { WorkspaceTabsModel } from "../workspace-tabs";
import type { WorkspaceSearchMode } from "../workspace-tabs/types";
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

const createAction = (
  action: LyraSoftwareActionManifest
): LyraSoftwareActionManifest => action;

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
              query: { type: "string" },
              mode: { type: "string", enum: ["standard", "deep"] }
            }
          }
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
      "software-store",
      [
        createAction({
          id: "software-store.open",
          title: "Open Software Store",
          description: "Open the Lyra Software Store.",
          risk: "navigate"
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
  onOpenSettingsSection
}: UseSoftwareCapabilitiesRegistryArgs): SoftwareCapabilitiesRegistryModel => {
  const [packs, setPacks] = useState<UiuxListPacksResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
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
      return { opened: true, url };
    });
    handlers.set("browser-search.search", (input) => {
      const query = requiredString(input, "query");
      const rawMode = optionalString(input, "mode");
      const mode: WorkspaceSearchMode = rawMode === "deep" ? "deep" : "standard";
      const tabId = tabsModel.navigateResolvedInput({
        kind: "search",
        query,
        mode
      }, { target: "new-tab" });
      return { opened: true, tabId, query, mode };
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
      return { opened: true, appInstanceId: nextApp.appInstanceId, path };
    });
    handlers.set("settings.openSection", (input) => {
      const section = optionalString(input, "section") ?? "general";
      const categoryId = SETTING_CATEGORY_IDS.has(section as BrowserSettingsCategoryId)
        ? section as BrowserSettingsCategoryId
        : "general";
      onOpenSettingsSection(categoryId);
      return { opened: true, section: categoryId };
    });
    handlers.set("software-store.open", () => {
      tabsModel.openAppTab(createSoftwareStoreAppRequest(labels.tabTitle));
      return { opened: true };
    });
    return handlers;
  }, [
    fileManagerModel,
    labels.tabTitle,
    onOpenSettingsSection,
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
    return await handler(request.input, {
      softwareId: selectedSoftware.id,
      actionId: action.id,
      ...(request.reason === undefined ? {} : { reason: request.reason })
    });
  }, [builtinHandlers, software]);

  const inspect = useCallback((request: SoftwareInspectCapabilityRequest) => {
    const selectedSoftware = findSoftware(software, request.softwareId);
    const action = request.actionId === undefined
      ? undefined
      : findAction(selectedSoftware, request.actionId);
    const actionIds = action === undefined
      ? selectedSoftware.actions.map((item) => item.id)
      : [action.id];
    return {
      software: selectedSoftware,
      ...(action === undefined ? {} : { action }),
      handlerRegistered: actionIds.every((actionId) =>
        builtinHandlers.has(actionId) || externalHandlersRef.current.has(actionId)
      )
    };
  }, [builtinHandlers, software]);

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
