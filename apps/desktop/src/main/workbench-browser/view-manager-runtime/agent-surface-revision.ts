import type { BrowserAgentPageTarget } from "./types";
import { runFrameScriptWithTimeout } from "./normalizers";

/** A cheap change journal, not another control/text map. One instance per document. */
export const SURFACE_REVISION_RUNTIME = String.raw`(() => {
  if (window.__lyraSurfaceRevision?.document === document) return window.__lyraSurfaceRevision;
  const roots = new Set(), observers = new Map(), controls = new Set();
  let revision = 0;
  const internal = node => {
    for (let el = node.nodeType === 1 ? node : node.parentElement; el; el = el.parentElement || el.getRootNode?.()?.host) {
      if (el.id === '__lyra_agent_page_cursor__' || el.hasAttribute?.('data-lyra-agent-overlay')) return true;
    }
    return false;
  };
  const register = root => {
    if (roots.has(root)) return;
    roots.add(root);
    const observer = new MutationObserver(records => consume(records));
    observer.observe(root, {subtree:true,childList:true,attributes:true,characterData:true});
    observers.set(root,observer);
    discover(root);
  };
  const discover = root => {
    if (internal(root)) return;
    if (root.nodeType === 1) {
      if (root.matches('input,textarea,select')) controls.add(root);
      if (root.shadowRoot) register(root.shadowRoot);
    }
    for (const node of root.querySelectorAll?.('*') ?? []) {
      if (node.matches('input,textarea,select')) controls.add(node);
      if (node.shadowRoot) register(node.shadowRoot);
    }
  };
  const consume = records => {
    for (const record of records) {
      if (internal(record.target)) continue;
      if (record.type === 'attributes' && record.attributeName?.startsWith('data-lyra-')) continue;
      if (record.type === 'childList' && [...record.addedNodes,...record.removedNodes].every(internal)) continue;
      revision++;
      for (const node of record.addedNodes ?? []) if (node.nodeType === 1) discover(node);
    }
  };
  register(document);
  for (const event of ['input','change','focusin','focusout','scroll','resize','pointerover','pointerout','transitionend','animationend','load']) {
    window.addEventListener(event, e => {if (!internal(e.target ?? document)) revision++;}, true);
  }
  const snapshot = () => {
    for (const weak of window.__lyraKnownShadowRoots ?? []) {const root=weak.deref();if(root?.host?.isConnected)register(root);}
    for (const [root,observer] of observers) {
      if (root !== document && !root.host?.isConnected) {observer.disconnect();observers.delete(root);roots.delete(root);continue;}
      consume(observer.takeRecords());
    }
    const values = [];
    for (const node of controls) {
      if (!node.isConnected) {controls.delete(node); continue;}
      values.push([node.value,node.checked,node.selectedIndex,node.disabled,node.readOnly]);
    }
    // This journal schedules a final fresh map; it is never proof that cached
    // geometry or CSS semantics remain valid. Local input still hit-tests live.
    const animated = document.getAnimations?.().some(animation => animation.playState === 'running' && !internal(animation.effect?.target ?? document)) ?? false;
    return { key: JSON.stringify([revision,location.href,document.readyState,innerWidth,innerHeight,scrollX,scrollY,values]), complete: !animated };
  };
  return window.__lyraSurfaceRevision = {document,snapshot};
})()`;

export const readSurfaceRevision = async (target: BrowserAgentPageTarget, timeoutMs = 1000): Promise<string | null> => {
  try {
    const frames = target.webContents.mainFrame.framesInSubtree.filter(frame => !frame.isDestroyed());
    const states = await Promise.all(frames.map(async frame => {
      const state = await runFrameScriptWithTimeout(() => frame.executeJavaScript(`(${SURFACE_REVISION_RUNTIME}).snapshot()`, false), Math.max(100, timeoutMs)) as { key?: unknown; complete?: boolean };
      return state?.complete && typeof state.key === "string" ? [frame.frameTreeNodeId, state.key] : null;
    }));
    return states.length > 0 && states.every(Boolean) ? JSON.stringify(states) : null;
  } catch { return null; }
};

/** Poll only the journal; collect controls once after the bounded settling window. */
export const settleSurfaceRevision = async (target: BrowserAgentPageTarget, timeoutMs = 800, requireChange = false): Promise<boolean> => {
  const deadline = Date.now() + Math.min(1000, Math.max(0, timeoutMs));
  let prior = await readSurfaceRevision(target), since = Date.now();
  let changed = !requireChange;
  while (Date.now() < deadline) {
    await new Promise(resolve => setTimeout(resolve, Math.min(60, Math.max(0, deadline - Date.now()))));
    const next = await readSurfaceRevision(target, Math.min(500, Math.max(100, deadline - Date.now())));
    if (next === null || next !== prior) { since = Date.now(); changed = true; }
    else if (changed && Date.now() - since >= 160) return true;
    prior = next;
  }
  return false;
};
