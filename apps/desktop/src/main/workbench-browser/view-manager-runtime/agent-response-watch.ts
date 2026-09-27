import { randomUUID } from "node:crypto";
import { SURFACE_TARGET_LOOKUP } from "./surface-target";
import { surfaceNameRuntime } from "./surface-name-runtime";
import { runFrameScriptWithTimeout } from "./normalizers";
import type { BrowserAgentPageTarget } from "./types";

export type BrowserResponseState = {
  readonly operationId: string;
  readonly status: "pending" | "streaming" | "complete" | "unknown" | "superseded";
  readonly evidence: readonly string[];
  readonly startedAt: number;
};

/** Observe only rendered UI state. Never fetch application endpoints or dispatch input. */
export const RESPONSE_WATCH_RUNTIME = String.raw`(() => {
  if (window.__lyraResponseWatches?.document === document) return window.__lyraResponseWatches;
  const watches = new Map();
  const parent = node => node.parentElement || node.getRootNode?.()?.host;
  const visible = node => {
    if (!node?.isConnected || !node.getClientRects?.().length) return false;
    for (let el = node; el; el = parent(el)) {
      if (el.hidden || el.inert || el.getAttribute('aria-hidden') === 'true') return false;
      const s = el.ownerDocument.defaultView.getComputedStyle(el);
      if (s.display === 'none' || s.visibility === 'hidden' || s.visibility === 'collapse' || Number(s.opacity) === 0) return false;
    }
    return true;
  };
  const all = (root, selector) => {
    const result = [...root.querySelectorAll(selector)];
    for (const host of root.querySelectorAll('*')) if (host.shadowRoot) result.push(...all(host.shadowRoot, selector));
    if (root.matches?.(selector)) result.unshift(root);
    return result;
  };
  const stopLabel = text => /^(stop( generating| generation| responding| response)?|停止(生成|回答|响应|回复)?|终止生成)$/i.test(text.trim());
  const arm = (id, source, label) => {
    const sourceDocument = source.ownerDocument;
    let region = source.closest('dialog,[role=dialog]') || source.closest('main,[role=main]') || source.closest('article,section') || sourceDocument.body;
    const composer = source.closest('form') || source.parentElement;
    const submitted = new Set(all(composer || source,'textarea,input,[contenteditable],[role=textbox]')
      .map(node => String(node.value ?? node.innerText ?? '').trim()).filter(Boolean));
    const controlled = [source,composer].flatMap(node => String(node?.getAttribute('aria-controls') || '').split(/\s+/))
      .map(id => source.getRootNode().getElementById?.(id) || sourceDocument.getElementById(id)).filter(Boolean);
    for (const node of controlled) while (!region.contains(node) && region.parentElement) region = region.parentElement;
    const names = label;
    const nearby = node => node === source || composer?.contains(node) || controlled.some(root => root === node || root.contains(node));
    const candidates = new Set([source,...all(composer || source,'button,[role=button],[aria-busy]'),
      ...controlled.flatMap(root => all(root,'button,[role=button],[aria-busy]'))]);
    const progress = () => [...candidates].filter(node => visible(node) &&
      (nearby(node) && stopLabel(names(node)) || node.getAttribute('aria-busy') === 'true' &&
        controlled.some(root => root === node || root.contains(node))));
    const baseline = new Set(progress());
    const startedAt = Date.now(), url = sourceDocument.location.href;
    const outputNodes = new Set(), active = new Set(), stopNodes = new Set();
    let status = 'pending', endedAt = 0, outputVersion = 0, versionAtEnd = -1, ambiguous = false;
    const evidence = [], observers = [], roots = new Set();
    const recordOutput = node => {
      const el = node.nodeType === 3 ? node.parentElement : node;
      if (!el?.matches || composer?.contains(el) || el === source || el.contains(source)
        || el.closest('input,textarea,select,button,[role=button],[role=textbox],[contenteditable],nav,aside,script,style,[role=status],[role=alert]')) return;
      if (!el.textContent?.trim()) return;
      if (submitted.has(el.textContent.trim())) return;
      outputNodes.add(el); outputVersion++;
      if (outputNodes.size > 256) {ambiguous = true; outputNodes.clear();}
    };
    const observe = root => {
      if (roots.has(root)) return;
      roots.add(root);
      const observer = new MutationObserver(records => consume(records));
      observer.observe(root, {subtree:true,childList:true,attributes:true,attributeOldValue:true,characterData:true});
      observers.push(observer);
      for (const host of root.querySelectorAll('*')) if (host.shadowRoot) observe(host.shadowRoot);
    };
    const consume = records => {
      for (const record of records) {
        if (record.type === 'characterData') recordOutput(record.target);
        if (record.type === 'childList') for (const node of record.addedNodes) {
          recordOutput(node);
          if (node.nodeType === 1) {
            for (const candidate of all(node,'button,[role=button],[aria-busy]')) candidates.add(candidate);
            for (const host of [node,...node.querySelectorAll('*')]) if (host.shadowRoot) observe(host.shadowRoot);
          }
        }
        if (record.type === 'attributes' && record.target.matches('button,[role=button],[aria-busy]')) candidates.add(record.target);
        // Keep fast busy cycles even if true -> false occurred in one task.
        if (record.type === 'attributes' && record.attributeName === 'aria-busy' && record.oldValue === 'true'
          && !baseline.has(record.target) && visible(record.target)
          && controlled.some(root => root === record.target || root.contains(record.target))) {
          active.add(record.target); status = 'streaming';
        }
      }
      for (const node of candidates) if (!node.isConnected) candidates.delete(node);
      const current = progress().filter(node => !baseline.has(node));
      for (const node of current) {active.add(node); if (nearby(node) && stopLabel(names(node))) stopNodes.add(node);}
      // Independent concurrent progress regions cannot be attributed to this send.
      const busyNodes = [...active].filter(node => !stopNodes.has(node));
      const independent = busyNodes.filter(node => !busyNodes.some(other => other !== node && other.contains(node)));
      if (independent.length > 1 || stopNodes.size > 1) ambiguous = true;
      if (active.size) status = 'streaming';
      if (active.size && !current.length) {
        if (!endedAt || versionAtEnd !== outputVersion) { endedAt = Date.now(); versionAtEnd = outputVersion; }
      } else endedAt = 0;
    };
    const dispose = () => observers.forEach(observer => observer.disconnect());
    const state = () => {
      if (status === 'superseded') return {operationId:id,status,evidence,startedAt};
      if (Date.now() - startedAt > 120000 || sourceDocument.location.href !== url || !region.isConnected) {
        status = 'unknown'; dispose(); return {operationId:id,status,evidence:['Observation expired or its document/region changed.'],startedAt};
      }
      for (const observer of observers) consume(observer.takeRecords());
      consume([]);
      const output = [...outputNodes].some(node => visible(node) && node.innerText?.trim()
        && !composer?.contains(node) && !node.closest('button,[role=button],[role=textbox],[contenteditable]'));
      if (!ambiguous && endedAt && output && Date.now() - endedAt >= 160) {
        status = 'complete';
        if (!evidence.length) evidence.push('A new response progress cycle started after this send, then ended with new rendered output.');
      }
      if (ambiguous) {status = 'unknown'; evidence.splice(0,evidence.length,'Multiple independent progress regions changed; completion cannot be attributed to this send.');}
      return {operationId:id,status,evidence,startedAt};
    };
    for (const watch of watches.values()) {
      if (watch.region === region || watch.region.contains(region) || region.contains(watch.region)) watch.supersede();
    }
    observe(region);
    const expiry = setTimeout(dispose, 120000);
    watches.set(id, {region,state,dispose:() => {clearTimeout(expiry);dispose();},supersede:() => {status='superseded';clearTimeout(expiry);dispose();}});
    while (watches.size > 8) {const key=watches.keys().next().value;watches.get(key).dispose();watches.delete(key);}
    return state();
  };
  const get = id => watches.get(id)?.state() ?? {operationId:id,status:'unknown',evidence:['No observation for this operation in the current document.'],startedAt:0};
  const cancel = id => {watches.get(id)?.dispose();watches.delete(id);};
  return window.__lyraResponseWatches = {document,arm,get,cancel,has:id=>watches.has(id)};
})()`;

export const armResponseWatchScript = (id: string, targetRef: string): string => `(() => {
  ${SURFACE_TARGET_LOOKUP}
  const source = findSurfaceTarget(${JSON.stringify(targetRef)});
  if (!source) return null;
  const names = ${surfaceNameRuntime};
  return (${RESPONSE_WATCH_RUNTIME}).arm(${JSON.stringify(id)}, source, node => names.label(node));
})()`;

export type ResponseWatchFrame = { executeJavaScript: (script: string, userGesture?: boolean) => Promise<unknown> };
export const armResponseWatch = async (frame: ResponseWatchFrame, targetRef: string): Promise<BrowserResponseState | undefined> => {
  const state = await runFrameScriptWithTimeout(() => frame.executeJavaScript(armResponseWatchScript(randomUUID(), targetRef), false), 1000).catch(() => undefined);
  return state && typeof state === "object" && "operationId" in state ? state as BrowserResponseState : undefined;
};
export const cancelResponseWatch = async (frame: ResponseWatchFrame, state: BrowserResponseState | undefined) => {
  if (state) await runFrameScriptWithTimeout(() => frame.executeJavaScript(`window.__lyraResponseWatches?.cancel(${JSON.stringify(state.operationId)})`, false), 500).catch(() => undefined);
};

export const readResponseWatch = async (target: BrowserAgentPageTarget, operationId: string, timeoutMs: number) => {
  const deadline = Date.now() + timeoutMs;
  for (const frame of target.webContents.mainFrame.framesInSubtree) {
    if (frame.isDestroyed() || Date.now() >= deadline) continue;
    const state = await runFrameScriptWithTimeout(() => frame.executeJavaScript(`window.__lyraResponseWatches?.has(${JSON.stringify(operationId)}) ? window.__lyraResponseWatches.get(${JSON.stringify(operationId)}) : null`, false), Math.max(1, deadline - Date.now())).catch(() => null) as BrowserResponseState | null;
    if (state) return state;
  }
  return { operationId, status: "unknown", startedAt: 0, evidence: ["The response observation is no longer available in this tab/document."] } satisfies BrowserResponseState;
};
