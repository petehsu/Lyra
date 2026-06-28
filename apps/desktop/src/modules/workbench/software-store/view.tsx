import {
  AppBadge,
  AppButton,
  AppEmptyState,
  AppIconButton,
  AppInput,
  AppObjectRow,
  AppSearchField,
  AppStatusMessage,
  AppSurfaceHeader,
  AppTabs,
  type AppBadgeTone,
  type AppTabOption
} from "@renderer/ui/components";
import {
  AppWindow,
  Bell,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Download,
  FileImage,
  FolderOpen,
  FolderTree,
  GitBranch,
  Globe,
  History,
  KeyRound,
  Layers3,
  Package,
  PackageOpen,
  Palette,
  Play,
  RefreshCw,
  Settings2,
  ShieldCheck,
  ShieldOff,
  SquareTerminal
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type FormEvent,
  type ReactNode
} from "react";

import type {
  BuiltinUiuxPackSummary,
  InstalledUiuxPack,
  LyraSoftwareManifest,
  UiuxListPacksResponse,
  UiuxPackSource
} from "../../../shared/desktop-bridge";
import { useWorkbenchTitlebarContribution } from "../shell/titlebar-context";
import { formatShortDateTime } from "@workbench/i18n";
import type { WorkbenchUiPackId } from "../ui-platform";
import {
  softwareStoreDetailKey,
  subscribeSoftwareStoreDetailRequests
} from "./service";
import type {
  SoftwareStoreAgentAccess,
  SoftwareStoreBuiltinApp,
  SoftwareStoreBuiltinAppId,
  SoftwareStoreCatalogFilter,
  SoftwareStoreLabels,
  SoftwareStoreSurfaceProps
} from "./types";

type BuiltinSoftwareItem = {
  readonly kind: "software";
  readonly key: string;
  readonly software: LyraSoftwareManifest;
};

type UiuxSoftwareItem = {
  readonly kind: "uiux";
  readonly key: string;
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly version: string;
  readonly sourceLabel: string;
  readonly permissions: readonly string[];
  readonly active: boolean;
  readonly pending: boolean;
  readonly builtin: boolean;
  readonly installed?: InstalledUiuxPack;
};

type SoftwareStoreItem = BuiltinSoftwareItem | UiuxSoftwareItem;

const createItemKey = (kind: SoftwareStoreItem["kind"], id: string): string =>
  `${kind}:${id}`;

// ponytail: formatDate 委托 formatter.ts formatShortDateTime — 保持 locale 一致性
const formatDate = (value: string | undefined): string => {
  if (value === undefined) {
    return "";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return formatShortDateTime(date.getTime());
};

const formatSource = (
  source: UiuxPackSource | "builtin",
  labels: SoftwareStoreLabels
): string => {
  if (source === "builtin") {
    return labels.builtinSource;
  }
  if (source.kind === "local") {
    return `${labels.localSource} · ${source.path}`;
  }
  if (source.kind === "git") {
    return [
      `${labels.gitSource} · ${source.url}`,
      source.ref,
      source.subdir
    ]
      .filter((part): part is string => typeof part === "string" && part.length > 0)
      .join(" · ");
  }
  return [
    `${labels.npmSource} · ${source.packageName}`,
    source.version,
    source.subdir
  ]
    .filter((part): part is string => typeof part === "string" && part.length > 0)
    .join(" · ");
};

const toUserError = (error: unknown): string =>
  error instanceof Error && error.message.trim().length > 0
    ? error.message
    : "Operation failed";

const getAgentAccessLabel = (
  access: SoftwareStoreAgentAccess,
  labels: SoftwareStoreLabels
): string => {
  if (access === "controllable") {
    return labels.agentAccessControllable;
  }
  if (access === "readOnly") {
    return labels.agentAccessReadOnly;
  }
  return labels.agentAccessNotConnected;
};

const getSoftwareAgentAccess = (
  software: LyraSoftwareManifest
): SoftwareStoreAgentAccess => {
  if (software.actions.length === 0) {
    return "notConnected";
  }
  return software.actions.every((action) => action.risk === "read")
    ? "readOnly"
    : "controllable";
};

const findBuiltinApp = (
  labels: SoftwareStoreLabels,
  software: LyraSoftwareManifest
): SoftwareStoreBuiltinApp | undefined =>
  labels.builtinApps.find((app) => app.id === software.id);

const createUiuxItems = (
  response: UiuxListPacksResponse | null,
  activeUiPackId: WorkbenchUiPackId,
  labels: SoftwareStoreLabels
): readonly UiuxSoftwareItem[] => {
  if (response === null) {
    return [];
  }
  const pendingPackId = response.pendingExternalPackId;
  const activePackId = pendingPackId ?? response.activeExternalPackId ?? activeUiPackId;
  const builtins = response.builtin.map((pack: BuiltinUiuxPackSummary): UiuxSoftwareItem => ({
    kind: "uiux",
    key: createItemKey("uiux", pack.id),
    id: pack.id,
    name: pack.name,
    description: pack.description,
    version: "1.0.0",
    sourceLabel: formatSource("builtin", labels),
    permissions: [],
    active: activePackId === pack.id,
    pending: pendingPackId === pack.id,
    builtin: true
  }));
  const installed = response.installed.map((pack): UiuxSoftwareItem => ({
    kind: "uiux",
    key: createItemKey("uiux", pack.id),
    id: pack.id,
    name: pack.manifest.name,
    description: pack.manifest.description,
    version: pack.manifest.version,
    sourceLabel: formatSource(pack.source, labels),
    permissions: pack.manifest.permissions,
    active: activePackId === pack.id,
    pending: pendingPackId === pack.id,
    builtin: false,
    installed: pack
  }));
  return [...builtins, ...installed];
};

const matchesQuery = (item: SoftwareStoreItem, query: string): boolean => {
  if (query.length === 0) {
    return true;
  }
  const haystack = item.kind === "software"
    ? `${item.software.title} ${item.software.description} ${item.software.category ?? ""} ${item.software.id}`
    : `${item.name} ${item.description} ${item.id} ${item.sourceLabel}`;
  return haystack.toLowerCase().includes(query);
};

const matchesFilter = (
  item: SoftwareStoreItem,
  filter: SoftwareStoreCatalogFilter
): boolean =>
  filter === "all"
  || (filter === "builtin" && item.kind === "software" && item.software.source === "builtin")
  || (
    filter === "uiux"
    && (item.kind === "uiux" || (item.kind === "software" && item.software.source === "uiux"))
  );

const BuiltinSoftwareIcon = ({
  id,
  size = 17
}: {
  readonly id: SoftwareStoreBuiltinAppId | string;
  readonly size?: number;
}) => {
  if (id === "browser-search") return <Globe size={size} />;
  if (id === "file-manager") return <FolderOpen size={size} />;
  if (id === "downloads") return <Download size={size} />;
  if (id === "terminal") return <SquareTerminal size={size} />;
  if (id === "image-viewer") return <FileImage size={size} />;
  if (id === "notifications") return <Bell size={size} />;
  if (id === "settings") return <Settings2 size={size} />;
  if (id === "agent-history") return <History size={size} />;
  if (id === "agent-project-tree") return <FolderTree size={size} />;
  if (id === "agent-git") return <GitBranch size={size} />;

  if (id === "login-manager") return <KeyRound size={size} />;
  if (id === "software-store") return <AppWindow size={size} />;
  return <Layers3 size={size} />;
};

const ItemIcon = ({
  item,
  size = 17
}: {
  readonly item: SoftwareStoreItem;
  readonly size?: number;
}) => {
  const icon = item.kind === "software"
    ? <BuiltinSoftwareIcon id={item.software.id} size={size} />
    : item.builtin
      ? <Palette size={size} />
      : <PackageOpen size={size} />;
  return (
    <span className="lyra-software-store-product-icon" aria-hidden="true">
      {icon}
    </span>
  );
};

const getItemTitle = (item: SoftwareStoreItem): string =>
  item.kind === "software" ? item.software.title : item.name;

const getItemDescription = (item: SoftwareStoreItem): string =>
  item.kind === "software" ? item.software.description : item.description;

const getItemMeta = (
  item: SoftwareStoreItem,
  labels: SoftwareStoreLabels
): string =>
  item.kind === "software"
    ? item.software.category ?? labels.builtinType
    : item.version;

const badgeToneForTrustState = (
  trustState: InstalledUiuxPack["trustState"]
): AppBadgeTone => {
  if (trustState === "trusted") {
    return "success";
  }
  if (trustState === "revoked") {
    return "error";
  }
  return "warning";
};

const badgeToneForRisk = (
  risk: LyraSoftwareManifest["actions"][number]["risk"]
): AppBadgeTone => (
  risk === "read" ? "neutral" : risk === "navigate" ? "info" : "warning"
);

const DetailFact = ({
  label,
  children
}: {
  readonly label: string;
  readonly children: ReactNode;
}) => (
  <div className="lyra-software-store-fact">
    <dt>{label}</dt>
    <dd>{children}</dd>
  </div>
);

const StatusBadges = ({
  item,
  labels
}: {
  readonly item: SoftwareStoreItem;
  readonly labels: SoftwareStoreLabels;
}) => {
  if (item.kind === "software") {
    return (
      <>
        <AppBadge>
          {item.software.source === "builtin" ? labels.builtinBadge : labels.uiuxBadge}
        </AppBadge>
        {item.software.actions.length === 0 ? null : (
          <AppBadge tone="success">
            {labels.agentAccessControllable}
          </AppBadge>
        )}
      </>
    );
  }
  return (
    <>
      <AppBadge>{labels.uiuxBadge}</AppBadge>
      {item.active ? (
        <AppBadge tone="success">
          {labels.activeBadge}
        </AppBadge>
      ) : null}
      {item.pending ? (
        <AppBadge tone="warning">
          {labels.pendingBadge}
        </AppBadge>
      ) : null}
      {item.installed === undefined ? null : (
        <AppBadge tone={badgeToneForTrustState(item.installed.trustState)}>
          {item.installed.trustState === "trusted"
            ? labels.trustedBadge
            : item.installed.trustState === "revoked"
              ? labels.revokedBadge
              : labels.untrustedBadge}
        </AppBadge>
      )}
    </>
  );
};

export const SoftwareStoreSurface = ({
  desktopApi,
  embedded = false,
  labels,
  softwareCapabilities,
  activeUiPackId,
  onUiPackIdChange,
  onOpenBuiltinApp
}: SoftwareStoreSurfaceProps) => {
  const [packs, setPacks] = useState<UiuxListPacksResponse | null>(null);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<SoftwareStoreCatalogFilter>("all");
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [pendingOperation, setPendingOperation] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [gitUrl, setGitUrl] = useState("");
  const [gitRef, setGitRef] = useState("");
  const [gitSubdir, setGitSubdir] = useState("");
  const [npmPackage, setNpmPackage] = useState("");
  const [npmVersion, setNpmVersion] = useState("");
  const [npmSubdir, setNpmSubdir] = useState("");

  const refreshPacks = useCallback(async (): Promise<void> => {
    if (desktopApi?.uiux === undefined) {
      setPacks(null);
      setError(labels.unavailable);
      return;
    }
    setError(null);
    try {
      const response = await desktopApi.uiux.listPacks();
      setPacks(response);
    } catch (loadError: unknown) {
      console.warn("[lyra-software-store] failed to refresh UIUX packs", loadError);
      setPacks(null);
      setError(toUserError(loadError));
    }
  }, [desktopApi, labels.unavailable]);

  const refreshAll = useCallback(async (): Promise<void> => {
    await Promise.all([
      refreshPacks(),
      softwareCapabilities.refresh()
    ]);
  }, [refreshPacks, softwareCapabilities]);

  useEffect(() => {
    let cancelled = false;
    if (desktopApi?.uiux === undefined) {
      setPacks(null);
      setError(labels.unavailable);
      return undefined;
    }
    void desktopApi.uiux.listPacks()
      .then((response) => {
        if (cancelled) {
          return;
        }
        setPacks(response);
        setError(null);
      })
      .catch((loadError: unknown) => {
        if (cancelled) {
          return;
        }
        console.warn("[lyra-software-store] failed to list UIUX packs", loadError);
        setPacks(null);
        setError(toUserError(loadError));
      });
    return () => {
      cancelled = true;
    };
  }, [desktopApi, labels.unavailable]);

  const items = useMemo<readonly SoftwareStoreItem[]>(() => {
    const builtinItems = softwareCapabilities.software.map((software): BuiltinSoftwareItem => ({
      kind: "software",
      key: createItemKey("software", software.id),
      software
    }));
    return [
      ...builtinItems,
      ...createUiuxItems(packs, activeUiPackId, labels)
    ];
  }, [activeUiPackId, labels, packs, softwareCapabilities.software]);

  const normalizedQuery = query.trim().toLowerCase();
  const filteredItems = useMemo(
    () => items.filter((item) => matchesFilter(item, filter) && matchesQuery(item, normalizedQuery)),
    [filter, items, normalizedQuery]
  );

  useEffect(() => {
    if (selectedKey === null || items.some((item) => item.key === selectedKey)) {
      return;
    }
    if (selectedKey.startsWith("uiux:") && packs === null) {
      return;
    }
    setSelectedKey(null);
  }, [items, packs, selectedKey]);

  useEffect(
    () => subscribeSoftwareStoreDetailRequests((request) => {
      setQuery("");
      setFilter(request.kind === "uiux" ? "uiux" : "all");
      setSelectedKey(softwareStoreDetailKey(request));
    }),
    []
  );

  const selectedItem = useMemo(
    () => items.find((item) => item.key === selectedKey) ?? null,
    [items, selectedKey]
  );

  const runOperation = async (
    operationLabel: string,
    operation: () => Promise<string | void>
  ): Promise<void> => {
    setPendingOperation(operationLabel);
    setMessage(null);
    setError(null);
    try {
      const operationMessage = await operation();
      await refreshAll();
      setMessage(operationMessage ?? labels.operationSucceeded);
    } catch (operationError: unknown) {
      console.warn("[lyra-software-store] operation failed", operationError);
      setError(`${labels.operationFailed}: ${toUserError(operationError)}`);
    } finally {
      setPendingOperation(null);
    }
  };

  const installLocal = (): void => {
    void runOperation(labels.installLocal, async () => {
      if (desktopApi?.uiux === undefined || desktopApi.files === undefined) {
        throw new Error(labels.unavailable);
      }
      const directories = await desktopApi.files.selectDirectories();
      const sourcePath = directories[0]?.path;
      if (sourcePath === undefined) {
        return;
      }
      await desktopApi.uiux.installFromLocal({ sourcePath });
    });
  };

  const installGit = (event: FormEvent): void => {
    event.preventDefault();
    void runOperation(labels.installGit, async () => {
      if (desktopApi?.uiux === undefined) {
        throw new Error(labels.unavailable);
      }
      await desktopApi.uiux.installFromGit({
        url: gitUrl.trim(),
        ...(gitRef.trim().length === 0 ? {} : { ref: gitRef.trim() }),
        ...(gitSubdir.trim().length === 0 ? {} : { subdir: gitSubdir.trim() })
      });
      setGitUrl("");
      setGitRef("");
      setGitSubdir("");
    });
  };

  const installNpm = (event: FormEvent): void => {
    event.preventDefault();
    void runOperation(labels.installNpm, async () => {
      if (desktopApi?.uiux === undefined) {
        throw new Error(labels.unavailable);
      }
      await desktopApi.uiux.installFromNpm({
        packageName: npmPackage.trim(),
        ...(npmVersion.trim().length === 0 ? {} : { version: npmVersion.trim() }),
        ...(npmSubdir.trim().length === 0 ? {} : { subdir: npmSubdir.trim() })
      });
      setNpmPackage("");
      setNpmVersion("");
      setNpmSubdir("");
    });
  };

  const setTrustState = (
    item: UiuxSoftwareItem,
    trustState: "trusted" | "revoked"
  ): void => {
    void runOperation(trustState === "trusted" ? labels.trust : labels.revokeTrust, async () => {
      if (desktopApi?.uiux === undefined) {
        throw new Error(labels.unavailable);
      }
      await desktopApi.uiux.setTrustState({ packId: item.id, trustState });
    });
  };

  const activateUiuxPack = (item: UiuxSoftwareItem): void => {
    void runOperation(labels.activate, async () => {
      if (desktopApi?.uiux === undefined) {
        throw new Error(labels.unavailable);
      }
      const response = await desktopApi.uiux.requestActivation({ packId: item.id });
      onUiPackIdChange(response.packId as WorkbenchUiPackId);
      if (response.reloadRequired) {
        return labels.reloadRequired;
      }
    });
  };

  const titlebarContribution = useMemo(
    () => ({
      ariaLabel: labels.title,
      content: (
        <>
          <span className="lyra-titlebar-context-chip">
            {String(items.length)}
          </span>
          <AppIconButton
            className="lyra-titlebar-context-icon-button"
            aria-label={labels.refresh}
            title={labels.refresh}
            onClick={() => {
              void refreshAll();
            }}
          >
            <RefreshCw size={14} aria-hidden="true" />
          </AppIconButton>
        </>
      )
    }),
    [items.length, labels.refresh, labels.title, refreshAll]
  );
  useWorkbenchTitlebarContribution(titlebarContribution);

  const canInstall = desktopApi?.uiux !== undefined;
  const isBusy = pendingOperation !== null;
  const filterOptions = useMemo<readonly AppTabOption<SoftwareStoreCatalogFilter>[]>(
    () => [
      { value: "all", label: labels.allTab },
      { value: "builtin", label: labels.builtinTab },
      { value: "uiux", label: labels.uiuxTab }
    ],
    [labels.allTab, labels.builtinTab, labels.uiuxTab]
  );
  const builtinItems = useMemo(
    () => filteredItems.filter((item) => item.kind === "software"),
    [filteredItems]
  );
  const uiuxItems = useMemo(
    () => filteredItems.filter((item) => item.kind === "uiux"),
    [filteredItems]
  );

  return (
    <section
      className={embedded ? "lyra-software-store lyra-software-store-embedded" : "lyra-software-store"}
      aria-label={labels.title}
    >
      <div className="lyra-software-store-content">
        {selectedItem === null ? (
          <>
            {embedded ? null : (
              <header className="lyra-software-store-browse-head">
                <div className="lyra-software-store-title-block">
                  <h1>{labels.title}</h1>
                  <p>{labels.selectItemDescription}</p>
                </div>
                <AppButton
                  variant="outline"
                  size="sm"
                  disabled={!canInstall || isBusy}
                  onClick={installLocal}
                >
                  <FolderOpen size={14} aria-hidden="true" />
                  <span>{labels.chooseLocal}</span>
                </AppButton>
              </header>
            )}

            <div className="lyra-software-store-controls">
              <AppTabs
                ariaLabel={labels.title}
                className="lyra-software-store-filter"
                value={filter}
                options={filterOptions}
                onValueChange={setFilter}
              />
              <AppSearchField
                className="lyra-software-store-search"
                ariaLabel={labels.searchPlaceholder}
                placeholder={labels.searchPlaceholder}
                value={query}
                onValueChange={setQuery}
              />
              {embedded ? (
                <AppIconButton
                  className="lyra-software-store-local-install"
                  aria-label={labels.chooseLocal}
                  title={labels.chooseLocal}
                  disabled={!canInstall || isBusy}
                  onClick={installLocal}
                >
                  <FolderOpen size={14} aria-hidden="true" />
                </AppIconButton>
              ) : null}
            </div>

            {filteredItems.length === 0 ? (
              <AppEmptyState className="lyra-software-store-empty" title={labels.emptyTitle} />
            ) : (
              <div className="lyra-software-store-section-stack">
                {builtinItems.length === 0 ? null : (
                  <SoftwareStoreItemSection
                    title={labels.builtinTab}
                    items={builtinItems}
                    labels={labels}
                    onSelect={setSelectedKey}
                  />
                )}
                {uiuxItems.length === 0 ? null : (
                  <SoftwareStoreItemSection
                    title={labels.uiuxTab}
                    items={uiuxItems}
                    labels={labels}
                    onSelect={setSelectedKey}
                  />
                )}
              </div>
            )}

            <section className="lyra-software-store-install" aria-label={labels.installLocal}>
              <AppSurfaceHeader
                title={labels.installLocal}
                description={labels.uiuxTab}
                actions={(
                  <AppIconButton
                    aria-label={labels.refresh}
                    title={labels.refresh}
                    onClick={() => {
                      void refreshAll();
                    }}
                  >
                    <RefreshCw size={14} aria-hidden="true" />
                  </AppIconButton>
                )}
              />

              <div className="lyra-software-store-install-grid">
                <form onSubmit={installGit}>
                  <strong className="lyra-software-store-install-title">
                    <GitBranch size={14} aria-hidden="true" />
                    {labels.installGit}
                  </strong>
                  <label>
                    <span>{labels.gitUrlLabel}</span>
                    <AppInput
                      aria-label={labels.gitUrlLabel}
                      value={gitUrl}
                      onChange={(event) => {
                        setGitUrl(event.currentTarget.value);
                      }}
                    />
                  </label>
                  <label>
                    <span>{labels.gitRefLabel}</span>
                    <AppInput
                      aria-label={labels.gitRefLabel}
                      value={gitRef}
                      onChange={(event) => {
                        setGitRef(event.currentTarget.value);
                      }}
                    />
                  </label>
                  <label>
                    <span>{labels.gitSubdirLabel}</span>
                    <AppInput
                      aria-label={labels.gitSubdirLabel}
                      value={gitSubdir}
                      onChange={(event) => {
                        setGitSubdir(event.currentTarget.value);
                      }}
                    />
                  </label>
                  <AppButton
                    type="submit"
                    variant="outline"
                    size="sm"
                    disabled={!canInstall || isBusy || gitUrl.trim().length === 0}
                  >
                    {labels.installGit}
                  </AppButton>
                </form>

                <form onSubmit={installNpm}>
                  <strong className="lyra-software-store-install-title">
                    <Package size={14} aria-hidden="true" />
                    {labels.installNpm}
                  </strong>
                  <label>
                    <span>{labels.npmPackageLabel}</span>
                    <AppInput
                      aria-label={labels.npmPackageLabel}
                      value={npmPackage}
                      onChange={(event) => {
                        setNpmPackage(event.currentTarget.value);
                      }}
                    />
                  </label>
                  <label>
                    <span>{labels.npmVersionLabel}</span>
                    <AppInput
                      aria-label={labels.npmVersionLabel}
                      value={npmVersion}
                      onChange={(event) => {
                        setNpmVersion(event.currentTarget.value);
                      }}
                    />
                  </label>
                  <label>
                    <span>{labels.npmSubdirLabel}</span>
                    <AppInput
                      aria-label={labels.npmSubdirLabel}
                      value={npmSubdir}
                      onChange={(event) => {
                        setNpmSubdir(event.currentTarget.value);
                      }}
                    />
                  </label>
                  <AppButton
                    type="submit"
                    variant="outline"
                    size="sm"
                    disabled={!canInstall || isBusy || npmPackage.trim().length === 0}
                  >
                    {labels.installNpm}
                  </AppButton>
                </form>
              </div>
            </section>
          </>
        ) : (
          <section className="lyra-software-store-detail" aria-label={labels.detailsTitle}>
            <AppButton
              className="lyra-software-store-back"
              variant="ghost"
              size="sm"
              onClick={() => {
                setSelectedKey(null);
              }}
            >
              <ChevronLeft size={14} aria-hidden="true" />
              <span>{labels.title}</span>
            </AppButton>

            {selectedItem.kind === "software" ? (
            <SoftwareDetail
              item={selectedItem}
              labels={labels}
              onOpenBuiltinApp={onOpenBuiltinApp}
            />
          ) : (
            <UiuxDetail
              item={selectedItem}
              labels={labels}
              busy={isBusy}
              onTrust={() => {
                setTrustState(selectedItem, "trusted");
              }}
              onRevoke={() => {
                setTrustState(selectedItem, "revoked");
              }}
              onActivate={() => {
                activateUiuxPack(selectedItem);
              }}
            />
          )}
          </section>
        )}

        <div className="lyra-software-store-status-stack">
          {pendingOperation === null ? null : (
            <AppStatusMessage className="lyra-software-store-status">
              {labels.activating}
            </AppStatusMessage>
          )}
          {message === null ? null : (
            <AppStatusMessage className="lyra-software-store-status" tone="success">
              {message}
            </AppStatusMessage>
          )}
          {error === null ? null : (
            <AppStatusMessage className="lyra-software-store-status" tone="error">
              {error}
            </AppStatusMessage>
          )}
        </div>
      </div>
    </section>
  );
};

const SoftwareStoreItemSection = ({
  title,
  items,
  labels,
  onSelect
}: {
  readonly title: string;
  readonly items: readonly SoftwareStoreItem[];
  readonly labels: SoftwareStoreLabels;
  readonly onSelect: (key: string) => void;
}) => (
  <section className="lyra-software-store-item-section" aria-label={title}>
    <h2>{title}</h2>
    <div className="lyra-software-store-item-list">
      {items.map((item) => (
        <AppObjectRow
          key={item.key}
          className="lyra-software-store-item"
          icon={<ItemIcon item={item} />}
          title={getItemTitle(item)}
          description={getItemDescription(item)}
          meta={getItemMeta(item, labels)}
          badges={<ChevronRight className="lyra-software-store-item-chevron" size={14} aria-hidden="true" />}
          onClick={() => {
            onSelect(item.key);
          }}
        />
      ))}
    </div>
  </section>
);

const SoftwareDetail = ({
  item,
  labels,
  onOpenBuiltinApp
}: {
  readonly item: BuiltinSoftwareItem;
  readonly labels: SoftwareStoreLabels;
  readonly onOpenBuiltinApp: SoftwareStoreSurfaceProps["onOpenBuiltinApp"];
}) => {
  const software = item.software;
  const builtinApp = findBuiltinApp(labels, software);
  const openable = software.source === "builtin" && builtinApp?.openable === true;
  return (
    <article className="lyra-software-store-detail-panel">
      <header className="lyra-software-store-detail-head">
        <span className="lyra-software-store-detail-icon" aria-hidden="true">
          <ItemIcon item={item} size={20} />
        </span>
        <div className="lyra-software-store-detail-copy">
          <h2>{software.title}</h2>
          <span className="lyra-software-store-detail-badges">
            <StatusBadges item={item} labels={labels} />
          </span>
          <p>{software.description}</p>
        </div>
        <span className="lyra-software-store-detail-actions">
          <AppButton
            variant="outline"
            size="sm"
            disabled={!openable}
            title={builtinApp?.openDisabledReason ?? labels.openBuiltin}
            onClick={() => {
              if (openable && builtinApp !== undefined) {
                onOpenBuiltinApp(builtinApp.id);
              }
            }}
          >
            <Play size={14} aria-hidden="true" />
            <span>{openable ? labels.openBuiltin : labels.openUnavailable}</span>
          </AppButton>
        </span>
      </header>
      <dl className="lyra-software-store-facts">
        <DetailFact label={labels.typeLabel}>
          {software.source === "builtin" ? labels.builtinType : labels.uiuxType}
        </DetailFact>
        <DetailFact label={labels.categoryLabel}>{software.category ?? "-"}</DetailFact>
        <DetailFact label={labels.versionLabel}>{software.version ?? "-"}</DetailFact>
        <DetailFact label={labels.agentAccessLabel}>
          {getAgentAccessLabel(getSoftwareAgentAccess(software), labels)}
        </DetailFact>
      </dl>
      <section className="lyra-software-store-permissions">
        <strong>{labels.actionsLabel}</strong>
        {software.actions.length === 0 ? (
          <span>{labels.noActions}</span>
        ) : (
          <ul className="lyra-software-store-action-list">
            {software.actions.map((action) => (
              <li key={action.id}>
                <span>{action.title}</span>
                <AppBadge tone={badgeToneForRisk(action.risk)}>
                  {labels.riskLabel}: {action.risk}
                </AppBadge>
              </li>
            ))}
          </ul>
        )}
      </section>
    </article>
  );
};

const UiuxDetail = ({
  item,
  labels,
  busy,
  onTrust,
  onRevoke,
  onActivate
}: {
  readonly item: UiuxSoftwareItem;
  readonly labels: SoftwareStoreLabels;
  readonly busy: boolean;
  readonly onTrust: () => void;
  readonly onRevoke: () => void;
  readonly onActivate: () => void;
}) => {
  const installed = item.installed;
  const canActivate = installed === undefined || installed.trustState === "trusted";
  return (
    <article className="lyra-software-store-detail-panel">
      <header className="lyra-software-store-detail-head">
        <span className="lyra-software-store-detail-icon" aria-hidden="true">
          <ItemIcon item={item} size={20} />
        </span>
        <div className="lyra-software-store-detail-copy">
          <h2>{item.name}</h2>
          <span className="lyra-software-store-detail-badges">
            <StatusBadges item={item} labels={labels} />
          </span>
          <p>{item.description}</p>
        </div>
        <span className="lyra-software-store-detail-actions">
          {installed === undefined ? null : installed.trustState === "trusted" ? (
            <AppButton variant="outline" size="sm" disabled={busy} onClick={onRevoke}>
              <ShieldOff size={14} aria-hidden="true" />
              <span>{labels.revokeTrust}</span>
            </AppButton>
          ) : (
            <AppButton variant="outline" size="sm" disabled={busy} onClick={onTrust}>
              <ShieldCheck size={14} aria-hidden="true" />
              <span>{labels.trust}</span>
            </AppButton>
          )}
          <AppButton
            variant="outline"
            size="sm"
            disabled={busy || item.active || item.pending || !canActivate}
            onClick={onActivate}
          >
            {item.active ? <CheckCircle2 size={14} aria-hidden="true" /> : <Play size={14} aria-hidden="true" />}
            <span>{labels.activate}</span>
          </AppButton>
        </span>
      </header>
      <dl className="lyra-software-store-facts">
        <DetailFact label={labels.typeLabel}>{labels.uiuxType}</DetailFact>
        <DetailFact label={labels.versionLabel}>{item.version}</DetailFact>
        <DetailFact label={labels.sourceLabel}>{item.sourceLabel}</DetailFact>
        <DetailFact label={labels.statusLabel}>
          {item.pending
            ? labels.pendingBadge
            : item.active
              ? labels.activeBadge
              : installed?.trustState ?? labels.builtinBadge}
        </DetailFact>
        {installed === undefined ? null : (
          <>
            <DetailFact label={labels.installedAtLabel}>{formatDate(installed.installedAt)}</DetailFact>
            <DetailFact label={labels.updatedAtLabel}>{formatDate(installed.updatedAt)}</DetailFact>
          </>
        )}
      </dl>
      <section className="lyra-software-store-permissions">
        <strong>{labels.permissionsLabel}</strong>
        {item.permissions.length === 0 ? (
          <span>{labels.noPermissions}</span>
        ) : (
          <ul className="lyra-software-store-chip-list">
            {item.permissions.map((permission) => (
              <li key={permission}>
                <AppBadge>{permission}</AppBadge>
              </li>
            ))}
          </ul>
        )}
      </section>
    </article>
  );
};
