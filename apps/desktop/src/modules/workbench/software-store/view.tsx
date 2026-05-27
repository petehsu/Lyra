import {
  CheckCircle2,
  FolderOpen,
  GitBranch,
  Package,
  Play,
  RefreshCw,
  ShieldCheck,
  ShieldOff,
  Store
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type FormEvent
} from "react";

import type {
  BuiltinUiuxPackSummary,
  InstalledUiuxPack,
  LyraSoftwareManifest,
  UiuxListPacksResponse,
  UiuxPackSource
} from "../../../shared/desktop-bridge";
import { useWorkbenchTitlebarContribution } from "../shell/titlebar-context";
import type { WorkbenchUiPackId } from "../ui-platform";
import type {
  SoftwareStoreAgentAccess,
  SoftwareStoreBuiltinApp,
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

const formatDate = (value: string | undefined): string => {
  if (value === undefined) {
    return "";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return date.toLocaleString(undefined, {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  });
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

const ItemIcon = ({ item }: { readonly item: SoftwareStoreItem }) => (
  <span className="lyra-software-store-item-icon" aria-hidden="true">
    {item.kind === "software" && item.software.source === "builtin"
      ? <Store size={15} />
      : <Package size={15} />}
  </span>
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
        <span className="lyra-software-store-badge">
          {item.software.source === "builtin" ? labels.builtinBadge : labels.uiuxBadge}
        </span>
        {item.software.actions.length === 0 ? null : (
          <span className="lyra-software-store-badge lyra-software-store-badge-success">
            {labels.agentAccessControllable}
          </span>
        )}
      </>
    );
  }
  return (
    <>
      <span className="lyra-software-store-badge">{labels.uiuxBadge}</span>
      {item.active ? (
        <span className="lyra-software-store-badge lyra-software-store-badge-success">
          {labels.activeBadge}
        </span>
      ) : null}
      {item.pending ? (
        <span className="lyra-software-store-badge lyra-software-store-badge-warning">
          {labels.pendingBadge}
        </span>
      ) : null}
      {item.installed === undefined ? null : (
        <span className="lyra-software-store-badge">
          {item.installed.trustState === "trusted"
            ? labels.trustedBadge
            : item.installed.trustState === "revoked"
              ? labels.revokedBadge
              : labels.untrustedBadge}
        </span>
      )}
    </>
  );
};

export const SoftwareStoreSurface = ({
  desktopApi,
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
    if (selectedKey !== null && items.some((item) => item.key === selectedKey)) {
      return;
    }
    setSelectedKey(items[0]?.key ?? null);
  }, [items, selectedKey]);

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
          <button
            type="button"
            className="lyra-titlebar-context-icon-button"
            aria-label={labels.refresh}
            title={labels.refresh}
            onClick={() => {
              void refreshAll();
            }}
          >
            <RefreshCw size={14} aria-hidden="true" />
          </button>
        </>
      )
    }),
    [items.length, labels.refresh, labels.title, refreshAll]
  );
  useWorkbenchTitlebarContribution(titlebarContribution);

  const canInstall = desktopApi?.uiux !== undefined;
  const isBusy = pendingOperation !== null;

  return (
    <section className="lyra-software-store" aria-label={labels.title}>
      <aside className="lyra-software-store-sidebar">
        <header className="lyra-software-store-sidebar-head">
          <strong>{labels.title}</strong>
          <button
            type="button"
            aria-label={labels.refresh}
            title={labels.refresh}
            onClick={() => {
              void refreshAll();
            }}
          >
            <RefreshCw size={14} aria-hidden="true" />
          </button>
        </header>

        <input
          className="lyra-software-store-search"
          aria-label={labels.searchPlaceholder}
          placeholder={labels.searchPlaceholder}
          value={query}
          onChange={(event) => {
            setQuery(event.currentTarget.value);
          }}
        />

        <div className="lyra-software-store-filter" role="tablist" aria-label={labels.title}>
          {[
            ["all", labels.allTab],
            ["builtin", labels.builtinTab],
            ["uiux", labels.uiuxTab]
          ].map(([value, label]) => (
            <button
              key={value}
              type="button"
              role="tab"
              aria-selected={filter === value}
              className={filter === value ? "is-active" : ""}
              onClick={() => {
                setFilter(value as SoftwareStoreCatalogFilter);
              }}
            >
              {label}
            </button>
          ))}
        </div>

        <div className="lyra-software-store-list" aria-label={labels.title}>
          {filteredItems.length === 0 ? (
            <div className="lyra-software-store-empty">
              <strong>{labels.emptyTitle}</strong>
              <span>{labels.emptyDescription}</span>
            </div>
          ) : (
            filteredItems.map((item) => {
              const active = selectedItem?.key === item.key;
              const title = item.kind === "software" ? item.software.title : item.name;
              const description = item.kind === "software"
                ? item.software.description
                : item.description;
              return (
                <button
                  key={item.key}
                  type="button"
                  className={active ? "lyra-software-store-item is-active" : "lyra-software-store-item"}
                  onClick={() => {
                    setSelectedKey(item.key);
                  }}
                >
                  <ItemIcon item={item} />
                  <span className="lyra-software-store-item-main">
                    <strong>{title}</strong>
                    <small>{description}</small>
                  </span>
                  <span className="lyra-software-store-item-badges">
                    <StatusBadges item={item} labels={labels} />
                  </span>
                </button>
              );
            })
          )}
        </div>
      </aside>

      <section className="lyra-software-store-detail" aria-label={labels.detailsTitle}>
        {selectedItem === null ? (
          <div className="lyra-software-store-detail-empty">
            <strong>{labels.selectItemTitle}</strong>
            <span>{labels.selectItemDescription}</span>
          </div>
        ) : selectedItem.kind === "software" ? (
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

        <section className="lyra-software-store-install" aria-label={labels.installLocal}>
          <header>
            <strong>{labels.uiuxTab}</strong>
            <button
              type="button"
              disabled={!canInstall || isBusy}
              onClick={installLocal}
            >
              <FolderOpen size={14} aria-hidden="true" />
              <span>{labels.chooseLocal}</span>
            </button>
          </header>

          <div className="lyra-software-store-install-grid">
            <form onSubmit={installGit}>
              <strong>
                <GitBranch size={14} aria-hidden="true" />
                {labels.installGit}
              </strong>
              <label>
                <span>{labels.gitUrlLabel}</span>
                <input
                  value={gitUrl}
                  onChange={(event) => {
                    setGitUrl(event.currentTarget.value);
                  }}
                />
              </label>
              <label>
                <span>{labels.gitRefLabel}</span>
                <input
                  value={gitRef}
                  onChange={(event) => {
                    setGitRef(event.currentTarget.value);
                  }}
                />
              </label>
              <label>
                <span>{labels.gitSubdirLabel}</span>
                <input
                  value={gitSubdir}
                  onChange={(event) => {
                    setGitSubdir(event.currentTarget.value);
                  }}
                />
              </label>
              <button type="submit" disabled={!canInstall || isBusy || gitUrl.trim().length === 0}>
                {labels.installGit}
              </button>
            </form>

            <form onSubmit={installNpm}>
              <strong>
                <Package size={14} aria-hidden="true" />
                {labels.installNpm}
              </strong>
              <label>
                <span>{labels.npmPackageLabel}</span>
                <input
                  value={npmPackage}
                  onChange={(event) => {
                    setNpmPackage(event.currentTarget.value);
                  }}
                />
              </label>
              <label>
                <span>{labels.npmVersionLabel}</span>
                <input
                  value={npmVersion}
                  onChange={(event) => {
                    setNpmVersion(event.currentTarget.value);
                  }}
                />
              </label>
              <label>
                <span>{labels.npmSubdirLabel}</span>
                <input
                  value={npmSubdir}
                  onChange={(event) => {
                    setNpmSubdir(event.currentTarget.value);
                  }}
                />
              </label>
              <button type="submit" disabled={!canInstall || isBusy || npmPackage.trim().length === 0}>
                {labels.installNpm}
              </button>
            </form>
          </div>
        </section>

        {pendingOperation === null ? null : (
          <p className="lyra-software-store-status">{labels.activating}</p>
        )}
        {message === null ? null : (
          <p className="lyra-software-store-status lyra-software-store-status-success">
            {message}
          </p>
        )}
        {error === null ? null : (
          <p className="lyra-software-store-status lyra-software-store-status-error">
            {error}
          </p>
        )}
      </section>
    </section>
  );
};

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
          {software.source === "builtin" ? <Store size={18} /> : <Package size={18} />}
        </span>
        <div>
          <h2>{software.title}</h2>
          <p>{software.description}</p>
        </div>
      </header>
      <dl className="lyra-software-store-facts">
        <div>
          <dt>{labels.typeLabel}</dt>
          <dd>{software.source === "builtin" ? labels.builtinType : labels.uiuxType}</dd>
        </div>
        <div>
          <dt>{labels.categoryLabel}</dt>
          <dd>{software.category ?? "-"}</dd>
        </div>
        <div>
          <dt>{labels.versionLabel}</dt>
          <dd>{software.version ?? "-"}</dd>
        </div>
        <div>
          <dt>{labels.agentAccessLabel}</dt>
          <dd>{getAgentAccessLabel(getSoftwareAgentAccess(software), labels)}</dd>
        </div>
      </dl>
      <section className="lyra-software-store-permissions">
        <strong>{labels.actionsLabel}</strong>
        {software.actions.length === 0 ? (
          <span>{labels.noActions}</span>
        ) : (
          <ul>
            {software.actions.map((action) => (
              <li key={action.id}>
                {action.title} · {labels.riskLabel}: {action.risk}
              </li>
            ))}
          </ul>
        )}
      </section>
      <footer className="lyra-software-store-actions">
        <button
          type="button"
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
        </button>
      </footer>
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
          <Package size={18} />
        </span>
        <div>
          <h2>{item.name}</h2>
          <p>{item.description}</p>
        </div>
      </header>
      <dl className="lyra-software-store-facts">
        <div>
          <dt>{labels.typeLabel}</dt>
          <dd>{labels.uiuxType}</dd>
        </div>
        <div>
          <dt>{labels.versionLabel}</dt>
          <dd>{item.version}</dd>
        </div>
        <div>
          <dt>{labels.sourceLabel}</dt>
          <dd>{item.sourceLabel}</dd>
        </div>
        <div>
          <dt>{labels.statusLabel}</dt>
          <dd>
            {item.pending
              ? labels.pendingBadge
              : item.active
                ? labels.activeBadge
                : installed?.trustState ?? labels.builtinBadge}
          </dd>
        </div>
        {installed === undefined ? null : (
          <>
            <div>
              <dt>{labels.installedAtLabel}</dt>
              <dd>{formatDate(installed.installedAt)}</dd>
            </div>
            <div>
              <dt>{labels.updatedAtLabel}</dt>
              <dd>{formatDate(installed.updatedAt)}</dd>
            </div>
          </>
        )}
      </dl>
      <section className="lyra-software-store-permissions">
        <strong>{labels.permissionsLabel}</strong>
        {item.permissions.length === 0 ? (
          <span>{labels.noPermissions}</span>
        ) : (
          <ul>
            {item.permissions.map((permission) => (
              <li key={permission}>{permission}</li>
            ))}
          </ul>
        )}
      </section>
      <footer className="lyra-software-store-actions">
        {installed === undefined ? null : installed.trustState === "trusted" ? (
          <button type="button" disabled={busy} onClick={onRevoke}>
            <ShieldOff size={14} aria-hidden="true" />
            <span>{labels.revokeTrust}</span>
          </button>
        ) : (
          <button type="button" disabled={busy} onClick={onTrust}>
            <ShieldCheck size={14} aria-hidden="true" />
            <span>{labels.trust}</span>
          </button>
        )}
        <button
          type="button"
          disabled={busy || item.active || item.pending || !canActivate}
          onClick={onActivate}
        >
          {item.active ? <CheckCircle2 size={14} aria-hidden="true" /> : <Play size={14} aria-hidden="true" />}
          <span>{labels.activate}</span>
        </button>
      </footer>
    </article>
  );
};
