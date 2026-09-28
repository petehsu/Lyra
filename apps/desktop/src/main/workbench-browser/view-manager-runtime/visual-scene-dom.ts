import { SURFACE_DOM_ACCESS } from "./surface-dom-access";
import { SURFACE_TARGET_LOOKUP } from "./surface-target";
import { READ_RENDER_STATE } from "./visual-render-state";
import { GROUP_VISUAL_GRIDS } from "./visual-grid-dom";

// No hover sweep, no application API/state inspection. Regions are DOM surfaces,
// not invented objects inside a canvas. The map and visual view share node refs.
export const VISUAL_DOCUMENT = `(() => {
  const state = window.__lyraVisualDocument;
  if (state?.document === document) return state.id + ':' + location.href;
  const id = crypto.randomUUID?.() ?? Date.now().toString(36)+Math.random().toString(36); window.__lyraVisualDocument = {document,id};
  return id + ':' + location.href;
})()`;

export const VISUAL_SIGNATURE = `(node, spatial = false) => {
  const editable = node.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(node.tagName);
  const row = node.closest('[role="row"],tr,li,[data-item-id],[data-row-key]');
  return JSON.stringify([node.tagName,node.id,node.getAttribute('role'),node.getAttribute('aria-label'),
    node.getAttribute('href'),node.getAttribute('title'),
    spatial === true || editable || /^(CANVAS|SVG)$/.test(node.tagName.toUpperCase()) ? '' : (node.textContent || '').trim().slice(0,160),
    row ? [row.getAttribute('data-item-id'),row.getAttribute('data-row-key'),spatial ? '' : (row.textContent || '').trim().slice(0,200)] : null]);
}`;

export const collectVisualNodes = (refs: readonly string[]) => `(() => {
  ${SURFACE_TARGET_LOOKUP}
  ${SURFACE_DOM_ACCESS}
  const documentId = ${VISUAL_DOCUMENT};
  const signature = ${VISUAL_SIGNATURE};
  const renderState = ${READ_RENDER_STATE};
  const registry = window.__lyraSurfaceNodeRegistry ??= {nodes:new WeakMap(),byRef:new Map(),serial:0,prefix:(crypto.randomUUID?.()??Math.random().toString(36)).slice(0,8)};
  registry.byRef ??= new Map();
  const stamp=node=>{
    let ref=registry.nodes.get(node);
    if(!ref) {ref='surface:'+registry.prefix+':'+(++registry.serial);registry.nodes.set(node,ref);}
    registry.byRef.set(ref,new WeakRef(node)); return ref;
  };
  const nodes = new Map();
  for (const ref of ${JSON.stringify(refs)}) {const node=findSurfaceTarget(ref);if(node) nodes.set(node,ref);}
  const regions = new Set();
  const occluders = new Set();
  const owned = node => {for(let n=node;n;n=n.parentElement||n.getRootNode()?.host)if(n.id==='__lyra_agent_page_cursor__'||n.hasAttribute?.('data-lyra-agent-overlay'))return true;return false;};
  const addOccluder = node => {
    if(!node||owned(node)||node===document.body||node===document.documentElement||nodes.has(node))return;
    const b=node.getBoundingClientRect(),s=getComputedStyle(node);
    if(!b.width||!b.height||s.visibility==='hidden'||s.display==='none')return;
    nodes.set(node,stamp(node));regions.add(node);occluders.add(node);
  };
  const scan = root => {
    for (const node of root.querySelectorAll('canvas,svg,[role="application"]')) {
      if (owned(node) || (node.tagName.toLowerCase()==='svg' && node.closest('button,a,[role="button"]'))) continue;
      const r=node.getBoundingClientRect(); if(r.width<32 || r.height<32) continue;
      regions.add(node);
      let ref=registry.nodes.get(node);
      if(!ref) {ref='surface:'+registry.prefix+':'+(++registry.serial);registry.nodes.set(node,ref);registry.byRef.set(ref,new WeakRef(node));}
      nodes.set(node,ref);
    }
    for(const node of root.querySelectorAll('*')) if(node.shadowRoot&&!owned(node)) scan(node.shadowRoot);
  };
  scan(document);
  for(const weak of window.__lyraKnownShadowRoots??[]) {const root=weak.deref();if(root?.host?.isConnected)scan(root);}
  const result=[];
  for(const [node,targetRef] of nodes) {
    if(owned(node))continue;
    const box=node.getBoundingClientRect(), style=getComputedStyle(node);
    if(!node.isConnected || !box.width || !box.height || style.visibility==='hidden' || style.display==='none' || (regions.has(node) && +style.opacity===0)) continue;
    const x0=Math.max(0,box.left),y0=Math.max(0,box.top),x1=Math.min(innerWidth,box.right),y1=Math.min(innerHeight,box.bottom);
    if(x1<=x0 || y1<=y0) continue;
    let hit=false;
    for(const [rx,ry] of [[.5,.5],[.1,.1],[.9,.1],[.1,.9],[.9,.9]]) {
      const px=x0+(x1-x0)*rx,py=y0+(y1-y0)*ry;
      const top=surfaceHitForNode(node,px,py);
      if(top===node || node.contains(top)) {hit=true;break;}
      // Publish what actually receives input, including delegated/custom-event
      // surfaces. This proves hitability, not a button role or a safe action.
      if(top&&!top.contains(node))addOccluder(top);
    }
    if(!hit) continue;
    result.push({targetRef,documentId,name:(node.getAttribute('aria-label')||node.getAttribute('title')||node.getAttribute('alt')||(!node.isContentEditable ? node.innerText : '')||'').trim().slice(0,96),renderState:renderState(node),signature:signature(node),kind:regions.has(node)?'region':'control',...(occluders.has(node)?{interactionEvidence:'occluding-hit-surface'}:{}),
      bounds:{x:box.x,y:box.y,width:box.width,height:box.height},role:node.getAttribute('role')||node.tagName.toLowerCase(),
      disabled:node.matches(':disabled')||!!node.closest('[inert],[aria-disabled="true"]')});
  }
  return (${GROUP_VISUAL_GRIDS})(result,findSurfaceTarget,stamp,signature,documentId);
})()`;

export const validateVisualNode = (
  ref: string,
  signature: string,
  documentId: string,
  spatial: boolean | "cell" = false,
) => `(() => {
  ${SURFACE_TARGET_LOOKUP}
  if (${VISUAL_DOCUMENT} !== ${JSON.stringify(documentId)}) return false;
  const node=findSurfaceTarget(${JSON.stringify(ref)});
  return !!node && (${VISUAL_SIGNATURE})(node,${JSON.stringify(spatial)}) === ${JSON.stringify(signature)};
})()`;
