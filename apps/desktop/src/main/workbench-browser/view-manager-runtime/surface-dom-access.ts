/** Resolve through owned shadow roots while checking every outer hit-test.
 * Holding a closed root is not permission to click through an overlay. */
export const SURFACE_DOM_ACCESS = String.raw`
  const surfaceHitForNode = (node, x, y) => {
    let hit = node.ownerDocument.elementFromPoint(x,y);
    const roots=[];
    for(let root=node.getRootNode();root.host;root=root.host.getRootNode())roots.unshift(root);
    for(const root of roots) {
      if(hit!==root.host)return hit;
      hit=root.elementFromPoint?.(x,y)??hit;
    }
    while(hit?.shadowRoot?.elementFromPoint) {
      const inner=hit.shadowRoot.elementFromPoint(x,y);if(!inner||inner===hit)break;hit=inner;
    }
    return hit;
  };
  const surfaceActiveElement = doc => {
    let node=doc.activeElement;
    for(;;) {
      let root=node?.shadowRoot;
      if(!root)for(const weak of doc.defaultView?.__lyraKnownShadowRoots??[]) {
        const candidate=weak.deref();if(candidate?.host===node){root=candidate;break;}
      }
      const inner=root?.activeElement||node?.contentDocument?.activeElement;
      if(!inner||inner===node)return node;
      node=inner;doc=node.ownerDocument;
    }
  };
`;
