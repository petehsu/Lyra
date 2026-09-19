import { useEffect, useSyncExternalStore } from "react";

import type { LspDiagnostic, LyraDesktopApi } from "../../../shared/desktop-bridge";

export const isPathInsideRoot = (filePath: string, rootPath: string): boolean => {
  const root = rootPath.replace(/[\\/]+$/u, "");
  if (root.length === 0) {
    return false;
  }
  if (filePath === root) {
    return true;
  }
  return filePath.startsWith(`${root}/`) || filePath.startsWith(`${root}\\`);
};

export const displayDiagnosticPath = (filePath: string, rootPath: string): string => {
  if (rootPath.length === 0 || !isPathInsideRoot(filePath, rootPath)) {
    return filePath;
  }
  return filePath.slice(rootPath.replace(/[\\/]+$/u, "").length).replace(/^[\\/]/u, "");
};

export const fileNameFromPath = (filePath: string): string => {
  const base = filePath.replaceAll("\\", "/").split("/").pop();
  return base === undefined || base.length === 0 ? filePath : base;
};

export const directoryLabelForFile = (filePath: string, rootPath: string): string => {
  const relative = displayDiagnosticPath(filePath, rootPath).replaceAll("\\", "/");
  const slash = relative.lastIndexOf("/");
  return slash <= 0 ? "" : relative.slice(0, slash);
};

export type ProblemFileGroup = {
  readonly filePath: string;
  readonly fileName: string;
  readonly directoryLabel: string;
  readonly items: readonly LspDiagnostic[];
};

export const groupDiagnosticsByFile = (
  items: readonly LspDiagnostic[],
  rootPath: string
): readonly ProblemFileGroup[] => {
  const groups = new Map<string, LspDiagnostic[]>();
  for (const item of items) {
    const existing = groups.get(item.filePath);
    if (existing === undefined) {
      groups.set(item.filePath, [item]);
    } else {
      existing.push(item);
    }
  }
  return [...groups.entries()].map(([filePath, grouped]) => ({
    filePath,
    fileName: fileNameFromPath(filePath),
    directoryLabel: directoryLabelForFile(filePath, rootPath),
    items: grouped
  }));
};

export type ProblemsTreeRow =
  | {
      readonly kind: "file";
      readonly key: string;
      readonly group: ProblemFileGroup;
    }
  | {
      readonly kind: "item";
      readonly key: string;
      readonly group: ProblemFileGroup;
      readonly item: LspDiagnostic;
      readonly index: number;
    };

export const flattenProblemsRows = (
  groups: readonly ProblemFileGroup[],
  collapsed: ReadonlySet<string>
): readonly ProblemsTreeRow[] => {
  const rows: ProblemsTreeRow[] = [];
  for (const group of groups) {
    rows.push({ kind: "file", key: `file:${group.filePath}`, group });
    if (collapsed.has(group.filePath)) {
      continue;
    }
    for (let index = 0; index < group.items.length; index += 1) {
      const item = group.items[index];
      if (item === undefined) {
        continue;
      }
      rows.push({
        kind: "item",
        key: `item:${item.filePath}:${item.startLine}:${item.startCharacter}:${index}`,
        group,
        item,
        index
      });
    }
  }
  return rows;
};

export const diagnosticsSignature = (
  filePath: string,
  diagnostics: readonly LspDiagnostic[]
): string =>
  `${filePath}\0${diagnostics.map((item) =>
    `${item.severity}:${item.startLine}:${item.startCharacter}:${item.message}`
  ).join("\n")}`;

export const filterDiagnosticsForRoot = (
  diagnostics: readonly LspDiagnostic[],
  rootPath: string
): readonly LspDiagnostic[] =>
  diagnostics.filter((item) => isPathInsideRoot(item.filePath, rootPath));

export type BoundProjectRootSource = {
  readonly workingDir?: string | null;
  readonly projectBound?: boolean;
  readonly workingDirIsHome?: boolean;
};

export type ProjectTreeTabSource = {
  readonly pageKind?: string;
  readonly appId?: string;
  readonly filePath?: string;
};

const normalizeProjectRoot = (value: string): string =>
  value.trim().replace(/[\\/]+$/u, "");

export const collectBoundProjectRoots = (
  sessionTabs: readonly BoundProjectRootSource[],
  workspaceTabs: readonly ProjectTreeTabSource[] = []
): readonly string[] => {
  const roots = new Set<string>();
  for (const tab of sessionTabs) {
    if (tab.projectBound !== true || tab.workingDirIsHome === true) {
      continue;
    }
    const workingDir = typeof tab.workingDir === "string" ? normalizeProjectRoot(tab.workingDir) : "";
    if (workingDir.length === 0) {
      continue;
    }
    roots.add(workingDir);
  }
  for (const tab of workspaceTabs) {
    if (tab.pageKind !== "app" || tab.appId !== "agent-project-tree") {
      continue;
    }
    const rootPath = typeof tab.filePath === "string" ? normalizeProjectRoot(tab.filePath) : "";
    if (rootPath.length === 0) {
      continue;
    }
    roots.add(rootPath);
  }
  return [...roots].sort();
};

const EMPTY_PROBLEMS: readonly LspDiagnostic[] = Object.freeze([]);

const flattenWorkspaceProblems = (
  byFile: ReadonlyMap<string, readonly LspDiagnostic[]>
): readonly LspDiagnostic[] => {
  const items = [...byFile.values()].flat().sort((left, right) => {
    if (left.severity !== right.severity) {
      return left.severity - right.severity;
    }
    const byPath = left.filePath.localeCompare(right.filePath);
    if (byPath !== 0) {
      return byPath;
    }
    return left.startLine - right.startLine;
  });
  return items.length === 0 ? EMPTY_PROBLEMS : items;
};

let problemsByFile: ReadonlyMap<string, readonly LspDiagnostic[]> = new Map();
let problemsSnapshot: readonly LspDiagnostic[] = EMPTY_PROBLEMS;
const problemsListeners = new Set<() => void>();
let attachedApi: LyraDesktopApi | null = null;
let attachedUnsubscribe: (() => void) | null = null;
let attachCount = 0;
let problemsEmitScheduled = false;

const emitWorkspaceProblems = (): void => {
  for (const listener of problemsListeners) {
    listener();
  }
};

const scheduleWorkspaceProblemsEmit = (): void => {
  if (problemsEmitScheduled) {
    return;
  }
  problemsEmitScheduled = true;
  const flush = (): void => {
    problemsEmitScheduled = false;
    emitWorkspaceProblems();
  };
  if (typeof requestAnimationFrame === "function") {
    requestAnimationFrame(flush);
    return;
  }
  queueMicrotask(flush);
};

export const getWorkspaceProblemsSnapshot = (): readonly LspDiagnostic[] => problemsSnapshot;

export const subscribeWorkspaceProblems = (listener: () => void): (() => void) => {
  problemsListeners.add(listener);
  return () => {
    problemsListeners.delete(listener);
  };
};

export const applyWorkspaceDiagnostics = (
  filePath: string,
  diagnostics: readonly LspDiagnostic[]
): void => {
  const previous = problemsByFile.get(filePath);
  const nextSignature = diagnosticsSignature(filePath, diagnostics);
  const previousSignature = diagnosticsSignature(filePath, previous ?? []);
  if (nextSignature === previousSignature && (previous === undefined) === (diagnostics.length === 0)) {
    return;
  }
  const next = new Map(problemsByFile);
  if (diagnostics.length === 0) {
    next.delete(filePath);
  } else {
    next.set(filePath, diagnostics);
  }
  problemsByFile = next;
  problemsSnapshot = flattenWorkspaceProblems(next);
  scheduleWorkspaceProblemsEmit();
};

export const resetWorkspaceProblemsStore = (): void => {
  problemsEmitScheduled = false;
  if (problemsByFile.size === 0 && problemsSnapshot === EMPTY_PROBLEMS) {
    return;
  }
  problemsByFile = new Map();
  problemsSnapshot = EMPTY_PROBLEMS;
  emitWorkspaceProblems();
};

export const attachWorkspaceProblems = (desktopApi: LyraDesktopApi | null): (() => void) => {
  const lsp = desktopApi?.lsp;
  if (lsp === undefined) {
    return () => undefined;
  }
  if (attachedApi !== desktopApi) {
    attachedUnsubscribe?.();
    attachedApi = desktopApi;
    attachedUnsubscribe = lsp.onEvent((event) => {
      if (event.kind !== "diagnostics" || event.filePath === undefined) {
        return;
      }
      applyWorkspaceDiagnostics(event.filePath, event.diagnostics ?? []);
    });
  }
  attachCount += 1;
  return () => {
    attachCount = Math.max(0, attachCount - 1);
    if (attachCount > 0) {
      return;
    }
    attachedUnsubscribe?.();
    attachedUnsubscribe = null;
    attachedApi = null;
  };
};

export const workspaceHasProblemsForRoot = (rootPath: string): boolean => {
  if (rootPath.length === 0) {
    return false;
  }
  for (const [filePath, items] of problemsByFile) {
    if (items.length === 0) {
      continue;
    }
    if (isPathInsideRoot(filePath, rootPath)) {
      return true;
    }
  }
  return false;
};

export const useWorkspaceProblems = (desktopApi: LyraDesktopApi | null): readonly LspDiagnostic[] => {
  useEffect(() => attachWorkspaceProblems(desktopApi), [desktopApi]);
  return useSyncExternalStore(
    subscribeWorkspaceProblems,
    getWorkspaceProblemsSnapshot,
    getWorkspaceProblemsSnapshot
  );
};

export const useWorkspaceProblemsActive = (
  desktopApi: LyraDesktopApi | null,
  rootPath: string
): boolean => {
  useEffect(() => attachWorkspaceProblems(desktopApi), [desktopApi]);
  return useSyncExternalStore(
    subscribeWorkspaceProblems,
    () => workspaceHasProblemsForRoot(rootPath),
    () => workspaceHasProblemsForRoot(rootPath)
  );
};
