import { readRuntimeSessionId, isRecord } from "./host-payload";
import { readTabId } from "./workbench-observation-adapter";
import { readLumenTargetMode } from "./lumen-tool-host-helpers";

type Page = { tabId: string; url?: string; title?: string; navigationFromUrl?: string | undefined };
type TextBaseline = { hash: string; maxChars: number; scope: "viewport" | "full" };
type Session = { current?: string; pages: Map<string, Page>; refs: Map<string, string>; texts: Map<string, TextBaseline[]>; responses: Map<string, { operationId: string; startedAt: number }> };
const textHash = (text: string) => createHash("sha256").update(text).digest("hex");
const textLimit = (maxChars?: number) => Math.max(512, Math.min(6_000, Math.round(maxChars ?? 4_000)));

/** Task selection is independent of foreground focus and preview presentation. */
export const createLumenSessionPages = () => {
  const sessions = new Map<string, Session>();
  const get = (payload: Record<string, unknown>): Session => {
    const key = `${readRuntimeSessionId(payload)}:${readLumenTargetMode(payload)}`;
    let state = sessions.get(key);
    if (!state) state = { pages: new Map(), refs: new Map(), texts: new Map(), responses: new Map() };
    sessions.delete(key);
    sessions.set(key, state);
    if (sessions.size > 128) sessions.delete(sessions.keys().next().value!);
    return state;
  };
  const prepare = (method: string, payload: Record<string, unknown>): Record<string, unknown> => {
    // navigate without an explicit destination tab opens another page. Do not
    // turn an implicit selection into permission to discard an existing form.
    if (method === "lyraLumen.navigate" && payload.newTab !== false) return payload;
    const state = get(payload);
    const refs = [payload.targetRef, payload.toTargetRef, payload.thenClick, payload.chooserId, payload.dialogId,
      ...(Array.isArray(payload.fields) ? payload.fields.map(field => isRecord(field) ? field.targetRef : undefined) : [])];
    const owners = new Set(refs.flatMap(ref => typeof ref === "string" && state.refs.has(ref) ? [state.refs.get(ref)!] : []));
    const explicit = readTabId(payload);
    if (owners.size > 1 || explicit !== null && [...owners].some(owner => owner !== explicit)) {
      throw new Error(`Targets belong to different tabs. Use each target in its mapped tab: ${[...owners].join(", ")}. No action was executed.`);
    }
    const selected = explicit ?? [...owners][0] ?? state.current;
    if (selected) state.current = selected;
    return selected ? { ...payload, tabId: selected } : payload;
  };
  const remember = (payload: Record<string, unknown>, result: Record<string, unknown>, method?: string) => {
    if (result.ok === false || result.notApplicable || typeof result.tabId !== "string") return;
    const state = get(payload), tabId = result.tabId;
    const previous = state.pages.get(tabId);
    const messageUrl = typeof result.message === "string"
      ? [...result.message.matchAll(/^Page: (https?:\/\/[^\s]+)/gm)].at(-1)?.[1] : undefined;
    const url = typeof result.url === "string" ? result.url : typeof result.address === "string" ? result.address : messageUrl;
    // Old refs keep their page identity. The live target registry, not this
    // routing table, decides whether the node survived navigation.
    state.current = tabId;
    if (["lyraLumen.act", "lyraLumen.type", "lyraLumen.press", "lyraLumen.upload", "lyraLumen.drag", "lyraLumen.dialog", "lyraLumen.reload", "lyraLumen.navigate"].includes(method ?? "")) state.responses.delete(tabId);
    if (previous?.url && url && previous.url !== url) state.responses.delete(tabId);
    if (isRecord(result.responseWatch) && typeof result.responseWatch.operationId === "string" && result.ok !== false) {
      state.responses.set(tabId, { operationId: result.responseWatch.operationId, startedAt: Date.now() });
    }
    const responseState = isRecord(result.waitState) && isRecord(result.waitState.response) ? result.waitState.response : undefined;
    if (responseState && ["complete", "unknown", "superseded"].includes(String(responseState.status))) state.responses.delete(tabId);
    const navigationFromUrl = ["lyraLumen.act", "lyraLumen.press", "lyraLumen.navigate", "lyraLumen.reload"].includes(method ?? "")
      && (result.navigationStarted === true || previous?.url && url && previous.url !== url) ? previous?.url : undefined;
    state.pages.set(tabId, { ...previous, tabId, navigationFromUrl, ...(url ? { url } : {}),
      ...(typeof result.title === "string" ? { title: result.title } : {}) });
    const text = [result.mapAppendix, result.message].filter(value => typeof value === "string").join("\n");
    for (const match of text.matchAll(/(?:\btargetRef[=:]|"targetRef":\s*")(lumen:[\w:-]+)/g)) state.refs.set(match[1]!, tabId);
    if (isRecord(result.dialog) && typeof result.dialog.id === "string") state.refs.set(result.dialog.id, tabId);
    if (isRecord(result.fileChooser) && typeof result.fileChooser.chooserId === "string") state.refs.set(result.fileChooser.chooserId, tabId);
    if (typeof result.targetRef === "string") state.refs.set(result.targetRef, tabId);
    if (Array.isArray(result.elements)) for (const element of result.elements) {
      if (isRecord(element) && typeof element.targetRef === "string") state.refs.set(element.targetRef, tabId);
    }
    while (state.refs.size > 8192) state.refs.delete(state.refs.keys().next().value!);
    // Page identity is not dropped merely because the task opened many tabs.
  };
  const current = (payload: Record<string, unknown>) => get(payload).current;
  const rememberText = (payload: Record<string, unknown>, tabId: string, content: string, maxChars?: number, scope: "viewport" | "full" = "viewport") => {
    const texts = get(payload).texts;
    const values = texts.get(tabId) ?? [];
    texts.delete(tabId);
    texts.set(tabId, [...values, { hash: textHash(content), maxChars: textLimit(maxChars), scope }].slice(-4));
    if (texts.size > 128) texts.delete(texts.keys().next().value!);
  };
  const requireTextBaseline = (payload: Record<string, unknown>, tabId: string, content: unknown, maxChars?: number, scope?: "viewport" | "full") => {
    const baseline = typeof content === "string" ? get(payload).texts.get(tabId)?.findLast(value =>
      value.hash === textHash(content) && (scope === undefined || value.scope === scope) && (maxChars === undefined || value.maxChars === textLimit(maxChars))) : undefined;
    if (!baseline) throw new Error("textChanged requires the exact, untruncated content from this task's earlier read(strategy=focus) of this tab, using the same scope and maxChars. A label or snippet cannot establish a change. Prefer textContains with the expected outcome. No wait was started.");
    return baseline;
  };
  const pages = (payload: Record<string, unknown>) => [...get(payload).pages.values()];
  const summary = (payload: Record<string, unknown>) => {
    const state = get(payload);
    if (!state.current) return "";
    const others = [...state.pages.values()].filter(page => page.tabId !== state.current).slice(-6);
    return `Task tab: ${state.current}. Foreground focus does not change this target.`
      + (others.length ? ` Other task tabs (last observed; map verifies availability): ${others.map(page => `${page.tabId} ${page.title || page.url || ""}`.slice(0, 180)).join("; ")}.` : "")
      + " navigate(url) opens another tab; pass tabId only to replace that tab. map(tabId) selects a preserved tab.";
  };
  const responseOperation = (payload: Record<string, unknown>, tabId: string) => {
    const state = get(payload).responses.get(tabId);
    return state && Date.now() - state.startedAt < 120000 ? state.operationId : undefined;
  };
  const navigationOrigin = (payload: Record<string, unknown>, tabId: string) => get(payload).pages.get(tabId)?.navigationFromUrl;
  return { prepare, remember, current, pages, summary, rememberText, requireTextBaseline, responseOperation, navigationOrigin };
};
import { createHash } from "node:crypto";
