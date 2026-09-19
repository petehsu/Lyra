import { useSyncExternalStore } from "react";

import type { FileManagerEntry, FileSearchTextHit } from "../../../shared/file-manager";

export type AgentProjectTreeFileSearch = {
  readonly query: string;
  readonly rootPath: string;
  readonly status: "searching" | "ready";
  readonly hits: readonly FileSearchTextHit[];
  readonly truncated: boolean;
  readonly collapsedFilePaths: readonly string[];
};

export type GroupedFileSearchHits = {
  readonly filePath: string;
  readonly hits: readonly FileSearchTextHit[];
};

export type ProjectTreeSearchRow =
  | {
      readonly kind: "file";
      readonly key: string;
      readonly filePath: string;
      readonly relativePath: string;
      readonly expanded: boolean;
      readonly entry: FileManagerEntry;
    }
  | {
      readonly kind: "hit";
      readonly key: string;
      readonly hit: FileSearchTextHit;
    }
  | {
      readonly kind: "loading";
      readonly key: string;
    }
  | {
      readonly kind: "empty";
      readonly key: string;
    };

let searches: Readonly<Record<string, AgentProjectTreeFileSearch | null>> = {};
const listeners = new Set<() => void>();

const emit = (): void => {
  for (const listener of listeners) {
    listener();
  }
};

export const getProjectTreeFileSearch = (
  instanceId: string
): AgentProjectTreeFileSearch | null => searches[instanceId] ?? null;

export const setProjectTreeFileSearch = (
  instanceId: string,
  next: AgentProjectTreeFileSearch | null
): void => {
  const current = searches[instanceId] ?? null;
  if (current === next) {
    return;
  }
  if (next === null) {
    if (current === null) {
      return;
    }
    const { [instanceId]: _removed, ...rest } = searches;
    searches = rest;
  } else {
    searches = {
      ...searches,
      [instanceId]: next
    };
  }
  emit();
};

export const toggleProjectTreeFileSearchGroup = (
  instanceId: string,
  filePath: string
): void => {
  const current = getProjectTreeFileSearch(instanceId);
  if (current === null) {
    return;
  }
  const collapsed = new Set(current.collapsedFilePaths);
  if (collapsed.has(filePath)) {
    collapsed.delete(filePath);
  } else {
    collapsed.add(filePath);
  }
  setProjectTreeFileSearch(instanceId, {
    ...current,
    collapsedFilePaths: [...collapsed]
  });
};

export const subscribeProjectTreeFileSearch = (listener: () => void): (() => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

export const useProjectTreeFileSearch = (
  instanceId: string
): AgentProjectTreeFileSearch | null =>
  useSyncExternalStore(
    subscribeProjectTreeFileSearch,
    () => getProjectTreeFileSearch(instanceId),
    () => getProjectTreeFileSearch(instanceId)
  );

export const relativeFileSearchPath = (filePath: string, rootPath: string): string => {
  if (rootPath.length === 0) {
    return filePath;
  }
  if (filePath.startsWith(rootPath)) {
    return filePath.slice(rootPath.length).replace(/^[\\/]/u, "");
  }
  return filePath;
};

export const groupFileSearchHits = (
  hits: readonly FileSearchTextHit[]
): readonly GroupedFileSearchHits[] => {
  const order: string[] = [];
  const grouped = new Map<string, FileSearchTextHit[]>();
  for (const hit of hits) {
    const existing = grouped.get(hit.filePath);
    if (existing === undefined) {
      grouped.set(hit.filePath, [hit]);
      order.push(hit.filePath);
    } else {
      existing.push(hit);
    }
  }
  return order.map((filePath) => ({
    filePath,
    hits: grouped.get(filePath) ?? []
  }));
};

export const toSearchFileEntry = (filePath: string): FileManagerEntry => {
  const name = filePath.slice(Math.max(filePath.lastIndexOf("/"), filePath.lastIndexOf("\\")) + 1);
  const dot = name.lastIndexOf(".");
  return {
    id: filePath,
    name,
    path: filePath,
    kind: "file",
    isHidden: false,
    ...(dot > 0 ? { extension: name.slice(dot + 1) } : {})
  };
};

export const flattenFileSearchRows = (
  search: AgentProjectTreeFileSearch,
  rootPath: string
): readonly ProjectTreeSearchRow[] => {
  if (search.status === "searching" && search.hits.length === 0) {
    return [{ kind: "loading", key: "search-loading" }];
  }
  if (search.hits.length === 0) {
    return [{ kind: "empty", key: "search-empty" }];
  }
  const collapsed = new Set(search.collapsedFilePaths);
  const rows: ProjectTreeSearchRow[] = [];
  for (const group of groupFileSearchHits(search.hits)) {
    const expanded = collapsed.has(group.filePath) === false;
    rows.push({
      kind: "file",
      key: `file:${group.filePath}`,
      filePath: group.filePath,
      relativePath: relativeFileSearchPath(group.filePath, rootPath),
      expanded,
      entry: toSearchFileEntry(group.filePath)
    });
    if (expanded === false) {
      continue;
    }
    for (const hit of group.hits) {
      rows.push({
        kind: "hit",
        key: `hit:${hit.filePath}:${hit.line}:${hit.column}`,
        hit
      });
    }
  }
  return rows;
};
