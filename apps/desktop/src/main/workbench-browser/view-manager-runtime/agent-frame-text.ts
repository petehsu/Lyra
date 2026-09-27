import { createHash, randomUUID } from "node:crypto";
import { buildVisiblePageReadScript, VISIBLE_TEXT_RUNTIME } from "./agent-visible-text";
import { runFrameScriptWithTimeout } from "./normalizers";
import type { BrowserAgentPageTarget, BrowserAgentSemanticFrameGraph } from "./types";
import type { WorkbenchBrowserWaitState } from "../types";

type FrameReadResult = { text: string; unreadFrames?: number; truncated?: boolean; waitState?: WorkbenchBrowserWaitState };

export type BrowserFrameTextReader = (target: BrowserAgentPageTarget, scope: "viewport" | "full", limit: number, timeoutMs: number, tail?: boolean, textNeedle?: string) => Promise<{
  text: string; truncated: boolean; hasMore: boolean; waitState?: WorkbenchBrowserWaitState;
}>;
export type BrowserTextFrameGraphBuilder = (target: BrowserAgentPageTarget, timeoutMs: number) => Promise<BrowserAgentSemanticFrameGraph>;

/** Same-origin documents are read inline. Cross-origin frames use their own
 * Electron execution context, after checking their visible embedding chain.
 * Missing/ambiguous contexts remain explicitly partial, never successful empty
 * reads. No frame navigation, images, or application API requests are involved. */
export const createBrowserFrameTextReader = (buildFrameGraph?: BrowserTextFrameGraphBuilder): BrowserFrameTextReader => async (target, scope, limit, timeoutMs, tail = false, textNeedle) => {
  const deadline = Date.now() + timeoutMs;
  const token = randomUUID();
  const run = <T>(execute: () => Promise<T>) => runFrameScriptWithTimeout(execute, Math.max(1, deadline - Date.now())) as Promise<T>;
  const raw = await run(() => target.webContents.executeJavaScript(buildVisiblePageReadScript(scope, limit, undefined, token, undefined, tail, textNeedle), true));
  if (!raw || typeof raw.text !== "string") throw new Error("Browser text extraction returned an invalid text result");
  if (!raw.unreadFrames) return { ...raw, truncated: raw.truncated === true, hasMore: raw.truncated === true };
  const fingerprints = [raw.waitState?.textFingerprint];
  const chunks = [raw.text];
  let totalChars = raw.waitState?.coverage?.totalChars ?? raw.text.length;
  let unresolved = raw.unreadFrames, truncated = raw.truncated === true;
  if (buildFrameGraph) {
    try {
      const graph = await run(() => buildFrameGraph(target, Math.max(1, deadline - Date.now())));
      const frames = target.webContents.mainFrame.framesInSubtree;
      const visibility = new Map<number, boolean>();
      const clips = new Map<number, {left:number;top:number;right:number;bottom:number}>();
      visibility.set(target.webContents.mainFrame.frameTreeNodeId, true);
      const exposed = async (id: number): Promise<boolean> => {
        if (visibility.has(id)) return visibility.get(id)!;
        const descriptor = graph.framesByTreeNodeId.get(id);
        if (!descriptor?.ownerSelectorPreview || descriptor.parentFrameTreeNodeId === undefined) return false;
        const parentId = descriptor.parentFrameTreeNodeId;
        if (!await exposed(parentId)) return false;
        const parent = frames.find(frame => frame.frameTreeNodeId === parentId);
        if (!parent || parent.isDestroyed()) return false;
        const visible = await run(() => parent.executeJavaScript(`(() => {
          const visibleText = ${VISIBLE_TEXT_RUNTIME}; let matches = [];
          const scan = root => {
            try { matches.push(...root.querySelectorAll(${JSON.stringify(descriptor.ownerSelectorPreview)})); } catch {}
            for (const node of root.querySelectorAll('*')) if (node.shadowRoot) scan(node.shadowRoot);
          }; scan(document);
          if (matches.length > 1) {
            const byUrl = matches.filter(node => node.src === ${JSON.stringify(descriptor.url)});
            if (byUrl.length) matches = byUrl;
          }
          if (matches.length > 1) {
            const expected = ${JSON.stringify(descriptor.bounds ?? null)}, parent = ${JSON.stringify(graph.framesByTreeNodeId.get(parentId)?.bounds ?? null)};
            if (expected && parent) matches = matches.filter(node => {
              const box = node.getBoundingClientRect();
              return Math.abs(box.x-(expected.x-parent.x)) <= 2 && Math.abs(box.y-(expected.y-parent.y)) <= 2
                && Math.abs(box.width-expected.width) <= 2 && Math.abs(box.height-expected.height) <= 2;
            });
          }
          if (matches.length !== 1) return false;
          const node = matches[0], root = visibleText.focusRoot(document);
          if (${scope === "viewport"} && root !== document.body && !root.contains(node)) return false;
          return visibleText.frameClip(node, ${scope === "viewport"});
        })()`, false));
        if (visible && typeof visible === "object" && "left" in visible) {
          const clip = visible as {left:number;top:number;right:number;bottom:number};
          const box = descriptor.bounds, parentBox = graph.framesByTreeNodeId.get(parentId)?.bounds;
          const parentClip = clips.get(parentId);
          const mainBox = graph.frames.find(frame => frame.isMainFrame)?.bounds;
          if (scope === "viewport" && box && mainBox) {
            clip.left = Math.max(clip.left, -box.x); clip.top = Math.max(clip.top,-box.y);
            clip.right = Math.min(clip.right,mainBox.width-box.x); clip.bottom = Math.min(clip.bottom,mainBox.height-box.y);
            if (parentClip && parentBox) {
              clip.left = Math.max(clip.left,parentBox.x+parentClip.left-box.x); clip.top = Math.max(clip.top,parentBox.y+parentClip.top-box.y);
              clip.right = Math.min(clip.right,parentBox.x+parentClip.right-box.x); clip.bottom = Math.min(clip.bottom,parentBox.y+parentClip.bottom-box.y);
            }
          }
          clips.set(id,clip);
          const shown = clip.right > clip.left && clip.bottom > clip.top;
          visibility.set(id, shown); return shown;
        }
        visibility.set(id, false); return false;
      };
      for (const descriptor of graph.frames) {
        if (descriptor.isMainFrame) continue;
        if (Date.now() >= deadline) { truncated = true; break; }
        const frame = frames.find(candidate => candidate.frameTreeNodeId === descriptor.frameTreeNodeId);
        if (!frame || frame.isDestroyed() || !await exposed(descriptor.frameTreeNodeId)) continue;
        const result = await run(() => frame.executeJavaScript(`window.__lyraTextReadToken === ${JSON.stringify(token)} ? null : ${buildVisiblePageReadScript(scope, Math.max(160, limit - 100), undefined, token, clips.get(descriptor.frameTreeNodeId), tail, textNeedle)}`, false)) as FrameReadResult | null;
        if (result === null) continue;
        if (!result || typeof result.text !== "string") { truncated = true; continue; }
        unresolved = Math.max(0, unresolved - 1) + (result.unreadFrames ?? 0);
        truncated ||= result.truncated === true;
        fingerprints.push(result.waitState?.textFingerprint ? `${descriptor.frameTreeNodeId}:${result.waitState.textFingerprint}` : undefined);
        totalChars += result.waitState?.coverage?.totalChars ?? result.text.length;
        if (result.text) {
          const part = `[Frame ${descriptor.frameTreeNodeId}] ${result.text}`;
          chunks.push(part);
        }
        if (result.waitState?.textMatch) raw.waitState = { ...raw.waitState, textMatch: true };
        if (result.waitState?.busy) raw.waitState = { ...raw.waitState, busy: true };
        if (result.waitState?.readyState && result.waitState.readyState !== "complete") {
          raw.waitState = { ...raw.waitState, readyState: result.waitState.readyState };
        }
      }
    } catch { truncated = true; }
  }
  if (unresolved > 0) chunks.push(`[Partial page read: ${unresolved} embedded frame(s) unavailable or outside the read budget. Map the relevant frame to inspect its controls.]`);
  const joined = chunks.join("\n");
  const text = tail ? joined.slice(-limit) : joined.slice(0, limit);
  truncated ||= unresolved > 0 || joined.length > limit;
  const scanComplete = unresolved === 0 && fingerprints.every(value => value !== undefined);
  const { textFingerprint: _mainFingerprint, ...state } = raw.waitState ?? { readyState: "unknown", busy: false };
  return { text, truncated, hasMore: truncated, waitState: { ...state,
    ...(scanComplete ? { textFingerprint: createHash("sha256").update(fingerprints.join("\n")).digest("hex") } : {}),
    coverage: { scope, scanComplete, startChar: 0, totalChars, excerpt: "frameExcerpts" }
  } };

};
