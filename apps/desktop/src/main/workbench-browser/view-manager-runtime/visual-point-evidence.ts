import { nativeImage, type WebContents } from "electron";
import type { VisualPoint, VisualScene } from "./visual-scene-types";

const runtime = String.raw`
  const owned=n=>{for(let e=n;e;e=e.parentElement||e.getRootNode()?.host)if(e.id==='__lyra_agent_page_cursor__'||e.hasAttribute?.('data-lyra-agent-overlay'))return true;return false;};
  const signature=n=>JSON.stringify([n.tagName,n.id,n.getAttribute('role'),n.getAttribute('aria-label'),n.getAttribute('title'),n.getAttribute('href'),n.getAttribute('alt'),n.getAttribute('type'),n.children.length===0?(n.textContent||'').slice(0,160):'']);
  const rect=n=>{const b=n.getBoundingClientRect();return [b.x,b.y,b.width,b.height];};
`;

// A coordinate cannot acquire a new, identically painted hit target after capture.
// Weak keys keep neither detached pages nor every node in past frames alive.
export const rememberPointTargets = async (
  contents: WebContents,
  id: string,
) => {
  await Promise.all(
    contents.mainFrame.framesInSubtree.map(async (frame) => {
      if (frame.isDestroyed()) return;
      await frame.executeJavaScript(
        `(() => { ${runtime}
      const nodes=new WeakMap(); let count=0;
      const scan=root=>{for(const n of root.querySelectorAll('*')){
        if(++count>12000)return;if(owned(n))continue;
        const b=rect(n),s=getComputedStyle(n);
        if(b[2]>0&&b[3]>0&&b[0]<innerWidth&&b[1]<innerHeight&&b[0]+b[2]>0&&b[1]+b[3]>0&&s.display!=='none'&&s.visibility!=='hidden')nodes.set(n,{rect:b,signature:signature(n)});
        if(n.shadowRoot)scan(n.shadowRoot);
      }};
      scan(document);for(const weak of window.__lyraKnownShadowRoots??[]){const r=weak.deref();if(r?.host?.isConnected&&!r.host.shadowRoot)scan(r);}
      const captures=window.__lyraPointCaptures??=new Map();captures.set(${JSON.stringify(id)},nodes);
      while(captures.size>12)captures.delete(captures.keys().next().value);
    })()`,
        false,
      );
    }),
  );
};

export const validatePointTarget = async (
  contents: WebContents,
  id: string,
  point: VisualPoint,
) => {
  let frame = contents.mainFrame,
    p = point;
  for (let depth = 0; depth < 16; depth++) {
    const result = (await frame.executeJavaScript(
      `(() => { ${runtime}
      const x=${p.x},y=${p.y};let n=document.elementFromPoint(x,y);
      for(let i=0;n&&i<32;i++){
        let root=n.shadowRoot;
        if(!root)for(const w of window.__lyraKnownShadowRoots??[]){const r=w.deref();if(r?.host===n){root=r;break;}}
        const inner=root?.elementFromPoint?.(x,y);if(!inner||inner===n)break;n=inner;
      }
      const before=n&&window.__lyraPointCaptures?.get(${JSON.stringify(id)})?.get(n);
      if(!before||owned(n)||n.matches(':disabled')||n.closest('[inert],[aria-disabled=true]'))return null;
      const b=rect(n);if(before.signature!==signature(n)||b.some((v,i)=>Math.abs(v-before.rect[i])>1))return null;
      if(/^(IFRAME|FRAME)$/.test(n.tagName)){
        let child=-1;for(let i=0;i<frames.length;i++)if(n.contentWindow===frames[i])child=i;
        if(child<0||!n.offsetWidth||!n.offsetHeight)return null;
        return {child,x:(x-b[0])*n.offsetWidth/b[2]-n.clientLeft,y:(y-b[1])*n.offsetHeight/b[3]-n.clientTop};
      }
      return {child:-1};
    })()`,
      false,
    )) as { child: number; x?: number; y?: number } | null;
    if (!result) throw new Error("image_target_changed");
    if (result.child < 0) return;
    const child = frame.frames[result.child];
    if (!child || child.isDestroyed()) throw new Error("image_target_changed");
    frame = child;
    p = { x: result.x!, y: result.y! };
  }
  throw new Error("image_target_unresolved");
};

/** Compare only the requested input corridor, never unrelated page animation. */
export const validatePointPixels = (
  scene: VisualScene,
  current: string,
  points: readonly VisualPoint[],
) => {
  if (!scene.pointEvidence) throw new Error("image_evidence_unavailable");
  const previous = nativeImage.createFromBuffer(
    Buffer.from(scene.pointEvidence.png, "base64"),
  );
  const next = nativeImage.createFromBuffer(Buffer.from(current, "base64"));
  const size = previous.getSize(),
    nextSize = next.getSize();
  if (size.width !== nextSize.width || size.height !== nextSize.height)
    throw new Error("viewport_changed");
  const sx = size.width / scene.pointEvidence.width,
    sy = size.height / scene.pointEvidence.height;
  for (const p of points) {
    const x = Math.max(0, Math.floor((p.x - 24) * sx)),
      y = Math.max(0, Math.floor((p.y - 24) * sy));
    const box = {
      x,
      y,
      width: Math.min(size.width - x, Math.ceil(48 * sx)),
      height: Math.min(size.height - y, Math.ceil(48 * sy)),
    };
    if (
      box.width < 1 ||
      box.height < 1 ||
      !previous.crop(box).toBitmap().equals(next.crop(box).toBitmap())
    )
      throw new Error("image_content_changed");
  }
};
