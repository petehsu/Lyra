import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import type {
  WorkbenchWebAutomationStoreData,
  WorkbenchWebAutomationStoredGraph,
  WorkbenchWebGraphSnapshot
} from "./types";

const STORE_FILENAME = "web-automation-graphs.v1.json";
const STORE_VERSION = 1;
const STORE_TTL_MS = 7 * 24 * 60 * 60 * 1_000;
const MAX_STORED_GRAPHS = 96;

const now = (): number => Date.now();

const toStoreData = (value: unknown): WorkbenchWebAutomationStoreData => {
  if (value === null || typeof value !== "object") {
    return { version: 1, graphs: [] };
  }
  const record = value as { readonly version?: unknown; readonly graphs?: unknown };
  if (record.version !== STORE_VERSION || !Array.isArray(record.graphs)) {
    return { version: 1, graphs: [] };
  }
  const graphs = record.graphs
    .filter((entry): entry is WorkbenchWebAutomationStoredGraph => {
      if (entry === null || typeof entry !== "object") {
        return false;
      }
      const candidate = entry as Record<string, unknown>;
      return (
        typeof candidate.graphId === "string"
        && typeof candidate.tabId === "string"
        && typeof candidate.builtAt === "number"
        && typeof candidate.expiresAt === "number"
        && Array.isArray(candidate.nodes)
        && Array.isArray(candidate.edges)
      );
    });
  return {
    version: STORE_VERSION,
    graphs
  };
};

const filePathFor = (storageRoot: string): string => path.join(storageRoot, STORE_FILENAME);

const persistableNodes = (snapshot: WorkbenchWebGraphSnapshot) =>
  snapshot.nodes.filter((node) =>
    node.interactable.clickable
    || node.interactable.typable
    || node.interactable.selectable
    || node.interactable.focusable
    || node.interactable.scrollable
  ).map((node) => ({
    nodeId: node.nodeId,
    frameTreeNodeId: node.frameTreeNodeId,
    parentNodeId: node.parentNodeId,
    tagName: node.tagName,
    role: node.role,
    inputType: node.inputType,
    selectorAddress: node.selectorAddress,
    stableSignature: node.stableSignature,
    interactable: node.interactable,
    visibilityState: node.visibilityState,
    bounds: node.bounds,
    textSnippet: typeof node.textSnippet === "string" ? node.textSnippet.slice(0, 80) : undefined,
    href: node.href,
    value: node.value,
    checked: node.checked,
    disabled: node.disabled,
    frameUrl: node.frameUrl
  }));

export class WorkbenchWebAutomationStore {
  private readonly storeFilePath: string;

  public constructor(private readonly storageRoot: string) {
    this.storeFilePath = filePathFor(storageRoot);
  }

  private async readData(): Promise<WorkbenchWebAutomationStoreData> {
    await mkdir(this.storageRoot, { recursive: true });
    try {
      const raw = await readFile(this.storeFilePath, "utf8");
      return toStoreData(JSON.parse(raw));
    } catch {
      return {
        version: STORE_VERSION,
        graphs: []
      };
    }
  }

  private async writeData(data: WorkbenchWebAutomationStoreData): Promise<void> {
    await mkdir(this.storageRoot, { recursive: true });
    await writeFile(this.storeFilePath, JSON.stringify(data, null, 2), "utf8");
  }

  public async compact(): Promise<void> {
    const current = await this.readData();
    const cutoff = now();
    const graphs = current.graphs
      .filter((graph) => graph.expiresAt > cutoff)
      .sort((left, right) => right.builtAt - left.builtAt)
      .slice(0, MAX_STORED_GRAPHS);
    await this.writeData({ version: STORE_VERSION, graphs });
  }

  public async write(snapshot: WorkbenchWebGraphSnapshot): Promise<void> {
    const current = await this.readData();
    const expiry = now() + STORE_TTL_MS;
    const nextRecord: WorkbenchWebAutomationStoredGraph = {
      graphId: snapshot.graphId,
      address: snapshot.address,
      tabId: snapshot.tabId,
      builtAt: snapshot.builtAt,
      expiresAt: expiry,
      nodeCount: snapshot.nodeCount,
      edgeCount: snapshot.edgeCount,
      interactableCount: snapshot.interactableCount,
      nodes: persistableNodes(snapshot),
      edges: snapshot.edges
    };

    const next = [nextRecord, ...current.graphs.filter((graph) => graph.graphId !== nextRecord.graphId)]
      .filter((graph) => graph.expiresAt > now())
      .sort((left, right) => right.builtAt - left.builtAt)
      .slice(0, MAX_STORED_GRAPHS);

    await this.writeData({
      version: STORE_VERSION,
      graphs: next
    });
  }

  public async readByGraphId(graphId: string): Promise<WorkbenchWebGraphSnapshot | null> {
    const current = await this.readData();
    const graph = current.graphs.find((entry) => entry.graphId === graphId && entry.expiresAt > now());
    if (graph === undefined) {
      return null;
    }
    return {
      tabId: graph.tabId,
      graphId: graph.graphId,
      address: graph.address,
      builtAt: graph.builtAt,
      nodeCount: graph.nodeCount,
      edgeCount: graph.edgeCount,
      interactableCount: graph.interactableCount,
      truncated: true,
      budgetExhausted: false,
      nodes: graph.nodes,
      edges: graph.edges
    };
  }

  public async readLatestByTab(tabId: string): Promise<WorkbenchWebGraphSnapshot | null> {
    const current = await this.readData();
    const graph = current.graphs
      .filter((entry) => entry.tabId === tabId && entry.expiresAt > now())
      .sort((left, right) => right.builtAt - left.builtAt)[0];
    if (graph === undefined) {
      return null;
    }
    return {
      tabId: graph.tabId,
      graphId: graph.graphId,
      address: graph.address,
      builtAt: graph.builtAt,
      nodeCount: graph.nodeCount,
      edgeCount: graph.edgeCount,
      interactableCount: graph.interactableCount,
      truncated: true,
      budgetExhausted: false,
      nodes: graph.nodes,
      edges: graph.edges
    };
  }

  public async clear(): Promise<void> {
    await this.writeData({
      version: STORE_VERSION,
      graphs: []
    });
  }
}
