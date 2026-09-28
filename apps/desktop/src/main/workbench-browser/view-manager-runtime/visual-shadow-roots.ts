import type { WorkbenchBrowserDebuggerSession } from "../types";

/** Share browser-owned closed roots with the existing DOM collector. The page
 * keeps its original shadow mode; refs still point to actual nodes. */
export const discoverVisualShadowRoots = async (
  session: WorkbenchBrowserDebuggerSession,
): Promise<void> => {
  type Node = {
    backendNodeId?: number;
    shadowRootType?: string;
    children?: Node[];
    shadowRoots?: Node[];
    contentDocument?: Node;
  };
  const result = (await session.sendCommand("DOM.getDocument", {
    depth: -1,
    pierce: true,
  })) as { root?: Node };
  const roots: number[] = [];
  const visit = (node: Node) => {
    if (node.shadowRootType === "closed" && node.backendNodeId)
      roots.push(node.backendNodeId);
    for (const child of [...(node.children ?? []), ...(node.shadowRoots ?? [])])
      visit(child);
    if (node.contentDocument) visit(node.contentDocument);
  };
  if (result.root) visit(result.root);
  for (const backendNodeId of roots) {
    const resolved = (await session.sendCommand("DOM.resolveNode", {
      backendNodeId,
    })) as { object?: { objectId?: string } };
    const objectId = resolved.object?.objectId;
    if (!objectId) continue;
    try {
      await session.sendCommand("Runtime.callFunctionOn", {
        objectId,
        returnByValue: true,
        functionDeclaration: `function() {
        const view=this.ownerDocument.defaultView;
        const roots=view.__lyraKnownShadowRoots ??= new Set();
        for(const weak of roots){const root=weak.deref();if(!root?.host?.isConnected)roots.delete(weak);else if(root===this)return;}
        roots.add(new WeakRef(this));
      }`,
      });
    } finally {
      await session
        .sendCommand("Runtime.releaseObject", { objectId })
        .catch(() => {});
    }
  }
};
