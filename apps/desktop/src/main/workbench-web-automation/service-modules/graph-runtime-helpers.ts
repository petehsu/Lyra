import type {
  WorkbenchWebGraphBuildResult,
  WorkbenchWebGraphQueryRequest,
  WorkbenchWebGraphQueryResult,
} from "../../../shared/workbench-web-automation";
import type { WorkbenchWebAutomationCache } from "../cache";
import { buildWebGraphSnapshot } from "../graph-builder";
import { buildGraphHighlights, rankNodesForAction, toNodeHint } from "../result-highlights";
import type { WorkbenchWebAutomationServiceDeps, WorkbenchWebGraphSnapshot } from "../types";
import type { WorkbenchWebAutomationStore } from "../store";

export const buildResultFromSnapshot = (
  snapshot: WorkbenchWebGraphSnapshot & { readonly budget: WorkbenchWebGraphBuildResult["budget"] },
  detail: "summary" | "full"
): WorkbenchWebGraphBuildResult => ({
  tabId: snapshot.tabId,
  graphId: snapshot.graphId,
  ...(snapshot.address === undefined ? {} : { address: snapshot.address }),
  builtAt: snapshot.builtAt,
  budget: snapshot.budget,
  nodeCount: snapshot.nodeCount,
  edgeCount: snapshot.edgeCount,
  interactableCount: snapshot.interactableCount,
  truncated: snapshot.truncated,
  budgetExhausted: snapshot.budgetExhausted,
  detail,
  highlights: buildGraphHighlights(snapshot.nodes),
  ...(detail === "full"
    ? {
        nodes: snapshot.nodes,
        edges: snapshot.edges
      }
    : {})
});

const isFullGraphSnapshot = (snapshot: WorkbenchWebGraphSnapshot): boolean =>
  snapshot.nodeCount > 0 && snapshot.nodes.length === snapshot.nodeCount;

export const ensureGraphLoaded = async ({
  tabId,
  graphId,
  forceBuild,
  deps,
  cache,
  store
}: {
  readonly tabId: string;
  readonly graphId?: string | undefined;
  readonly forceBuild?: boolean | undefined;
  readonly deps: WorkbenchWebAutomationServiceDeps;
  readonly cache: WorkbenchWebAutomationCache;
  readonly store: WorkbenchWebAutomationStore;
}): Promise<WorkbenchWebGraphSnapshot> => {
  if (forceBuild !== true && typeof graphId === "string" && graphId.trim().length > 0) {
    const fromCache = cache.graphById.read(graphId.trim());
    if (fromCache !== null) {
      return fromCache;
    }
    const fromStore = await store.readByGraphId(graphId.trim());
    if (fromStore !== null) {
      cache.graphById.write(fromStore.graphId, fromStore);
      cache.graphByTab.write(fromStore.tabId, fromStore);
      return fromStore;
    }
  }

  if (forceBuild !== true) {
    const fromCache = cache.graphByTab.read(tabId);
    if (fromCache !== null && isFullGraphSnapshot(fromCache)) {
      return fromCache;
    }
    const fromStore = await store.readLatestByTab(tabId);
    if (fromStore !== null && isFullGraphSnapshot(fromStore)) {
      cache.graphById.write(fromStore.graphId, fromStore);
      cache.graphByTab.write(tabId, fromStore);
      return fromStore;
    }
  }

  const fresh = await buildWebGraphSnapshot({
    browserBridge: deps.browserBridge,
    request: {
      tabId,
      detail: "full"
    }
  });

  const snapshot: WorkbenchWebGraphSnapshot = {
    tabId: fresh.tabId,
    graphId: fresh.graphId,
    ...(fresh.address === undefined ? {} : { address: fresh.address }),
    builtAt: fresh.builtAt,
    nodeCount: fresh.nodeCount,
    edgeCount: fresh.edgeCount,
    interactableCount: fresh.interactableCount,
    truncated: fresh.truncated,
    budgetExhausted: fresh.budgetExhausted,
    nodes: fresh.nodes,
    edges: fresh.edges
  };

  cache.graphById.write(snapshot.graphId, snapshot);
  cache.graphByTab.write(snapshot.tabId, snapshot);
  await store.write(snapshot);

  return snapshot;
};

export const queryGraphSnapshot = ({
  snapshot,
  request
}: {
  readonly snapshot: WorkbenchWebGraphSnapshot;
  readonly request?: WorkbenchWebGraphQueryRequest | undefined;
}): WorkbenchWebGraphQueryResult => {
  const textNeedle = typeof request?.textContains === "string" ? request.textContains.trim().toLowerCase() : "";
  const tagNameNeedle = typeof request?.tagName === "string" ? request.tagName.trim().toLowerCase() : "";
  const roleNeedle = typeof request?.role === "string" ? request.role.trim().toLowerCase() : "";
  const onlyInteractable = request?.onlyInteractable === true;
  const actionNeedle = request?.action;
  const maxResults = Math.max(1, Math.min(1_000, Math.round(request?.maxResults ?? 200)));

  const matches = snapshot.nodes.filter((node) => {
    if (tagNameNeedle.length > 0 && node.tagName.toLowerCase() !== tagNameNeedle) {
      return false;
    }
    if (roleNeedle.length > 0 && (node.role ?? "").toLowerCase() !== roleNeedle) {
      return false;
    }
    if (textNeedle.length > 0) {
      const haystacks = [
        node.textSnippet ?? "",
        node.stableSignature.ariaLabel ?? "",
        node.stableSignature.name ?? "",
        node.stableSignature.id ?? ""
      ].map((value) => value.toLowerCase());
      if (haystacks.some((value) => value.includes(textNeedle)) === false) {
        return false;
      }
    }

    const interactable =
      node.interactable.clickable
      || node.interactable.typable
      || node.interactable.selectable
      || node.interactable.focusable
      || node.interactable.scrollable;

    if (onlyInteractable && !interactable) {
      return false;
    }

    if (actionNeedle === undefined) {
      return true;
    }

    if (actionNeedle === "click") {
      return node.interactable.clickable;
    }
    if (actionNeedle === "type") {
      return node.interactable.typable;
    }
    if (actionNeedle === "select") {
      return node.interactable.selectable;
    }
    if (actionNeedle === "focus") {
      return node.interactable.focusable;
    }
    if (actionNeedle === "scroll") {
      return node.interactable.scrollable;
    }
    if (actionNeedle === "submit") {
      return node.tagName === "form" || node.tagName === "button";
    }

    return true;
  });

  const sortedMatches = (() => {
    if (actionNeedle === "type") {
      return rankNodesForAction(matches, "type", textNeedle);
    }
    if (actionNeedle === "click") {
      return rankNodesForAction(matches, "click", textNeedle);
    }
    if (actionNeedle === "focus") {
      return rankNodesForAction(matches, "focus", textNeedle);
    }
    return matches;
  })().slice(0, maxResults);

  const nodeIds = new Set(sortedMatches.map((node) => node.nodeId));
  const edges = snapshot.edges.filter((edge) =>
    nodeIds.has(edge.fromNodeId) && nodeIds.has(edge.toNodeId)
  );

  return {
    tabId: snapshot.tabId,
    graphId: snapshot.graphId,
    totalMatched: matches.length,
    ...(sortedMatches[0] === undefined ? {} : { bestNode: toNodeHint(sortedMatches[0]) }),
    nodes: sortedMatches,
    edges
  };
};
