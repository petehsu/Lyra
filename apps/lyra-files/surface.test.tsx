import assert from "node:assert/strict";
import test from "node:test";
import { isValidElement, type ReactElement, type ReactNode } from "react";

import { enUS } from "./src/l10n/en-US.ts";
import { FilesEmbeddedChrome } from "./src/surface.tsx";

const walk = (node: ReactNode, visit: (element: ReactElement) => void): void => {
  if (node === null || node === undefined || typeof node === "boolean") return;
  if (Array.isArray(node)) {
    for (const child of node) walk(child, visit);
    return;
  }
  if (!isValidElement(node)) return;
  visit(node);
  walk((node.props as { children?: ReactNode }).children, visit);
};

const flatten = (node: ReactNode): { readonly classes: string; readonly text: string } => {
  const classes: string[] = [];
  const text: string[] = [];
  walk(node, (element) => {
    const props = element.props as { className?: string; title?: string; children?: ReactNode };
    if (typeof props.className === "string") classes.push(props.className);
    if (typeof props.title === "string") text.push(props.title);
    if (typeof props.children === "string") text.push(props.children);
  });
  return { classes: classes.join(" "), text: text.join(" ") };
};

test("Files chrome keeps the Classic class tree and nested Downloads slot", () => {
  const tree = FilesEmbeddedChrome({
    labels: enUS,
    instanceId: "files-1",
    error: null,
    createKind: null,
    createName: "",
    destructiveAction: null,
    currentFavorite: false,
    state: {
      instanceId: "files-1",
      status: "ready",
      viewKind: "home",
      presentationMode: "list",
      title: "Files",
      currentLocation: { id: "home", title: "Files", kind: "home" },
      historyLength: 1,
      historyIndex: 0,
      systemLocations: [],
      favorites: [],
      recentLocations: [],
      disks: [{
        id: "disk-1",
        title: "System",
        mountPath: "/",
        kind: "system",
        totalBytes: 100,
        availableBytes: 60,
        usedBytes: 40,
        usageRatio: 0.4
      }],
      devices: [],
      entries: [],
      trashEntries: [],
      downloadTasks: []
    },
    onOpenHome: () => undefined,
    onOpenDownloads: () => undefined,
    onOpenTrash: () => undefined,
    onOpenFavorite: () => undefined,
    onOpenLocation: () => undefined,
    onNavigate: () => undefined,
    onSetPresentation: () => undefined,
    onToggleFavorite: () => undefined,
    onBeginCreate: () => undefined,
    onCreateNameChange: () => undefined,
    onCreate: () => undefined,
    onCancelCreate: () => undefined,
    onSelectEntry: () => undefined,
    onOpenEntry: () => undefined,
    onSelectTrashEntry: () => undefined,
    onBeginDestructive: () => undefined,
    onCancelDestructive: () => undefined,
    onConfirmDestructive: () => undefined,
    onRestore: () => undefined
  });
  const { classes, text } = flatten(tree);
  assert.match(classes, /lyra-file-manager-surface/u);
  assert.match(classes, /lyra-app-sidebar-nav/u);
  assert.match(classes, /lyra-file-manager-nav/u);
  assert.match(classes, /lyra-file-manager-home/u);
  assert.match(text, /Files/u);
  assert.match(text, /System/u);
});

test("nested Downloads slot id stays in the Core identifier alphabet", () => {
  const tree = FilesEmbeddedChrome({
    labels: enUS,
    instanceId: "file-manager-0c6ed803-a56f-476d-92bc-0333a26475da",
    error: null,
    createKind: null,
    createName: "",
    destructiveAction: null,
    currentFavorite: false,
    state: {
      instanceId: "file-manager-0c6ed803-a56f-476d-92bc-0333a26475da",
      status: "ready",
      viewKind: "downloads",
      presentationMode: "list",
      title: "Downloads",
      currentLocation: { id: "downloads", title: "Downloads", kind: "special", specialId: "downloadManager" },
      historyLength: 1,
      historyIndex: 0,
      systemLocations: [],
      favorites: [],
      recentLocations: [],
      disks: [],
      devices: [],
      entries: [],
      trashEntries: [],
      downloadTasks: []
    },
    onOpenHome: () => undefined,
    onOpenDownloads: () => undefined,
    onOpenTrash: () => undefined,
    onOpenFavorite: () => undefined,
    onOpenLocation: () => undefined,
    onNavigate: () => undefined,
    onSetPresentation: () => undefined,
    onToggleFavorite: () => undefined,
    onBeginCreate: () => undefined,
    onCreateNameChange: () => undefined,
    onCreate: () => undefined,
    onCancelCreate: () => undefined,
    onSelectEntry: () => undefined,
    onOpenEntry: () => undefined,
    onSelectTrashEntry: () => undefined,
    onBeginDestructive: () => undefined,
    onCancelDestructive: () => undefined,
    onConfirmDestructive: () => undefined,
    onRestore: () => undefined
  });
  const slotIds: string[] = [];
  walk(tree, (element) => {
    const slotId = (element.props as { slotId?: unknown }).slotId;
    if (typeof slotId === "string") slotIds.push(slotId);
  });
  assert.deepEqual(slotIds, ["downloads"]);
  assert.match(slotIds[0] ?? "", /^[a-z0-9]+(?:[.-][a-z0-9]+)*$/u);
});
