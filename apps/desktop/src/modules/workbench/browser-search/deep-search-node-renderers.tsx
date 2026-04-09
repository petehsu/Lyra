import { Handle, Position, type Node, type NodeProps, type NodeTypes } from "@xyflow/react";
import { BadgeCheck } from "lucide-react";
import type { SearchOfficialCategory } from "../../../shared/desktop-bridge";

export type DeepSearchCanvasNodeData = {
  readonly kind:
    | "root_query"
    | "derived_query"
    | "site_domain"
    | "site_subdomain"
    | "web_page"
    | "local_result";
  readonly title: string;
  readonly subtitle?: string;
  readonly status: "loading" | "ready" | "error";
  readonly score?: number;
  readonly isOfficialResult?: boolean;
  readonly officialLabel?: string;
  readonly officialCategory?: SearchOfficialCategory;
  readonly officialCategoryLabel?: string;
};

export type DeepSearchCanvasNode = Node<DeepSearchCanvasNodeData, "deepSearchNode">;

const resolveKindLabel = (kind: DeepSearchCanvasNodeData["kind"]): string => {
  if (kind === "root_query") {
    return "Root";
  }
  if (kind === "derived_query") {
    return "Derived";
  }
  if (kind === "site_domain") {
    return "Domain";
  }
  if (kind === "site_subdomain") {
    return "Subdomain";
  }
  if (kind === "web_page") {
    return "Page";
  }
  return "Local";
};

export const DeepSearchNodeCard = ({ data, selected }: NodeProps<DeepSearchCanvasNode>) => (
  <div
    className={
      selected
        ? "lyra-deep-search-node lyra-deep-search-node-selected"
        : "lyra-deep-search-node"
    }
    data-kind={data.kind}
    data-status={data.status}
  >
    <Handle id="target-north" type="target" position={Position.Top} className="lyra-deep-search-handle" />
    <Handle id="source-north" type="source" position={Position.Top} className="lyra-deep-search-handle" />
    <Handle id="target-south" type="target" position={Position.Bottom} className="lyra-deep-search-handle" />
    <Handle id="source-south" type="source" position={Position.Bottom} className="lyra-deep-search-handle" />
    <Handle id="target-west" type="target" position={Position.Left} className="lyra-deep-search-handle" />
    <Handle id="source-west" type="source" position={Position.Left} className="lyra-deep-search-handle" />
    <Handle id="target-east" type="target" position={Position.Right} className="lyra-deep-search-handle" />
    <Handle id="source-east" type="source" position={Position.Right} className="lyra-deep-search-handle" />
    <div className="lyra-deep-search-node-meta">
      <span className="lyra-deep-search-node-kind">{resolveKindLabel(data.kind)}</span>
      {typeof data.score === "number" ? (
        <span className="lyra-deep-search-node-score">{data.score.toFixed(1)}</span>
      ) : null}
    </div>
    <div className="lyra-deep-search-node-copy">
      <div className="lyra-deep-search-node-title-row">
        <strong title={data.title}>{data.title}</strong>
        {data.isOfficialResult === true ? (
          <span
            className="lyra-deep-search-official-icon"
            title={data.officialLabel ?? "Official"}
            aria-label={data.officialLabel ?? "Official"}
          >
            <BadgeCheck size={14} />
          </span>
        ) : null}
      </div>
      {data.isOfficialResult === true && typeof data.officialCategoryLabel === "string" ? (
        <div className="lyra-deep-search-node-badge-row">
          <span className="lyra-deep-search-node-badge">{data.officialCategoryLabel}</span>
        </div>
      ) : null}
      {typeof data.subtitle === "string" && data.subtitle.length > 0 ? (
        <small title={data.subtitle}>{data.subtitle}</small>
      ) : null}
    </div>
  </div>
);

export const deepSearchNodeTypes: NodeTypes = {
  deepSearchNode: DeepSearchNodeCard
};
