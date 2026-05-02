import {
  BaseEdge,
  EdgeLabelRenderer,
  getSmoothStepPath,
  type Edge,
  type EdgeProps,
  type EdgeTypes
} from "@xyflow/react";

export type DeepSearchCanvasEdgeData = {
  readonly kind:
    | "discovered_from"
    | "expanded_to"
    | "hosts_subdomain"
    | "contains_page"
    | "related_to";
  readonly reasonLabel?: string;
  readonly muted?: boolean;
  readonly highlighted?: boolean;
  readonly showReasonBadge?: boolean;
};

export type DeepSearchCanvasEdge = Edge<DeepSearchCanvasEdgeData, "deepSearchEdge">;

const DEEP_SEARCH_EDGE_TOKENS = {
  radiusRelated: 24,
  radiusDefault: 18,
  strokeHighlighted: 2.3,
  strokeRelated: 1.05,
  strokeHostLike: 1.75,
  strokeDefault: 1.45,
  opacityMuted: 0.14,
  opacityHighlighted: 0.96,
  opacityRelated: 0.42,
  opacityDefault: 0.74
} as const;

const resolveStrokeColor = (kind: DeepSearchCanvasEdgeData["kind"]): string => {
  if (kind === "related_to") {
    return "rgba(191, 189, 182, 0.58)";
  }
  return "rgba(148, 148, 148, 0.78)";
};

const DeepSearchEdgeView = ({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  data,
  selected
}: EdgeProps<DeepSearchCanvasEdge>) => {
  const [path, labelX, labelY] = getSmoothStepPath({
    sourceX,
    sourceY,
    targetX,
    targetY,
    borderRadius:
      data?.kind === "related_to"
        ? DEEP_SEARCH_EDGE_TOKENS.radiusRelated
        : DEEP_SEARCH_EDGE_TOKENS.radiusDefault
  });
  const highlighted = data?.highlighted === true || selected;
  const muted = data?.muted === true && highlighted === false;

  return (
    <>
      <BaseEdge
        id={id}
        path={path}
        style={{
          stroke: resolveStrokeColor(data?.kind ?? "discovered_from"),
          strokeWidth:
            highlighted
              ? DEEP_SEARCH_EDGE_TOKENS.strokeHighlighted
              : data?.kind === "related_to"
                ? DEEP_SEARCH_EDGE_TOKENS.strokeRelated
                : data?.kind === "hosts_subdomain" || data?.kind === "contains_page"
                  ? DEEP_SEARCH_EDGE_TOKENS.strokeHostLike
                  : DEEP_SEARCH_EDGE_TOKENS.strokeDefault,
          strokeOpacity:
            muted
              ? DEEP_SEARCH_EDGE_TOKENS.opacityMuted
              : highlighted
                ? DEEP_SEARCH_EDGE_TOKENS.opacityHighlighted
                : data?.kind === "related_to"
                  ? DEEP_SEARCH_EDGE_TOKENS.opacityRelated
                  : DEEP_SEARCH_EDGE_TOKENS.opacityDefault,
          strokeDasharray:
            data?.kind === "expanded_to"
              ? "7 7"
              : data?.kind === "related_to"
                ? "3 8"
                : data?.kind === "hosts_subdomain"
                  ? "10 4"
                  : undefined,
          transition: "stroke-opacity 160ms ease, stroke-width 160ms ease"
        }}
      />
      {data?.showReasonBadge === true && typeof data.reasonLabel === "string" && data.reasonLabel.length > 0 ? (
        <EdgeLabelRenderer>
          <div
            className="lyra-deep-search-edge-reason"
            style={{
              transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`
            }}
          >
            {data.reasonLabel}
          </div>
        </EdgeLabelRenderer>
      ) : null}
    </>
  );
};

export const deepSearchEdgeTypes: EdgeTypes = {
  deepSearchEdge: DeepSearchEdgeView
};
