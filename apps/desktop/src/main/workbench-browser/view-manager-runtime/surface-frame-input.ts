import type { WebFrameMain } from "electron";
import { INSTALL_POINTER_GUARD, FINISH_POINTER_GUARD, type PointerReceipt } from "./bound-pointer";

/** Translate a point from its owning execution context through live iframe
 * owners. Frame order identifies contentWindow; URLs never identify a target. */
export const createSurfaceFrameInput = (frame: WebFrameMain) => {
  const guarded = new Set<WebFrameMain>();
  const revealOwners = async () => {
    for (let child = frame; child.parent; child = child.parent) {
      const parent = child.parent;
      const index = parent.frames.findIndex(candidate => candidate.frameTreeNodeId === child.frameTreeNodeId);
      if (index < 0 || child.isDestroyed()) return;
      await parent.executeJavaScript(`(() => {
        const find = root => {
          for (const node of root.querySelectorAll('*')) {
            if ((node.tagName === 'IFRAME' || node.tagName === 'FRAME') && node.contentWindow === window.frames[${index}]) return node;
            if (node.shadowRoot) { const found = find(node.shadowRoot); if (found) return found; }
          }
        };
        find(document)?.scrollIntoView({block:'nearest',inline:'nearest',behavior:'instant'});
      })()`, true);
    }
  };
  const translate = async (point: { x: number; y: number }, token?: string) => {
    let child = frame;
    while (child.parent) {
      const parent = child.parent;
      const index = parent.frames.findIndex(candidate => candidate.frameTreeNodeId === child.frameTreeNodeId);
      if (index < 0 || child.isDestroyed()) return null;
      const result = await parent.executeJavaScript(`(() => {
        const find = root => {
          for (const node of root.querySelectorAll('*')) {
            if ((node.tagName === 'IFRAME' || node.tagName === 'FRAME') && node.contentWindow === window.frames[${index}]) return node;
            if (node.shadowRoot) { const found = find(node.shadowRoot); if (found) return found; }
          }
          return null;
        };
        const node = find(document); if (!node || node.closest('[inert]')) return null;
        const box = node.getBoundingClientRect();
        if (!node.offsetWidth || !node.offsetHeight) return null;
        const x = box.left + (${point.x} + node.clientLeft) * box.width / node.offsetWidth;
        const y = box.top + (${point.y} + node.clientTop) * box.height / node.offsetHeight;
        let hit = document.elementFromPoint(x,y);
        while (hit?.shadowRoot?.elementFromPoint) {
          const inner = hit.shadowRoot.elementFromPoint(x,y); if (!inner || inner === hit) break; hit = inner;
        }
        if (hit !== node) return null;
        ${token ? `(${INSTALL_POINTER_GUARD}).call(node, ${JSON.stringify(token)});` : ""}
        return {x:Math.round(x),y:Math.round(y)};
      })()`, true).catch(() => null) as { x: number; y: number } | null;
      if (token) guarded.add(parent);
      if (!result || child.isDestroyed() || parent.frames[index]?.frameTreeNodeId !== child.frameTreeNodeId) return null;
      point = result; child = parent;
    }
    return point;
  };
  const finish = async (token: string) => {
    const receipts = await Promise.all([...guarded].map(parent => parent.executeJavaScript(
      `(${FINISH_POINTER_GUARD})(${JSON.stringify(token)})`, true
    ).catch(() => null) as Promise<PointerReceipt | null>));
    guarded.clear();
    return receipts.some(receipt => receipt?.blocked);
  };
  return { translate, finish, revealOwners };
};
