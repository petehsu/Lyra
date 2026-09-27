import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import { browserAgentOperationContext } from "../agent-operation-context";
import type { WorkbenchBrowserDebuggerSession, WorkbenchBrowserAgentModeRequest, WorkbenchBrowserAgentObservation } from "../types";
import type { BrowserAgentPageTarget } from "./types";
import { armFileReceipt, BrowserUploadError, callFileInput, finishFileReceipt, readFileInput, validateUploadFiles, type BrowserUploadRequest } from "./agent-file-input";

type Mode = "live" | "isolated";
type FrameTree = { frame?: { id?: string }; childFrames?: FrameTree[] };
type PageEvent = { frameId?: string; backendNodeId?: number; frame?: { id?: string; parentId?: string } };
type InputInfo = { connected: boolean; fileInput: boolean; disabled: boolean; multiple: boolean; directory: boolean; accept: string };
type Choice = {
  id: string; owner: string; tabId: string; mode: Mode; frameId: string; backendNodeId?: number;
  sessionId?: string; session: WorkbenchBrowserDebuggerSession; ready: Promise<void>;
  objectId?: string; info?: InputInfo; failure?: string; timer?: ReturnType<typeof setTimeout>;
  release: () => Promise<void>;
};
type Host = {
  resolveBrowserAgentTarget: (tabId: string, request: WorkbenchBrowserAgentModeRequest | undefined, timeoutMs: number | undefined) => Promise<BrowserAgentPageTarget>;
  openDebuggerSessionForTarget: (target: BrowserAgentPageTarget) => Promise<WorkbenchBrowserDebuggerSession>;
  assertSharedControlCanContinue: (tabId: string) => void;
  setPending: (tabId: string, mode: Mode, pending: boolean) => void;
  click: (tabId: string, targetRef: string, mode: Mode) => Promise<{ ok: boolean; error?: unknown }>;
  observe: (tabId: string, mode: Mode) => Promise<WorkbenchBrowserAgentObservation>;
};
const keyFor = (tabId: string, mode: Mode) => `${mode}:${tabId}`;
const owner = () => browserAgentOperationContext.getStore()?.sessionId ?? "";

/** File chooser interception is leased to an input action, never to diagnostics
 * or a whole agent turn. Pending choices retain the exact node, not a selector. */
export const createBrowserFileChooserController = (host: Host) => {
  let disposed = false;
  const inputContext = new AsyncLocalStorage<{ expired: boolean }>();
  const assertInputAllowed = () => {
    if (inputContext.getStore()?.expired) throw new BrowserUploadError("inputScopeExpired", "Browser input timed out before activation. No further input was sent; map the page before retrying.");
  };
  const pending = new Map<string, Choice>();
  const active = new Set<string>();
  const releases = new Set<() => Promise<void>>();
  const clear = (tabId: string, mode: Mode) => {
    const key = keyFor(tabId, mode), choice = pending.get(key);
    pending.delete(key); host.setPending(tabId, mode, false);
    if (choice) { clearTimeout(choice.timer); void choice.release(); }
  };
  const visibleChoice = (tabId: string, mode: Mode) => {
    const choice = pending.get(keyFor(tabId, mode));
    if (!choice || choice.owner !== owner()) return undefined;
    return { chooserId: choice.id, status: "awaitingFiles", multiple: choice.info?.multiple,
      accept: choice.info?.accept, supported: !!choice.objectId && !choice.failure,
      ...(choice.failure ? { message: choice.failure } : {}) };
  };
  const decorate = async <T extends object>(result: T, tabId: string, mode: Mode): Promise<T> => {
    const resolving = pending.get(keyFor(tabId, mode));
    if (resolving?.owner === owner()) await resolving.ready;
    const choice = visibleChoice(tabId, mode);
    if (!choice) return result;
    const note = choice.supported
      ? `File selection pending: browser_upload({chooserId:${JSON.stringify(choice.chooserId)},files:[absolute paths],effect:"upload"}). No system dialog is open; do not click the attachment button again.`
      : `File selection cannot be completed by browser_upload: ${choice.message ?? "unsupported picker"}.`;
    const value = result as Record<string, unknown>;
    return { ...result, fileChooser: choice, nextRecommendedAction: choice.supported ? "browser_upload" : "lyra_lumen.map",
      ...(Array.isArray(value.pageNotes) ? { pageNotes: [{ id: choice.chooserId, kind: "status", text: note }, ...value.pageNotes.filter(note => note?.id !== choice.chooserId)] } : {}),
      ...(typeof value.mapAppendix === "string" && !value.mapAppendix.includes(note) ? { mapAppendix: `${note}\n${value.mapAppendix}` } : {}),
      ...(typeof value.message === "string" && !value.message.includes(note) ? { message: `${value.message}\n${note}` } : {}) };
  };

  const capture = async <T extends object>(tabId: string, request: WorkbenchBrowserAgentModeRequest | undefined,
    action: () => Promise<T>, waitForChooserMs = 0): Promise<T> => {
    const mode = request?.targetMode ?? "live", key = keyFor(tabId, mode);
    if (disposed) throw new BrowserUploadError("browserClosed", "Browser controller has closed.");
    if (active.has(key)) throw new BrowserUploadError("browserActionBusy", "Another browser input is active on this tab. Wait for its result.");
    active.add(key);
    let session: WorkbenchBrowserDebuggerSession | undefined;
    let unsubscribe = () => {};
    let intercepting = false;
    const inputState = { expired: false };
    let fuse: ReturnType<typeof setTimeout> | undefined;
    const sessions: (string | undefined)[] = [undefined];
    let disabling: Promise<unknown> | undefined;
    const disable = () => {
      if (disabling) return disabling;
      if (!intercepting || !session) return Promise.resolve();
      intercepting = false;
      disabling = Promise.allSettled(sessions.map(id => session!.sendCommand("Page.setInterceptFileChooserDialog", { enabled: false }, id)));
      return disabling;
    };
    let releasing: Promise<void> | undefined;
    const release = (): Promise<void> => {
      if (releasing) return releasing;
      releasing = (async () => {
        inputState.expired = true; clearTimeout(fuse); unsubscribe();
        await disable();
        if (session) {
          if (received) {
            await received.ready;
            if (received.objectId) await session.sendCommand("Runtime.releaseObject", { objectId: received.objectId }, received.sessionId).catch(() => {});
          }
          await Promise.allSettled(sessions.filter((id): id is string => !!id).map(sessionId => session!.sendCommand("Target.detachFromTarget", { sessionId })));
          await session.close().catch(() => {});
        }
        releases.delete(release);
      })();
      return releasing;
    };
    let received: Choice | undefined;
    let wake = () => {};
    const opened = new Promise<void>(resolve => { wake = resolve; });
    try {
      const target = await host.resolveBrowserAgentTarget(tabId, request, undefined);
      if (mode === "live") host.assertSharedControlCanContinue(tabId);
      session = await host.openDebuggerSessionForTarget(target);
      releases.add(release);
      if (disposed) throw new BrowserUploadError("browserClosed", "Browser controller has closed.");
      const actionOwner = owner();
      unsubscribe = session.subscribe(event => {
        if (event.kind === "detached") { clear(tabId, mode); return; }
        if (event.kind !== "message") return;
        const params = event.params as PageEvent;
        if ((event.method === "Page.frameNavigated" && ((!event.sessionId && !params.frame?.parentId) || params.frame?.id === pending.get(key)?.frameId))
          || (event.method === "Page.frameDetached" && params.frameId === pending.get(key)?.frameId)) {
          clear(tabId, mode); return;
        }
        if (event.method !== "Page.fileChooserOpened" || !intercepting) return;
        clear(tabId, mode);
        const choice: Choice = { id: `chooser:${randomUUID()}`, owner: actionOwner, tabId, mode,
          frameId: String(params.frameId), ...(typeof params.backendNodeId === "number" ? { backendNodeId: params.backendNodeId } : {}),
          ...(event.sessionId ? { sessionId: event.sessionId } : {}), session: session!, ready: Promise.resolve(), release };
        received = choice; pending.set(key, choice); host.setPending(tabId, mode, true);
        choice.timer = setTimeout(() => { if (pending.get(key) === choice) clear(tabId, mode); }, 120_000);
        choice.timer.unref();
        choice.ready = (async () => {
          if (!choice.backendNodeId) throw new Error("This picker has no HTML file input; native filesystem picker APIs are not supported.");
          const resolved = await session!.sendCommand("DOM.resolveNode", { backendNodeId: choice.backendNodeId }, choice.sessionId);
          const objectId = (resolved.object as { objectId?: string })?.objectId;
          if (objectId) choice.objectId = objectId;
          if (!choice.objectId) throw new Error("The page removed its upload control.");
          choice.info = await callFileInput<InputInfo>(session!, choice.objectId, choice.sessionId, readFileInput);
        })().catch(error => { choice.failure = String(error instanceof Error ? error.message : error); });
        wake();
        // The event identifies the node. Do not suppress human clicks while
        // the model decides which files to supply on a subsequent turn.
        void disable();
      });
      await session.sendCommand("Page.enable");
      // Match OOPIF targets by frame identity, never by a coincidentally equal URL.
      const tree = await session.sendCommand("Page.getFrameTree");
      const frameIds = new Set<string>();
      const visit = (node: FrameTree | undefined) => { if (node?.frame?.id) frameIds.add(node.frame.id); for (const child of node?.childFrames ?? []) visit(child); };
      visit(tree.frameTree as FrameTree | undefined);
      const targets = await session.sendCommand("Target.getTargets");
      const infos = (targets.targetInfos ?? []) as { type: string; targetId: string; parentFrameId?: string; parentId?: string }[];
      // Page.getFrameTree excludes OOPIFs in current Chromium. Reconstruct only
      // this page's descendants from protocol parent IDs, never URL similarity.
      let expanded = true;
      while (expanded) {
        expanded = false;
        for (const info of infos) {
          if (info.type === "iframe" && !frameIds.has(info.targetId)
            && (frameIds.has(info.parentFrameId ?? "") || frameIds.has(info.parentId ?? ""))) {
            frameIds.add(info.targetId); expanded = true;
          }
        }
      }
      for (const info of infos) {
        if (info.type !== "iframe" || !frameIds.has(info.targetId)) continue;
        const attached = await session.sendCommand("Target.attachToTarget", { targetId: info.targetId, flatten: true });
        const id = String(attached.sessionId); sessions.push(id); await session.sendCommand("Page.enable", {}, id);
      }
      intercepting = true;
      await Promise.all(sessions.map(id => session!.sendCommand("Page.setInterceptFileChooserDialog", { enabled: true }, id)));
      // A stalled host operation must not leave native dialogs disabled.
      fuse = setTimeout(() => { inputState.expired = true; void disable(); }, 8_000); fuse.unref();
      const result = await inputContext.run(inputState, action);
      if (waitForChooserMs && !received && (result as { ok?: boolean }).ok !== false) {
        let timer: ReturnType<typeof setTimeout> | undefined;
        try { await Promise.race([opened, new Promise<void>(resolve => { timer = setTimeout(resolve, waitForChooserMs); })]); }
        finally { clearTimeout(timer); }
      }
      if (received) await received.ready;
      return decorate(result, tabId, mode);
    } finally {
      clearTimeout(fuse);
      try {
        await disable();
        if (!received || pending.get(key) !== received) await release();
      } finally { active.delete(key); }
    }
  };

  const upload = async (tabId: string, request: BrowserUploadRequest): Promise<Record<string, unknown>> => {
    const mode = request.targetMode ?? "live", key = keyFor(tabId, mode);
    let dispatched = false;
    try {
      if (request.effect !== "upload") throw new BrowserUploadError("invalidEffect", "File selection can transmit data immediately; effect must be upload.");
      const files = await validateUploadFiles(request.files);
      if (request.targetRef && request.chooserId) throw new BrowserUploadError("ambiguousUploadTarget", "Use an attachment targetRef OR an existing chooserId, not both.");
      if (request.targetRef) {
        // A fresh attachment click must never fall back to a previous input.
        const previous = pending.get(key);
        clear(tabId, mode);
        if (previous) await previous.release();
        const clicked = await capture(tabId, request, () => host.click(tabId, request.targetRef!, mode), 1_500);
        if (!clicked.ok) return clicked as Record<string, unknown>;
      }
      const choice = pending.get(key);
      if (!choice || choice.owner !== owner() || (request.chooserId && choice.id !== request.chooserId)) {
        throw new BrowserUploadError("fileChooserUnavailable", "No matching file selection is pending for this task and tab. Map the attachment control, then upload with its targetRef.");
      }
      await choice.ready;
      if (!choice.objectId || choice.failure) throw new BrowserUploadError("unsupportedFileChooser", choice.failure ?? "This picker is not an HTML file input.");
      if (mode === "live") host.assertSharedControlCanContinue(tabId);
      const info = await callFileInput<InputInfo>(choice.session, choice.objectId, choice.sessionId, readFileInput);
      if (!info.connected || !info.fileInput) { clear(tabId, mode); throw new BrowserUploadError("fileInputChanged", "The original upload control was removed. Map the page before retrying."); }
      if (info.disabled) throw new BrowserUploadError("fileInputDisabled", "The upload control is disabled or inert.");
      if (info.directory) throw new BrowserUploadError("directoryPicker", "This control selects a folder; individual file uploads cannot complete it.");
      if (!info.multiple && files.length > 1) throw new BrowserUploadError("multipleFilesNotAllowed", "This control accepts one file. No files were selected.");
      const receiptKey = `__lyraFiles_${randomUUID()}`;
      // Claim synchronously before any further await; a racing/replayed call
      // must neither dispatch twice nor release the winning call's node handle.
      if (pending.get(key) !== choice) throw new BrowserUploadError("fileInputChanged", "The page changed or this selection was already consumed.");
      pending.delete(key); host.setPending(tabId, mode, false); clearTimeout(choice.timer);
      let receipt: { connected: boolean; files: { name: string; size: number }[] } | undefined;
      try {
        await callFileInput(choice.session, choice.objectId, choice.sessionId, armFileReceipt, [receiptKey]);
        if (mode === "live") host.assertSharedControlCanContinue(tabId);
        dispatched = true;
        await choice.session.sendCommand("DOM.setFileInputFiles", { objectId: choice.objectId, files: files.map(file => file.path) }, choice.sessionId);
      } finally {
        receipt = await callFileInput<typeof receipt>(choice.session, choice.objectId, choice.sessionId, finishFileReceipt, [receiptKey]).catch(() => undefined);
        if (pending.get(key) === choice) clear(tabId, mode);
        await choice.release();
      }
      const verified = receipt?.files.length === files.length && files.every((file, i) => receipt?.files[i]?.name === file.name && receipt.files[i]?.size === file.size);
      const map = await host.observe(tabId, mode).catch(() => undefined);
      return { ok: verified, kind: "lyraLumenUploadResult", tabId, targetMode: mode, status: verified ? "filesSelected" : "selectionUnconfirmed",
        files: files.map(({ name, size }) => ({ name, size })), selectionVerified: verified, uploadCompletion: "notVerified",
        ...(map ? { mapAppendix: map.mapAppendix, url: map.url, afterObservationId: map.observationId } : {}),
        message: verified ? "Files were selected in the webpage without opening a system dialog. Check the returned page for attachment/progress/error status before claiming upload completion."
          : "File selection was dispatched but the page changed before it could be verified. Inspect the page; do not automatically repeat the upload.",
        nextRecommendedAction: "lyra_lumen.map" };
    } catch (error) {
      if (error && typeof error === "object" && "handoff" in error) throw error;
      return { ok: false, kind: "lyraLumenUploadResult", tabId, targetMode: mode, status: dispatched ? "selectionUnconfirmed" : "notSelected",
        error: { kind: error instanceof BrowserUploadError ? error.kind : "uploadFailed", message: String(error instanceof Error ? error.message : error) },
        ...(dispatched ? { message: "Selection may have reached the page. Inspect its attachment state before retrying." } : {}), nextRecommendedAction: "lyra_lumen.map" };
    }
  };
  const dispose = () => { disposed = true; for (const choice of pending.values()) clear(choice.tabId, choice.mode); for (const release of releases) void release(); };
  return { capture, upload, decorate, clear, dispose, assertInputAllowed };
};
