// Bundle with esbuild (--platform=node --external:electron), then run with Electron.
import { app, BrowserWindow } from 'electron';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';
import { execFileSync } from 'node:child_process';
import { createCdpAuditSession } from '../src/main/workbench-browser/cdp-audit-session';
import { createLumenToolHost } from '../src/main/agent/lumen-tool-host';
import { createWorkbenchBrowserAgentController } from '../src/main/workbench-browser/view-manager-runtime/agent-controller';
import { browserAgentOperationContext } from '../src/main/workbench-browser/agent-operation-context';
const profile=mkdtempSync(join(tmpdir(),'lyra-native-upload-'));
app.setPath('userData', profile);
app.commandLine.appendSwitch('no-proxy-server');
const first=join(profile,'first.txt'), second=join(profile,'second.txt');
writeFileSync(first,'native attachment 一');writeFileSync(second,'another attachment');
let port=0, uploads:string[]=[], failActivity=false;
const form=(extra='')=>`<button id="attach" style="width:150px;height:60px" onclick="document.querySelector('#file').click()">Attach file</button><button id="noop">No operation</button><input id="file" type="file" hidden ${extra}><output id="status"></output><script>
window.selections=[];document.querySelector('#file').addEventListener('change',async event=>{
 const files=Array.from(event.target.files);window.selections.push({trusted:event.isTrusted,names:files.map(f=>f.name)});
 document.querySelector('#status').textContent='Uploading';
 ${extra.includes('data-reset')?"event.target.value='';event.target.remove();":''}
 for(const file of files)await fetch('/upload',{method:'POST',body:await file.text()});
 document.querySelector('#status').textContent='Attached '+files.map(f=>f.name).join(', ');
});</script>`;
const server=createServer(async(req,res)=>{
 if(req.url==='/upload'){let data='';for await(const chunk of req)data+=chunk;uploads.push(data);res.end('ok');return;}
 res.setHeader('Content-Type','text/html; charset=utf-8');
 if(req.url==='/frames')res.end(`<iframe title="Cross origin upload" src="http://127.0.0.1:${port}/" style="width:600px;height:300px"></iframe>`);
 else if(req.url==='/twins')res.end(`<iframe src="http://127.0.0.1:${port}/" style="width:600px;height:160px"></iframe><br><iframe src="http://127.0.0.1:${port}/" style="width:600px;height:160px"></iframe>`);
 else res.end(form(req.url==='/multi'?'multiple':req.url==='/reset'?'data-reset':''));
});
const run=async()=>{
 await app.whenReady();await new Promise<void>(resolve=>server.listen(0,resolve));port=(server.address() as {port:number}).port;
 const win=new BrowserWindow({show:false,width:1000,height:700,webPreferences:{sandbox:true,contextIsolation:true}});
 let controller:ReturnType<typeof createWorkbenchBrowserAgentController>|undefined;
 const watchdog=setTimeout(()=>{console.error('fixture timed out');app.exit(1);},60_000);
 try{
  await win.loadURL(`http://localhost:${port}/`);
  const wc=win.webContents;wc.debugger.attach('1.3');
  const commands:{method:string;params:any;sessionId?:string}[]=[];
  const target={tabId:'upload-fixture',targetMode:'live',address:wc.getURL(),title:'fixture',isLoading:false,browserMode:{targetMode:'live',visibleFollow:false,authState:'liveProfile'},webContents:wc};
  const openDebuggerSessionForTarget=async()=>({
   tabId:target.tabId,pageAddress:wc.getURL(),focus:()=>{},close:async()=>{},
   sendCommand:(method:string,params?:object,sessionId?:string)=>{commands.push({method,params,...(sessionId?{sessionId}:{})});return wc.debugger.sendCommand(method,params,sessionId);},
   subscribe:(listener:(event:any)=>void)=>{const handler=(_event:unknown,method:string,params:unknown,sessionId?:string)=>listener({kind:'message',method,params,sessionId});wc.debugger.on('message',handler);return()=>wc.debugger.removeListener('message',handler);}
  });
  const host={resolveBrowserAgentTarget:async()=>target,openDebuggerSessionForTarget,
   publishBrowserAgentActivity:async()=>{if(failActivity){failActivity=false;throw new Error('fixture interrupted action');}},readPageDiagnostics:()=>[],rememberBrowserRestoreState:()=>{},updateRuntimeState:()=>{},assertSharedControlCanContinue:()=>{},recordFollowAction:()=>{},markSyntheticInput:()=>{},
   findFrameInWebContents:(_contents:unknown,id:number)=>wc.mainFrame.framesInSubtree.find(frame=>frame.frameTreeNodeId===id),
   readAgentViewportState:async()=>({width:1000,height:700,scrollX:0,scrollY:0}),
   sendAgentInputEvent:(_target:unknown,event:Electron.InputEvent)=>wc.sendInputEvent(event)};
  controller=createWorkbenchBrowserAgentController(host as never);
  const task=<T,>(fn:()=>T,sessionId='upload-task')=>browserAgentOperationContext.run({sessionId},fn);
  const map=()=>task(()=>controller!.observeAgentPage(target.tabId,{strategy:'interactiveOnly'}));
  const upload=(request:object)=>task(()=>controller!.uploadAgentFiles(target.tabId,{effect:'upload',...request} as never));
  const button=async(label='Attach file')=>{const m=await map();const element=m.elements.find(e=>e.label===label);assert(element,JSON.stringify(m));return element.targetRef;};
  const click=async()=>task(async()=>controller!.actOnAgentElement(target.tabId,{targetRef:await button(),interaction:'click',effect:'upload',verification:'fast'}));
  const checkRestored=()=>{for(const sessionId of new Set(commands.filter(c=>c.method==='Page.setInterceptFileChooserDialog').map(c=>c.sessionId)))assert.equal(commands.findLast(c=>c.method==='Page.setInterceptFileChooserDialog'&&c.sessionId===sessionId)?.params.enabled,false);};
  const check=(name:string)=>{checkRestored();console.log(JSON.stringify({passed:true,case:name}));};
  const waitForUploaded=async(count:number)=>{const end=Date.now()+3000;while(uploads.length<count&&Date.now()<end)await new Promise(r=>setTimeout(r,10));assert.equal(uploads.length,count);};
  let result=await upload({targetRef:await button(),files:[first]});
  assert.equal(result.ok,true,JSON.stringify(result));assert.equal(result.status,'filesSelected');assert.equal(result.uploadCompletion,'notVerified');
  await waitForUploaded(1);assert.equal(uploads[0],'native attachment 一');assert.deepEqual(await wc.executeJavaScript('window.selections'),[{trusted:true,names:['first.txt']}]);
  check('hidden-input-native-selection-and-real-web-upload');

  await win.loadURL(`http://localhost:${port}/`);
  const clicked=await click() as any;assert(clicked.ok,JSON.stringify(clicked));assert(clicked.fileChooser?.chooserId,JSON.stringify(clicked));
  const chooserId=clicked.fileChooser.chooserId;
  const pending=await map() as any;assert.equal(pending.fileChooser.chooserId,chooserId);assert.match(pending.mapAppendix,/browser_upload/);assert(!pending.blockedRegions?.some((r:any)=>r.reason==='permission'));
  check('ordinary-click-pending-chooser-in-map');
  result=await task(()=>controller!.uploadAgentFiles(target.tabId,{effect:'upload',chooserId,files:[first]}),'other-task');assert.equal(result.ok,false);assert.equal((result.error as any).kind,'fileChooserUnavailable');
  result=await upload({chooserId,files:[first,second]});assert.equal(result.ok,false);assert.equal((result.error as any).kind,'multipleFilesNotAllowed');
  result=await upload({chooserId,files:[second]});assert.equal(result.ok,true,JSON.stringify(result));await waitForUploaded(2);
  result=await upload({chooserId,files:[second]});assert.equal(result.ok,false);assert.equal((result.error as any).kind,'fileChooserUnavailable');
  check('task-bound-chooser-single-file-constraint-and-no-replay');

  await win.loadURL(`http://localhost:${port}/multi`);
  result=await upload({targetRef:await button(),files:[first,second]});assert.equal(result.ok,true,JSON.stringify(result));await waitForUploaded(4);check('multiple-native-files');
  await win.loadURL(`http://localhost:${port}/reset`);
  result=await upload({targetRef:await button(),files:[first]});assert.equal(result.ok,true,JSON.stringify(result));await waitForUploaded(5);assert.equal(await wc.executeJavaScript("!!document.querySelector('#file')"),false);check('page-removes-input-after-native-change');

  await win.loadURL(`http://localhost:${port}/`);
  await click();const before=commands.filter(c=>c.method==='DOM.setFileInputFiles').length;
  result=await upload({targetRef:await button('No operation'),files:[first]});assert.equal(result.ok,false,JSON.stringify(result));assert.equal((result.error as any).kind,'fileChooserUnavailable');assert.equal(commands.filter(c=>c.method==='DOM.setFileInputFiles').length,before);check('new-click-never-uploads-to-old-pending-control');
  result=await upload({targetRef:await button(),files:[join(profile,'missing')]});assert.equal(result.ok,false);assert.equal((result.error as any).kind,'fileUnavailable');check('unreadable-files-rejected-before-click');
  result=await upload({targetRef:await button(),files:[profile]});assert.equal(result.ok,false);assert.equal((result.error as any).kind,'notRegularFile');check('directories-rejected-without-opening-picker');
  const stale=await click() as any;await wc.executeJavaScript("document.querySelector('#file').remove();document.body.insertAdjacentHTML('beforeend','<input id=file type=file hidden>')");
  result=await upload({chooserId:stale.fileChooser.chooserId,files:[first]});assert.equal(result.ok,false);assert.equal((result.error as any).kind,'fileInputChanged');assert.equal(commands.filter(c=>c.method==='DOM.setFileInputFiles').length,before);check('replaced-node-is-not-retargeted');

  win.showInactive();
  await win.loadURL(`http://localhost:${port}/frames`);
  await new Promise(r=>setTimeout(r,150));
  assert.equal(wc.mainFrame.framesInSubtree.length,2);assert.notEqual(wc.mainFrame.framesInSubtree[0]!.processId,wc.mainFrame.framesInSubtree[1]!.processId);
  result=await upload({targetRef:await button(),files:[first]});assert.equal(result.ok,true,JSON.stringify(result));await waitForUploaded(6);
  assert(commands.findLast(c=>c.method==='DOM.setFileInputFiles')?.sessionId);check('cross-origin-out-of-process-iframe');

  await win.loadURL(`http://localhost:${port}/`);
  const failingTarget=await button();failActivity=true;
  result=await upload({targetRef:failingTarget,files:[first]});assert.equal(result.ok,false);assert.match((result.error as any).message,/fixture interrupted/);check('interception-restored-after-action-error');

  // Shadow DOM still uses the site's real button and file input.
  await wc.executeJavaScript(`const root=document.createElement('section');document.body.replaceChildren(root);root.attachShadow({mode:'open'}).innerHTML='<button style="width:150px;height:60px">Shadow attachment</button><input type=file hidden>';root.shadowRoot.querySelector('button').onclick=()=>root.shadowRoot.querySelector('input').click();void 0;`);
  result=await upload({targetRef:await button('Shadow attachment'),files:[second]});assert.equal(result.ok,true,JSON.stringify(result));check('shadow-dom-hidden-file-input');

  if(process.env.LYRA_UPLOAD_CONTRACT_FIXTURE){
    await win.loadURL(`http://localhost:${port}/`);
    const toolHost=createLumenToolHost({getBrowserBridge:()=>controller,tabResolver:{resolveBrowserAgentTabId:async()=>target.tabId},storageRoot:profile} as never);
    for(const payload of JSON.parse(readFileSync(process.env.LYRA_UPLOAD_CONTRACT_FIXTURE,'utf8'))){
      const selected=await toolHost.handlers['lyraLumen.upload']!({...payload,targetRef:await button(),files:[first]}) as any;
      assert.equal(selected.ok,true,JSON.stringify(selected));assert.equal(selected.uploadCompletion,'notVerified');
    }
    await waitForUploaded(7);check('rust-to-electron-native-upload-contract');
  }
  await win.loadURL(`http://localhost:${port}/`);
  const raceChoice=(await click() as any).fileChooser.chooserId, countBeforeRace=uploads.length;
  const raced=await Promise.all([upload({chooserId:raceChoice,files:[first]}),upload({chooserId:raceChoice,files:[first]})]);
  assert.equal(raced.filter(value=>value.ok===true).length,1,JSON.stringify(raced));await waitForUploaded(countBeforeRace+1);check('concurrent-selection-consumed-once');

  await win.loadURL(`http://localhost:${port}/twins`);
  const twins=await map(), twinTargets=twins.elements.filter(e=>e.label==='Attach file');assert.equal(twinTargets.length,2,twins.mapAppendix);
  assert.notEqual(twinTargets[0]!.frameTreeNodeId,twinTargets[1]!.frameTreeNodeId);
  const countBeforeTwins=uploads.length;
  result=await upload({targetRef:twinTargets[1]!.targetRef,files:[second]});assert.equal(result.ok,true,JSON.stringify(result));await waitForUploaded(countBeforeTwins+1);
  const children=wc.mainFrame.frames;
  assert.equal((await children[0]!.executeJavaScript('window.selections')).length,0);
  assert.equal((await children[1]!.executeJavaScript('window.selections')).length,1);check('identical-url-iframes-keep-distinct-upload-targets');
  const beforeCover=commands.filter(c=>c.method==='DOM.setFileInputFiles').length;
  await wc.executeJavaScript(`const cover=document.createElement('button');cover.style.cssText='position:fixed;inset:0;width:100vw;height:100vh';window.wrong=0;cover.onclick=()=>window.wrong++;document.body.append(cover);void 0;`);
  result=await upload({targetRef:twinTargets[1]!.targetRef,files:[first]});assert.equal(result.ok,false);assert.equal(await wc.executeJavaScript('window.wrong'),0);
  assert.equal(commands.filter(c=>c.method==='DOM.setFileInputFiles').length,beforeCover);check('covered-iframe-cannot-receive-files-or-click-overlay');

  if(process.env.LYRA_VERIFY_NATIVE_DIALOG){
    // Optional Linux/X11 check: a new native portal window appears after all
    // agent actions, with production diagnostics still attached. No file chosen.
    await win.loadURL(`http://localhost:${port}/`);win.show();win.focus();
    const audit=createCdpAuditSession({tabId:target.tabId,targetMode:'live',acquireDebugger:openDebuggerSessionForTarget,onDiagnostic:()=>{}} as never);
    assert.equal((await audit.start()).available,true);
    const windows=()=>execFileSync('xwininfo',['-root','-tree'],{encoding:'utf8'}).split('\n').filter(line=>line.includes('"Open File"'));
    const before=new Set(windows());
    // A real click without an agent interception scope.
    await wc.debugger.sendCommand('Input.dispatchMouseEvent',{type:'mousePressed',x:80,y:35,button:'left',clickCount:1});
    await wc.debugger.sendCommand('Input.dispatchMouseEvent',{type:'mouseReleased',x:80,y:35,button:'left',clickCount:1});
    let opened:string|undefined;const end=Date.now()+5000;
    while(!opened&&Date.now()<end){opened=windows().find(line=>!before.has(line));await new Promise(r=>setTimeout(r,100));}
    assert(opened,'Native file dialog did not appear');console.log(JSON.stringify({passed:true,case:'native-system-file-dialog-restored-with-audit',window:opened.trim()}));
    await audit.dispose();
  }
 }catch(error){console.error(error);process.exitCode=1;}
 finally{clearTimeout(watchdog);controller?.dispose();win.destroy();server.close();rmSync(profile,{recursive:true,force:true});app.exit(process.exitCode??0);}
};
void run();
