import { focusBrowserPageForInput } from "../workspace-focus-isolation";
import type { WorkbenchBrowserAgentElement, WorkbenchLumenTargetRef } from "../types";
import type { BrowserAgentPageTarget } from "./types";
import {
  actionCapabilitiesForElement,
  browserAgentTargetKind,
  createBrowserAgentTargetRef,
  delay,
  semanticNodeKeyForTarget
} from "./normalizers";

export const TAB_SWEEP_LIMIT = 48;

export type TabStop = {
  readonly token: string;
  readonly collected: boolean;
  readonly tagName: string;
  readonly role: string;
  readonly label: string;
  readonly editable: boolean;
  readonly disabled: boolean;
  readonly textSnippet: string;
  readonly inputType: string;
  readonly selectorPreview: string;
  readonly xpath: string;
  readonly offscreen: boolean;
  readonly bounds: {
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
  };
};

export const selectNewTabStops = (
  stops: readonly TabStop[],
  cycled: boolean
): { readonly added: readonly TabStop[]; readonly unfinished: boolean } => {
  const added: TabStop[] = [];
  const seen = new Set<string>();
  for (const stop of stops) {
    if (stop.collected || seen.has(stop.token) || stop.bounds.width <= 0 || stop.bounds.height <= 0) {
      continue;
    }
    seen.add(stop.token);
    added.push(stop);
  }
  return {
    added,
    unfinished: cycled === false && stops.length >= TAB_SWEEP_LIMIT
  };
};

const READ_TAB_STOP_SCRIPT = `(() => {
  const el = document.activeElement;
  if (!(el instanceof Element) || el === document.body || el === document.documentElement) return null;
  let token = el.getAttribute("data-lyra-tab-token");
  if (!token) {
    token = "tab-" + Math.random().toString(16).slice(2);
    el.setAttribute("data-lyra-tab-token", token);
  }
  const rect = el.getBoundingClientRect();
  const width = window.innerWidth || 0;
  const height = window.innerHeight || 0;
  const tag = String(el.tagName || "").toLowerCase();
  const role = String(el.getAttribute("role") || tag);
  const named = el.getAttribute("aria-label") || el.getAttribute("placeholder") || el.getAttribute("title") || "";
  const value = "value" in el && typeof el.value === "string" ? el.value : "";
  const text = named || value || (el.innerText || el.textContent || "");
  const editable = tag === "textarea" || tag === "select" || role === "textbox" || role === "searchbox"
    || el.isContentEditable === true
    || (tag === "input" && String(el.type || "text").toLowerCase() !== "hidden");
  const parts = [];
  let node = el;
  while (node && node.nodeType === 1 && parts.length < 8) {
    const part = node.tagName.toLowerCase();
    const parent = node.parentElement;
    const index = parent ? Array.prototype.indexOf.call(parent.children, node) + 1 : 1;
    parts.unshift(part + "[" + index + "]");
    node = parent;
  }
  return {
    token,
    collected: el.getAttribute("data-lyra-collected") === "1",
    tagName: tag,
    role,
    label: String(text).replace(/\\s+/g, " ").trim().slice(0, 120) || "(no label)",
    editable,
    disabled: el.hasAttribute("disabled") || el.getAttribute("aria-disabled") === "true",
    textSnippet: String(value).replace(/\\s+/g, " ").trim().slice(0, 80),
    inputType: tag === "input" ? String(el.type || "") : "",
    selectorPreview: tag,
    xpath: "/" + parts.join("/"),
    offscreen: rect.bottom <= 0 || rect.right <= 0 || rect.top >= height || rect.left >= width,
    bounds: {
      x: Math.round(rect.left),
      y: Math.round(rect.top),
      width: Math.round(rect.width),
      height: Math.round(rect.height)
    }
  };
})()`;

const controlKindFor = (stop: TabStop): WorkbenchBrowserAgentElement["controlKind"] => {
  const tag = stop.tagName.toLowerCase();
  if (tag === "input") return "input";
  if (tag === "textarea") return "textarea";
  if (tag === "select") return "select";
  if (stop.editable) return "editable";
  if (tag === "button" || stop.role === "button") return "button";
  if (tag === "a" || stop.role === "link") return "link";
  return "other";
};

export const elementFromTabStop = (input: {
  readonly stop: TabStop;
  readonly id: number;
  readonly pageUrl: string;
  readonly tabId: string;
  readonly frameRef: string;
  readonly frameTreeNodeId: number;
  readonly mapEpoch: number;
  readonly observedAt: number;
}): WorkbenchBrowserAgentElement => {
  const { stop } = input;
  const base = {
    id: input.id,
    frameTreeNodeId: input.frameTreeNodeId,
    frameRef: input.frameRef,
    tagName: stop.tagName,
    role: stop.role,
    label: stop.label,
    selectorPreview: stop.selectorPreview,
    bounds: stop.bounds,
    localBounds: stop.bounds,
    focusable: true,
    disabled: stop.disabled,
    editable: stop.editable,
    visibility: {
      visible: true,
      offscreen: stop.offscreen,
      covered: false,
      ariaHidden: false
    },
    discoveryScope: "document" as const,
    xpath: stop.xpath,
    ...(stop.textSnippet.length > 0 ? { textSnippet: stop.textSnippet } : {}),
    ...(stop.inputType.length > 0 ? { inputType: stop.inputType } : {}),
    controlKind: controlKindFor(stop)
  };
  const minted = createBrowserAgentTargetRef(input.pageUrl, base);
  const actionCapabilities = actionCapabilitiesForElement(base);
  const target: WorkbenchLumenTargetRef = {
    targetRef: minted.targetRef,
    targetKind: browserAgentTargetKind(base),
    tabId: input.tabId,
    frameRef: input.frameRef,
    frameChain: [input.frameRef],
    elementFingerprint: minted.elementFingerprint,
    mapEpoch: input.mapEpoch,
    expiresAt: input.observedAt + 60_000
  };
  return {
    ...base,
    semanticNodeKey: semanticNodeKeyForTarget(minted.targetRef, "dom", input.frameRef),
    actionCapabilities,
    stableId: minted.stableId,
    targetRef: minted.targetRef,
    target,
    elementFingerprint: minted.elementFingerprint
  };
};

const sendTab = async (
  target: BrowserAgentPageTarget,
  sendAgentInputEvent: (target: BrowserAgentPageTarget, event: { readonly type: "keyDown" | "keyUp"; readonly keyCode: string }) => void
): Promise<void> => {
  await focusBrowserPageForInput(target.webContents);
  sendAgentInputEvent(target, { type: "keyDown", keyCode: "Tab" });
  await delay(16);
  sendAgentInputEvent(target, { type: "keyUp", keyCode: "Tab" });
  await delay(40);
};

const readStop = async (target: BrowserAgentPageTarget): Promise<TabStop | null> => {
  const raw = await target.webContents.mainFrame.executeJavaScript(READ_TAB_STOP_SCRIPT, true).catch(() => null);
  if (raw === null || typeof raw !== "object") return null;
  const record = raw as Partial<TabStop>;
  if (typeof record.token !== "string" || record.bounds === undefined) return null;
  return record as TabStop;
};

export const runTabFocusSweep = async (
  target: BrowserAgentPageTarget,
  sendAgentInputEvent: (target: BrowserAgentPageTarget, event: { readonly type: "keyDown" | "keyUp"; readonly keyCode: string }) => void
): Promise<{ readonly stops: readonly TabStop[]; readonly cycled: boolean }> => {
  const anchor = `lyra-tab-${Date.now().toString(16)}`;
  await target.webContents.mainFrame.executeJavaScript(
    `(() => { const el = document.activeElement; if (el instanceof Element) el.setAttribute("data-lyra-tab-anchor", ${JSON.stringify(anchor)}); return true; })()`,
    true
  ).catch(() => false);
  const stops: TabStop[] = [];
  let cycled = false;
  let startToken = "";
  try {
    for (let index = 0; index < TAB_SWEEP_LIMIT; index += 1) {
      await sendTab(target, sendAgentInputEvent);
      const stop = await readStop(target);
      if (stop === null) break;
      if (startToken.length === 0) startToken = stop.token;
      else if (stop.token === startToken) {
        cycled = true;
        break;
      }
      stops.push(stop);
    }
  } finally {
    await target.webContents.mainFrame.executeJavaScript(
      `(() => { const el = document.querySelector(${JSON.stringify(`[data-lyra-tab-anchor="${anchor}"]`)}); if (el instanceof HTMLElement) { el.focus({ preventScroll: true }); el.removeAttribute("data-lyra-tab-anchor"); } return true; })()`,
      true
    ).catch(() => false);
  }
  return { stops, cycled };
};
