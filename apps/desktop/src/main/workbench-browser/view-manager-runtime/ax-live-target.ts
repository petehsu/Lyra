import { randomUUID } from "node:crypto";
import { BoundPointerError, dispatchBoundPointer, INSTALL_POINTER_GUARD, FINISH_POINTER_GUARD } from "./bound-pointer";
import type { BrowserAxNode, WorkbenchBrowserDebuggerSession, WorkbenchBrowserAxInteraction } from "../types";
import { coerceAxBounds, isRecord } from "./ax-controller-support";

// A retained AX ref identifies a node, never permission to reuse snapshot pixels.
// Resolve it immediately before input. Focus must be observed, not just attempted.
const prepareNode = `async function(interaction) {
  if (!this.isConnected) return { reason: 'detached' };
  const view = this.ownerDocument.defaultView;
  const style = view.getComputedStyle(this);
  if (style.visibility === 'hidden' || style.display === 'none' || !this.getClientRects().length) return { reason: 'hidden' };
  this.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'instant' });
  // Reveal before reading enablement: visibility observers may enable the
  // control only after scrolling. Allow those observers one rendering cycle.
  await new Promise(resolve => setTimeout(resolve, 32));
  if (interaction === 'focus') {
    if (this.matches(':disabled') || this.closest('[aria-disabled="true"], [inert]')) return { reason: 'disabled' };
    this.focus?.({ preventScroll: true });
    return this.getRootNode().activeElement === this ? { focused: true } : { reason: 'notFocusable' };
  }
  let previous = '';
  for (let attempt = 0; attempt < 12; attempt++) {
    if (!this.isConnected) return { reason: 'detached' };
    if (interaction !== 'hover' && (this.matches(':disabled') || this.closest('[aria-disabled="true"], [inert]'))) return { reason: 'disabled' };
    const r = this.getBoundingClientRect();
    const bounds = { x: r.x, y: r.y, width: r.width, height: r.height };
    const signature = JSON.stringify(bounds);
    if (signature === previous && r.width > 0 && r.height > 0) {
      for (const [rx, ry] of [[.5,.5],[.2,.2],[.8,.2],[.2,.8],[.8,.8]]) {
        const x = r.x + r.width * rx, y = r.y + r.height * ry;
        const root = this.getRootNode();
        let hit = root.elementFromPoint?.(x, y) ?? this.ownerDocument.elementFromPoint(x, y);
        while (hit?.shadowRoot?.elementFromPoint) {
          const inner = hit.shadowRoot.elementFromPoint(x, y);
          if (!inner || inner === hit) break;
          hit = inner;
        }
        if (hit === this || (hit && this.contains(hit))) {
          let dx = 0, dy = 0, owner = view;
          while (owner.frameElement) {
            const frame = owner.frameElement, box = frame.getBoundingClientRect();
            dx += box.x + frame.clientLeft; dy += box.y + frame.clientTop;
            const root = frame.getRootNode();
            const outerHit = root.elementFromPoint?.(x + dx, y + dy);
            if (outerHit !== frame) return { reason: 'coveredFrame' };
            owner = frame.ownerDocument.defaultView;
          }
          return { bounds: { ...bounds, x: bounds.x + dx, y: bounds.y + dy }, point: { x: x + dx, y: y + dy } };
        }
      }
      return { reason: 'covered' };
    }
    previous = signature;
    await new Promise(resolve => setTimeout(resolve, 16));
  }
  return { reason: 'moving' };
}`;

type LiveAxTarget = {
  reason?: string;
  focused?: boolean;
  bounds?: { x: number; y: number; width: number; height: number };
  point?: { x: number; y: number };
  dispatched?: boolean;
  inputDelivery?: "targetReceived" | "unconfirmed";
};

export const prepareLiveAxTarget = async (
  session: WorkbenchBrowserDebuggerSession,
  node: BrowserAxNode,
  interaction: WorkbenchBrowserAxInteraction,
  offset = { x: 0, y: 0 },
  pointer?: { send: (event: Electron.MouseInputEvent) => void; check: () => void }
): Promise<LiveAxTarget> => {
  let sessionId: string | undefined;
  let objectId: string | undefined;
  try {
    if (node.backendDOMNodeId === undefined) return { reason: "missingDomBinding" };
    if (node.cdpTargetId !== undefined) {
      const attached = await session.sendCommand("Target.attachToTarget", { targetId: node.cdpTargetId, flatten: true });
      if (!isRecord(attached) || typeof attached.sessionId !== "string") return { reason: "missingFrame" };
      sessionId = attached.sessionId;
    }
    const resolved = await session.sendCommand("DOM.resolveNode", { backendNodeId: node.backendDOMNodeId }, sessionId);
    if (!isRecord(resolved) || !isRecord(resolved.object) || typeof resolved.object.objectId !== "string") return { reason: "detached" };
    objectId = resolved.object.objectId;
    const token = randomUUID();
    const call = async (functionDeclaration: string, value: string) => {
      const result = await session.sendCommand("Runtime.callFunctionOn", {
        objectId, functionDeclaration, arguments: [{ value }], returnByValue: true, awaitPromise: true
      }, sessionId);
      return isRecord(result) && isRecord(result.result) ? result.result.value : undefined;
    };
    const prepare = async (): Promise<LiveAxTarget> => {
      pointer?.check();
      const value = await call(prepareNode, interaction);
      if (!isRecord(value)) return { reason: "unavailable" };
      if (value.focused === true) return { focused: true };
      const bounds = coerceAxBounds(value.bounds);
      if (!bounds || !isRecord(value.point) || typeof value.point.x !== "number" || typeof value.point.y !== "number"
        || !Number.isFinite(value.point.x) || !Number.isFinite(value.point.y)) {
        return { reason: typeof value.reason === "string" ? value.reason : "unavailable" };
      }
      return {
        bounds: { ...bounds, x: bounds.x + offset.x, y: bounds.y + offset.y },
        point: { x: Math.round(value.point.x + offset.x), y: Math.round(value.point.y + offset.y) }
      };
    };
    if (!pointer || interaction === "focus" || interaction === "hover") return await prepare();
    let prepared: Awaited<ReturnType<typeof prepare>> = {};
    let receipt: unknown;
    try {
      await dispatchBoundPointer({ interaction: "click", send: pointer.send, prepare: async () => {
        prepared = await prepare();
        if (!prepared.point) return null;
        if (await call(INSTALL_POINTER_GUARD, token) !== true) return null;
        return prepared.point;
      } });
    } finally {
      receipt = await call(FINISH_POINTER_GUARD, token).catch(() => null);
    }
    if (isRecord(receipt) && (receipt.blocked || !receipt.accepted)) {
      return { reason: receipt.accepted ? "partialGestureInspectOutcome" : "activationNotDelivered" };
    }
    return { ...prepared, dispatched: true, inputDelivery: isRecord(receipt) && receipt.accepted === true ? "targetReceived" : "unconfirmed" };
  } catch (error) {
    if (error instanceof BoundPointerError) return { reason: error.message };
    return { reason: "unavailable" };
  } finally {
    if (objectId !== undefined) await session.sendCommand("Runtime.releaseObject", { objectId }, sessionId).catch(() => undefined);
    if (sessionId !== undefined) await session.sendCommand("Target.detachFromTarget", { sessionId }).catch(() => undefined);
  }
};
