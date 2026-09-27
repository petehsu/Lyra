// Production controllers, real Chromium input, no screenshots or website APIs.
import { app, BrowserWindow } from "electron";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createBrowserAgentObservationEngine } from "../src/main/workbench-browser/view-manager-runtime/agent-observation-engine";
import { createBrowserAgentStateStore } from "../src/main/workbench-browser/view-manager-runtime/agent-state-store";
import { createBrowserAgentInteractionExecutor } from "../src/main/workbench-browser/view-manager-runtime/agent-interaction-executor";
import { createBrowserAgentFocusInputController } from "../src/main/workbench-browser/view-manager-runtime/agent-focus-input-controller";
import { createSurfaceDrag } from "../src/main/workbench-browser/view-manager-runtime/surface-drag";
import { createBrowserNativeDialogs } from "../src/main/workbench-browser/view-manager-runtime/agent-native-dialog";
import { createLumenToolHost } from "../src/main/agent/lumen-tool-host";

const profile = mkdtempSync(join(tmpdir(), "lyra-capabilities-"));
app.setPath("userData", profile);
app.disableHardwareAcceleration();
app.commandLine.appendSwitch("disable-smooth-scrolling");
app.commandLine.appendSwitch("ozone-platform","x11");
const run = async () => {
  await app.whenReady();
  const win = new BrowserWindow({show:false,width:1000,height:750,webPreferences:{contextIsolation:true,sandbox:true,backgroundThrottling:false}});
  const wc = win.webContents;
  wc.debugger.attach("1.3");
  const target = {tabId:"fixture",targetMode:"live",address:"",isLoading:false,browserMode:{targetMode:"live",visibleFollow:false,authState:"liveProfile"},webContents:wc};
  const stateStore = createBrowserAgentStateStore();
  const host = {stateStore,resolveBrowserAgentTarget:async()=>target,
    openDebuggerSessionForTarget:async()=>({sendCommand:(method:string,params:object)=>wc.debugger.sendCommand(method,params),subscribe:(listener:(event:unknown)=>void)=>{const onMessage=(_event:unknown,method:string,params:unknown)=>listener({kind:"message",method,params});wc.debugger.on("message",onMessage);return()=>wc.debugger.off("message",onMessage);},close:async()=>{}}),
    publishBrowserAgentActivity:async()=>{},readPageDiagnostics:()=>[],rememberBrowserRestoreState:()=>{},updateRuntimeState:()=>{},
    assertSharedControlCanContinue:()=>{},recordFollowAction:()=>{},markSyntheticInput:()=>{},
    findFrameInWebContents:(_wc:unknown,id:number)=>wc.mainFrame.framesInSubtree.find(frame=>frame.frameTreeNodeId===id),
    readAgentViewportState:async()=>wc.executeJavaScript("({width:innerWidth,height:innerHeight,scrollX,scrollY})"),
    sendAgentInputEvent:(_target:unknown,event:Electron.InputEvent)=>wc.sendInputEvent(event)};
  const engine = createBrowserAgentObservationEngine(host as never);
  const findAgentElement = async (_tab:string,request:{targetRef?:string}) => ({element:stateStore.readBrowserAgentCacheEntry("fixture","live")?.elements.find(e=>e.targetRef===request.targetRef)??null});
  const actions = createBrowserAgentInteractionExecutor({...host,findAgentElement,observeAgentPage:engine.observeAgentPage} as never);
  const inputs = createBrowserAgentFocusInputController({...host,...actions,findAgentElement,observeAgentPage:engine.observeAgentPage} as never);
  const drag=createSurfaceDrag({...host,find:async(tabId,ref)=> (await findAgentElement(tabId,{targetRef:ref})).element,
    observe:()=>engine.observeAgentPage("fixture",{strategy:"interactiveOnly",suppressActivity:true})} as never);
  const dialogs=createBrowserNativeDialogs(host as never);
  const bridge = {...actions,...inputs,observeAgentPage:engine.observeAgentPage,dragAgentElement:drag,handleAgentDialog:dialogs.handle,peekAgentDialog:dialogs.peek,
    actOnAgentElement:(tabId:string,request:any)=>dialogs.capture(tabId,request,()=>actions.actOnAgentElement(tabId,request))};
  const tools = createLumenToolHost({getBrowserBridge:()=>bridge,tabResolver:{resolveBrowserAgentTabId:async()=>"fixture"},storageRoot:profile} as never).handlers;
  const load = async (html:string) => {await win.loadURL("data:text/html;charset=utf-8,"+encodeURIComponent(html));return engine.observeAgentPage("fixture",{strategy:"interactiveOnly",settle:false});};
  const check = (name:string) => console.log(JSON.stringify({passed:true,name}));
  const act = async (targetRef:string,extra:object={}) => {
    const result = await tools["lyraLumen.act"]!({targetRef,interaction:"click",effect:"editDraft",...extra}) as any;
    assert(result.ok,JSON.stringify(result));return result;
  };
  try {
    let map = await load(`<button id=b>Choose</button><script>window.events=[];for(const t of ['click','auxclick','contextmenu','dblclick'])b.addEventListener(t,e=>{e.preventDefault();events.push({type:e.type,shift:e.shiftKey,ctrl:e.ctrlKey,alt:e.altKey,meta:e.metaKey,button:e.button,trusted:e.isTrusted})});</script>`);
    const ref = map.elements.find(e=>e.label==="Choose")!.targetRef;
    for (const modifier of ["shift","control","alt","meta"] as const) {
      await act(ref,{modifiers:[modifier]});
      const last = await wc.executeJavaScript("events.at(-1)");
      assert(last.trusted);assert(last[modifier==="control"?"ctrl":modifier]);
    }
    await act(ref,{button:"middle"});assert.equal(await wc.executeJavaScript("events.at(-1).type"),"auxclick");
    await act(ref,{interaction:"rightClick"});assert(await wc.executeJavaScript("events.some(e=>e.type==='contextmenu'&&e.trusted&&e.button===2)"));
    await act(ref,{interaction:"doubleClick"});assert.equal(await wc.executeJavaScript("events.at(-1).type"),"dblclick");
    check("trusted modifier, middle, right and double clicks through tool host");

    map = await load(`<button id=b>Hold</button><script>b.onpointerdown=()=>window.started=performance.now();b.onpointerup=()=>window.held=performance.now()-started;</script>`);
    await act(map.elements.find(e=>e.label==="Hold")!.targetRef,{holdMs:180});
    assert(await wc.executeJavaScript("held>=170"));check("bounded long press");

    map = await load(`<select aria-label="Single" id=s><option value="">Empty</option><option value=a>Alpha</option><option value=b>Beta</option><option value=c disabled>Blocked</option><option value=d>Same</option><option value=e>Same</option></select><select multiple aria-label="Multi" id=m><option value=a>Alpha</option><option value=b>Beta</option></select><script>window.changes=0;s.onchange=()=>changes++;</script>`);
    const single = map.elements.find(e=>e.label==="Single")!.targetRef, multi = map.elements.find(e=>e.label==="Multi")!.targetRef;
    const options=await act(single,{interaction:"select"});
    assert.equal(options.selectionOptions.total,6);assert(options.selectionOptions.options.some((o:any)=>o.value==="b"&&o.label==="Beta"));
    const filtered=await act(single,{interaction:"select",optionQuery:"Beta"});assert.equal(filtered.selectionOptions.matched,1);
    assert.equal(await wc.executeJavaScript("s.value"),"");
    await act(single,{interaction:"select",selectValue:"b"});assert.equal(await wc.executeJavaScript("s.value"),"b");
    await act(single,{interaction:"select",selectValue:""});assert.equal(await wc.executeJavaScript("s.value"),"");
    await act(single,{interaction:"select",selectValue:""});assert.equal(await wc.executeJavaScript("changes"),2);
    for (const extra of [{optionLabel:"Same"},{selectValue:"c"},{selectValues:["a","missing"]}]) {
      const result = await tools["lyraLumen.act"]!({targetRef:single,interaction:"select",effect:"editDraft",...extra}) as any;
      assert.equal(result.ok,false);assert.equal(await wc.executeJavaScript("s.value"),"");
    }
    await act(multi,{interaction:"select",selectValues:["a","b"]});assert.equal(await wc.executeJavaScript("m.selectedOptions.length"),2);
    await act(multi,{interaction:"select",selectValues:[]});assert.equal(await wc.executeJavaScript("m.selectedOptions.length"),0);
    check("native single/multiple/empty select; ambiguity and disabled options fail atomically");

    map = await load(`<input type=checkbox aria-label=Check id=c><input type=radio name=group aria-label=First id=a><input type=radio name=group aria-label=Second id=b><input type=range aria-label=Volume id=r min=0 max=100 value=0 style="width:300px">`);
    await act(map.elements.find(e=>e.label==="Check")!.targetRef);assert(await wc.executeJavaScript("c.checked"));
    await act(map.elements.find(e=>e.label==="First")!.targetRef);await act(map.elements.find(e=>e.label==="Second")!.targetRef);assert(await wc.executeJavaScript("!a.checked&&b.checked"));
    await act(map.elements.find(e=>e.label==="Volume")!.targetRef,{position:{x:.75,y:.5}});assert(await wc.executeJavaScript("r.valueAsNumber>65&&r.valueAsNumber<85"));
    check("checkbox, radio exclusivity and DOM-relative slider position");

    for (const [type,value] of [["date","2026-10-12"],["time","18:30"],["datetime-local","2026-10-12T18:30"],["month","2026-10"],["week","2026-W42"],["color","#123456"],["range","70"],["number","42"]]) {
      map = await load(`<input type="${type}" aria-label=Value id=v><script>window.presses=0;v.onmousedown=()=>window.presses++;</script>`);
      const result = await inputs.typeIntoAgentElement("fixture",{targetRef:map.elements.find(e=>e.label==="Value")!.targetRef,text:value,clear:true,verification:"fast"});
      assert(result.ok,JSON.stringify({type,result}));assert.equal(await wc.executeJavaScript("v.value"),value);
      if(type!=="number") assert.equal(await wc.executeJavaScript("window.presses"),0,"value filling must not open a native picker");
      check(`native ${type} value`);
    }
    map=await load(`<div id=s draggable=true aria-label=Card style="width:100px;height:60px;background:#ddd">Card</div><div id=d aria-label=Destination style="margin:80px;width:200px;height:100px;background:#aaa">Destination</div><script>s.ondragstart=e=>e.dataTransfer.setData('text/plain','fixture-card');d.ondragover=e=>e.preventDefault();d.ondrop=e=>{e.preventDefault();window.dropped=e.dataTransfer.getData('text/plain');window.trusted=e.isTrusted;};</script>`);
    assert.equal(map.elements.find(e=>e.label==="Card")?.semantics?.constraints?.draggable,"true");
    assert(map.elements.find(e=>e.label==="Destination")?.semantics?.constraints?.dropTarget);
    let result=await tools["lyraLumen.drag"]!({targetRef:map.elements.find(e=>e.label==="Card")!.targetRef,toTargetRef:map.elements.find(e=>e.label==="Destination")!.targetRef,effect:"editDraft"}) as any;
    assert(result.ok,JSON.stringify(result));assert.equal(await wc.executeJavaScript("window.dropped"),"fixture-card");assert(await wc.executeJavaScript("window.trusted"));
    check("native HTML drag uses browser drag data and a real trusted drop");

    const destinationDoc = `<div id=d aria-label="Frame destination" ondragover="event.preventDefault()" ondrop="event.preventDefault();window.dropped=event.dataTransfer.getData('text/plain')" style="width:200px;height:100px;background:#ccc">Frame destination</div>`;
    map=await load(`<div id=s draggable=true aria-label="Frame source" ondragstart="event.dataTransfer.setData('text/plain','cross-frame')" style="width:100px;height:60px;background:#ddd">Frame source</div><iframe style="margin:50px;width:400px;height:200px" srcdoc="${destinationDoc.replaceAll('&','&amp;').replaceAll('"','&quot;')}"></iframe>`);
    result=await tools["lyraLumen.drag"]!({targetRef:map.elements.find(e=>e.label==="Frame source")!.targetRef,toTargetRef:map.elements.find(e=>e.label==="Frame destination")!.targetRef,effect:"editDraft"}) as any;
    assert(result.ok,JSON.stringify(result));assert.equal(await wc.executeJavaScript("frames[0].dropped"),"cross-frame");
    check("HTML drag between independent frame identities");

    map=await load(`<div id=t role=slider aria-label=Track tabindex=0 style="width:400px;height:70px;background:#ddd;touch-action:none"></div><script>t.onpointerdown=e=>{t.setPointerCapture(e.pointerId);window.origin=e.clientX};t.onpointermove=e=>{if(e.buttons===1)window.moved=e.clientX-origin};t.onpointerup=e=>window.released=e.isTrusted;</script>`);
    const track=map.elements.find(e=>e.label==="Track")!.targetRef;
    result=await tools["lyraLumen.drag"]!({targetRef:track,toTargetRef:track,fromPosition:{x:.1,y:.5},toPosition:{x:.8,y:.5},effect:"editDraft"}) as any;
    assert(result.ok,JSON.stringify(result));assert(await wc.executeJavaScript("window.moved>250&&window.released"));check("pointer-captured slider drag releases the button");

    // Native dialogs need a mapped native parent on Linux. Test a real window,
    // never patch window.confirm/alert to fabricate a page outcome.
    win.show();await new Promise(resolve=>setTimeout(resolve,120));
    for(const accept of [false,true]) {
      map=await load(`<button id=b onclick="window.decision=confirm('Apply fixture change?')">Confirm change</button>`);
      const pending=await act(map.elements.find(e=>e.label==="Confirm change")!.targetRef);
      assert.equal(pending.status,"dialogPending");assert.equal(pending.dialog.message,"Apply fixture change?");
      const outcome=await tools["lyraLumen.dialog"]!({dialogId:pending.dialog.id,accept,effect:"editDraft"}) as any;
      assert(outcome.ok,JSON.stringify(outcome));assert.equal(await wc.executeJavaScript("window.decision"),accept);
      const replay=await tools["lyraLumen.dialog"]!({dialogId:pending.dialog.id,accept,effect:"editDraft"}) as any;
      assert.equal(replay.ok,false);check(`native confirm ${accept?'accept':'dismiss'} and stale dialog rejection`);
    }
    map=await load(`<button onclick="alert('Fixture alert');window.continued=true">Alert</button>`);
    const alert=await act(map.elements.find(e=>e.label==="Alert")!.targetRef);
    assert.equal(alert.dialog.type,"alert");
    result=await tools["lyraLumen.dialog"]!({dialogId:alert.dialog.id,accept:true,effect:"editDraft"}) as any;
    assert(result.ok);assert.equal(await wc.executeJavaScript("window.continued"),true);check("native alert resumes original input exactly once");
    const promptSupport=await wc.executeJavaScript(`(()=>{try{window.prompt('Fixture prompt');return 'implemented'}catch(error){return error.message}})()`);
    console.log(JSON.stringify({limitation:"Electron native prompt",detail:promptSupport}));
  } finally {dialogs.dispose();win.destroy();}
};
run().then(()=>app.exit(0),error=>{console.error(error);app.exit(1)}).finally(()=>rmSync(profile,{recursive:true,force:true}));
