import type { SearchDeepEdge, SearchDeepNode, SearchDeepSnapshot } from "../../../shared/desktop-bridge";
import type {
  DeepSearchEdgeDirectionFilter,
  DeepSearchEdgeKindFilter
} from "./types";
import type { DeepSearchConnectedEdge, DeepSearchLineage } from "./deep-search-lineage";

export type DeepSearchOverviewLabels = {
  readonly overviewLabel: string;
  readonly selectedNodeLabel: string;
  readonly phaseLabel: string;
  readonly budgetLabel: string;
  readonly webStatusLabel: string;
  readonly localStatusLabel: string;
  readonly dedupedLabel: string;
  readonly derivedLabel: string;
  readonly roundsLabel: string;
  readonly sourceFilterLabel: string;
  readonly webLabel: string;
  readonly localLabel: string;
  readonly openLabel: string;
  readonly expandLabel: string;
  readonly centerLabel: string;
  readonly emptySelectionLabel: string;
  readonly snippetLabel: string;
  readonly sourceLabel: string;
  readonly connectedLinksLabel: string;
  readonly edgeFiltersLabel: string;
  readonly directionLabel: string;
  readonly incomingLabel: string;
  readonly outgoingLabel: string;
  readonly bothLabel: string;
  readonly discoveredLabel: string;
  readonly expandedLabel: string;
  readonly relatedLabel: string;
  readonly hostsSubdomainLabel: string;
  readonly containsPageLabel: string;
  readonly lineageLabel: string;
  readonly alternateLinksLabel: string;
  readonly revealInManagerLabel: string;
  readonly matchKindLabel: string;
  readonly lineLabel: string;
  readonly sharedTermsLabel: string;
  readonly domainLabel: string;
  readonly subdomainLabel: string;
  readonly pageLabel: string;
  readonly verifiedLabel: string;
  readonly guessedLabel: string;
  readonly discoveredByLabel: string;
  readonly verificationScoreLabel: string;
  readonly guessedDomainsLabel: string;
  readonly verifiedDomainsLabel: string;
  readonly subdomainsLabel: string;
  readonly visitedPagesLabel: string;
  readonly queuedPagesLabel: string;
  readonly droppedPagesLabel: string;
  readonly siteExpansionStatusLabel: string;
  readonly allLabel: string;
};

type DeepSearchOverviewProps = {
  readonly labels: DeepSearchOverviewLabels;
  readonly snapshot: SearchDeepSnapshot;
  readonly selectedNode: SearchDeepNode | null;
  readonly connectedEdges: readonly DeepSearchConnectedEdge[];
  readonly lineage: DeepSearchLineage;
  readonly sourceFilter: "all" | "web" | "local";
  readonly edgeKindFilter: DeepSearchEdgeKindFilter;
  readonly edgeDirectionFilter: DeepSearchEdgeDirectionFilter;
  readonly localPrimaryAction: "open_file" | "reveal_in_manager";
  readonly onOpenSelected?: () => void;
  readonly onRevealSelected?: () => void;
  readonly onExpandSelected?: () => void;
  readonly onCenterSelected?: () => void;
  readonly onSourceFilterChange: (value: "all" | "web" | "local") => void;
  readonly onEdgeKindFilterChange: (value: DeepSearchEdgeKindFilter) => void;
  readonly onEdgeDirectionFilterChange: (value: DeepSearchEdgeDirectionFilter) => void;
  readonly onHighlightEdge: (edgeId: string | null) => void;
};

const renderNodeMeta = (node: SearchDeepNode): string => {
  if (node.kind === "web_page") {
    return typeof node.metadata?.canonicalUrl === "string"
      ? node.metadata.canonicalUrl
      : typeof node.metadata?.url === "string"
        ? node.metadata.url
        : node.subtitle ?? "";
  }
  if (node.kind === "site_domain" || node.kind === "site_subdomain") {
    return typeof node.metadata?.finalUrl === "string" ? node.metadata.finalUrl : node.subtitle ?? "";
  }
  if (node.kind === "local_result") {
    return typeof node.metadata?.path === "string" ? node.metadata.path : node.subtitle ?? "";
  }
  return typeof node.metadata?.query === "string" ? node.metadata.query : node.title;
};

const resolveEdgeKindLabel = (
  edge: SearchDeepEdge,
  labels: DeepSearchOverviewLabels
): string => {
  if (edge.kind === "discovered_from") {
    return labels.discoveredLabel;
  }
  if (edge.kind === "expanded_to") {
    return labels.expandedLabel;
  }
  if (edge.kind === "hosts_subdomain") {
    return labels.hostsSubdomainLabel;
  }
  if (edge.kind === "contains_page") {
    return labels.containsPageLabel;
  }
  return labels.relatedLabel;
};

export const formatDeepSearchEdgeReason = (
  edge: SearchDeepEdge,
  labels: DeepSearchOverviewLabels
): string => {
  if (edge.reasonCode === "web_match") {
    const engineIds = edge.metadata?.sourceEngineIds?.join(", ") ?? labels.webStatusLabel;
    return `${labels.discoveredLabel} · ${engineIds}`;
  }
  if (edge.reasonCode === "local_match") {
    const base = edge.metadata?.matchKind === undefined
      ? labels.localStatusLabel
      : `${labels.matchKindLabel}: ${edge.metadata.matchKind}`;
    return edge.metadata?.line === undefined ? base : `${base} · ${labels.lineLabel} ${edge.metadata.line}`;
  }
  if (edge.reasonCode === "query_expansion") {
    if (typeof edge.metadata?.seedQuery === "string" && typeof edge.metadata?.derivedToken === "string") {
      return `${labels.expandedLabel} · ${edge.metadata.seedQuery} · ${edge.metadata.derivedToken}`;
    }
    if (typeof edge.metadata?.seedQuery === "string") {
      return `${labels.expandedLabel} · ${edge.metadata.seedQuery}`;
    }
    return labels.expandedLabel;
  }
  if (edge.reasonCode === "semantic_overlap") {
    const tokens = edge.metadata?.sharedTokens?.slice(0, 3).join(", ") ?? labels.relatedLabel;
    return `${labels.sharedTermsLabel}: ${tokens}`;
  }
  if (edge.reasonCode === "domain_guess") {
    return `${labels.domainLabel} · ${labels.guessedLabel}`;
  }
  if (edge.reasonCode === "domain_verify") {
    return `${labels.domainLabel} · ${labels.verifiedLabel}`;
  }
  if (edge.reasonCode === "subdomain_guess") {
    return `${labels.subdomainLabel} · ${labels.guessedLabel}`;
  }
  if (edge.reasonCode === "sitemap_discovery") {
    return `${labels.pageLabel} · sitemap`;
  }
  if (edge.reasonCode === "html_link_discovery") {
    return `${labels.pageLabel} · html`;
  }
  if (edge.reasonCode === "redirect_canonical") {
    return `${labels.pageLabel} · canonical`;
  }
  return resolveEdgeKindLabel(edge, labels);
};

const renderSnippet = (labels: DeepSearchOverviewLabels, node: SearchDeepNode): string => {
  if (node.kind === "web_page" && typeof node.metadata?.snippet === "string") {
    return node.metadata.snippet;
  }
  if (node.kind === "web_page" && typeof node.metadata?.contentPreview === "string") {
    return node.metadata.contentPreview;
  }
  if (node.kind === "site_domain") {
    return typeof node.metadata?.finalUrl === "string" ? node.metadata.finalUrl : node.title;
  }
  if (node.kind === "site_subdomain") {
    return typeof node.metadata?.finalUrl === "string" ? node.metadata.finalUrl : node.title;
  }
  if (node.kind === "local_result") {
    if (typeof node.metadata?.snippet === "string" && node.metadata.snippet.length > 0) {
      return node.metadata.snippet;
    }
    return renderNodeMeta(node);
  }
  if (typeof node.metadata?.query === "string") {
    return node.metadata.query;
  }
  return labels.emptySelectionLabel;
};

const renderSecondaryActionLabel = (
  labels: DeepSearchOverviewLabels,
  selectedNode: SearchDeepNode,
  localPrimaryAction: "open_file" | "reveal_in_manager"
): string => {
  if (selectedNode.kind !== "local_result") {
    return labels.openLabel;
  }
  return localPrimaryAction === "open_file" ? labels.revealInManagerLabel : labels.openLabel;
};

export const DeepSearchOverview = ({
  labels,
  snapshot,
  selectedNode,
  connectedEdges,
  lineage,
  sourceFilter,
  edgeKindFilter,
  edgeDirectionFilter,
  localPrimaryAction,
  onOpenSelected,
  onRevealSelected,
  onExpandSelected,
  onCenterSelected,
  onSourceFilterChange,
  onEdgeKindFilterChange,
  onEdgeDirectionFilterChange,
  onHighlightEdge
}: DeepSearchOverviewProps) => {
  const incomingEdges = connectedEdges.filter((entry) => entry.direction === "incoming");
  const outgoingEdges = connectedEdges.filter((entry) => entry.direction === "outgoing");
  const primaryActionLabel =
    selectedNode?.kind === "local_result" && localPrimaryAction === "reveal_in_manager"
      ? labels.revealInManagerLabel
      : labels.openLabel;
  const canOpenSelected =
    selectedNode?.kind === "web_page"
    || selectedNode?.kind === "site_domain"
    || selectedNode?.kind === "site_subdomain"
    || selectedNode?.kind === "local_result";

  return (
    <aside className="lyra-deep-search-side">
      <section className="lyra-deep-search-panel">
        <header>
          <h3>{labels.sourceFilterLabel}</h3>
        </header>
        <div className="lyra-deep-search-filter-group">
          <div className="lyra-deep-search-filter-row">
            {([
              ["all", labels.allLabel],
              ["web", labels.webLabel],
              ["local", labels.localLabel]
            ] as const).map(([value, label]) => (
              <button
                key={value}
                type="button"
                className={sourceFilter === value
                  ? "lyra-deep-search-filter-chip lyra-deep-search-filter-chip-active"
                  : "lyra-deep-search-filter-chip"}
                onClick={() => {
                  onSourceFilterChange(value);
                }}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      </section>

      <section className="lyra-deep-search-panel">
        <header>
          <h3>{labels.overviewLabel}</h3>
        </header>
        <dl className="lyra-deep-search-metric-list">
          <div>
            <dt>{labels.phaseLabel}</dt>
            <dd>{snapshot.phase}</dd>
          </div>
          <div>
            <dt>{labels.budgetLabel}</dt>
            <dd>{snapshot.budgetPreset}</dd>
          </div>
          <div>
            <dt>{labels.webStatusLabel}</dt>
            <dd>{snapshot.web.status} · {snapshot.web.blendedCount}</dd>
          </div>
          <div>
            <dt>{labels.localStatusLabel}</dt>
            <dd>{snapshot.local.status} · {snapshot.local.stats.matchedFiles}</dd>
          </div>
          <div>
            <dt>{labels.dedupedLabel}</dt>
            <dd>{snapshot.stats.dedupedResults}</dd>
          </div>
          <div>
            <dt>{labels.derivedLabel}</dt>
            <dd>{snapshot.stats.derivedQueries}</dd>
          </div>
          <div>
            <dt>{labels.roundsLabel}</dt>
            <dd>{snapshot.stats.expansionRounds}</dd>
          </div>
          <div>
            <dt>{labels.siteExpansionStatusLabel}</dt>
            <dd>{snapshot.web.siteExpansion?.status ?? "idle"}</dd>
          </div>
          <div>
            <dt>{labels.guessedDomainsLabel}</dt>
            <dd>{snapshot.web.siteExpansion?.guessAttempts ?? 0}</dd>
          </div>
          <div>
            <dt>{labels.verifiedDomainsLabel}</dt>
            <dd>{snapshot.web.siteExpansion?.verifiedDomains ?? 0}</dd>
          </div>
          <div>
            <dt>{labels.subdomainsLabel}</dt>
            <dd>{snapshot.web.siteExpansion?.discoveredSubdomains ?? 0}</dd>
          </div>
          <div>
            <dt>{labels.visitedPagesLabel}</dt>
            <dd>{snapshot.web.siteExpansion?.visitedPages ?? 0}</dd>
          </div>
          <div>
            <dt>{labels.queuedPagesLabel}</dt>
            <dd>{snapshot.web.siteExpansion?.queuedPages ?? 0}</dd>
          </div>
          <div>
            <dt>{labels.droppedPagesLabel}</dt>
            <dd>{snapshot.web.siteExpansion?.droppedPages ?? 0}</dd>
          </div>
        </dl>

        <div className="lyra-deep-search-engine-stack">
          {snapshot.web.engineBuckets.map((bucket) => (
            <section key={bucket.engine.id} className="lyra-deep-search-engine-card">
              <header>
                <span
                  className="lyra-deep-search-engine-dot"
                  style={{ backgroundColor: bucket.engine.accentColor }}
                />
                <strong>{bucket.engine.label}</strong>
                <small>{bucket.latencyMs ?? 0}ms</small>
              </header>
              <ul>
                {bucket.results.slice(0, 2).map((result) => (
                  <li key={`${bucket.engine.id}-${result.id}`}>{result.title}</li>
                ))}
                {bucket.error === undefined ? null : (
                  <li className="lyra-deep-search-error-text">{bucket.error}</li>
                )}
              </ul>
            </section>
          ))}
          <section className="lyra-deep-search-engine-card">
            <header>
              <span className="lyra-deep-search-engine-dot" />
              <strong>{labels.localStatusLabel}</strong>
              <small>{snapshot.local.elapsedMs}ms</small>
            </header>
            <ul>
              <li>scope: {snapshot.local.scopePreset}</li>
              <li>files: {snapshot.local.stats.scannedFiles}</li>
              <li>dirs: {snapshot.local.stats.scannedDirs}</li>
              <li>content: {snapshot.local.stats.contentScannedFiles}</li>
              {snapshot.local.indexStatus === undefined ? null : (
                <li>index: {snapshot.local.indexStatus.state}</li>
              )}
              {snapshot.local.error === undefined ? null : (
                <li className="lyra-deep-search-error-text">{snapshot.local.error}</li>
              )}
            </ul>
          </section>
        </div>
      </section>

      <section className="lyra-deep-search-panel">
        <header>
          <h3>{labels.selectedNodeLabel}</h3>
        </header>
        {selectedNode === null ? (
          <div className="lyra-deep-search-empty-selection">{labels.emptySelectionLabel}</div>
        ) : (
          <>
            <div className="lyra-deep-search-selected">
              <strong>{selectedNode.title}</strong>
              {selectedNode.subtitle === undefined ? null : <small>{selectedNode.subtitle}</small>}
              <p>{renderNodeMeta(selectedNode)}</p>
              <div className="lyra-deep-search-selected-meta">
                <span>
                  {selectedNode.kind === "site_domain"
                    ? labels.domainLabel
                    : selectedNode.kind === "site_subdomain"
                      ? labels.subdomainLabel
                      : selectedNode.kind === "web_page"
                        ? labels.pageLabel
                        : selectedNode.kind}
                </span>
                {typeof selectedNode.score === "number" ? <span>{selectedNode.score.toFixed(1)}</span> : null}
                <span>{selectedNode.status}</span>
              </div>
              {selectedNode.kind === "site_domain" ? (
                <div className="lyra-deep-search-badge-row">
                  <span className="lyra-deep-search-inline-badge">
                    {labels.verificationScoreLabel}: {selectedNode.metadata?.verificationScore?.toFixed(1) ?? "0.0"}
                  </span>
                  <span className="lyra-deep-search-inline-badge">
                    {selectedNode.metadata?.verifiedFrom === "guessed" ? labels.guessedLabel : labels.verifiedLabel}
                  </span>
                </div>
              ) : null}
              {selectedNode.kind === "site_subdomain" ? (
                <div className="lyra-deep-search-badge-row">
                  <span className="lyra-deep-search-inline-badge">
                    {labels.discoveredByLabel}: {selectedNode.metadata?.discoveredBy ?? "unknown"}
                  </span>
                  <span className="lyra-deep-search-inline-badge">
                    {labels.verificationScoreLabel}: {selectedNode.metadata?.verificationScore?.toFixed(1) ?? "0.0"}
                  </span>
                </div>
              ) : null}
              {selectedNode.kind === "web_page" ? (
                <div className="lyra-deep-search-badge-row">
                  <span className="lyra-deep-search-inline-badge">
                    {labels.discoveredByLabel}: {selectedNode.metadata?.discoveredBy ?? "search"}
                  </span>
                  <span className="lyra-deep-search-inline-badge">
                    depth: {selectedNode.metadata?.fetchDepth ?? 0}
                  </span>
                </div>
              ) : null}
            </div>

            <section className="lyra-deep-search-inspector-block">
              <header>
                <h4>{labels.snippetLabel}</h4>
              </header>
              <div className="lyra-deep-search-snippet">
                <p>{renderSnippet(labels, selectedNode)}</p>
                {selectedNode.kind === "local_result" && typeof selectedNode.metadata?.matchKind === "string" ? (
                  <div className="lyra-deep-search-badge-row">
                    <span className="lyra-deep-search-inline-badge">{labels.matchKindLabel}: {selectedNode.metadata.matchKind}</span>
                    {typeof selectedNode.metadata?.line === "number" ? (
                      <span className="lyra-deep-search-inline-badge">{labels.lineLabel}: {selectedNode.metadata.line}</span>
                    ) : null}
                  </div>
                ) : null}
              </div>
            </section>

            <section className="lyra-deep-search-inspector-block">
              <header>
                <h4>{labels.sourceLabel}</h4>
              </header>
              <div className="lyra-deep-search-actions">
                <button
                  type="button"
                  onClick={selectedNode.kind === "local_result" && localPrimaryAction === "reveal_in_manager" ? onRevealSelected : onOpenSelected}
                  disabled={canOpenSelected === false}
                >
                  {primaryActionLabel}
                </button>
                {selectedNode.kind === "local_result" ? (
                  <button type="button" onClick={localPrimaryAction === "open_file" ? onRevealSelected : onOpenSelected}>
                    {renderSecondaryActionLabel(labels, selectedNode, localPrimaryAction)}
                  </button>
                ) : null}
                <button
                  type="button"
                  onClick={onExpandSelected}
                  disabled={selectedNode.kind !== "root_query" && selectedNode.kind !== "derived_query"}
                >
                  {labels.expandLabel}
                </button>
                <button type="button" onClick={onCenterSelected}>{labels.centerLabel}</button>
              </div>
            </section>

            <section className="lyra-deep-search-inspector-block">
              <header>
                <h4>{labels.edgeFiltersLabel}</h4>
              </header>
              <div className="lyra-deep-search-filter-group">
                <div className="lyra-deep-search-filter-row">
                  {([
                    ["all", labels.allLabel],
                    ["discovered_from", labels.discoveredLabel],
                    ["expanded_to", labels.expandedLabel],
                    ["hosts_subdomain", labels.hostsSubdomainLabel],
                    ["contains_page", labels.containsPageLabel],
                    ["related_to", labels.relatedLabel]
                  ] as const).map(([value, label]) => (
                    <button
                      key={value}
                      type="button"
                      className={edgeKindFilter === value
                        ? "lyra-deep-search-filter-chip lyra-deep-search-filter-chip-active"
                        : "lyra-deep-search-filter-chip"}
                      onClick={() => {
                        onEdgeKindFilterChange(value);
                      }}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                <div className="lyra-deep-search-filter-row">
                  {([
                    ["both", labels.bothLabel],
                    ["incoming", labels.incomingLabel],
                    ["outgoing", labels.outgoingLabel]
                  ] as const).map(([value, label]) => (
                    <button
                      key={value}
                      type="button"
                      className={edgeDirectionFilter === value
                        ? "lyra-deep-search-filter-chip lyra-deep-search-filter-chip-active"
                        : "lyra-deep-search-filter-chip"}
                      onClick={() => {
                        onEdgeDirectionFilterChange(value);
                      }}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>
            </section>

            <section className="lyra-deep-search-inspector-block">
              <header>
                <h4>{labels.connectedLinksLabel}</h4>
              </header>
              <div className="lyra-deep-search-link-groups">
                {([
                  [labels.incomingLabel, incomingEdges],
                  [labels.outgoingLabel, outgoingEdges]
                ] as const).map(([groupLabel, edges]) => (
                  <div key={groupLabel} className="lyra-deep-search-link-group">
                    <strong>{groupLabel}</strong>
                    {edges.length === 0 ? (
                      <div className="lyra-deep-search-empty-selection">{labels.emptySelectionLabel}</div>
                    ) : (
                      <ul className="lyra-deep-search-link-list">
                        {edges.map((entry) => (
                          <li key={entry.edge.id}>
                            <button
                              type="button"
                              className="lyra-deep-search-link-item"
                              onMouseEnter={() => {
                                onHighlightEdge(entry.edge.id);
                              }}
                              onMouseLeave={() => {
                                onHighlightEdge(null);
                              }}
                              onClick={() => {
                                onHighlightEdge(entry.edge.id);
                              }}
                            >
                              <span>{entry.adjacentNode.title}</span>
                              <small>{resolveEdgeKindLabel(entry.edge, labels)}</small>
                              <p>{formatDeepSearchEdgeReason(entry.edge, labels)}</p>
                            </button>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                ))}
              </div>
            </section>

            <section className="lyra-deep-search-inspector-block">
              <header>
                <h4>{labels.lineageLabel}</h4>
              </header>
              {lineage.nodes.length === 0 ? (
                <div className="lyra-deep-search-empty-selection">{labels.emptySelectionLabel}</div>
              ) : (
                <>
                  <div className="lyra-deep-search-lineage-breadcrumb">
                    {lineage.nodes.map((node) => node.title).join(" / ")}
                  </div>
                  <ol className="lyra-deep-search-lineage-list">
                    {lineage.nodes.map((node) => (
                      <li key={node.id}>{node.title}</li>
                    ))}
                  </ol>
                  {lineage.alternateCount > 0 ? (
                    <div className="lyra-deep-search-empty-selection">
                      {labels.alternateLinksLabel}: {lineage.alternateCount}
                    </div>
                  ) : null}
                </>
              )}
            </section>
          </>
        )}
      </section>
    </aside>
  );
};
