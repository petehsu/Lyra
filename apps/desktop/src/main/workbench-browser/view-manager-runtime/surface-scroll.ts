import { SURFACE_TARGET_LOOKUP } from "./surface-target";

// Track the scroll chain under the pointer, including shadow roots and local
// frames. A stationary document does not imply a stationary page surface.
const SCROLL_CHAIN = `
  const scrollParent = node => node.parentElement || node.getRootNode()?.host
    || node.ownerDocument?.defaultView?.frameElement;
  const chainFor = node => {
    const chain = [];
    for (let current = node; current; current = scrollParent(current)) {
      if (current.scrollHeight > current.clientHeight || current.scrollWidth > current.clientWidth)
        chain.push(current);
    }
    const root = document.scrollingElement;
    if (root && !chain.includes(root)) chain.push(root);
    return chain;
  };
  const pointNode = (root, x, y) => {
    let node = root.elementFromPoint(x, y);
    if (node?.shadowRoot) node = pointNode(node.shadowRoot, x, y) || node;
    try {
      if (node?.contentDocument) {
        const box = node.getBoundingClientRect();
        node = pointNode(node.contentDocument, x - box.left - node.clientLeft, y - box.top - node.clientTop) || node;
      }
    } catch (_) {}
    return node;
  };
`;

export const beginSurfaceScrollScript = (token: string, point: { x: number; y: number }): string => `(() => {
  ${SCROLL_CHAIN}
  const store = window.__lyraScrollProbes ??= new Map();
  for (const [key, value] of store) { value.dispose(); store.delete(key); }
  const chain = chainFor(pointNode(document, ${point.x}, ${point.y}));
  const entries = chain.map(node => ({ node, x: node.scrollLeft, y: node.scrollTop }));
  let wheel = null;
  const handler = event => { wheel = event; };
  const views = [...new Set(chain.map(node => node.ownerDocument.defaultView))];
  for (const view of views) view.addEventListener('wheel', handler, { capture: true, passive: true });
  store.set(${JSON.stringify(token)}, { entries, get wheel() { return wheel; },
    dispose: () => { for (const view of views) view.removeEventListener('wheel', handler, true); } });
})()`;

export const finishSurfaceScrollScript = (token: string, deltaX: number, deltaY: number): string => `(() => {
  const store = window.__lyraScrollProbes, probe = store?.get(${JSON.stringify(token)});
  if (!probe) return { deltaX: 0, deltaY: 0, method: 'none' };
  try {
    const movement = () => probe.entries.reduce((sum, {node,x,y}) => ({
      deltaX: sum.deltaX + node.scrollLeft - x, deltaY: sum.deltaY + node.scrollTop - y
    }), { deltaX: 0, deltaY: 0 });
    let change = movement(), method = 'wheel';
    if (!change.deltaX && !change.deltaY && !probe.wheel?.defaultPrevented) {
      method = 'none';
      // Apply only to the first scrollable ancestor that can consume each
      // axis. Never fall through a scroll boundary with overscroll containment.
      for (const [axis, amount] of [['x', ${deltaX}], ['y', ${deltaY}]]) {
        if (!amount) continue;
        for (const {node} of probe.entries) {
          const style = node.ownerDocument.defaultView.getComputedStyle(node);
          const root = node === node.ownerDocument.scrollingElement;
          const overflow = axis === 'y' ? style.overflowY : style.overflowX;
          if (!root && !/^(auto|scroll|overlay)$/.test(overflow)) continue;
          const before = axis === 'y' ? node.scrollTop : node.scrollLeft;
          node.scrollBy({ left: axis === 'x' ? amount : 0, top: axis === 'y' ? amount : 0, behavior: 'instant' });
          if ((axis === 'y' ? node.scrollTop : node.scrollLeft) !== before) {
            method = root ? 'scrollBy' : 'containerScroll'; break;
          }
          const overscroll = axis === 'y' ? style.overscrollBehaviorY : style.overscrollBehaviorX;
          if (overscroll === 'contain' || overscroll === 'none') break;
        }
      }
      change = movement();
    }
    return { ...change, method: change.deltaX || change.deltaY ? method : 'none' };
  } finally { probe.dispose(); store.delete(${JSON.stringify(token)}); }
})()`;

export const revealSurfaceTargetScript = (ref: string, block = "center"): string => `(() => {
  ${SURFACE_TARGET_LOOKUP}
  const node = findSurfaceTarget(${JSON.stringify(ref)});
  if (!node) return null;
  const before = surfaceGlobalRect(node);
  // Chromium scrollIntoView walks clipping ancestors, including shadow roots.
  // Do not move a target that is already fully exposed to pointer input.
  const reveal = element => {
    const rect = element.getBoundingClientRect(), doc = element.ownerDocument;
    const x = rect.left + rect.width / 2, y = rect.top + rect.height / 2;
    const root = element.getRootNode();
    const hit = root.elementFromPoint?.(x,y) ?? doc.elementFromPoint(x,y);
    if (rect.top >= 0 && rect.left >= 0 && rect.bottom <= doc.defaultView.innerHeight
      && rect.right <= doc.defaultView.innerWidth && (hit === element || element.contains(hit))) return;
    element.scrollIntoView({ block: ${JSON.stringify(block)}, inline: 'nearest', behavior: 'instant' });
  };
  reveal(node);
  for (let view = node.ownerDocument.defaultView; view && view !== window && view.frameElement;) {
    reveal(view.frameElement); view = view.frameElement.ownerDocument.defaultView;
  }
  return { before, after: surfaceGlobalRect(node) };
})()`;
