import { focusBrowserPageForInput } from "../workspace-focus-isolation";
import { randomUUID } from "node:crypto";
import type { BrowserActionEffect, WorkbenchBrowserAgentElement, WorkbenchBrowserAgentModeRequest, WorkbenchBrowserAgentObservation } from "../types";
import type { WorkbenchBrowserAgentControllerHost } from "./agent-controller-types";
import { cdpPointerModifiers, validatePointerOptions, type PointerOptions, type PointerReceipt } from "./bound-pointer";
import { activateStampedSurfaceScript, armStampedPointerScript, finishStampedPointerScript, type StampedSurfacePoint } from "./surface-control-names";
import { revealSurfaceTargetScript } from "./surface-scroll";
import { createSurfaceFrameInput } from "./surface-frame-input";
import { SURFACE_TARGET_LOOKUP } from "./surface-target";
import { delay } from "./normalizers";

export type BrowserDragRequest = WorkbenchBrowserAgentModeRequest & {
  readonly targetRef: string;
  readonly toTargetRef: string;
  readonly fromPosition?: PointerOptions["position"];
  readonly toPosition?: PointerOptions["position"];
  readonly modifiers?: PointerOptions["modifiers"];
  readonly effect: BrowserActionEffect;
};
type Host = Pick<WorkbenchBrowserAgentControllerHost, "resolveBrowserAgentTarget" | "openDebuggerSessionForTarget" | "findFrameInWebContents" | "assertSharedControlCanContinue" | "publishBrowserAgentActivity" | "markSyntheticInput"> & {
  find: (tabId:string, ref:string, mode:"live"|"isolated") => Promise<WorkbenchBrowserAgentElement | null>;
  observe: (tabId:string, mode:"live"|"isolated") => Promise<WorkbenchBrowserAgentObservation>;
};

export const createSurfaceDrag = (host:Host) => async (tabId:string, request:BrowserDragRequest):Promise<Record<string,unknown>> => {
  validatePointerOptions({...(request.modifiers !== undefined ? {modifiers:request.modifiers}:{}),...(request.fromPosition !== undefined ? {position:request.fromPosition}:{})});
  validatePointerOptions(request.toPosition !== undefined ? {position:request.toPosition}:{});
  if (!request.effect || request.effect === "observe" || request.effect === "unknown") throw new Error("Dragging requires its state-changing effect");
  const target = await host.resolveBrowserAgentTarget(tabId,request,undefined), mode=target.targetMode;
  const [source,destination] = await Promise.all([host.find(tabId,request.targetRef,mode),host.find(tabId,request.toTargetRef,mode)]);
  const fail = (kind:string,message:string,dispatched=false) => ({ok:false,kind:"lyraLumenDragResult",tabId,targetMode:mode,dispatched,error:{kind,message},nextRecommendedAction:"Inspect the current map; never replay an uncertain drag."});
  if (!source || !destination || source.discoveryScope === "visual" || destination.discoveryScope === "visual") return fail("invalidDragTargets","Both endpoints must be current DOM targets from this page map.");
  const frame = host.findFrameInWebContents(target.webContents,source.frameTreeNodeId);
  if (!frame) return fail("detached","The original frame no longer exists.");
  const destinationFrame = host.findFrameInWebContents(target.webContents,destination.frameTreeNodeId);
  if (!destinationFrame) return fail("detached","The destination frame no longer exists.");
  const execute = (script:string) => frame.executeJavaScript(script,true);
  const executeDestination = (script:string) => destinationFrame.executeJavaScript(script,true);
  const point = async (ref:string,position:PointerOptions["position"]) => {
    const owner = ref === request.targetRef ? frame : destinationFrame;
    const run = (script:string) => owner.executeJavaScript(script,true);
    const input = createSurfaceFrameInput(owner);
    await run(revealSurfaceTargetScript(ref));await input.revealOwners();
    const state=await run(activateStampedSurfaceScript(ref,300,false,position)) as StampedSurfacePoint | null;
    if (!state?.trusted) throw new Error(`Drag target is ${state?.reason ?? "detached"}`);
    const translated=await input.translate({x:state.clickX,y:state.clickY});
    if (!translated) throw new Error("Drag target's frame is covered or detached");
    return translated;
  };
  let session:Awaited<ReturnType<Host["openDebuggerSessionForTarget"]>>|undefined;
  let unsubscribe=()=>{}, pressed=false, dispatched=false, htmlDrag=false;
  let current={x:0,y:0};let data:unknown;
  const token=randomUUID(), dropToken=`__lyraDrop_${token.replaceAll("-","")}`;
  try {
    await host.publishBrowserAgentActivity({tabId,targetMode:mode,action:"act",inputActive:true,visibleFollow:target.browserMode.visibleFollow,durationMs:2400});
    await focusBrowserPageForInput(target.webContents);
    await point(request.toTargetRef,request.toPosition); // Validate both before any press.
    current=await point(request.targetRef,request.fromPosition);
    session=await host.openDebuggerSessionForTarget(target);
    unsubscribe=session.subscribe(event=>{if(event.kind==="message"&&event.method==="Input.dragIntercepted") {data=(event.params as {data?:unknown}).data;htmlDrag=true;}});
    await session.sendCommand("Input.setInterceptDrags",{enabled:true});
    const modifiers=cdpPointerModifiers(request.modifiers);
    const move=async(p:{x:number;y:number})=>{host.assertSharedControlCanContinue(tabId);host.markSyntheticInput(tabId);current=p;await session!.sendCommand("Input.dispatchMouseEvent",{type:"mouseMoved",...p,button:pressed?"left":"none",buttons:pressed?1:0,modifiers});};
    await move(current);await delay(30);current=await point(request.targetRef,request.fromPosition);
    await execute(armStampedPointerScript(request.targetRef,token));
    host.assertSharedControlCanContinue(tabId);host.markSyntheticInput(tabId);pressed=true;dispatched=true;
    await session.sendCommand("Input.dispatchMouseEvent",{type:"mousePressed",...current,button:"left",buttons:1,clickCount:1,modifiers});
    const received=await execute(finishStampedPointerScript(token)) as PointerReceipt | null;
    if (!received?.accepted || received.blocked) throw new Error("Source did not receive the drag press");
    // The browser supplies native HTML drag data; never fabricate DataTransfer.
    const start=current;
    await move({x:start.x+6,y:start.y+2});await delay(20);
    const end=await point(request.toTargetRef,request.toPosition);
    for(let step=1;step<=12;step++) {await move({x:start.x+(end.x-start.x)*step/12,y:start.y+(end.y-start.y)*step/12});await delay(8);}
    await move(end);await delay(20);
    // Recheck the live endpoint after dragover/mouseover handlers had a chance
    // to replace it. Do not release a mutation at a stale coordinate.
    const ready=await executeDestination(activateStampedSurfaceScript(request.toTargetRef,300,false,request.toPosition)) as StampedSurfacePoint | null;
    const live=ready?.trusted ? await createSurfaceFrameInput(destinationFrame).translate({x:ready.clickX,y:ready.clickY}):null;
    if (!live || Math.abs(live.x-end.x)>2 || Math.abs(live.y-end.y)>2) throw new Error("Drop target moved, was replaced or became covered; drag cancelled");
    if (data) {
      await executeDestination(`(()=>{${SURFACE_TARGET_LOOKUP};const node=findSurfaceTarget(${JSON.stringify(request.toTargetRef)});const root=node.ownerDocument.defaultView;
        const handler=e=>{if(!e.composedPath().includes(node)&&!node.contains(e.composedPath()[0])){e.preventDefault();e.stopImmediatePropagation();}};
        root.addEventListener('drop',handler,true);window[${JSON.stringify(dropToken)}]=()=>root.removeEventListener('drop',handler,true);})()`);
      for(const type of ["dragEnter","dragOver","drop"]) {host.assertSharedControlCanContinue(tabId);await session.sendCommand("Input.dispatchDragEvent",{type,...end,data,modifiers});}
    }
    await session.sendCommand("Input.dispatchMouseEvent",{type:"mouseReleased",...current,button:"left",buttons:0,clickCount:1,modifiers});pressed=false;
    await delay(30);
    const map=await host.observe(tabId,mode);
    return {ok:true,kind:"lyraLumenDragResult",tabId,targetMode:mode,dispatched:true,method:htmlDrag?"nativeHtmlDrag":"nativePointerDrag",targetRef:request.targetRef,toTargetRef:request.toTargetRef,
      message:"Drag input delivered. Inspect the resulting state before claiming reorder/move completion.",mapAppendix:map.mapAppendix,url:map.url,afterObservationId:map.observationId};
  } catch(error) {return fail("dragFailed",String(error instanceof Error?error.message:error),dispatched);}
  finally {
    // Cleanup bypasses takeover guards: a stopped task must never hold a button.
    if (pressed) {await session?.sendCommand("Input.cancelDragging").catch(()=>{});await session?.sendCommand("Input.dispatchMouseEvent",{type:"mouseReleased",...current,button:"left",buttons:0,clickCount:1}).catch(()=>{});}
    await execute(finishStampedPointerScript(token)).catch(()=>{});
    await executeDestination(`window[${JSON.stringify(dropToken)}]?.();delete window[${JSON.stringify(dropToken)}]`).catch(()=>{});
    await session?.sendCommand("Input.setInterceptDrags",{enabled:false}).catch(()=>{});unsubscribe();await session?.close().catch(()=>{});
  }
};
