import "@xyflow/react/dist/style.css";

import type { Viewport } from "@xyflow/react";
import { Search } from "lucide-react";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

import type { SearchDeepNode, SearchDeepSnapshot } from "../../../shared/desktop-bridge";
import { LyraBrandLogo } from "../brand";
import { DeepSearchCanvas } from "./deep-search-canvas";
import { buildDeepSearchLineage, getDeepSearchConnectedEdges } from "./deep-search-lineage";
import {
  DeepSearchOverview,
  formatDeepSearchEdgeReason,
  type DeepSearchOverviewLabels
} from "./deep-search-overview";
import type {
  DeepSearchEdgeDirectionFilter,
  DeepSearchEdgeKindFilter
} from "./types";

const DEEP_SEARCH_VIEWPORT_MEMORY = new Map<string, Viewport>();

export type DeepSearchResultSurfaceLabels = DeepSearchOverviewLabels & {
  readonly headingLabel: string;
  readonly deepSearchToggleLabel: string;
  readonly deepSearchChipLabel: string;
  readonly stopLabel: string;
  readonly fitViewLabel: string;
  readonly resetLayoutLabel: string;
  readonly loadingLabel: string;
  readonly emptyLabel: string;
  readonly officialResultLabel: string;
  readonly officialHomepageLabel: string;
  readonly officialSubsiteLabel: string;
  readonly officialDocsLabel: string;
  readonly officialLoginLabel: string;
  readonly officialDownloadLabel: string;
  readonly officialSupportLabel: string;
  readonly allLabel: string;
};

export type DeepSearchResultSurfaceProps = {
  readonly logoUrl: string;
  readonly inputValue: string;
  readonly placeholder: string;
  readonly searchActionLabel: string;
  readonly deepSearchEnabled: boolean;
  readonly labels: DeepSearchResultSurfaceLabels;
  readonly snapshot: SearchDeepSnapshot;
  readonly searching: boolean;
  readonly viewportMemoryKey: string;
  readonly restoreViewportEnabled: boolean;
  readonly localOpenBehavior: "open_file" | "reveal_in_manager";
  readonly sourceFilter: "all" | "web" | "local";
  readonly sharedStartRect?: DOMRect | null;
  readonly onInputChange: (value: string) => void;
  readonly onSubmit: () => void;
  readonly onToggleDeepSearch: () => void;
  readonly onCancel: () => void;
  readonly onExpandNode: (nodeId: string) => void;
  readonly onSourceFilterChange: (value: "all" | "web" | "local") => void;
  readonly onOpenUrl?: (url: string, title: string) => void;
  readonly onOpenLocalPath?: (path: string) => void;
  readonly onRevealLocalPath?: (path: string) => void;
  readonly onSharedAnimationDone?: () => void;
};

const filterDeepSearchSnapshotBySource = (
  snapshot: SearchDeepSnapshot,
  sourceFilter: "all" | "web" | "local"
): SearchDeepSnapshot => {
  if (sourceFilter === "all") {
    return snapshot;
  }
  const allowedKinds = new Set<SearchDeepNode["kind"]>(
    sourceFilter === "web"
      ? ["root_query", "derived_query", "site_domain", "site_subdomain", "web_page"]
      : ["root_query", "derived_query", "local_result"]
  );
  const nodes = snapshot.nodes.filter((node) => allowedKinds.has(node.kind));
  const allowedIds = new Set(nodes.map((node) => node.id));
  return {
    ...snapshot,
    nodes,
    edges: snapshot.edges.filter(
      (edge) => allowedIds.has(edge.sourceId) && allowedIds.has(edge.targetId)
    )
  };
};

export const DeepSearchResultSurface = ({
  logoUrl,
  inputValue,
  placeholder,
  searchActionLabel,
  deepSearchEnabled,
  labels,
  snapshot,
  searching,
  viewportMemoryKey,
  restoreViewportEnabled,
  localOpenBehavior,
  sourceFilter,
  sharedStartRect,
  onInputChange,
  onSubmit,
  onToggleDeepSearch,
  onCancel,
  onExpandNode,
  onSourceFilterChange,
  onOpenUrl,
  onOpenLocalPath,
  onRevealLocalPath,
  onSharedAnimationDone
}: DeepSearchResultSurfaceProps) => {
  const pillRef = useRef<HTMLDivElement | null>(null);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [highlightedEdgeId, setHighlightedEdgeId] = useState<string | null>(null);
  const [fitViewNonce, setFitViewNonce] = useState(0);
  const [focusSelectionNonce, setFocusSelectionNonce] = useState(0);
  const [resetLayoutNonce, setResetLayoutNonce] = useState(0);
  const [edgeKindFilter, setEdgeKindFilter] = useState<DeepSearchEdgeKindFilter>("all");
  const [edgeDirectionFilter, setEdgeDirectionFilter] = useState<DeepSearchEdgeDirectionFilter>("both");
  const filteredSnapshot = useMemo(
    () => filterDeepSearchSnapshotBySource(snapshot, sourceFilter),
    [snapshot, sourceFilter]
  );

  const selectedNode = useMemo<SearchDeepNode | null>(
    () => filteredSnapshot.nodes.find((node) => node.id === selectedNodeId) ?? null,
    [filteredSnapshot.nodes, selectedNodeId]
  );
  const lineage = useMemo(
    () => buildDeepSearchLineage(filteredSnapshot, selectedNodeId),
    [filteredSnapshot, selectedNodeId]
  );
  const connectedEdges = useMemo(
    () => getDeepSearchConnectedEdges(filteredSnapshot, selectedNodeId, edgeKindFilter, edgeDirectionFilter),
    [edgeDirectionFilter, edgeKindFilter, filteredSnapshot, selectedNodeId]
  );
  const edgeReasonLabels = useMemo(
    () => Object.fromEntries(filteredSnapshot.edges.map((edge) => [edge.id, formatDeepSearchEdgeReason(edge, labels)])),
    [filteredSnapshot.edges, labels]
  );
  const savedViewport = restoreViewportEnabled
    ? (DEEP_SEARCH_VIEWPORT_MEMORY.get(viewportMemoryKey) ?? null)
    : null;

  useEffect(() => {
    if (selectedNodeId === null) {
      return;
    }
    if (filteredSnapshot.nodes.some((node) => node.id === selectedNodeId)) {
      return;
    }
    setSelectedNodeId(null);
  }, [filteredSnapshot.nodes, selectedNodeId]);

  useEffect(() => {
    setHighlightedEdgeId(null);
  }, [selectedNodeId]);

  useLayoutEffect(() => {
    if (sharedStartRect === null || sharedStartRect === undefined) {
      return;
    }

    const pill = pillRef.current;
    if (pill === null) {
      return;
    }

    const targetRect = pill.getBoundingClientRect();
    const deltaX = sharedStartRect.left - targetRect.left;
    const deltaY = sharedStartRect.top - targetRect.top;
    const scaleX = sharedStartRect.width / targetRect.width;
    const scaleY = sharedStartRect.height / targetRect.height;

    const animation = pill.animate(
      [
        {
          transformOrigin: "left top",
          transform: `translate(${deltaX}px, ${deltaY}px) scale(${scaleX}, ${scaleY})`
        },
        {
          transformOrigin: "left top",
          transform: "translate(0, 0) scale(1, 1)"
        }
      ],
      {
        duration: 320,
        easing: "cubic-bezier(0.2, 0.78, 0.08, 0.98)",
        fill: "both"
      }
    );

    animation.onfinish = () => {
      pill.style.transform = "none";
      pill.style.transformOrigin = "";
      onSharedAnimationDone?.();
    };

    return () => {
      animation.cancel();
      pill.style.transform = "";
      pill.style.transformOrigin = "";
    };
  }, [onSharedAnimationDone, sharedStartRect]);

  const openLocalPrimary = (path: string): void => {
    if (localOpenBehavior === "reveal_in_manager") {
      if (onRevealLocalPath !== undefined) {
        onRevealLocalPath(path);
        return;
      }
    }
    onOpenLocalPath?.(path);
  };

  const openLocalSecondary = (path: string): void => {
    if (localOpenBehavior === "reveal_in_manager") {
      onOpenLocalPath?.(path);
      return;
    }
    onRevealLocalPath?.(path);
  };

  const onOpenSelected = (): void => {
    if (selectedNode === null) {
      return;
    }
    if (
      (selectedNode.kind === "site_domain" || selectedNode.kind === "site_subdomain")
      && typeof selectedNode.metadata?.finalUrl === "string"
    ) {
      onOpenUrl?.(selectedNode.metadata.finalUrl, selectedNode.title);
      return;
    }
    if (selectedNode.kind === "web_page" && typeof selectedNode.metadata?.url === "string") {
      onOpenUrl?.(selectedNode.metadata.url, selectedNode.title);
      return;
    }
    if (selectedNode.kind === "local_result" && typeof selectedNode.metadata?.path === "string") {
      openLocalPrimary(selectedNode.metadata.path);
    }
  };

  const onRevealSelected = (): void => {
    if (selectedNode?.kind !== "local_result" || typeof selectedNode.metadata?.path !== "string") {
      return;
    }
    openLocalSecondary(selectedNode.metadata.path);
  };

  const onExpandSelected = (): void => {
    if (selectedNode === null) {
      return;
    }
    if (selectedNode.kind === "root_query" || selectedNode.kind === "derived_query") {
      onExpandNode(selectedNode.id);
    }
  };

  return (
    <section className="lyra-results-shell lyra-deep-search-shell" aria-label="deep-search-results-surface">
      <header className="lyra-results-topbar lyra-deep-search-topbar">
        <div className="lyra-browser-pill lyra-browser-pill-compact" ref={pillRef}>
          <button
            type="button"
            role="switch"
            aria-checked={deepSearchEnabled}
            aria-label={labels.deepSearchToggleLabel}
            title={labels.deepSearchToggleLabel}
            className={
              deepSearchEnabled
                ? "lyra-logo-circle lyra-logo-toggle lyra-logo-toggle-active"
                : "lyra-logo-circle lyra-logo-toggle"
            }
            onClick={onToggleDeepSearch}
          >
            <LyraBrandLogo logoUrl={logoUrl} />
          </button>
          <input
            aria-label="browser-address-input"
            value={inputValue}
            placeholder={placeholder}
            onChange={(event) => {
              onInputChange(event.target.value);
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                onSubmit();
              }
            }}
          />
          {deepSearchEnabled ? (
            <span className="lyra-browser-mode-chip">{labels.deepSearchChipLabel}</span>
          ) : null}
          <button className="lyra-search-circle" aria-label={searchActionLabel} onClick={onSubmit}>
            <Search size={14} />
          </button>
        </div>

        <div className="lyra-deep-search-summary">
          <strong>{labels.headingLabel}</strong>
          <span>{snapshot.query}</span>
        </div>

        <div className="lyra-deep-search-toolbar">
          <span className="lyra-browser-mode-chip">{labels.budgetLabel} {snapshot.budgetPreset}</span>
          <button type="button" onClick={onCancel} disabled={!searching}>{labels.stopLabel}</button>
          <button
            type="button"
            onClick={() => {
              setFitViewNonce((current) => current + 1);
            }}
          >
            {labels.fitViewLabel}
          </button>
          <button
            type="button"
            onClick={() => {
              setResetLayoutNonce((current) => current + 1);
            }}
          >
            {labels.resetLayoutLabel}
          </button>
        </div>
      </header>

      <div className="lyra-deep-search-grid">
        <DeepSearchCanvas
          snapshot={filteredSnapshot}
          selectedNodeId={selectedNodeId}
          loadingLabel={labels.loadingLabel}
          emptyLabel={labels.emptyLabel}
          officialResultLabel={labels.officialResultLabel}
          officialCategoryLabels={{
            official_homepage: labels.officialHomepageLabel,
            official_subsite: labels.officialSubsiteLabel,
            official_docs: labels.officialDocsLabel,
            official_login: labels.officialLoginLabel,
            official_download: labels.officialDownloadLabel,
            official_support: labels.officialSupportLabel
          }}
          fitViewNonce={fitViewNonce}
          focusSelectionNonce={focusSelectionNonce}
          resetLayoutNonce={resetLayoutNonce}
          connectedEdgeIds={connectedEdges.map((entry) => entry.edge.id)}
          highlightedEdgeId={highlightedEdgeId}
          edgeReasonLabels={edgeReasonLabels}
          savedViewport={savedViewport}
          restoreViewportEnabled={restoreViewportEnabled}
          onSelectNode={setSelectedNodeId}
          onHighlightEdge={setHighlightedEdgeId}
          onViewportChange={(viewport) => {
            if (restoreViewportEnabled) {
              DEEP_SEARCH_VIEWPORT_MEMORY.set(viewportMemoryKey, viewport);
            }
          }}
          onOpenWebResult={onOpenUrl}
          onOpenLocalResult={openLocalPrimary}
          onExpandNode={onExpandNode}
        />

        <DeepSearchOverview
          labels={labels}
          snapshot={snapshot}
          selectedNode={selectedNode}
          connectedEdges={connectedEdges}
          lineage={lineage}
          sourceFilter={sourceFilter}
          edgeKindFilter={edgeKindFilter}
          edgeDirectionFilter={edgeDirectionFilter}
          localPrimaryAction={localOpenBehavior}
          onOpenSelected={onOpenSelected}
          onRevealSelected={onRevealSelected}
          onExpandSelected={onExpandSelected}
          onCenterSelected={() => {
            setFocusSelectionNonce((current) => current + 1);
          }}
          onSourceFilterChange={onSourceFilterChange}
          onEdgeKindFilterChange={setEdgeKindFilter}
          onEdgeDirectionFilterChange={setEdgeDirectionFilter}
          onHighlightEdge={setHighlightedEdgeId}
        />
      </div>
    </section>
  );
};
