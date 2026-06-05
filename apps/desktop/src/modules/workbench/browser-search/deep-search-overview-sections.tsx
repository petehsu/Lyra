import type { SearchDeepNode, SearchDeepSnapshot } from "../../../shared/desktop-bridge";
import type { DeepSearchConnectedEdge, DeepSearchLineage } from "./deep-search-lineage";
import {
  canOpenDeepSearchNode,
  formatDeepSearchEdgeReason,
  renderNodeMeta,
  renderSnippet,
  resolveDeepSearchPrimaryActionLabel,
  resolveDeepSearchSecondaryActionLabel,
  resolveEdgeKindLabel,
  type DeepSearchOverviewLabels
} from "./deep-search-overview-model";
import type {
  DeepSearchEdgeDirectionFilter,
  DeepSearchEdgeKindFilter
} from "./types";

type DeepSearchSourceFilterSectionProps = {
  readonly labels: DeepSearchOverviewLabels;
  readonly sourceFilter: "all" | "web" | "local";
  readonly onSourceFilterChange: (value: "all" | "web" | "local") => void;
};

export const DeepSearchSourceFilterSection = ({
  labels,
  sourceFilter,
  onSourceFilterChange
}: DeepSearchSourceFilterSectionProps) => (
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
);

type DeepSearchMetricsSectionProps = {
  readonly labels: DeepSearchOverviewLabels;
  readonly snapshot: SearchDeepSnapshot;
};

export const DeepSearchMetricsSection = ({
  labels,
  snapshot
}: DeepSearchMetricsSectionProps) => (
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
            <span className="lyra-deep-search-engine-marker" />
            <strong>{bucket.engine.label}</strong>
            <small>{bucket.latencyMs ?? 0}ms</small>
          </header>
          <ul className="lyra-deep-search-engine-list">
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
          <span className="lyra-deep-search-engine-marker" />
          <strong>{labels.localStatusLabel}</strong>
          <small>{snapshot.local.elapsedMs}ms</small>
        </header>
        <ul className="lyra-deep-search-engine-list">
          <li>scope: {snapshot.local.scopePreset}</li>
          <li>files: {snapshot.local.stats.scannedFiles}</li>
          <li>dirs: {snapshot.local.stats.scannedDirs}</li>
          <li>content: {snapshot.local.stats.contentScannedFiles}</li>
          {snapshot.local.error === undefined ? null : (
            <li className="lyra-deep-search-error-text">{snapshot.local.error}</li>
          )}
        </ul>
      </section>
    </div>
  </section>
);

type DeepSearchSelectedNodeSectionProps = {
  readonly labels: DeepSearchOverviewLabels;
  readonly selectedNode: SearchDeepNode | null;
  readonly connectedEdges: readonly DeepSearchConnectedEdge[];
  readonly lineage: DeepSearchLineage;
  readonly edgeKindFilter: DeepSearchEdgeKindFilter;
  readonly edgeDirectionFilter: DeepSearchEdgeDirectionFilter;
  readonly localPrimaryAction: "open_file" | "reveal_in_manager";
  readonly onOpenSelected: (() => void) | undefined;
  readonly onRevealSelected: (() => void) | undefined;
  readonly onExpandSelected: (() => void) | undefined;
  readonly onCenterSelected: (() => void) | undefined;
  readonly onEdgeKindFilterChange: (value: DeepSearchEdgeKindFilter) => void;
  readonly onEdgeDirectionFilterChange: (value: DeepSearchEdgeDirectionFilter) => void;
  readonly onHighlightEdge: (edgeId: string | null) => void;
};

export const DeepSearchSelectedNodeSection = ({
  labels,
  selectedNode,
  connectedEdges,
  lineage,
  edgeKindFilter,
  edgeDirectionFilter,
  localPrimaryAction,
  onOpenSelected,
  onRevealSelected,
  onExpandSelected,
  onCenterSelected,
  onEdgeKindFilterChange,
  onEdgeDirectionFilterChange,
  onHighlightEdge
}: DeepSearchSelectedNodeSectionProps) => {
  const incomingEdges = connectedEdges.filter((entry) => entry.direction === "incoming");
  const outgoingEdges = connectedEdges.filter((entry) => entry.direction === "outgoing");
  const primaryActionLabel = resolveDeepSearchPrimaryActionLabel(
    labels,
    selectedNode,
    localPrimaryAction
  );
  const canOpenSelected = canOpenDeepSearchNode(selectedNode);

  return (
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
                  {resolveDeepSearchSecondaryActionLabel(labels, selectedNode, localPrimaryAction)}
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
  );
};
