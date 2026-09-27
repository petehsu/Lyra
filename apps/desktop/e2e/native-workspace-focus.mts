// Real native focus transitions; temporary profile, no accounts or screenshots.
import { app, BrowserWindow, WebContentsView, webContents, type WebContents } from "electron";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createWorkbenchBrowserSharedDebuggerSession } from "../src/main/workbench-browser/debugger";
import { createWorkspaceFocusIsolation, focusBrowserPageForInput } from "../src/main/workbench-browser/workspace-focus-isolation";

const profile = mkdtempSync(join(tmpdir(), "lyra-workspace-focus-"));
app.setPath("userData", profile);
app.disableHardwareAcceleration();
app.commandLine.appendSwitch("ozone-platform", process.env.WAYLAND_DISPLAY ? "wayland" : "x11");
const pause = () => new Promise(resolve => setTimeout(resolve, 60));
const activate = async (window: BrowserWindow) => {
  for (let attempt = 0; !window.isFocused() && attempt < 30; attempt++) {
    window.focus();
    await pause();
  }
  assert.equal(window.isFocused(),true,"fixture must be the active native window");
};
const check = (name: string) => console.log(JSON.stringify({ passed: true, name }));
const html = `<style>input,button{height:30px} #menu{border:1px solid}</style>
<input id=field><button id=trigger>Menu</button><div id=menu hidden>Menu content</div><button id=outside>Outside</button>
<script>
window.events=[];
trigger.onclick=()=>{menu.hidden=false;trigger.focus()};
window.addEventListener('blur',()=>{events.push('window-blur');menu.hidden=true});
trigger.addEventListener('blur',()=>{events.push('element-blur');menu.hidden=true});
document.addEventListener('pointerdown',e=>{if(e.target.id==='outside')menu.hidden=true});
document.addEventListener('keydown',e=>{if(e.key==='Escape')menu.hidden=true});
</script>`;
const load = (wc: WebContents, body = html) => wc.loadURL("data:text/html," + encodeURIComponent(body));
const point = (wc: WebContents, selector: string) => wc.executeJavaScript(`(() => {
  const r=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();
  return {x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)};
})()`);
const click = async (wc: WebContents, selector: string, nativeFocus = true) => {
  if (nativeFocus) wc.focus();
  const p = await point(wc, selector);
  wc.sendInputEvent({type:"mouseDown",button:"left",clickCount:1,...p});
  wc.sendInputEvent({type:"mouseUp",button:"left",clickCount:1,...p});
  await pause();
};
const open = (wc: WebContents) => wc.executeJavaScript("!menu.hidden");
const key = async (wc: WebContents, keyCode: string) => {
  wc.sendInputEvent({type:"keyDown",keyCode});
  wc.sendInputEvent({type:"keyUp",keyCode});
  await pause();
};

const run = async () => {
  await app.whenReady();
  const win = new BrowserWindow({show:true,width:1000,height:700,webPreferences:{focusOnNavigation:false}});
  const left = new WebContentsView({webPreferences:{focusOnNavigation:false}});
  const right = new WebContentsView({webPreferences:{focusOnNavigation:false}});
  for (const view of [left,right]) win.contentView.addChildView(view);
  left.setBounds({x:0,y:120,width:490,height:500});
  right.setBounds({x:500,y:120,width:490,height:500});
  const shared = [left,right].map((view,i) => createWorkbenchBrowserSharedDebuggerSession({
    tabId:`page-${i}`,webContents:view.webContents,readPageAddress:()=>view.webContents.getURL()
  }));
  const surfaces = [left,right].map((view,i) => ({webContents:view.webContents,acquire:shared[i]!.acquire}));
  const errors: unknown[] = [];
  const isolation = createWorkspaceFocusIsolation({onError:error=>{ errors.push(error); console.error(error); }});
  const sync = () => isolation.sync(win,surfaces);
  try {
    await load(win.webContents);
    await load(left.webContents);
    await load(right.webContents);
    await activate(win);
    await click(left.webContents,"#trigger");
    await click(win.webContents,"#field");
    assert.equal(await open(left.webContents),false);
    check("baseline reproduces workspace menu closing on shell focus");

    await sync();
    await click(left.webContents,"#trigger");
    await click(win.webContents,"#field");
    assert.equal(await open(left.webContents),true);
    assert.equal(webContents.getFocusedWebContents()?.id,win.webContents.id);
    await webContents.getFocusedWebContents()!.insertText("chat text");
    assert.equal(await win.webContents.executeJavaScript("field.value"),"chat text");
    assert.equal(await left.webContents.executeJavaScript("field.value"),"");
    check("workspace menu survives shell click; only shell receives typing");

    await click(win.webContents,"#trigger");
    await click(left.webContents,"#field");
    assert.equal(await open(win.webContents),true);
    await webContents.getFocusedWebContents()!.insertText("page text");
    assert.equal(await left.webContents.executeJavaScript("field.value"),"page text");
    assert.equal(await win.webContents.executeJavaScript("field.value"),"chat text");
    check("shell menu survives workspace click; only workspace receives typing");

    await click(left.webContents,"#trigger");
    await click(right.webContents,"#field");
    assert.equal(await open(left.webContents),true);
    check("split panes retain independent menus");

    await click(left.webContents,"#outside");
    assert.equal(await open(left.webContents),false);
    await click(left.webContents,"#trigger");
    await key(left.webContents,"Escape");
    assert.equal(await open(left.webContents),false);
    await click(left.webContents,"#trigger");
    await key(left.webContents,"Tab");
    assert.equal(await open(left.webContents),false);
    check("local outside click, Escape and Tab retain normal dismissal");

    await click(win.webContents,"#field");
    await focusBrowserPageForInput(left.webContents);
    await click(left.webContents,"#field",false);
    await left.webContents.insertText(" agent text");
    await key(left.webContents,"End");
    assert.equal(webContents.getFocusedWebContents()?.id,win.webContents.id);
    assert.equal(await left.webContents.executeJavaScript("field.value"),"page text agent text");
    assert.equal(await win.webContents.executeJavaScript("field.value"),"chat text");
    check("agent pointer, typing and keys do not steal shell keyboard focus");

    await load(left.webContents, `<iframe style="width:470px;height:400px" srcdoc="${html.replaceAll('&','&amp;').replaceAll('"','&quot;')}"></iframe>`);
    const frame = left.webContents.mainFrame.frames[0]!;
    left.webContents.focus();
    const p = await frame.executeJavaScript("(()=>{const r=trigger.getBoundingClientRect();return{x:Math.round(r.x+r.width/2)+10,y:Math.round(r.y+r.height/2)+10}})()");
    left.webContents.sendInputEvent({type:"mouseDown",button:"left",clickCount:1,...p});
    left.webContents.sendInputEvent({type:"mouseUp",button:"left",clickCount:1,...p});
    await pause();
    assert.equal(await frame.executeJavaScript("!menu.hidden"),true);
    await click(win.webContents,"#field");
    assert.equal(await frame.executeJavaScript("!menu.hidden"),true);
    check("iframe menu survives shell focus after navigation");

    await load(left.webContents);
    await click(left.webContents,"#trigger");
    await click(win.webContents,"#field");
    assert.equal(await open(left.webContents),true);
    check("focus isolation survives document reload/navigation");

    left.setVisible(false);
    await isolation.sync(win,[surfaces[1]!]);
    assert.equal(await left.webContents.executeJavaScript("document.hasFocus()"),false);
    assert.equal(await open(left.webContents),false);
    check("hidden tab releases emulation and closes focus-dependent menu");
    left.setVisible(true); await sync();
    await click(left.webContents,"#trigger");
    await click(win.webContents,"#field");
    assert.equal(await open(left.webContents),true);
    check("returning to a tab restores isolation");

    win.hide(); await sync(); await pause();
    assert.equal(await left.webContents.executeJavaScript("document.hasFocus()"),false);
    assert.equal(await left.webContents.executeJavaScript("document.visibilityState"),"hidden");
    check("hidden window restores actual focus and visibility state");
    win.show(); await activate(win); await sync();
    await click(left.webContents,"#trigger");
    await click(win.webContents,"#field");
    assert.equal(await open(left.webContents),true);
    await isolation.dispose();
    assert.equal(await left.webContents.executeJavaScript("document.hasFocus()"),false);
    assert.equal(await open(left.webContents),false);
    assert.deepEqual(errors,[]);
    check("window restore and controller teardown release all overrides");
  } finally {
    await isolation.dispose();
    for (const session of shared) await session.dispose();
    left.webContents.close(); right.webContents.close(); win.destroy();
    app.quit(); rmSync(profile,{recursive:true,force:true});
  }
};
run().catch(error=>{console.error(error);app.exit(1);});
