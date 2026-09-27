/** Shared by injected readers and input dispatch: a ref names an actual node,
 * never its ordinal in a freshly queried list or the node under an old box. */
export const SURFACE_TARGET_LOOKUP = `
  const findSurfaceTarget = (ref, root = document) => {
    const registry = window.__lyraSurfaceNodeRegistry;
    const indexed = registry?.byRef?.get(ref)?.deref();
    if (indexed?.isConnected && registry.nodes.get(indexed) === ref
      && (root === document || root.contains(indexed))) return indexed;
    if (registry?.byRef?.has(ref) && !indexed?.isConnected) registry.byRef.delete(ref);
    for (const node of root.querySelectorAll("[data-lyra-surface]")) {
      if (node.getAttribute("data-lyra-surface") !== ref) continue;
      const registries = [window.__lyraSurfaceNodeRegistry, node.ownerDocument.defaultView?.__lyraSurfaceNodeRegistry].filter(Boolean);
      // A framework clone may copy attributes. Only the original collected
      // node owns the ref; cloned markup is not another authorized target.
      if (registries.length && !registries.some(registry => registry.nodes.get(node) === ref)) continue;
      return node;
    }
    for (const host of root.querySelectorAll("*")) {
      if (host.shadowRoot) {
        const found = findSurfaceTarget(ref, host.shadowRoot);
        if (found) return found;
      }
      if (host.tagName === "IFRAME" || host.tagName === "FRAME") {
        try {
          if (host.contentDocument) {
            const found = findSurfaceTarget(ref, host.contentDocument);
            if (found) return found;
          }
        } catch (_) { /* Cross-origin frames require their own execution context. */ }
      }
    }
    return null;
  };
  const surfaceGlobalRect = (node) => {
    const rect = node.getBoundingClientRect();
    let x = rect.left, y = rect.top;
    let view = node.ownerDocument.defaultView;
    while (view && view !== window) {
      const frame = view.frameElement;
      if (!frame) break;
      const box = frame.getBoundingClientRect();
      x += box.left + frame.clientLeft; y += box.top + frame.clientTop;
      view = frame.ownerDocument.defaultView;
    }
    return { x, y, width: rect.width, height: rect.height };
  };
`;
