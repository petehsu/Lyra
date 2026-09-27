import { app, BrowserWindow } from 'electron';
import { configureBrowserSensitiveBoundary } from '../src/main/sensitive-values/browser-boundary';
import { createOpaqueSensitiveValueRef } from '../src/shared/sensitive-value';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';
const profile=mkdtempSync(join(tmpdir(),'lyra-native-regression-'));
app.setPath('userData',profile);
app.commandLine.appendSwitch('disable-smooth-scrolling');
import assert from 'node:assert/strict';
import { createBrowserAgentObservationEngine } from '../src/main/workbench-browser/view-manager-runtime/agent-observation-engine';
import { createBrowserAgentStateStore } from '../src/main/workbench-browser/view-manager-runtime/agent-state-store';
import { createBrowserAgentInteractionExecutor } from '../src/main/workbench-browser/view-manager-runtime/agent-interaction-executor';
import { createBrowserAgentFocusInputController } from '../src/main/workbench-browser/view-manager-runtime/agent-focus-input-controller';
import { observeAgentNavigation } from '../src/main/workbench-browser/view-manager-runtime/agent-navigation-ready';
import { createBrowserAgentPageController } from '../src/main/workbench-browser/view-manager-runtime/agent-page-controller';
import { armStampedPointerScript, finishStampedPointerScript } from '../src/main/workbench-browser/view-manager-runtime/surface-control-names';
import { createLumenToolHost } from '../src/main/agent/lumen-tool-host';
let onActivity: (() => Promise<unknown>) | undefined;
const run = async () => {
await app.whenReady();
const win = new BrowserWindow({show:false,width:1000,height:700,webPreferences:{contextIsolation:true,sandbox:true,backgroundThrottling:false}});
try {
  await win.loadURL('data:text/html;charset=utf-8,'+encodeURIComponent(`<div aria-label="Composer" role="textbox" contenteditable="true" style="width:480px;height:100px">说点儿什么吧</div><script>(()=>{const field=document.querySelector('div');window.events=[];field.onclick=()=>{if(field.textContent==='说点儿什么吧')field.replaceChildren()};for(const type of ['beforeinput','input','change'])field.addEventListener(type,event=>window.events.push({type,trusted:event.isTrusted}));})()</script>`));
  const webContents=win.webContents;
  webContents.debugger.attach('1.3');
  const target={tabId:'native-fixture',targetMode:'live',address:webContents.getURL(),title:'fixture',isLoading:false,browserMode:{targetMode:'live',visibleFollow:false,authState:'liveProfile'},webContents};
  const stateStore=createBrowserAgentStateStore();
  const host={stateStore,resolveBrowserAgentTarget:async()=>target,
    openDebuggerSessionForTarget:async()=>({sendCommand:(method:string,params:object)=>webContents.debugger.sendCommand(method,params),close:async()=>{}}),
    publishBrowserAgentActivity:async()=>{ await onActivity?.(); },readPageDiagnostics:()=>[],rememberBrowserRestoreState:()=>{},updateRuntimeState:()=>{},assertSharedControlCanContinue:()=>{},recordFollowAction:()=>{},markSyntheticInput:()=>{},
    findFrameInWebContents:(_contents:unknown,id:number)=>webContents.mainFrame.framesInSubtree.find(frame=>frame.frameTreeNodeId===id),
    readAgentViewportState:async()=>webContents.executeJavaScript('({width:innerWidth,height:innerHeight,scrollX,scrollY})'),
    sendAgentInputEvent:(_target:unknown,event:Electron.InputEvent)=>webContents.sendInputEvent(event)};
  const engine=createBrowserAgentObservationEngine(host as never);
  const findAgentElement=async(_tab:string,request:{targetRef?:string})=>{const cache=stateStore.readBrowserAgentCacheEntry('native-fixture','live');return{element:cache?.elements.find(e=>e.targetRef===request.targetRef)??null,observationId:cache?.observationId}};
  const actions=createBrowserAgentInteractionExecutor({...host,findAgentElement,observeAgentPage:engine.observeAgentPage} as never);
  const inputs=createBrowserAgentFocusInputController({...host,...actions,findAgentElement,observeAgentPage:engine.observeAgentPage} as never);
  const map=await engine.observeAgentPage('native-fixture',{strategy:'interactiveOnly'});
  const field=map.elements.find(e=>e.label==='Composer')!;assert(field,map.mapAppendix);
  const result=await inputs.typeIntoAgentElement('native-fixture',{targetRef:field.targetRef,text:'Lyra 原生输入',verification:'fast'});
  assert(result.ok,JSON.stringify(result));
  const state=await webContents.executeJavaScript(`({text:document.querySelector('div').textContent,events:window.events})`);
  assert.equal(state.text,'Lyra 原生输入');assert.deepEqual(state.events,[{type:'beforeinput',trusted:true},{type:'input',trusted:true}]);
  console.log(JSON.stringify({passed:true,electron:process.versions.electron,method:result.inputInsertionMethod,state}));

  // A page can stop input propagation after Chromium has accepted the edit.
  // Verify the real multiline value, including blank lines, with native input.
  for (const text of ['第一段\n第二段', '第一段\n\n末段\n', '\n正文\n\n']) {
    await win.loadURL('data:text/html;charset=utf-8,'+encodeURIComponent(`<input aria-label="Subject"><div role="textbox" aria-label="Message Body" contenteditable style="width:480px;min-height:150px"><div><b>旧标题</b></div><div>旧段落</div></div><script>window.nativeInputs=[];document.addEventListener('input',event=>{window.nativeInputs.push(event.isTrusted);event.stopImmediatePropagation()},true)</script>`));
    const map=await engine.observeAgentPage('native-fixture',{strategy:'interactiveOnly'});
    assert.deepEqual(map.elements.map(e=>e.label),['Subject','Message Body']);
    const body=map.elements.find(e=>e.label==='Message Body')!;
    const result=await inputs.typeIntoAgentElement('native-fixture',{targetRef:body.targetRef,text,clear:true,verification:'fast'});
    assert(result.ok,JSON.stringify({result,html:await webContents.executeJavaScript(`document.querySelector('[contenteditable]').innerHTML`)}));
    assert.equal(result.inputEvidence?.inputEventObserved,false);
    assert.equal(result.inputEvidence?.valueMatches,true);
    assert.equal(result.inputValuePreview,text);
    const state=await webContents.executeJavaScript(`({paragraphs:Array.from(document.querySelector('[contenteditable]').childNodes).map(node=>node.textContent),inputs:window.nativeInputs})`);
    assert.deepEqual(state.paragraphs,text.split('\n'));
    assert(state.inputs.length > 0 && state.inputs.every((trusted:boolean)=>trusted));
    console.log(JSON.stringify({passed:true,case:'native-multiline-stopped-input',lines:text.split('\n').length}));
  }

  for (const mode of ['direct','fields','individual']) {
    const html=`<form><div style="display:flex;gap:12px">${Array.from({length:8},(_,i)=>`<input aria-label="Code ${i}" maxlength="1" style="width:40px;height:40px">`).join('')}</div></form><script>document.querySelectorAll('input').forEach((node,i,all)=>{node.oninput=()=>{if(node.value.length===1)all[i+1]?.focus()};node.onfocus=()=>node.select()})</script>`;
    await win.loadURL('data:text/html;charset=utf-8,'+encodeURIComponent(html));
    const map=await engine.observeAgentPage('native-fixture',{strategy:'interactiveOnly'});
    const fields=map.elements.filter(e=>e.tagName==='input');assert.equal(fields.length,8);
    const request=mode==='direct'?{targetRef:fields[0].targetRef,text:'ABCD-EFGH',clear:true}
      :{text:'',fields:mode==='fields'?[{targetRef:fields[0].targetRef,text:'ABCD-EFGH',clear:true}]
        :fields.map((field,i)=>({targetRef:field.targetRef,text:'ABCDEFGH'[i],clear:true}))};
    const result=await inputs.typeIntoAgentElement('native-fixture',{...request,verification:'fast'});
    assert(result.ok,JSON.stringify(result));
    assert.equal(await webContents.executeJavaScript(`Array.from(document.querySelectorAll('input')).map(node=>node.value).join('')`),'ABCDEFGH');
    console.log(JSON.stringify({passed:true,case:'native-auto-focus-code',mode}));
  }
  if (process.env.LYRA_BROWSER_CONTRACT_FIXTURE) {
    await win.loadURL('data:text/html,'+encodeURIComponent(`<button onclick="window.clicks=(window.clicks||0)+1;window.trusted=event.isTrusted">Contract target</button>`));
    const map=await engine.observeAgentPage('native-fixture',{strategy:'interactiveOnly'});
    const button=map.elements.find(e=>e.label==='Contract target')!;
    const toolHost=createLumenToolHost({getBrowserBridge:()=>({actOnAgentElement:actions.actOnAgentElement}),tabResolver:{resolveBrowserAgentTabId:async()=> 'native-fixture'},storageRoot:profile} as never);
    const payloads=JSON.parse(readFileSync(process.env.LYRA_BROWSER_CONTRACT_FIXTURE,'utf8'));
    for (const payload of payloads) {
      const result=await toolHost.handlers['lyraLumen.act']!({...payload,targetRef:button.targetRef,verification:'fast'});
      assert(result.ok,JSON.stringify(result));
      assert.equal(await webContents.executeJavaScript('window.clicks||0'),payload.effect==='observe'?0:1);
    }
    assert.equal(await webContents.executeJavaScript('window.trusted'),true);
    console.log(JSON.stringify({passed:true,case:'rust-to-electron-effect-contract'}));
  }
  for (const trigger of ['activity','hover']) {
    await win.loadURL('data:text/html,'+encodeURIComponent(`<button id="target" style="position:absolute;left:100px;top:100px;width:120px;height:60px" onclick="window.clicks=(window.clicks||0)+1;window.trusted=event.isTrusted">Continue</button><script>window.shift=()=>{document.querySelector('#target').style.left='500px'};${trigger==='hover'?"document.querySelector('#target').onpointerover=()=>{window.shift();document.querySelector('#target').onpointerover=null}":''}</script>`));
    const map=await engine.observeAgentPage('native-fixture',{strategy:'interactiveOnly'});
    const button=map.elements.find(e=>e.label==='Continue')!;
    if(trigger==='activity') onActivity=async()=>{onActivity=undefined;await webContents.executeJavaScript('window.shift()');};
    const result=await actions.actOnAgentElement('native-fixture',{targetRef:button.targetRef,interaction:'click',effect:'editDraft',verification:'fast'});
    assert(result.ok,JSON.stringify(result));
    assert.equal(result.inputDelivery,'targetReceived');
    assert.equal(await webContents.executeJavaScript('window.clicks||0'),1,trigger+' moved the button after coordinates were cached');
    assert.equal(await webContents.executeJavaScript('window.trusted'),true);
    console.log(JSON.stringify({passed:true,case:'native-layout-shift-before-click',trigger}));
  }
  // Cover arriving after preparation: wrong-target events must be suppressed,
  // and releasing the guard must restore normal user input.
  await win.loadURL('data:text/html,'+encodeURIComponent(`<button style="width:200px;height:80px">Guarded control</button><script>window.wrong=0;</script>`));
  const guardMap=await engine.observeAgentPage('native-fixture',{strategy:'interactiveOnly'});
  const guarded=guardMap.elements.find(e=>e.label==='Guarded control')!;
  await webContents.executeJavaScript(armStampedPointerScript(guarded.targetRef,'fixture-guard'));
  await webContents.executeJavaScript(`const cover=document.createElement('button');cover.style.cssText='position:fixed;inset:0;width:100vw;height:100vh';cover.onclick=()=>window.wrong++;document.body.append(cover);`);
  for(const type of ['mouseDown','mouseUp'] as const) webContents.sendInputEvent({type,x:50,y:40,button:'left',clickCount:1});
  await new Promise(resolve=>setTimeout(resolve,60));
  const receipt=await webContents.executeJavaScript(finishStampedPointerScript('fixture-guard'));
  assert.equal(receipt.blocked,true);assert.equal(await webContents.executeJavaScript('window.wrong'),0);
  for(const type of ['mouseDown','mouseUp'] as const) webContents.sendInputEvent({type,x:50,y:40,button:'left',clickCount:1});
  await new Promise(resolve=>setTimeout(resolve,60));assert.equal(await webContents.executeJavaScript('window.wrong'),1);
  console.log(JSON.stringify({passed:true,case:'native-wrong-target-block-and-cleanup'}));

  await win.loadURL('data:text/html,'+encodeURIComponent(`<div style="height:1400px"></div><button disabled onclick="window.clicked=true">Ready control</button><script>new IntersectionObserver(e=>{if(e[0].isIntersecting)document.querySelector('button').disabled=false}).observe(document.querySelector('button'))</script>`));
  const waitMap=await engine.observeAgentPage('native-fixture',{strategy:'interactiveOnly'}), ready=waitMap.elements.find(e=>e.label==='Ready control')!;
  const pages=createBrowserAgentPageController(host as never);
  const waitHost=createLumenToolHost({getBrowserBridge:()=>({...pages,...actions,observeAgentPage:engine.observeAgentPage,showAgentActivity:async()=>{}}),tabResolver:{resolveBrowserAgentTabId:async()=> 'native-fixture'},storageRoot:profile} as never);
  const waiting=await waitHost.handlers['lyraLumen.wait']!({until:'targetEnabled',targetRef:ready.targetRef,timeoutMs:3000});
  assert.equal(waiting.matched,true,JSON.stringify(waiting));assert.equal(await webContents.executeJavaScript('!!window.clicked'),false);
  console.log(JSON.stringify({passed:true,case:'native-wait-reveals-disabled-target-without-click',elapsedMs:waiting.elapsedMs}));
  assert(waiting.mapAppendix && waiting.waitState.target.enabled,JSON.stringify(waiting));
  await win.loadURL('data:text/html,'+encodeURIComponent(`<p>Expected earlier confirmation</p><p>${'History '.repeat(1800)}</p><p>Recent result beyond viewport</p><button>Continue</button>`));
  const content=await waitHost.handlers['lyraLumen.wait']!({until:'textContains',text:'Expected earlier confirmation',maxChars:512,timeoutMs:3000});
  assert(content.matched && content.truncated && content.coverage.scanComplete,JSON.stringify(content));
  assert(content.content.includes('Recent result beyond viewport'),JSON.stringify(content));
  assert(content.mapAppendix.includes('Continue'),JSON.stringify(content));
  console.log(JSON.stringify({passed:true,case:'native-wait-full-scan-recent-text-and-controls',elapsedMs:content.elapsedMs}));

  await win.loadURL('data:text/html,'+encodeURIComponent(`<main><div id="answers"></div><form onsubmit="return false"><textarea aria-label="Message"></textarea><button type="button" id="send" aria-controls="answers">Send</button></form></main><script>window.sent=0;send.onclick=()=>{window.sent++;send.textContent='Stop';document.querySelector('textarea').value='';const reply=document.createElement('p');reply.textContent='Starting';answers.append(reply);setTimeout(()=>{reply.textContent='Complete answer '+window.sent;send.textContent='Send';window.finishedAt=Date.now()},200)};</script>`));
  const initial=await engine.observeAgentPage('native-fixture',{strategy:'interactiveOnly'});
  const message=initial.elements.find(e=>e.editable)!,send=initial.elements.find(e=>e.label==='Send')!;
  const responseHost=createLumenToolHost({getBrowserBridge:()=>({...pages,...actions,...inputs,observeAgentPage:engine.observeAgentPage,showAgentActivity:async()=>{}}),tabResolver:{resolveBrowserAgentTabId:async()=> 'native-fixture'},storageRoot:profile} as never);
  const responseStarted=Date.now();const recognitionDelays:number[]=[];
  for(let index=1;index<=3;index++) {
    const sent=await responseHost.handlers['lyraLumen.type']!({targetRef:message.targetRef,text:'Question '+index,clear:true,thenClick:send.targetRef,effect:'communicate',awaitResponse:true});
    assert(sent.ok && sent.matched && sent.completion==='conditionMet',JSON.stringify(sent));
    assert(sent.response.includes('Complete answer '+index),JSON.stringify(sent));
    recognitionDelays.push(await webContents.executeJavaScript('Date.now()-window.finishedAt'));
  }
  assert.equal(await webContents.executeJavaScript('window.sent'),3);
  assert(recognitionDelays.every(value=>value<1200),JSON.stringify(recognitionDelays));
  console.log(JSON.stringify({passed:true,case:'native-three-send-reply-cycles-one-initial-map',elapsedMs:Date.now()-responseStarted,recognitionDelays}));

  // Real Electron events, not mocked scroll offsets.
  for (const nested of [false, true]) {
    const html=`<style>html,body{margin:0;${nested?'height:100%;overflow:hidden;':''}}#pane{${nested?'position:absolute;inset:40px 10px;overflow:auto;':''}}</style><main id="pane"><p>Top</p><div style="height:1800px"></div><button onclick="window.clicked=true" style="height:40px;width:140px">Target action</button><div style="height:300px"></div></main><script>window.wheels=[];document.addEventListener('wheel',e=>window.wheels.push({deltaY:e.deltaY,trusted:e.isTrusted}),{capture:true});</script>`;
    const load=()=>win.loadURL('data:text/html;charset=utf-8,'+encodeURIComponent(html));
    const position=()=>webContents.executeJavaScript(nested?"document.querySelector('#pane').scrollTop":"scrollY");
    await load();
    const down=await actions.scrollAgentPage('native-fixture',{direction:'down',amount:500,autoMap:false});
    assert(down.scrolled && down.deltaY > 0, JSON.stringify(down)); assert((await position()) > 0);
    const before=await position();
    const up=await actions.scrollAgentPage('native-fixture',{direction:'up',amount:100,autoMap:false});
    assert(up.scrolled && up.deltaY < 0 && (await position()) < before,JSON.stringify(up));
    const wheels=await webContents.executeJavaScript('window.wheels');
    assert(wheels.some((e:{deltaY:number;trusted:boolean})=>e.trusted && e.deltaY > 0),JSON.stringify(wheels));

    await load();
    const map=await engine.observeAgentPage('native-fixture',{strategy:'interactiveOnly'});
    const button=map.elements.find(e=>e.label==='Target action')!; assert(button);
    const act=await actions.actOnAgentElement('native-fixture',{targetRef:button.targetRef,interaction:'click',effect:'editDraft',verification:'fast'});
    assert(act.ok && await webContents.executeJavaScript('!!window.clicked'),JSON.stringify(act));
    console.log(JSON.stringify({passed:true,case:nested?'native-container-scroll-and-reveal':'native-window-scroll-and-reveal'}));
  }
  await win.loadURL('data:text/html,'+encodeURIComponent(`<button onclick="window.clicked=true" style="position:absolute;top:100px">Blocked action</button>`));
  const blockedMap=await engine.observeAgentPage('native-fixture',{strategy:'interactiveOnly'});
  const blockedButton=blockedMap.elements.find(e=>e.label==='Blocked action')!;
  await webContents.executeJavaScript(`document.body.insertAdjacentHTML('beforeend','<div style="position:fixed;inset:0;background:white;z-index:99">Overlay</div>')`);
  const blocked=await actions.actOnAgentElement('native-fixture',{targetRef:blockedButton.targetRef,interaction:'click',effect:'editDraft',verification:'fast'});
  assert(!blocked.ok && blocked.error?.message.includes('covered'),JSON.stringify(blocked));
  assert.equal(await webContents.executeJavaScript('!!window.clicked'),false);
  console.log(JSON.stringify({passed:true,case:'native-covered-target-preserves-reason-and-never-clicks'}));

  for (const kind of ['shadow', 'frame']) {
    const inside=`<div style="height:1800px"></div><button style="width:150px;height:40px" onclick="this.setAttribute('data-clicked','yes')">Deep action</button><div style="height:200px"></div>`;
    const html=kind==='shadow'
      ? `<div id="host"></div><script>host.attachShadow({mode:'open'}).innerHTML=${JSON.stringify('<div style="height:280px;overflow:auto">'+inside+'</div>')}</script>`
      : `<div style="height:900px"></div><iframe style="height:280px;width:500px" srcdoc="${inside.replaceAll('&','&amp;').replaceAll('"','&quot;')}"></iframe>`;
    await win.loadURL('data:text/html,'+encodeURIComponent(html));
    const observed=await engine.observeAgentPage('native-fixture',{strategy:'interactiveOnly'});
    const button=observed.elements.find(e=>e.label==='Deep action')!; assert(button,observed.mapAppendix);
    const result=await actions.actOnAgentElement('native-fixture',{targetRef:button.targetRef,interaction:'click',effect:'editDraft',verification:'fast'});
    assert(result.ok,JSON.stringify(result));
    const clicked=await webContents.executeJavaScript(kind==='shadow'
      ? "document.querySelector('#host').shadowRoot.querySelector('button').getAttribute('data-clicked')"
      : "document.querySelector('iframe').contentDocument.querySelector('button').getAttribute('data-clicked')");
    assert.equal(clicked,'yes');
    console.log(JSON.stringify({passed:true,case:'native-reveal-'+kind+'-scroll-ancestors'}));
  }
  const captured:string[]=[];
  configureBrowserSensitiveBoundary(async request => {
    captured.push(request.value);
    return {ref:createOpaqueSensitiveValueRef({id:'native-secret-test',owner:'external',valueKind:'token',label:'Test credential',displayHint:'Hidden',ownerName:'browser',capabilities:['use','fill']})};
  });
  const syntheticSecret='glpat-'+'SyntheticOnlyNotACredential'.repeat(12);
  await win.loadURL('data:text/html,'+encodeURIComponent(`<input readonly value="${syntheticSecret}"><input aria-label="Token name" value="clone-test">`));
  const secretMap=await responseHost.handlers['lyraLumen.map']!({});
  assert.equal(captured[0],syntheticSecret);
  assert(!JSON.stringify(secretMap).includes(syntheticSecret.slice(0,20)));
  assert(Array.isArray(secretMap.sensitiveValues)&&secretMap.sensitiveValues.length===1);
  assert(JSON.stringify(secretMap).includes('clone-test'));
  console.log(JSON.stringify({passed:true,case:'native-unnamed-readonly-credential-captured-before-snippet-truncation'}));

  const server=createServer((request,response)=>{response.setHeader('Content-Type','text/html');response.end(`<main>${request.url}</main>`)});
  await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
  try {
    const origin=`http://127.0.0.1:${(server.address() as {port:number}).port}`;
    const navigation=observeAgentNavigation(webContents,4000,origin+'/verify');
    await win.loadURL(origin+'/verify');
    assert.equal(await navigation.done,'ready');
    console.log(JSON.stringify({passed:true,case:'native-navigation-document-ready'}));
    await win.loadURL(origin+'/mail');
    const back=await inputs.pressAgentKey('native-fixture',{key:'Alt+ArrowLeft',effect:'navigate'});
    assert(back.ok,JSON.stringify(back));assert.equal(webContents.getURL(),origin+'/verify');
    const forward=await inputs.pressAgentKey('native-fixture',{key:'Alt+ArrowRight',effect:'navigate'});
    assert(forward.ok,JSON.stringify(forward));assert.equal(webContents.getURL(),origin+'/mail');
    console.log(JSON.stringify({passed:true,case:'native-history-back-forward'}));
  } finally {await new Promise<void>(resolve=>server.close(()=>resolve()));}
} catch(error) {console.error(error);process.exitCode=1;}
finally {win.destroy();rmSync(profile,{recursive:true,force:true});app.exit(process.exitCode??0);}

};
void run();
