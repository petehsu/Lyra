import type { SearchDeepNode, SearchDeepSnapshot } from "../../../shared/desktop-bridge";
import type {
  DeepSearchEdgeDirectionFilter,
  DeepSearchEdgeKindFilter
} from "./types";
import type { DeepSearchConnectedEdge, DeepSearchLineage } from "./deep-search-lineage";
import {
  DeepSearchMetricsSection,
  DeepSearchSelectedNodeSection,
  DeepSearchSourceFilterSection
} from "./deep-search-overview-sections";
import type { DeepSearchOverviewLabels } from "./deep-search-overview-model";

export type { DeepSearchOverviewLabels } from "./deep-search-overview-model";

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
}: DeepSearchOverviewProps) => (
  <aside className="lyra-deep-search-side">
    <DeepSearchSourceFilterSection
      labels={labels}
      sourceFilter={sourceFilter}
      onSourceFilterChange={onSourceFilterChange}
    />
    <DeepSearchMetricsSection
      labels={labels}
      snapshot={snapshot}
    />
    <DeepSearchSelectedNodeSection
      labels={labels}
      selectedNode={selectedNode}
      connectedEdges={connectedEdges}
      lineage={lineage}
      edgeKindFilter={edgeKindFilter}
      edgeDirectionFilter={edgeDirectionFilter}
      localPrimaryAction={localPrimaryAction}
      onOpenSelected={onOpenSelected}
      onRevealSelected={onRevealSelected}
      onExpandSelected={onExpandSelected}
      onCenterSelected={onCenterSelected}
      onEdgeKindFilterChange={onEdgeKindFilterChange}
      onEdgeDirectionFilterChange={onEdgeDirectionFilterChange}
      onHighlightEdge={onHighlightEdge}
    />
  </aside>
);
