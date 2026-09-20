import assert from "node:assert/strict";
import test from "node:test";
import { isValidElement, type ReactElement, type ReactNode } from "react";

import { enUS } from "./src/l10n/en-US.ts";
import { DownloadsEmbeddedChrome } from "./src/surface.tsx";

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
    const props = element.props as { className?: string; placeholder?: string; children?: ReactNode };
    if (typeof props.className === "string") classes.push(props.className);
    if (typeof props.placeholder === "string") text.push(props.placeholder);
    if (typeof props.children === "string") text.push(props.children);
  });
  return { classes: classes.join(" "), text: text.join(" ") };
};

test("embedded chrome keeps the Files Downloads class tree and copy", () => {
  const tree = DownloadsEmbeddedChrome({
    labels: enUS,
    tasks: [{
      id: "download-1",
      url: "https://example.com/archive.zip",
      fileName: "archive.zip",
      source: "manual",
      state: "downloading",
      receivedBytes: 512,
      totalBytes: 1024,
      speedBytesPerSecond: 128,
      estimatedRemainingMs: 120_000,
      priority: "normal",
      connectionsRequested: 1,
      connectionsActive: 1
    }],
    urlDraft: "https://example.com/next.zip",
    error: null,
    busyKey: null,
    onUrlDraftChange: () => undefined,
    onSubmitUrl: () => undefined,
    onPause: () => undefined,
    onResume: () => undefined,
    onCancel: () => undefined,
    onRetry: () => undefined,
    onRemove: () => undefined,
    onPauseAll: () => undefined,
    onResumeAll: () => undefined,
    onCancelAll: () => undefined,
    onOpen: () => undefined,
    onReveal: () => undefined,
    onSetPriority: () => undefined
  });
  const { classes, text } = flatten(tree);
  assert.match(classes, /lyra-file-manager-downloads-page/u);
  assert.match(classes, /lyra-file-manager-download-list/u);
  assert.match(text, /Paste URL or batch URLs/u);
  assert.match(text, /archive\.zip/u);
  assert.match(text, /2m 0s left/u);
  assert.equal(classes.includes("lyra-app-module-aside"), false);
});
