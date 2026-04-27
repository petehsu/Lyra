import type { SearchDeepNode, SearchDeepSnapshot } from "../../../shared/desktop-bridge";
import type { DeepSearchOverviewLabels } from "./deep-search-overview-model";
import { formatDeepSearchEdgeReason } from "./deep-search-overview-model";

export type DeepSearchSourceFilter = "all" | "web" | "local";
export type DeepSearchLocalOpenBehavior = "open_file" | "reveal_in_manager";

type DeepSearchOpenActions = {
  readonly onOpenUrl: ((url: string, title: string) => void) | undefined;
  readonly onOpenLocalPath: ((path: string) => void) | undefined;
  readonly onRevealLocalPath: ((path: string) => void) | undefined;
};

export const filterDeepSearchSnapshotBySource = (
  snapshot: SearchDeepSnapshot,
  sourceFilter: DeepSearchSourceFilter
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

export const findDeepSearchSelectedNode = (
  snapshot: SearchDeepSnapshot,
  selectedNodeId: string | null
): SearchDeepNode | null =>
  selectedNodeId === null
    ? null
    : snapshot.nodes.find((node) => node.id === selectedNodeId) ?? null;

export const createDeepSearchEdgeReasonLabels = (
  snapshot: SearchDeepSnapshot,
  labels: DeepSearchOverviewLabels
): Readonly<Record<string, string>> =>
  Object.fromEntries(
    snapshot.edges.map((edge) => [edge.id, formatDeepSearchEdgeReason(edge, labels)])
  );

export const getDeepSearchConnectedEdgeIds = (
  connectedEdges: readonly { readonly edge: { readonly id: string } }[]
): readonly string[] => connectedEdges.map((entry) => entry.edge.id);

export const openDeepSearchLocalPrimary = (
  path: string,
  localOpenBehavior: DeepSearchLocalOpenBehavior,
  actions: DeepSearchOpenActions
): void => {
  if (localOpenBehavior === "reveal_in_manager" && actions.onRevealLocalPath !== undefined) {
    actions.onRevealLocalPath(path);
    return;
  }
  actions.onOpenLocalPath?.(path);
};

export const openDeepSearchLocalSecondary = (
  path: string,
  localOpenBehavior: DeepSearchLocalOpenBehavior,
  actions: DeepSearchOpenActions
): void => {
  if (localOpenBehavior === "reveal_in_manager") {
    actions.onOpenLocalPath?.(path);
    return;
  }
  actions.onRevealLocalPath?.(path);
};

export const openDeepSearchNode = (
  node: SearchDeepNode | null,
  localOpenBehavior: DeepSearchLocalOpenBehavior,
  actions: DeepSearchOpenActions
): void => {
  if (node === null) {
    return;
  }
  if (
    (node.kind === "site_domain" || node.kind === "site_subdomain")
    && typeof node.metadata?.finalUrl === "string"
  ) {
    actions.onOpenUrl?.(node.metadata.finalUrl, node.title);
    return;
  }
  if (node.kind === "web_page" && typeof node.metadata?.url === "string") {
    actions.onOpenUrl?.(node.metadata.url, node.title);
    return;
  }
  if (node.kind === "local_result" && typeof node.metadata?.path === "string") {
    openDeepSearchLocalPrimary(node.metadata.path, localOpenBehavior, actions);
  }
};

export const revealDeepSearchNode = (
  node: SearchDeepNode | null,
  localOpenBehavior: DeepSearchLocalOpenBehavior,
  actions: DeepSearchOpenActions
): void => {
  if (node?.kind !== "local_result" || typeof node.metadata?.path !== "string") {
    return;
  }
  openDeepSearchLocalSecondary(node.metadata.path, localOpenBehavior, actions);
};

export const expandDeepSearchNode = (
  node: SearchDeepNode | null,
  onExpandNode: (nodeId: string) => void
): void => {
  if (node === null) {
    return;
  }
  if (node.kind === "root_query" || node.kind === "derived_query") {
    onExpandNode(node.id);
  }
};
