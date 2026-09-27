import { presentBrowserMap, MAP_PRESENTATION_CHARS } from "../src/main/workbench-browser/view-manager-runtime/agent-map-presentation.ts";
import { waitForLumenPage } from "../src/main/agent/lumen-page-wait.ts";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { createBrowserAgentObservationEngine } from "../src/main/workbench-browser/view-manager-runtime/agent-observation-engine.ts";
import { createBrowserAgentStateStore } from "../src/main/workbench-browser/view-manager-runtime/agent-state-store.ts";
import { activateStampedSurfaceScript } from "../src/main/workbench-browser/view-manager-runtime/surface-control-names.ts";
import { probeElementState } from "../src/main/workbench-browser/view-manager-runtime/agent-element-probe.ts";
import { createBrowserAgentInteractionExecutor } from "../src/main/workbench-browser/view-manager-runtime/agent-interaction-executor.ts";
import { createBrowserAgentFocusInputController } from "../src/main/workbench-browser/view-manager-runtime/agent-focus-input-controller.ts";
import { createBrowserAxController } from "../src/main/workbench-browser/view-manager-runtime/ax-controller.ts";
import { createBrowserAxSnapshotStore } from "../src/main/workbench-browser/view-manager-runtime/ax-snapshot-store.ts";

import { buildVisiblePageReadScript } from "../src/main/workbench-browser/view-manager-runtime/agent-visible-text.ts";
import { nextRecommendedActionAfterFastLumenAction } from "../src/main/agent/lumen-tool-host-helpers.ts";

import { CURSOR_DEFINITIONS, type BrowserCursorKeyword } from "../src/main/workbench-browser/view-manager-runtime/agent-cursor-semantics.ts";
import { compactMapObservation } from "../src/main/workbench-browser/view-manager-runtime/agent-map-compaction.ts";
import { compareSurface } from "../src/main/workbench-browser/view-manager-runtime/agent-surface-change.ts";
import { armResponseWatchScript, readResponseWatch } from "../src/main/workbench-browser/view-manager-runtime/agent-response-watch.ts";

// Exercises production surface maps, AX, and input in Chromium. No image inputs,
// saved sessions, credentials, or external pages are used.
const browser = await chromium.launch({
  headless: true,
  ...(process.env.LYRA_TEST_CHROMIUM ? { executablePath: process.env.LYRA_TEST_CHROMIUM } : {})
});
const page = await browser.newPage({ viewport: { width: 1318, height: 694 } });
const cdp = await page.context().newCDPSession(page);
const frame = {
  frameTreeNodeId: 1, url: "about:blank", origin: "null", name: "",
  executeJavaScript: (script: string) => page.evaluate(script), isDestroyed: () => false
};
Object.assign(frame, { framesInSubtree: [frame], frames: [], parent: null });
const target = {
  tabId: "fixture", targetMode: "live", address: "about:blank", title: "fixture", isLoading: false,
  browserMode: { targetMode: "live", visibleFollow: true, authState: "liveProfile" },
  webContents: { mainFrame: frame, executeJavaScript: frame.executeJavaScript, focus: () => undefined, insertText: async (text: string) => { await inputQueue; await page.keyboard.insertText(text); } }
};
const pointerMoves: number[][] = [];
const stateStore = createBrowserAgentStateStore();
let inputQueue = Promise.resolve();
const host = {
  stateStore,
  resolveBrowserAgentTarget: async () => target,
  openDebuggerSessionForTarget: async () => ({
    sendCommand: (method: string, params: object) => cdp.send(method as never, params as never),
    close: async () => undefined
  }),
  publishBrowserAgentActivity: async () => undefined,
  readPageDiagnostics: () => [],
  rememberBrowserRestoreState: () => undefined,
  updateRuntimeState: () => undefined,
  assertSharedControlCanContinue: () => undefined,
  recordFollowAction: () => undefined,
  nextRecommendedActionAfterAgentAction: () => "lyra_lumen.map",
  markSyntheticInput: () => undefined,
  findFrameInWebContents: () => frame,
  readAgentViewportState: async () => ({ width: 1318, height: 694, scrollX: 0, scrollY: 0 }),
  sendAgentInputEvent: (_target: unknown, event: { type: string; x?: number; y?: number; button?: string; clickCount?: number; keyCode?: string; modifiers?: string[] }) => {
    pointerMoves.push([event.x ?? 0, event.y ?? 0]);
    const type = { mouseMove: "mouseMoved", mouseDown: "mousePressed", mouseUp: "mouseReleased" }[event.type];
    // Match Electron's wire contract. Playwright accepts "Control+b" as a key,
    // which previously hid the production bug (Electron requires modifiers).
    const key = ({ Left: "ArrowLeft", Right: "ArrowRight", Up: "ArrowUp", Down: "ArrowDown", Esc: "Escape" } as Record<string, string>)[event.keyCode ?? ""] ?? event.keyCode;
    const modifiers = (event.modifiers ?? []).map(value => ({ shift: "Shift", control: "Control", alt: "Alt", meta: "Meta" } as Record<string, string>)[value]!);
    if (event.type === "keyDown") inputQueue = inputQueue.then(async () => {
      assert(!key!.includes("+") || key === "+", "Electron keyCode must not contain a shortcut chord");
      for (const modifier of modifiers) await page.keyboard.down(modifier);
      await page.keyboard.down(key!);
    });
    if (event.type === "keyUp") inputQueue = inputQueue.then(async () => {
      await page.keyboard.up(key!);
      for (const modifier of [...modifiers].reverse()) await page.keyboard.up(modifier);
    });
    if (type) inputQueue = inputQueue.then(async () => {
      await cdp.send("Input.dispatchMouseEvent", {
        type: type as "mouseMoved", x: event.x ?? 0, y: event.y ?? 0,
        button: (event.button ?? "left") as "left", clickCount: event.clickCount ?? 1
      });
    });
  }
};
const engine = createBrowserAgentObservationEngine(host as unknown as Parameters<typeof createBrowserAgentObservationEngine>[0]);
// The registry lookup uses the same map captured by production observation.
const findAgentElement = async (_tabId: string, request: { targetRef?: string }) => {
  const cache = stateStore.readBrowserAgentCacheEntry("fixture", "live");
  return { element: cache?.elements.find(e => e.targetRef === request.targetRef) ?? null, observationId: cache?.observationId };
};
const actions = createBrowserAgentInteractionExecutor({
  ...host, findAgentElement, observeAgentPage: engine.observeAgentPage
} as unknown as Parameters<typeof createBrowserAgentInteractionExecutor>[0]);
const inputs = createBrowserAgentFocusInputController({
  ...host, ...actions, findAgentElement, observeAgentPage: engine.observeAgentPage
} as unknown as Parameters<typeof createBrowserAgentFocusInputController>[0]);
const observe = () => engine.observeAgentPage("fixture", { strategy: "interactiveOnly" });
const axSnapshotStore = createBrowserAxSnapshotStore();
let axEpoch = 0;
const ax = createBrowserAxController({
  ...host, axSnapshotStore, nextMapEpoch: () => ++axEpoch,
  buildSemanticFrameGraph: async () => ({ frames: [{
    frameRef: "fixture-main", frameTreeNodeId: 1, isMainFrame: true,
    url: "about:blank", bounds: { x: 0, y: 0, width: 1318, height: 694 }
  }], blockedRegions: [] })
} as unknown as Parameters<typeof createBrowserAxController>[0]);
const cases: Array<[string, () => Promise<void>]> = [];

cases.push(["identical anonymous row menus stay bound through refresh, insertion, and deletion", async () => {
  await page.setContent(`<style>a{display:block;position:relative;width:240px;height:40px}.icon{position:absolute;right:4px;top:6px;width:28px;height:28px;cursor:pointer}</style>
    <div id="root"><a href="#one">Other conversation<div role="button" class="icon"></div></a><a href="#two">Target conversation<div role="button" class="icon"></div></a><a href="#three">Another conversation<div role="button" class="icon"></div></a></div><div id="portal"></div>
    <script>
      document.querySelectorAll('.icon').forEach(icon=>icon.onclick=e=>{
        e.preventDefault(); window.chosen=icon.parentElement;
        document.querySelector('#portal').innerHTML='<button id="delete">Delete</button>';
      });
      document.addEventListener('click', e=>{
        if(e.target.id==='delete') document.querySelector('#portal').innerHTML='<div role="dialog" aria-modal="true" style="position:fixed;inset:0;background:white"><h2>Delete Target conversation?</h2><button id="confirm">Delete chat</button><button>Cancel</button></div>';
        if(e.target.id==='confirm') {window.chosen.remove();document.querySelector('#portal').replaceChildren();}
      });
    </script>`);
  const initial = await observe();
  const icons = initial.elements.filter(e => e.role === "button" && e.tagName === "div");
  assert.equal(icons.length, 3, initial.mapAppendix);
  assert.equal(new Set(icons.map(e => e.targetRef)).size, 3);
  for (const icon of icons) {
    const prepared = await page.evaluate(activateStampedSurfaceScript(icon.targetRef)) as { trusted?: boolean } | null;
    assert(prepared?.trusted, `unresolvable mapped icon: ${icon.targetRef}`);
    const matches = await page.evaluate(({ xpath, ref }) => document.evaluate(xpath!, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue === document.querySelector('[data-lyra-surface="'+ref+'"]'), { xpath: icon.xpath, ref: icon.targetRef });
    assert(matches, `XPath lost its descendant path: ${icon.xpath}`);
  }
  const refreshed = await observe();
  assert.deepEqual(refreshed.elements.filter(e => e.role === "button").map(e => e.targetRef), icons.map(e => e.targetRef));
  // Use the relation actually published to the agent, not an ID from the fixture.
  const line = initial.mapAppendix!.split("\n").find(line => line.includes("icon at the end of") && line.includes("Target conversation"));
  assert(line, initial.mapAppendix);
  const chosen = icons.find(e => line.includes(e.targetRef))!;
  assert(chosen, line);
  await page.evaluate(() => document.querySelector('#root')!.prepend(document.querySelector('a')!.cloneNode(true)));
  await observe();
  const started = performance.now();
  const open = await actions.actOnAgentElement("fixture", { targetRef: chosen.targetRef, interaction: "click", verification: "fast" });
  await inputQueue;
  assert(open.ok, JSON.stringify(open));
  for (const label of ["Delete", "Delete chat"]) {
    const element = stateStore.readBrowserAgentCacheEntry("fixture", "live")?.elements.find(e => e.label === label);
    assert(element, `returned map omitted ${label}`);
    const result = await actions.actOnAgentElement("fixture", { targetRef: element.targetRef, interaction: "click", verification: "fast" });
    await inputQueue;
    assert(result.ok, JSON.stringify(result));
  }
  assert.equal(await page.locator('a[href="#two"]').count(), 0);
  assert.equal(await page.locator('a').count(), 3, "another conversation was deleted");
  console.log(JSON.stringify({ metric: "anonymous_menu_to_delete_ms", elapsed: performance.now() - started }));
}]);

cases.push(["AX refs survive filtered and concurrent maps; actions use live nodes and trusted input", async () => {
  axSnapshotStore.invalidate("fixture", "live");
  await page.setContent(`<button id="target" onclick="window.clicks=(window.clicks||0)+1;window.trusted=event.isTrusted">Current conversation</button><input aria-label="Composer">`);
  const first = await ax.axMapAgentPage("fixture", { strategy: "interactive" });
  const node = first.nodes.find(n => n.name === "Current conversation")!;
  assert(node, JSON.stringify(first));
  for (let i = 0; i < 20; i++) await ax.axMapAgentPage("fixture", { strategy: "document", maxNodes: 1, includeText: true });
  await Promise.all([ax.axMapAgentPage("fixture", {}), ax.axMapAgentPage("fixture", {})]);
  assert.equal(axSnapshotStore.resolveAxRef(node.axRef).kind, "ok");
  await page.evaluate(() => { const el = document.querySelector<HTMLElement>('#target')!; el.style.marginLeft='300px'; el.textContent='Renamed conversation'; });
  const refreshed = await ax.axMapAgentPage("fixture", {});
  assert.equal(refreshed.nodes.find(n => n.name === "Renamed conversation")?.axRef, node.axRef);
  const focused = await ax.axActOnNode("fixture", { axRef: node.axRef, interaction: "focus", effect: "observe" });
  assert(focused.ok, JSON.stringify(focused));
  assert.equal(await page.evaluate(() => document.activeElement?.id), "target");
  for (let i = 0; i < 2; i++) {
    const clicked = await ax.axActOnNode("fixture", { axRef: node.axRef, interaction: "click", effect: "editDraft", intent: "activate" });
    await inputQueue;
    assert(clicked.ok, JSON.stringify(clicked));
  }
  assert.equal(await page.evaluate('window.clicks'), 2, "a cached receipt replaced an actual action");
  assert.equal(await page.evaluate('window.trusted'), true);
  await page.evaluate(() => document.querySelector('#target')!.remove());
  pointerMoves.length = 0;
  const gone = await ax.axActOnNode("fixture", { axRef: node.axRef, interaction: "click", effect: "editDraft" });
  assert(!gone.ok, JSON.stringify(gone));
  assert.equal(pointerMoves.length, 0, "detached AX node fell back to old coordinates");
  const focusGone = await ax.axActOnNode("fixture", { axRef: node.axRef, interaction: "focus", effect: "observe" });
  assert(!focusGone.ok, "focus reported success for a detached node");
  axSnapshotStore.invalidate("fixture", "live", "navigation");
  assert.equal(axSnapshotStore.resolveAxRef(node.axRef).kind, "stale");
}]);

cases.push(["AX input refuses disabled, covered, unfocusable, and foreign targets", async () => {
  axSnapshotStore.invalidate("fixture", "live");
  await page.setContent(`<button id="target">Bound control</button><div role="button" id="nofocus">Not focusable</div>`);
  const map = await ax.axMapAgentPage("fixture", {});
  const node = map.nodes.find(n => n.name === "Bound control")!;
  const nofocus = map.nodes.find(n => n.name === "Not focusable")!;
  assert(node && nofocus);
  for (const [tabId, targetMode] of [["different-tab", "live"], ["fixture", "isolated"]] as const) {
    const rejected = await ax.axActOnNode(tabId, { axRef: node.axRef, targetMode, interaction: "click", effect: "editDraft" });
    assert(!rejected.ok, "reference crossed a tab/profile boundary");
  }
  const focus = await ax.axActOnNode("fixture", { axRef: nofocus.axRef, interaction: "focus", effect: "observe" });
  assert(!focus.ok, "unfocusable node reported focus success");
  await page.evaluate(() => document.querySelector<HTMLButtonElement>('#target')!.disabled = true);
  pointerMoves.length = 0;
  const disabled = await ax.axActOnNode("fixture", { axRef: node.axRef, interaction: "click", effect: "editDraft" });
  assert(!disabled.ok);
  await page.evaluate(() => {
    document.querySelector<HTMLButtonElement>('#target')!.disabled = false;
    const cover=document.createElement('div'); cover.style.cssText='position:fixed;inset:0;background:white;z-index:99'; document.body.append(cover);
  });
  const covered = await ax.axActOnNode("fixture", { axRef: node.axRef, interaction: "click", effect: "editDraft" });
  assert(!covered.ok);
  assert.equal(pointerMoves.length, 0);
}]);

cases.push(["AX input reaches nodes in same-origin frames and closed shadow roots", async () => {
  axSnapshotStore.invalidate("fixture", "live");
  await page.setContent(`<iframe style="margin-left:200px;margin-top:80px" srcdoc="<button onclick='window.clicked=event.isTrusted'>Frame control</button>"></iframe><div id="shadow"></div>`);
  await page.locator('iframe').waitFor();
  await page.evaluate(() => {
    const root=document.querySelector('#shadow')!.attachShadow({mode:'closed'});
    root.innerHTML='<button onclick="window.shadowClicked=event.isTrusted">Shadow control</button>';
  });
  const map = await ax.axMapAgentPage("fixture", {});
  for (const name of ["Frame control", "Shadow control"]) {
    const node = map.nodes.find(n => n.name === name);
    assert(node, JSON.stringify(map));
    const result = await ax.axActOnNode("fixture", { axRef: node.axRef, interaction: "click", effect: "editDraft" });
    await inputQueue;
    assert(result.ok, JSON.stringify(result));
  }
  assert.equal(await page.evaluate('document.querySelector("iframe").contentWindow.clicked'), true);
  assert.equal(await page.evaluate('window.shadowClicked'), true);
}]);

cases.push(["modal controls remain actionable; covered background remains findable but blocked", async () => {
  await page.setContent(`<style>button{width:120px;height:40px} .backdrop{position:fixed;inset:0;background:#0008;display:grid;place-items:center}.dialog{background:white;padding:32px;transform:translateZ(0)} .caption{position:relative}</style>
    <button id="background">Background action</button>
    <div class="backdrop"><div class="dialog" role="dialog" aria-modal="true"><h2>Delete conversation?</h2><button>Cancel</button><button id="confirm"><span class="caption">Delete chat</span></button></div></div>`);
  const result = await observe();
  assert(result.elements.some(e => e.label === "Delete chat"), result.mapAppendix);
  assert(result.elements.some(e => e.label === "Background action" && e.visibility?.covered), result.mapAppendix);
  assert(presentBrowserMap(result, {query:"Background action"}).includes("covered"), result.mapAppendix);
  const button = result.elements.find(e => e.label === "Delete chat")!;
  assert.equal(await page.locator("#confirm").getAttribute("data-lyra-surface"), button.targetRef);
}]);

cases.push(["action-result maps do not sweep unnamed controls", async () => {
  await page.setContent(`<style>button{width:32px;height:32px;margin:10px}</style>${"<button></button>".repeat(8)}`);
  pointerMoves.length = 0;
  const start = performance.now();
  await engine.observeAgentPage("fixture", { strategy: "interactiveOnly", suppressActivity: true });
  const elapsed = performance.now() - start;
  console.log(JSON.stringify({ metric: "eight_unlabeled_controls_receipt_ms", elapsed }));
  assert.equal(pointerMoves.length, 0, "observation moved the page pointer");
  assert(elapsed < 1000, `map took ${elapsed.toFixed(0)}ms`);
}]);

cases.push(["target and verification keep node identity when DOM order changes", async () => {
  await page.setContent(`<a href="#old">Old conversation</a><textarea aria-label="Message"></textarea><button id="send" aria-pressed="false">Send</button>`);
  const map = await observe();
  const send = map.elements.find(e => e.label === "Send")!;
  assert(send);
  await page.evaluate(() => {
    const link = document.createElement("a"); link.href = "#new"; link.textContent = "New conversation";
    document.body.prepend(link);
    document.body.prepend(document.querySelector("#send")!.cloneNode(true));
    document.querySelectorAll("#send")[1]!.setAttribute("aria-pressed", "true");
  });
  const state = await probeElementState(frame as never, send);
  assert.equal(state?.label, "Send");
  assert.equal(state?.checked, true);
}]);

cases.push(["covered target never receives a synthetic click", async () => {
  await page.setContent(`<button id="send" style="width:120px;height:40px">Send</button>`);
  const send = (await observe()).elements.find(e => e.label === "Send")!;
  await page.evaluate(() => {
    (window as unknown as { clicks: number }).clicks = 0;
    document.querySelector("#send")!.addEventListener("click", () => (window as unknown as { clicks: number }).clicks++);
    const cover = document.createElement("div"); cover.style.cssText = "position:fixed;inset:0;background:white;z-index:100"; document.body.append(cover);
  });
  const refused = await actions.actOnAgentElement("fixture", { targetRef: send.targetRef, interaction: "click", verification: "fast" });
  await inputQueue;
  assert.equal(refused.ok, false);
  assert.equal(await page.evaluate(() => (window as unknown as { clicks: number }).clicks), 0);
}]);

cases.push(["map and act share shadow-root and same-origin frame targets", async () => {
  await page.setContent(`<div id="host"></div><iframe srcdoc="<button>Frame action</button>"></iframe>`);
  await page.locator("iframe").evaluate((frame: HTMLIFrameElement) => new Promise<void>(resolve => {
    if (frame.contentDocument?.readyState === "complete") resolve(); else frame.addEventListener("load", () => resolve(), { once: true });
  }));
  await page.evaluate(() => document.querySelector("#host")!.attachShadow({ mode: "open" }).innerHTML = "<button>Shadow action</button>");
  const map = await observe();
  for (const label of ["Shadow action", "Frame action"]) {
    const element = map.elements.find(e => e.label === label);
    assert(element, map.mapAppendix);
    const prepared = await page.evaluate(activateStampedSurfaceScript(element.targetRef));
    assert(prepared?.trusted, JSON.stringify(prepared));
  }
}]);

cases.push(["fill then click waits for enable and submits exactly once", async () => {
  await page.setContent(`<form><textarea aria-label="Message"></textarea><button id="send" disabled>Send</button></form><output></output>
    <script>
      let sent=0;
      document.querySelector('textarea').addEventListener('input',()=>setTimeout(()=>document.querySelector('#send').disabled=false,80));
      document.querySelector('form').addEventListener('submit',event=>{event.preventDefault();document.querySelector('output').textContent='Sent '+(++sent)+': '+document.querySelector('textarea').value;document.querySelector('textarea').value='';});
    </script>`);
  const map = await observe();
  const field = map.elements.find(e => e.label === "Message")!;
  const send = map.elements.find(e => e.label === "Send")!;
  assert(field && send, map.mapAppendix);
  const typed = await inputs.typeIntoAgentElement("fixture", { fields: [{ targetRef: field.targetRef, text: "Hello" }], text: "", verification: "fast" });
  assert(typed.ok, JSON.stringify(typed));
  const clicked = await actions.actOnAgentElement("fixture", { targetRef: send.targetRef, interaction: "click", verification: "fast" });
  await inputQueue;
  assert(clicked.ok, JSON.stringify(clicked));
  assert.equal(await page.locator("output").textContent(), "Sent 1: Hello");
  assert.equal(await page.locator("textarea").inputValue(), "");
  assert(clicked.afterObservationId, "action did not return a fresh map");
}]);

cases.push(["menu to confirmation to deletion uses maps returned by actions", async () => {
  await page.setContent(`<div id="conversation">Fixture conversation <button id="more">More</button></div><div id="portal"></div>
    <script>
      document.querySelector('#more').onclick=()=>document.querySelector('#portal').innerHTML='<button id="delete">Delete</button>';
      document.addEventListener('click',event=>{
        if(event.target.id==='delete') document.querySelector('#portal').innerHTML='<div role="dialog" aria-modal="true" style="position:fixed;inset:0;background:white"><button id="confirm">Delete chat</button><button>Cancel</button></div>';
        if(event.target.id==='confirm') {document.querySelector('#conversation').remove();document.querySelector('#portal').replaceChildren();}
      });
    </script>`);
  await observe();
  for (const label of ["More", "Delete", "Delete chat"]) {
    const element = stateStore.readBrowserAgentCacheEntry("fixture", "live")?.elements.find(e => e.label === label);
    assert(element, `returned map missing ${label}`);
    const result = await actions.actOnAgentElement("fixture", { targetRef: element.targetRef, interaction: "click", verification: "fast" });
    await inputQueue;
    assert(result.ok, JSON.stringify(result));
    if (label === "More") assert(result.message?.includes("Delete"), result.message);
    if (label === "Delete") assert(result.message?.includes("Delete chat"), result.message);
  }
  assert.equal(await page.locator("#conversation").count(), 0);
  assert.equal(await page.getByRole("dialog").count(), 0);
}]);

cases.push(["React controlled composer rerenders and moves before a single submit", async () => {
  await page.setContent(`<div id="root"></div>`);
  await page.addScriptTag({ path: fileURLToPath(new URL("../node_modules/react/umd/react.development.js", import.meta.url)) });
  await page.addScriptTag({ path: fileURLToPath(new URL("../node_modules/react-dom/umd/react-dom.development.js", import.meta.url)) });
  await page.addScriptTag({ content: `
    const h=React.createElement;
    function Composer() {
      const [value,setValue]=React.useState('');
      const [ready,setReady]=React.useState(false);
      const [sent,setSent]=React.useState(0);
      React.useEffect(()=>{const timer=setTimeout(()=>setReady(!!value),80);return()=>clearTimeout(timer)},[value]);
      return h('form',{onSubmit:e=>{e.preventDefault();setSent(n=>n+1);setValue('')}},
        value ? h('a',{href:'#new'},'New history row') : null,
        h('textarea',{'aria-label':'Message',value,onChange:e=>setValue(e.target.value),style:{display:'block',height:value?'160px':'40px'}}),
        h('button',{disabled:!ready},'Send'),h('output',null,'Sent '+sent));
    }
    ReactDOM.createRoot(document.querySelector('#root')).render(h(Composer));
  ` });
  await page.getByRole("textbox").waitFor();
  const map = await observe();
  const field = map.elements.find(e => e.label === "Message")!;
  const send = map.elements.find(e => e.label === "Send")!;
  const typed = await inputs.typeIntoAgentElement("fixture", { fields: [{ targetRef: field.targetRef, text: "Hello React" }], text: "", verification: "fast" });
  assert(typed.ok, JSON.stringify(typed));
  const clicked = await actions.actOnAgentElement("fixture", { targetRef: send.targetRef, interaction: "click", verification: "fast" });
  await inputQueue;
  assert(clicked.ok, JSON.stringify(clicked));
  assert.equal(await page.locator("output").textContent(), "Sent 1");
  assert.equal(await page.locator("textarea").inputValue(), "");
}]);

cases.push(["pointer-transparent paint decoration cannot hide actionable dialog buttons", async () => {
  await page.setContent(`<style>.decoration{position:fixed;inset:0;z-index:20;background:#fffa;pointer-events:none}</style>
    <div role="dialog" aria-modal="true"><button>Cancel</button><button>Delete chat</button></div><div class="decoration"></div>`);
  const map = await observe();
  assert(map.elements.some(e => e.label === "Delete chat"), map.mapAppendix);
  assert(map.elements.some(e => e.label === "Cancel"), map.mapAppendix);
}]);

cases.push(["cached input refs cannot bypass disabled, readonly, or covered fields", async () => {
  for (const state of ["disabled", "readonly", "covered"]) {
    await page.setContent(`<input aria-label="Name" value="original">`);
    const field = (await observe()).elements.find(e => e.label === "Name")!;
    await page.evaluate(state => {
      const input = document.querySelector("input")!;
      if (state === "disabled") input.disabled = true;
      else if (state === "readonly") input.readOnly = true;
      else {
        const cover = document.createElement("div"); cover.style.cssText = "position:fixed;inset:0;background:white;z-index:99"; document.body.append(cover);
      }
    }, state);
    const result = await inputs.typeIntoAgentElement("fixture", { fields: [{ targetRef: field.targetRef, text: "replacement", clear: true }], text: "", verification: "fast" });
    assert.equal(result.ok, false, `${state} field accepted input`);
    assert.equal(await page.locator("input").inputValue(), "original");
  }
}]);

cases.push(["form requirements, errors, descriptions and multiple selections reach the map without events", async () => {
  await page.setContent(`<form aria-label="Profile"><label for="email">Email</label><input id="email" type="email" required value="invalid" aria-describedby="hint extra" aria-errormessage="error" aria-invalid="true"><p id="hint">Use your work email.</p><p id="extra">We send a verification link.</p><p id="error">Address is not accepted</p><input aria-label="Account ID" readonly value="123"><input aria-label="Code" pattern="[0-9]{6}" minlength="6" maxlength="6"><select aria-label="Languages" multiple><option selected>English</option><option selected>Chinese</option></select><button disabled>Save</button></form>
    <script>window.invalidEvents=0;document.addEventListener('invalid',()=>window.invalidEvents++,true)</script>`);
  const map = await observe();
  const output = map.mapAppendix ?? "";
  for (const value of ["required", "invalid=true", "Address is not accepted", "Use your work email. We send a verification link.", "readonly", 'pattern="[0-9]{6}"', "English, Chinese", "Profile"]) assert(output.includes(value), `${value} missing: ${output}`);
  assert(!output.includes("disabled until"));
  assert.equal(await page.evaluate(() => (window as unknown as { invalidEvents: number }).invalidEvents), 0);
}]);

cases.push(["independent control states keep mixed and unknown distinct from off", async () => {
  await page.setContent(`<div role="switch" aria-label="Unknown switch" tabindex="0">Unknown</div><div role="switch" data-state="on" aria-label="Data switch" tabindex="0">Data</div><input type="checkbox" aria-label="Partial"><button aria-label="Tools" aria-expanded="false" aria-pressed="true">Tools</button><button role="tab" aria-selected="false">First</button><button role="tab" aria-selected="true">Second</button><a href="#page" aria-current="page">Page one</a><details open><summary>Advanced</summary><p>Options</p></details>`);
  await page.locator('input').evaluate((node: HTMLInputElement) => { node.indeterminate = true; });
  const map = await observe();
  const line = (name: string) => (map.mapAppendix ?? "").split("\n").find(line => line.includes('"' + name + '"')) ?? "";
  assert(line("Unknown switch").includes("checked=unknown"), map.mapAppendix);
  assert(line("Data switch").includes(" on"), map.mapAppendix);
  assert(line("Partial").includes("checked=mixed"), map.mapAppendix);
  assert(line("Tools").includes("pressed=true") && line("Tools").includes("collapsed"), map.mapAppendix);
  assert(line("Second").includes("selected"), map.mapAppendix);
  assert(line("Page one").includes("current=page"), map.mapAppendix);
  assert(line("Advanced").includes("expanded"), map.mapAppendix);
}]);

cases.push(["shadow focus and active descendant identify the keyboard destination", async () => {
  await page.setContent(`<div id="host"></div>`);
  await page.evaluate(() => {
    document.querySelector('#host')!.attachShadow({ mode: 'open' }).innerHTML = `<input role="combobox" aria-label="City" aria-controls="cities" aria-expanded="true" aria-activedescendant="paris" aria-describedby="hint"><p id="hint">Choose a destination</p><div role="listbox" id="cities" aria-label="Cities"><div id="london" role="option">London</div><div id="paris" role="option" aria-selected="true">Paris</div></div>`;
  });
  await page.locator('input').focus();
  const map = await observe();
  const city = map.elements.find(e => e.label === "City")!;
  assert(city?.semantics?.focused, map.mapAppendix);
  assert.equal(map.activeElementId, city.id);
  for (const value of ["activeCandidate=", "Paris", "Cities", "Choose a destination", "expanded"]) assert(map.mapAppendix?.includes(value), map.mapAppendix);
  assert(map.pageNotes?.some(note => note.kind === "focus" && note.text.includes(city.targetRef)));
}]);

cases.push(["opening a confirmation returns its subject, description and complete new controls", async () => {
  await page.setContent(`<button id="open" onclick="document.querySelector('dialog').showModal()">Delete</button><dialog aria-labelledby="title" aria-describedby="body"><h2 id="title">Delete conversation Alpha?</h2><p id="body">This permanently deletes Alpha and its messages.</p><button disabled>Confirm</button><button>Cancel</button></dialog>`);
  const open = (await observe()).elements.find(e => e.label === "Delete")!;
  const result = await actions.actOnAgentElement("fixture", { targetRef: open.targetRef, interaction: "click", verification: "fast" });
  await inputQueue;
  assert(result.ok, JSON.stringify(result));
  for (const value of ["Delete conversation Alpha?", "permanently deletes Alpha", "Confirm", "disabled", "dialog:"]) assert(result.message?.includes(value), result.message);
}]);

cases.push(["successful save appears in the click receipt even when buttons do not change", async () => {
  await page.setContent(`<button onclick="document.querySelector('output').textContent='Saved successfully'">Save</button><output></output>`);
  const save = (await observe()).elements.find(e => e.label === "Save")!;
  const result = await actions.actOnAgentElement("fixture", { targetRef: save.targetRef, interaction: "click", verification: "fast" });
  await inputQueue;
  assert(result.ok, JSON.stringify(result));
  assert(result.message?.includes("Saved successfully"), result.message);
  assert(!result.message?.includes("Controls unchanged"), result.message);
  assert(!(await observe()).elements.some(e => e.label === "Saved successfully"), "Result message became an action target");
}]);

cases.push(["transient alerts survive until the next map; hidden text is excluded", async () => {
  await page.setContent(`<button>Save</button><div id="area"></div><div role="alert" hidden>Hidden internal error</div><progress aria-label="Upload" value="30" max="100"></progress><div aria-label="Results" aria-busy="true"></div>`);
  await observe();
  await page.evaluate(() => {
    const alert = document.createElement('div'); alert.setAttribute('role', 'alert'); alert.textContent = 'Upload rejected'; document.querySelector('#area')!.append(alert);
  });
  await page.evaluate(() => document.querySelector('#area')!.replaceChildren());
  const map = await observe();
  for (const value of ["recent: alert: Upload rejected", "Upload: 30/100", "Results is busy"]) assert(map.mapAppendix?.includes(value), map.mapAppendix);
  assert(!map.mapAppendix?.includes("Hidden internal error"), map.mapAppendix);
}]);

cases.push(["same-origin frame descriptions and read-only status keep their own context", async () => {
  await page.setContent(`<iframe srcdoc='<input aria-label="Email" aria-describedby="hint" required><p id="hint">Frame address</p><div role="status">Frame ready</div>'></iframe>`);
  await page.locator("iframe").evaluate((frame: HTMLIFrameElement) => new Promise<void>(resolve => {
    if (frame.contentDocument?.readyState === "complete") resolve(); else frame.addEventListener("load", () => resolve(), { once: true });
  }));
  const map = await observe();
  for (const value of ["Frame address", "Frame ready", "required"]) assert(map.mapAppendix?.includes(value), map.mapAppendix);
}]);

cases.push(["typing returns live validation without a separate map request", async () => {
  await page.setContent(`<input type="email" aria-label="Email" required><button disabled>Save</button>`);
  const email = (await observe()).elements.find(e => e.label === "Email")!;
  const result = await inputs.typeIntoAgentElement("fixture", { targetRef: email.targetRef, text: "invalid-address", clear: true, verification: "fast" });
  assert(result.ok, JSON.stringify(result));
  assert(result.message?.includes("invalid=true"), result.message);
  assert(result.message?.includes("error="), result.message);
}]);

cases.push(["keyboard actions return the changed active candidate without screenshots", async () => {
  await page.setContent(`<input role="combobox" aria-label="City" aria-controls="cities" aria-expanded="true" aria-activedescendant="london" onkeydown="if(event.key==='ArrowDown')this.setAttribute('aria-activedescendant','paris')"><div id="cities" role="listbox" aria-label="Cities"><div role="option" id="london">London</div><div role="option" id="paris">Paris</div></div>`);
  await page.locator('input').focus();
  await observe();
  const result = await inputs.pressAgentKey("fixture", { key: "ArrowDown" });
  await inputQueue;
  assert(result.ok, JSON.stringify(result));
  assert.equal(result.verification, "fast");
  assert(result.message?.includes("activeCandidate=") && result.message.includes("Paris"), result.message);
}]);

cases.push(["native and ARIA inherited restrictions appear before attempting input", async () => {
  await page.setContent(`<fieldset disabled><legend>Locked profile</legend><input aria-label="Name"></fieldset><div aria-disabled="true"><button>Locked action</button></div><div aria-readonly="true"><input aria-label="Readonly account"></div><span id="account">Account email</span><input aria-labelledby="account" placeholder="Wrong fallback"><div role="row"><span>Invoice Alpha</span><button>Delete invoice</button></div>`);
  const map = await observe();
  assert(map.elements.find(e => e.label === "Name")?.disabled, map.mapAppendix);
  assert(map.elements.find(e => e.label === "Locked action")?.disabled, map.mapAppendix);
  assert(map.elements.find(e => e.label === "Readonly account")?.semantics?.readOnly, map.mapAppendix);
  assert(map.elements.some(e => e.label === "Account email"), map.mapAppendix);
  assert(map.elements.find(e => e.label === "Delete invoice")?.semantics?.context?.some(value => value.includes("Invoice Alpha")), map.mapAppendix);
}]);

cases.push(["non-selection input types use native values and return their constraints", async () => {
  await page.setContent(`<input type="number" aria-label="Quantity" min="1" max="5" value="1"><input type="date" aria-label="Date">`);
  const map = await observe();
  const quantity = map.elements.find(e => e.label === "Quantity")!;
  const date = map.elements.find(e => e.label === "Date")!;
  const result = await inputs.typeIntoAgentElement("fixture", { fields: [{ targetRef: quantity.targetRef, text: "10", clear: true }, { targetRef: date.targetRef, text: "2026-09-25", clear: true }], text: "", verification: "fast" });
  assert(result.ok, JSON.stringify(result));
  assert.equal(await page.locator('[type=number]').inputValue(), "10");
  assert.equal(await page.locator('[type=date]').inputValue(), "2026-09-25");
  assert(result.message?.includes("invalid=true") && result.message.includes('max="5"'), result.message);
}]);


cases.push(["passive names cover SVG, tooltip attributes, linked tips, pseudo text and nested ownership", async () => {
  await page.setContent(`<style>button{width:36px;height:36px;margin:10px} #pseudo::before{content:'Save'}</style>
    <button id="svg"><svg><title>Open sidebar</title><path d="M0 0"></path></svg></button>
    <button data-tooltip="New chat"></button><button aria-describedby="tip"></button><button data-tippy-content="Help"></button>
    <div id="tip" role="tooltip" hidden>Upload files</div><button id="pseudo"></button>
    <button><span title="Settings"><svg></svg></span></button>`);
  pointerMoves.length = 0;
  const map = await observe();
  for (const name of ["Open sidebar", "New chat", "Upload files", "Save", "Settings", "Help"]) assert(map.elements.some(e => e.label === name), map.mapAppendix);
  assert.equal(pointerMoves.length, 0, "passive naming should not move the pointer");
}]);

cases.push(["map reads delayed portal tooltips, caches by node, and refreshes changed state", async () => {
  await page.setContent(`<style>button{width:34px;height:34px;margin:12px}.tip{position:fixed;background:white;padding:4px}</style>
    <button id="first" aria-expanded="false"></button><button id="second"></button><button id="third"></button>
    <script>
      window.hovers=0; window.clicks=0;
      for(const [index,node] of [...document.querySelectorAll('button')].entries()) {
        let timer,tip;
        node.onclick=()=>window.clicks++;
        node.onmouseenter=()=>{window.hovers++; timer=setTimeout(()=>{
          tip=document.createElement('div');tip.className='tip';
          if(index!==1)tip.setAttribute('role','tooltip');
          tip.textContent=index===0?(node.getAttribute('aria-expanded')==='true'?'Close sidebar':'Open sidebar'):index===1?'New chat':'Upload files';
          tip.style.left=node.getBoundingClientRect().x+'px';tip.style.top='66px';document.body.append(tip);
        },220);};
        node.onmouseleave=()=>{clearTimeout(timer);tip?.remove()};
      }
    </script>`);
  await page.mouse.move(900, 600);
  // Install the tracker through a passive receipt, then record a known position.
  await engine.observeAgentPage("fixture", { strategy: "interactiveOnly", suppressActivity: true });
  await page.mouse.move(880, 580);
  const started = performance.now();
  const map = await observe();
  for (const name of ["Open sidebar", "New chat", "Upload files"]) assert(map.elements.some(e => e.label === name), map.mapAppendix);
  assert.equal(await page.evaluate('window.clicks'), 0);
  const hovers = await page.evaluate('window.hovers');
  const again = await observe();
  assert.equal(await page.evaluate('window.hovers'), hovers, "unchanged map repeated hover discovery");
  assert.deepEqual(map.elements.map(e => e.targetRef), again.elements.map(e => e.targetRef));
  assert.deepEqual(pointerMoves.at(-1), [880, 580], "probe did not restore the pointer");
  await page.locator('#first').evaluate(node => node.setAttribute('aria-expanded','true'));
  const changed = await observe();
  assert(changed.elements.some(e => e.label === "Close sidebar"), changed.mapAppendix);
  assert(!changed.elements.some(e => e.label === "Open sidebar"), changed.mapAppendix);
  console.log(JSON.stringify({ metric: "three_delayed_tooltip_names_and_state_refresh_ms", elapsed: performance.now()-started }));
}]);

cases.push(["tooltip discovery reaches portals after a long document without scanning its prefix", async () => {
  await page.setContent(`<style>button{position:fixed;left:8px;top:8px;width:32px;height:32px}</style>
    <button></button><main>${"<span>old content</span>".repeat(4200)}</main>
    <script>document.querySelector('button').onmouseenter=()=>setTimeout(()=>{
      const tip=document.createElement('div');tip.style='position:fixed;left:8px;top:48px';
      tip.textContent='Manage conversations';document.body.append(tip);
    },120)</script>`);
  await page.mouse.move(900,600);
  const map = await observe();
  assert(map.elements.some(e=>e.label==='Manage conversations'), 'late portal tooltip was omitted');
}]);

cases.push(["explicit hover reads late tooltips in its receipt without another map or screenshot", async () => {
  await page.setContent(`<button style="width:32px;height:32px" id="target"></button>
    <script>document.querySelector('button').onmouseenter=()=>setTimeout(()=>{
      const tip=document.createElement('div');tip.role='tooltip';tip.style='position:fixed;top:50px;left:8px';tip.textContent='Manage chats';document.body.append(tip);
    },780)</script>`);
  const map = await engine.observeAgentPage("fixture", { strategy: "interactiveOnly", suppressActivity: true });
  const result = await actions.actOnAgentElement("fixture", { interaction: "hover", targetRef: map.elements[0]!.targetRef, verification: "fast" });
  assert(result.ok, JSON.stringify(result));
  assert(result.message?.includes('Manage chats'), result.message);
}]);

cases.push(["unknown purpose stays explicit, unrelated live text is not a name, misses are cached", async () => {
  await page.setContent(`<button style="width:32px;height:32px" id="unknown"></button><div role="status" style="position:fixed;top:45px">Ready</div>
    <script>window.clicks=0;document.querySelector('button').onclick=()=>window.clicks++;document.querySelector('button').onmouseenter=()=>document.querySelector('[role=status]').textContent='Delete everything';</script>`);
  const map = await observe();
  assert(!map.elements.some(e => e.label === 'Delete everything'), map.mapAppendix);
  assert(map.mapAppendix?.includes('purpose=unknown') && map.mapAppendix.includes('x='), map.mapAppendix);
  assert(!map.mapAppendix?.includes('(no label)'), map.mapAppendix);
  assert.equal(await page.evaluate('window.clicks'), 0);
  pointerMoves.length=0;
  await observe();
  assert.equal(pointerMoves.length,0,'unchanged unnamed node was probed again');
}]);

cases.push(["inherited cursor produces one icon owner and keeps distinct nested controls", async () => {
  await page.setContent(`<style>.icon{width:32px;height:32px;cursor:pointer}.icon svg{width:32px;height:32px}.composer{cursor:text;width:300px}.row{display:block;width:240px;height:40px;position:relative}.more{position:absolute;right:0;top:4px;width:28px;height:28px;cursor:pointer}</style>
    <div class="icon" data-tooltip="Open sidebar"><svg><path d="M0 0"></path></svg></div>
    <div class="composer"><div><textarea aria-label="Message"></textarea><button>Search</button></div></div>
    <a class="row" href="#chat">Conversation<div class="more"><svg><title>More</title></svg></div></a>`);
  const map = await observe();
  assert.equal(map.elements.filter(e => e.label === "Open sidebar").length, 1, map.mapAppendix);
  assert.equal(map.elements.filter(e => e.tagName === "svg").length, 0, map.mapAppendix);
  assert.equal(map.elements.length, 5, map.mapAppendix);
  for (const name of ["Message","Search","Conversation","More"]) assert(map.elements.some(e=>e.label===name),map.mapAppendix);
  await page.evaluate(() => {
    (window as any).menuClicks=0; (window as any).rowClicks=0;
    document.querySelector('.more')!.addEventListener('click',event=>{event.stopPropagation();event.preventDefault();(window as any).menuClicks++;});
    document.querySelector('.row')!.addEventListener('click',()=>(window as any).rowClicks++);
  });
  const menu=map.elements.find(e=>e.label==='More')!;
  const clicked=await actions.actOnAgentElement('fixture',{interaction:'click',targetRef:menu.targetRef,verification:'fast'});
  await inputQueue;
  assert(clicked.ok,JSON.stringify(clicked));
  assert.equal(await page.evaluate('window.menuClicks'),1);
  assert.equal(await page.evaluate('window.rowClicks'),0);
}]);


cases.push(["tooltip association works inside open shadow roots and same-origin frames", async () => {
  await page.setContent(`<div id="host"></div><iframe style="margin-left:200px" srcdoc="<button style='width:32px;height:32px'></button>"></iframe>`);
  await page.locator('iframe').evaluate((frame: HTMLIFrameElement) => new Promise<void>(resolve => {
    if(frame.contentDocument?.readyState==='complete') resolve(); else frame.onload=()=>resolve();
  }));
  await page.evaluate(() => {
    const root = document.querySelector('#host')!.attachShadow({mode:'open'});
    root.innerHTML='<button style="width:32px;height:32px"></button>';
    for (const container of [root,document.querySelector('iframe')!.contentDocument!]) {
      const node = container.querySelector('button')!;
      node.addEventListener('mouseenter',()=>{
        const tip=node.ownerDocument.createElement('div');tip.role='tooltip';tip.textContent=container===root?'Shadow action':'Frame action';
        const box=node.getBoundingClientRect();tip.style.cssText=`position:fixed;left:${box.x}px;top:${box.bottom+6}px`;
        (container.nodeType === 9 ? (container as Document).body : container).append(tip);
        node.addEventListener('mouseleave',()=>tip.remove(),{once:true});
      });
    }
  });
  const map = await observe();
  for (const name of ['Shadow action','Frame action']) assert(map.elements.some(e=>e.label===name),map.mapAppendix);
}]);

cases.push(["ambiguous tooltips stay unresolved and cached names do not cross replacement nodes", async () => {
  await page.setContent(`<button id="target" style="width:32px;height:32px"></button><script>
    document.querySelector('button').onmouseenter=()=>{
      for(const [i,text] of ['Archive','Delete'].entries()) {
        const tip=document.createElement('div');tip.role='tooltip';tip.style='position:fixed;left:8px;top:'+(50+i*20)+'px';tip.textContent=text;document.body.append(tip);
      }
    };
  </script>`);
  let map=await observe();
  assert(map.elements.every(e=>e.label!=='Archive' && e.label!=='Delete'),map.mapAppendix);
  assert(map.mapAppendix?.includes('no unambiguous tooltip found during bounded hover'),map.mapAppendix);
  await page.evaluate(()=>{
    document.querySelectorAll('[role=tooltip]').forEach(e=>e.remove());
    const node=document.querySelector('button')!;
    node.replaceWith(node.cloneNode(true));
    document.querySelector('button')!.setAttribute('data-tooltip','Newly created action');
  });
  const oldRef=map.elements[0]!.targetRef;
  map=await observe();
  assert.equal(map.elements[0]?.label,'Newly created action');
  assert.notEqual(map.elements[0]?.targetRef,oldRef);
}]);


cases.push(["removing a tooltip content attribute invalidates cached hover evidence", async () => {
  await page.setContent('<button style="width:32px;height:32px" data-tooltip-content="Old action"></button>');
  const map=await observe();
  assert.equal(map.elements[0]?.label,'Old action');
  const hover=await actions.actOnAgentElement('fixture',{interaction:'hover',targetRef:map.elements[0]!.targetRef,verification:'fast'});
  assert(hover.ok);
  await page.locator('button').evaluate(node=>node.removeAttribute('data-tooltip-content'));
  const changed=await observe();
  assert(!changed.elements.some(e=>e.label==='Old action'),changed.mapAppendix);
  assert(changed.mapAppendix?.includes('purpose=unknown'),changed.mapAppendix);
}]);

cases.push(["delayed sidebar, overlapping portal menu, plain div dialog and async deletion need only returned maps", async () => {
  await page.setContent(`<style>
    #sidebar{display:none;position:absolute;top:60px;left:12px;width:236px}
    a{display:block;position:relative;width:236px;height:40px;line-height:40px}
    .more{position:absolute;right:4px;top:6px;width:28px;height:28px;cursor:pointer}
    #menu{position:absolute;left:210px;top:104px;background:white;z-index:3;width:150px}
    .item{height:40px;display:flex;gap:10px;align-items:center;cursor:pointer}
    svg{width:14px;height:14px;margin-left:8px}
    [role=dialog]{position:fixed;inset:0;padding:80px 300px;background:white;z-index:5}
  </style><button id="open">Open sidebar</button><aside id="sidebar">
    <a href="#latest">Latest conversation</a><a href="#other">Other conversation</a><a href="#third">Third conversation</a>
  </aside><div id="portal"></div><div hidden>HIDDEN HISTORY AND SCRIPT MUST NOT LEAK</div>
  <script>
    const sidebar=document.querySelector('#sidebar'), portal=document.querySelector('#portal');
    document.querySelector('#open').onclick=()=>setTimeout(()=>sidebar.style.display='block',140);
    const latest=sidebar.querySelector('a');
    latest.onmouseenter=()=>setTimeout(()=>{
      if(latest.querySelector('.more'))return;
      latest.insertAdjacentHTML('beforeend','<div role="button" class="more"></div>');
      latest.querySelector('.more').onclick=e=>{
        e.preventDefault();e.stopPropagation();
        setTimeout(()=>portal.innerHTML='<div id="menu"><div class="item"><svg><path d="M0 0h10v10z"/></svg><span>Rename</span></div><div class="item" id="delete"><svg><path d="M0 0h10v10z"/></svg><span>Delete</span></div></div>',100);
      };
    },90);
    document.addEventListener('click',e=>{
      if(e.target.closest('#delete')){
        portal.replaceChildren();
        setTimeout(()=>portal.innerHTML='<div role="dialog" aria-modal="true"><div>Delete Latest conversation?</div><div>This chat cannot be recovered. Share links will be disabled.</div><div hidden>DO NOT REPORT HIDDEN TEXT</div><button>Cancel</button><button id="confirm">Delete chat</button></div>',120);
      }
      if(e.target.id==='confirm'){
        e.target.closest('[role=dialog]').setAttribute('aria-busy','true');
        setTimeout(()=>{latest.remove();portal.replaceChildren();},260);
      }
    });
  </script>`);
  let map = await observe();
  const initialMoves = pointerMoves.length;
  const start = performance.now();
  const act = async (label: string, interaction: "click" | "hover" = "click") => {
    const element = stateStore.readBrowserAgentCacheEntry('fixture','live')!.elements.find(e=>e.label===label);
    assert(element, 'returned map omitted '+label);
    const result = await actions.actOnAgentElement('fixture',{targetRef:element.targetRef,interaction,verification:'fast'});
    await inputQueue;
    assert(result.ok,JSON.stringify(result));
    assert.equal(result.surfaceChange?.changed,true,JSON.stringify(result));
    assert.equal(result.surfaceChange?.settled,true,JSON.stringify(result));
    assert.equal(nextRecommendedActionAfterFastLumenAction(result as unknown as Record<string,unknown>),'continue_with_cached_targets');
    assert(!('warning' in result),JSON.stringify(result));
    return result;
  };
  const opened=await act('Open sidebar');
  assert(opened.message?.includes('Latest conversation'),opened.message);
  const hovered=await act('Latest conversation','hover');
  assert(hovered.message?.includes('icon at the end of "Latest conversation"'),hovered.message);
  assert((hovered.runtimeCostMs??Infinity)<1000,'named row hover waited for a tooltip name');
  map=stateStore.readBrowserAgentCacheEntry('fixture','live')! as typeof map;
  const row=map.elements.find(e=>e.label==='Latest conversation')!;
  const more=map.elements.find(e=>e.ancestorTargetRefs?.includes(row.targetRef))!;
  assert(more,hovered.message);
  const menu=await actions.actOnAgentElement('fixture',{targetRef:more.targetRef,interaction:'click',verification:'fast'});
  await inputQueue;
  assert(menu.message?.includes('Observed after click') && menu.message.includes('Latest conversation'),menu.message);
  const addedLines=menu.message?.split('\n').filter(line=>line.startsWith('Added ')).join('\n')??'';
  assert(!addedLines.includes('icon at the end of "Other conversation"'),menu.message);
  assert(!addedLines.includes('icon at the end of "Third conversation"'),menu.message);
  const confirmation=await act('Delete');
  assert(confirmation.message?.includes('This chat cannot be recovered'),confirmation.message);
  assert(confirmation.message?.includes('Delete Latest conversation?'),confirmation.message);
  assert(!confirmation.message?.includes('DO NOT REPORT HIDDEN TEXT'),confirmation.message);
  assert(!confirmation.message?.includes('detached: '+row.targetRef), 'covered row was reported deleted');
  const read=await page.evaluate(buildVisiblePageReadScript('viewport',4000)) as {text:string};
  assert(read.text.includes('Latest conversation?'),read.text);
  assert(!read.text.includes('Other conversation') && !read.text.includes('HIDDEN'),read.text);
  const deleted=await act('Delete chat');
  assert(deleted.message?.includes('detached: '+row.targetRef+' "Latest conversation"'),deleted.message);
  assert.equal(await page.locator('a[href="#latest"]').count(),0);
  assert.equal(await page.locator('aside a').count(),2);
  assert.equal(await page.locator('[role=dialog]').count(),0);
  console.log(JSON.stringify({metric:'delayed_nonvisual_delete_ms',elapsed:performance.now()-start,inputEvents:pointerMoves.length-initialMoves,actions:5,screenshots:0}));
}]);

cases.push(["viewport reads exclude collapsed and clipped text; full reads retain rendered offscreen text", async () => {
  await page.setContent(`<button>Visible button</button><div style="display:none">Collapsed history</div>
    <div aria-hidden="true">ARIA hidden</div><div style="opacity:0">Transparent text</div>
    <div style="height:20px;overflow:hidden"><div style="padding-top:50px">Clipped text</div></div>
    <div style="position:absolute;top:1100px">Offscreen rendered text</div>
    <div id="host"></div><script>document.querySelector('#host').attachShadow({mode:'open'}).innerHTML='<span>Shadow text</span>'</script>`);
  const viewport=await page.evaluate(buildVisiblePageReadScript('viewport',4000)) as {text:string};
  assert(viewport.text.includes('Visible button') && viewport.text.includes('Shadow text'),viewport.text);
  for(const absent of ['Collapsed','ARIA hidden','Transparent','Clipped','Offscreen','attachShadow'])assert(!viewport.text.includes(absent),viewport.text);
  const full=await page.evaluate(buildVisiblePageReadScript('full',12000)) as {text:string};
  assert(full.text.includes('Offscreen rendered text'),full.text);
  assert(!full.text.includes('Collapsed') && !full.text.includes('attachShadow'),full.text);
}]);

cases.push(["a paused stream stays pending until its observed stop control disappears", async () => {
  await page.setContent(`<main aria-busy="true"><p id="answer">Partial answer</p><button id="stop">Stop generating</button></main>`);
  const map = await observe();
  const stop = map.elements.find(e=>e.label==='Stop generating')!;
  assert(stop, map.mapAppendix);
  const reader = { readAgentPage: async (_tabId: string, request: { waitTargetRef?: string }) => {
    const raw = await page.evaluate(buildVisiblePageReadScript('viewport', 4000, request.waitTargetRef));
    return { ...raw, content: raw.text };
  } } as unknown as Parameters<typeof waitForLumenPage>[0];
  const paused = await waitForLumenPage(reader, 'fixture', { targetMode:'live', until:'textStable', idleMs:20, timeoutMs:700 });
  assert.equal(paused.matched, false, 'stream pause was treated as completion');
  await page.evaluate(() => setTimeout(() => {
    document.querySelector('#answer')!.textContent='Complete answer including the final sentence';
    document.querySelector('main')!.setAttribute('aria-busy','false');
    document.querySelector('#stop')!.remove();
  }, 300));
  const complete = await waitForLumenPage(reader, 'fixture', { targetMode:'live', until:'targetHidden', targetRef:stop.targetRef, idleMs:20, timeoutMs:2000 });
  assert.equal(complete.matched,true);
  assert(complete.content.content.includes('final sentence'),complete.content.content);
  assert(complete.elapsedMs>=250,'wait returned before the stop control disappeared');
}]);

cases.push(["viewport reads follow browser clipping for positioned application content", async () => {
  for (const position of ["fixed", "absolute"]) {
    await page.setContent(`<!doctype html><style>body{margin:0;overflow:hidden}main{position:${position};inset:0}</style>
      <main><p>Visible chat answer</p><textarea aria-label="Message"></textarea></main>`);
    assert.equal(await page.locator('body').evaluate(node => node.getBoundingClientRect().height), 0);
    assert(await page.locator('p').isVisible());
    const result = await page.evaluate(buildVisiblePageReadScript('viewport', 4000)) as { text: string };
    assert(result.text.includes('Visible chat answer'), `${position}: ${JSON.stringify(result)}`);
  }
  await page.setContent(`<!doctype html><style>body{margin:0}#outer{position:relative}#clip{height:0;overflow:hidden}
    #absolute{position:absolute;top:20px}#fixed{position:fixed;top:60px}</style>
    <div id="outer"><div id="clip"><p id="absolute">Absolute answer</p><p id="fixed">Fixed answer</p><p>Clipped answer</p></div></div>`);
  const escaped = await page.evaluate(buildVisiblePageReadScript('viewport', 4000)) as { text: string };
  assert(escaped.text.includes('Absolute answer') && escaped.text.includes('Fixed answer'), escaped.text);
  assert(!escaped.text.includes('Clipped answer'), escaped.text);
  await page.locator('#clip').evaluate(node => { (node as HTMLElement).style.transform = 'translateZ(0)'; });
  const contained = await page.evaluate(buildVisiblePageReadScript('viewport', 4000)) as { text: string };
  assert.equal(contained.text, '', 'a transformed clipping container must still clip positioned children');
}]);

cases.push(["async selection does not depend on the trigger button changing", async () => {
  await page.setContent(`<button role="combobox" onclick="setTimeout(()=>document.querySelector('#portal').innerHTML='<div role=option tabindex=0>Paris</div>',140)">City</button><div id="portal"></div><output></output>
    <script>document.addEventListener('click',e=>{if(e.target.getAttribute('role')==='option'){document.querySelector('output').textContent='Selected Paris';document.querySelector('#portal').replaceChildren();}})</script>`);
  const city=(await observe()).elements.find(e=>e.label==='City')!;
  const selected=await actions.actOnAgentElement('fixture',{targetRef:city.targetRef,interaction:'select',optionLabel:'Paris',verification:'fast'});
  await inputQueue;
  assert(selected.ok,JSON.stringify(selected));
  assert(selected.message?.includes('Selected Paris'),selected.message);
}]);

cases.push(["no-effect clicks remain unsettled and moving a node is not deletion evidence", async () => {
  await page.setContent(`<button>No effect</button><div id="one"><a href="#target">Target row</a></div><div id="two"></div>`);
  const map=await observe();
  const button=map.elements.find(e=>e.label==='No effect')!;
  const result=await actions.actOnAgentElement('fixture',{targetRef:button.targetRef,interaction:'click',verification:'fast'});
  assert.equal(result.surfaceChange?.changed,false,JSON.stringify(result));
  assert.equal(result.surfaceChange?.settled,false,JSON.stringify(result));
  assert.equal(result.nextRecommendedAction,'lyra_lumen.wait');
  await page.evaluate(()=>document.querySelector('#two')!.append(document.querySelector('a')!));
  const moved=await observe();
  assert(!moved.pageNotes?.some(n=>n.text.includes('detached:') && n.text.includes('Target row')),JSON.stringify(moved.pageNotes));
}]);

cases.push(["cursor vocabulary covers all 36 computed styles without pointer sweeps", async () => {
  const keywords=Object.keys(CURSOR_DEFINITIONS) as BrowserCursorKeyword[];
  await page.setContent('<div style="display:grid;grid-template-columns:repeat(6,180px);gap:8px">'+keywords.map(keyword=>`<button style="cursor:${keyword};height:45px" aria-label="${keyword}">${keyword}</button>`).join('')+'</div>');
  pointerMoves.length=0;
  const map=await observe();
  assert.equal(keywords.length,36);
  assert.equal(map.elements.length,36,map.mapAppendix);
  for(const keyword of keywords){
    const element=map.elements.find(e=>e.label===keyword)!;
    assert.equal(element?.cursor?.keyword,keyword,map.mapAppendix);
    assert(!element.cursorOnly,map.mapAppendix);
    assert.equal(element.disabled,false);
    assert(element.actionCapabilities?.includes('click'),map.mapAppendix);
    assert(map.mapAppendix?.includes('cursor='+keyword),map.mapAppendix);
  }
  assert.equal(pointerMoves.length,0,'reading CSS moved the pointer');
}]);

cases.push(["cursor-only candidates remain hints while status regions are read-only", async () => {
  const entries=Object.entries(CURSOR_DEFINITIONS);
  await page.setContent('<div style="display:grid;grid-template-columns:repeat(6,180px);gap:8px">'+entries.map(([keyword])=>`<div style="cursor:${keyword};height:45px" aria-label="${keyword}">${keyword}</div>`).join('')+'</div>');
  const map=await observe();
  for(const [keyword,definition] of entries){
    const element=map.elements.find(e=>e.label===keyword);
    if(definition.kind==='action'||definition.kind==='selection'){
      assert(element,keyword+' missing: '+map.mapAppendix);
      assert.equal(element.cursorOnly,true,keyword);
      assert.deepEqual(element.actionCapabilities,[],keyword+' fabricated capabilities');
      assert.equal(element.editable,false,keyword+' fabricated editability');
    } else {
      assert(!element,keyword+' became an action target');
      if(keyword!=='auto'&&keyword!=='default') assert(map.pageNotes?.some(note=>note.kind==='cursor'&&note.text.includes(keyword)),map.mapAppendix);
    }
  }
}]);

cases.push(["cursor hints survive shadow and iframe boundaries, inheritance and custom images", async () => {
  await page.setContent(`<div id="host"></div><iframe id="child"></iframe><div id="inherited" style="cursor:grab;width:200px;height:50px" aria-label="One grab region"><span>child decoration</span></div><button id="custom" aria-label="Custom cursor">Custom</button>`);
  await page.evaluate(()=>{
    document.querySelector('#host')!.attachShadow({mode:'open'}).innerHTML='<div style="cursor:col-resize;width:30px;height:45px" aria-label="Shadow column"></div>';
    const doc=(document.querySelector('#child') as HTMLIFrameElement).contentDocument!;
    doc.body.innerHTML='<div style="cursor:context-menu;width:120px;height:45px" aria-label="Frame menu">Frame</div>';
  });
  // A valid image data URL with no embedded quotes, never a network URL.
  await page.locator('#custom').evaluate((node:HTMLElement)=>node.style.cursor='url("data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==") 0 0, zoom-in');
  const map=await observe();
  assert.equal(map.elements.find(e=>e.label==='Shadow column')?.cursor?.keyword,'col-resize',map.mapAppendix);
  assert.equal(map.elements.find(e=>e.label==='Frame menu')?.cursor?.keyword,'context-menu',map.mapAppendix);
  assert.equal(map.elements.filter(e=>e.label==='One grab region').length,1,map.mapAppendix);
  assert(!map.elements.some(e=>e.label==='child decoration'),map.mapAppendix);
  const custom=map.elements.find(e=>e.label==='Custom cursor')!;
  assert.deepEqual([custom.cursor?.keyword,custom.cursor?.customImage],['zoom-in',true]);
  assert(map.mapAppendix?.includes('image appearance uninspected'),map.mapAppendix);
  assert(!map.mapAppendix?.includes('data:image'),map.mapAppendix);
}]);

cases.push(["cursor status changes never disable controls or prove an outcome", async () => {
  await page.setContent(`<style>body{cursor:wait}</style><button id="allowed" style="cursor:not-allowed" onclick="document.querySelector('output').textContent='Clicked'">Still enabled</button><button disabled style="cursor:pointer">Actually disabled</button><output></output>`);
  await page.evaluate(()=>{const node=document.createElement('div');node.textContent='JS control';node.style.cursor='wait';node.onclick=()=>{};document.body.append(node);});
  const before=await observe();
  assert.equal(before.elements.find(e=>e.label==='JS control')?.cursor?.keyword,'wait',before.mapAppendix);
  assert(!before.elements.find(e=>e.label==='JS control')?.cursorOnly,before.mapAppendix);
  assert(before.pageNotes?.some(note=>note.kind==='cursor'&&note.text.includes('wait')),before.mapAppendix);
  assert(!before.elements.some(e=>e.tagName==='body'),before.mapAppendix);
  const allowed=before.elements.find(e=>e.label==='Still enabled')!;
  assert.equal(allowed.disabled,false);
  assert.equal(before.elements.find(e=>e.label==='Actually disabled')?.disabled,true);
  await page.locator('#allowed').evaluate((node:HTMLElement)=>node.style.cursor='progress');
  await page.evaluate(()=>document.body.style.cursor='default');
  const after=await observe();
  assert.equal(compareSurface(before,after).changed,false,'CSS change verified an operation');
  const delta=compactMapObservation(before,after).observation.mapAppendix!;
  assert(delta.includes('cursor=progress'),delta);
  const clicked=await actions.actOnAgentElement('fixture',{targetRef:allowed.targetRef,interaction:'click',verification:'fast'});
  await inputQueue;
  assert(clicked.ok,JSON.stringify(clicked));
  assert(clicked.message?.includes('Clicked'),clicked.message);
}]);

cases.push(["context-menu cursor can guide a real nonvisual right-click", async () => {
  await page.setContent(`<div style="cursor:context-menu;width:200px;height:50px" aria-label="Document actions" oncontextmenu="event.preventDefault();document.querySelector('#portal').innerHTML='<button>Rename document</button>'">Document</div><div id="portal"></div>`);
  const map=await observe();
  const target=map.elements.find(e=>e.label==='Document actions')!;
  assert.equal(target?.cursor?.keyword,'context-menu',map.mapAppendix);
  const result=await actions.actOnAgentElement('fixture',{targetRef:target.targetRef,interaction:'rightClick',verification:'fast'});
  await inputQueue;
  assert(result.ok,JSON.stringify(result));
  assert(result.message?.includes('Rename document'),result.message);
}]);

cases.push(["cursor hover changes reach receipts without reporting operation success", async () => {
  await page.setContent(`<style>button{cursor:grab}button:hover{cursor:grabbing}</style><button>Drag candidate</button>`);
  const map=await observe();
  const element=map.elements[0]!;
  const result=await actions.actOnAgentElement('fixture',{targetRef:element.targetRef,interaction:'hover',verification:'fast'});
  await inputQueue;
  assert(result.ok,JSON.stringify(result));
  assert.equal(result.surfaceChange?.changed,false,JSON.stringify(result));
  assert.equal(result.surfaceChange?.cursorChanged,true,JSON.stringify(result));
  assert.equal(result.surfaceChange?.settled,true,JSON.stringify(result));
  assert(result.message?.includes('cursor=grabbing'),result.message);
  assert.equal(stateStore.readBrowserAgentCacheEntry('fixture','live')?.elements[0]?.targetRef,element.targetRef);
}]);

cases.push(["cursor resize handle remains distinct from an enclosing button", async () => {
  await page.setContent(`<button style="position:relative;cursor:pointer;width:240px;height:50px">Card<div aria-label="Resize edge" style="cursor:ew-resize;position:absolute;right:0;top:0;width:12px;height:50px"></div></button>`);
  const map=await observe();
  const handle=map.elements.find(e=>e.label==='Resize edge');
  assert.equal(handle?.cursor?.keyword,'ew-resize',map.mapAppendix);
  assert.equal(handle?.cursorOnly,true,map.mapAppendix);
  assert.equal(map.elements.filter(e=>e.tagName==='button').length,1,map.mapAppendix);
}]);

cases.push(["cursor inheritance preserves independent ARIA toggles inside one pointer row", async () => {
  await page.setContent(`<div style="cursor:pointer;display:flex;width:220px;height:36px"><div style="cursor:pointer;width:96px" aria-pressed="true">DeepThink</div><div style="cursor:pointer;width:80px" aria-pressed="false">Search</div></div>`);
  const map=await observe();
  assert.equal(map.elements.find(e=>e.label==='DeepThink')?.semantics?.pressed,true,map.mapAppendix);
  assert.equal(map.elements.find(e=>e.label==='Search')?.semantics?.pressed,false,map.mapAppendix);
  assert.equal(map.elements.length,2,map.mapAppendix);
}]);


cases.push(["large inbox map prioritizes compose and retrieves offscreen policy links without losing refs", async () => {
  await page.setContent(`<style>nav{width:700px}nav button{width:100px;height:25px}section{position:fixed;left:760px;top:60px;width:480px;height:300px;background:white}input,[contenteditable]{display:block;width:420px;height:40px}</style>
    <nav aria-label="Inbox">${Array.from({length:300},(_,i)=>`<button>Message ${i}</button>`).join('')}<a href="#policy">Privacy policy</a></nav>
    <section role="dialog" aria-label="Compose"><input aria-label="To"><input aria-label="Subject"><div role="textbox" contenteditable="true" aria-label="Message Body"></div><button>Send</button></section>`);
  const map = await observe();
  assert(map.mapAppendix!.length <= MAP_PRESENTATION_CHARS, String(map.mapAppendix!.length));
  assert(map.mapAppendix!.includes('"Subject"'), map.mapAppendix);
  assert(map.mapAppendix!.includes('"Message Body"'), map.mapAppendix);
  const policy = map.elements.find(element => element.label === "Privacy policy");
  assert(policy, "offscreen control disappeared from the action index");
  const recovered = presentBrowserMap(map, {query:"Privacy policy"});
  assert(recovered.includes(policy.targetRef), recovered);
  const result = await actions.actOnAgentElement("fixture", {targetRef:policy.targetRef, interaction:"click", verification:"fast"});
  await inputQueue;
  assert(result.ok, JSON.stringify(result));
  assert.equal(await page.evaluate('location.hash'), '#policy');
}]);

cases.push(["rich editor preserves caret, exact selection and bold through successive keyboard and typing calls", async () => {
  await page.setContent(`<div role="textbox" aria-label="Message Body" contenteditable="true" style="width:500px;min-height:200px" onclick="window.editorClicks=(window.editorClicks||0)+1"></div>`);
  const map = await observe();
  const body = map.elements.find(element => element.label === "Message Body")!;
  const type = async (text: string, clear = false) => {
    const result = await inputs.typeIntoAgentElement("fixture", {targetRef:body.targetRef, text, clear, effect:"editDraft", verification:"fast"});
    await inputQueue; assert(result.ok, JSON.stringify(result)); return result;
  };
  const press = async (key: string, options: {repeat?:number;selectText?:string;occurrence?:number} = {}) => {
    const result = await inputs.pressAgentKey("fixture", {targetRef:body.targetRef, key, ...options, effect:"editDraft", verification:"fast"});
    await inputQueue; assert(result.ok, JSON.stringify(result)); return result;
  };
  const original = "Weekend plan\nBudget: 400\nReturn by 20:00";
  await type(original, true);
  await press("Control+Home");
  await press("Shift+ArrowRight", {repeat:7});
  assert.equal(await page.evaluate('getSelection().toString()'), "Weekend");
  await type("Saturday");
  assert.match(await page.locator('[contenteditable]').innerText(), /^Saturday plan/);
  const bold = await press("Control+b", {selectText:"Budget: 400"});
  assert(bold.message?.includes('"bold":true'), bold.message);
  assert.equal(await page.locator('[contenteditable] b,[contenteditable] strong').textContent(), "Budget: 400");
  await press("Control+End");
  await type("\nRain: visit the museum");
  assert((await page.locator('[contenteditable]').innerText()).endsWith("Rain: visit the museum"));
  assert.equal(await page.evaluate('window.editorClicks || 0'), 1, "continuing input clicked again and reset selection");
  // Idempotent whole-document replacements must not fail due to textContent
  // omitting rendered paragraph separators.
  await type(original, true);
  await type(original, true);
  assert.equal(await page.locator('[contenteditable]').innerText(), original);
}]);

cases.push(["ambiguous phrase selection and focusing an activation button never send unintended input", async () => {
  await page.setContent(`<div role="textbox" contenteditable="true" aria-label="Draft">cost 500; cost 500</div><button onclick="window.sent=(window.sent||0)+1">Send</button>`);
  const map = await observe();
  const draft = map.elements.find(element => element.label === "Draft")!;
  const result = await inputs.pressAgentKey("fixture", {targetRef:draft.targetRef, key:"Control+b", selectText:"cost 500", effect:"editDraft"});
  await inputQueue;
  assert.equal(result.ok, false);
  assert.equal(result.error?.kind, "selection_ambiguous");
  assert.equal(await page.locator('b,strong').count(), 0);
  const button = map.elements.find(element => element.label === "Send")!;
  const focused = await inputs.pressAgentKey("fixture", {targetRef:button.targetRef,key:"ArrowLeft",effect:"observe"});
  await inputQueue;
  assert(focused.ok, JSON.stringify(focused));
  assert.equal(await page.evaluate('window.sent||0'), 0, "press focused the button by clicking it");
}]);


cases.push(["rich editor toolbar list formatting keeps the selected paragraph and subsequent input", async () => {
  await page.setContent(`<div role="textbox" aria-label="Draft" contenteditable="true" style="width:400px;min-height:100px"><div>Bus to the park</div><div>Lunch at noon</div></div><button onmousedown="event.preventDefault()" onclick="window.listClicks=(window.listClicks||0)+1;window.listResult=document.execCommand('insertUnorderedList')">Bulleted list</button>`);
  const map = await observe();
  const body = map.elements.find(element => element.label === "Draft")!;
  const selected = await inputs.pressAgentKey("fixture", {targetRef:body.targetRef, key:"Control+b",selectText:"Lunch at noon",effect:"editDraft"});
  await inputQueue; assert(selected.ok,JSON.stringify(selected));
  const button = map.elements.find(element => element.label === "Bulleted list")!;
  const list = await actions.actOnAgentElement("fixture", {targetRef:button.targetRef,interaction:"click",effect:"editDraft",verification:"fast"});
  await inputQueue; assert(list.ok,JSON.stringify(list));
  assert.equal(await page.locator('ul li').count(), 1, JSON.stringify({list, html:await page.locator('body').innerHTML(), selection:await page.evaluate('getSelection().toString()'), clicks:await page.evaluate('window.listClicks'), result:await page.evaluate('window.listResult')}));
  assert.equal(await page.locator('ul li').innerText(), "Lunch at noon");
  assert(list.message?.includes('"insertUnorderedList":true'),list.message);
  await inputs.pressAgentKey("fixture", {targetRef:body.targetRef,key:"ArrowRight",effect:"editDraft"});
  const typed = await inputs.typeIntoAgentElement("fixture", {targetRef:body.targetRef,text:" together",effect:"editDraft",verification:"fast"});
  await inputQueue; assert(typed.ok,JSON.stringify(typed));
  assert.equal(await page.locator('ul li').innerText(), "Lunch at noon together");
  assert.equal(await page.locator('[contenteditable] b,[contenteditable] strong').innerText(), "Lunch at noon together");
}]);

cases.push(["AX shortcuts use separate Electron modifiers while keeping the editor selection", async () => {
  axSnapshotStore.invalidate("fixture", "live");
  await page.setContent(`<textarea aria-label="Draft">budget</textarea>`);
  const map = await ax.axMapAgentPage("fixture", {strategy:"interactive"});
  const body = map.nodes.find(node=>node.name==="Draft")!;
  const select = await ax.axPressAgentKey("fixture",{axRef:body.axRef,key:"Control+a",effect:"editDraft"});
  await inputQueue; assert(select.ok,JSON.stringify(select));
  assert.equal(await page.locator('textarea').evaluate(node=>node.selectionEnd-node.selectionStart),6);
  const left = await ax.axPressAgentKey("fixture",{axRef:body.axRef,key:"ArrowLeft",effect:"editDraft"});
  await inputQueue; assert(left.ok,JSON.stringify(left));
  assert.equal(await page.locator('textarea').evaluate(node=>node.selectionStart),0);
}]);


cases.push(["targeted selection works in a same-origin frame and an open shadow editor", async () => {
  await page.setContent(`<div id="host"></div><iframe style="width:400px;height:180px" srcdoc='<textarea aria-label="Frame draft">same budget</textarea>'></iframe><script>document.querySelector('#host').attachShadow({mode:'open'}).innerHTML='<div contenteditable="true" role="textbox" aria-label="Shadow draft" style="width:400px;height:80px">same budget</div>'</script>`);
  await page.frameLocator('iframe').locator('textarea').waitFor();
  const map = await observe();
  for (const label of ["Frame draft", "Shadow draft"]) {
    const field = map.elements.find(element => element.label === label)!;
    assert(field, map.mapAppendix);
    const result = await inputs.pressAgentKey("fixture", {targetRef:field.targetRef,key:"ArrowLeft",selectText:"budget",effect:"editDraft"});
    await inputQueue; assert(result.ok,JSON.stringify(result));
    if (process.env.LYRA_TEST_DEBUG) console.log(JSON.stringify({label, result, state:await page.evaluate(() => {
      const root = document.querySelector('#host')!.shadowRoot!;
      const node = root.querySelector('[contenteditable]')!;
      const selection = document.getSelection()!;
      const shadow = (root as ShadowRoot & {getSelection?:()=>Selection}).getSelection?.();
      return {anchor:selection.anchorNode?.nodeName, anchorText:selection.anchorNode?.textContent, offset:selection.anchorOffset,
        focus:selection.focusNode?.nodeName, active:root.activeElement?.getAttribute('aria-label'), owned:node.contains(selection.anchorNode),
        rangeStart:selection.rangeCount?selection.getRangeAt(0).startContainer.nodeName:null,
        shadowAnchor:shadow?.anchorNode?.nodeName,shadowOffset:shadow?.anchorOffset};
    })}));
    const typed = await inputs.typeIntoAgentElement("fixture", {targetRef:field.targetRef,text:"new ",effect:"editDraft",verification:"fast"});
    await inputQueue; assert(typed.ok,JSON.stringify(typed));
  }
  assert.equal(await page.frameLocator('iframe').locator('textarea').inputValue(), "same new budget");
  assert.equal(await page.locator('#host [contenteditable]').innerText(), "same new budget");
}]);


cases.push(["visible editor inside hidden ancestor accepts exact bold selection in one press", async () => {
  await page.setContent(`<section style="visibility:hidden"><div role="textbox" aria-label="Message Body" contenteditable="true" style="visibility:visible;width:420px;height:200px" onclick="window.editorClicks=(window.editorClicks||0)+1">周末聚餐，晚上八点前结束</div></section>`);
  const map = await observe();
  const body = map.elements.find(element => element.label === "Message Body")!;
  assert(body, map.mapAppendix);
  const result = await inputs.pressAgentKey("fixture", {targetRef:body.targetRef,key:"Control+b",selectText:"晚上八点前结束",effect:"editDraft",verification:"fast"});
  await inputQueue; assert(result.ok, JSON.stringify(result));
  assert.equal(await page.locator('b,strong').innerText(), "晚上八点前结束");
  assert(result.message?.includes('"bold":true'), result.message);
  assert.equal(await page.evaluate('window.editorClicks || 0'), 0);
  const typed = await inputs.typeIntoAgentElement("fixture", {targetRef:body.targetRef,text:"九点之前结束",effect:"editDraft",verification:"fast"});
  await inputQueue; assert(typed.ok, JSON.stringify(typed));
  assert.equal(await page.locator('[contenteditable]').innerText(), "周末聚餐，九点之前结束");
}]);

cases.push(["hidden editors stay out of the map and cached refs cannot send input after hiding", async () => {
  await page.setContent(`<textarea aria-label="Hidden draft" style="visibility:hidden">private</textarea><div role="textbox" contenteditable="true" aria-label="Collapsed draft" style="visibility:collapse;width:400px;height:120px">private</div><section style="content-visibility:hidden"><textarea aria-label="Unrendered draft">private</textarea></section><textarea aria-label="Visible draft">unchanged</textarea>`);
  const map = await observe();
  for (const name of ["Hidden draft", "Collapsed draft", "Unrendered draft"]) assert(!map.elements.some(element => element.label === name), map.mapAppendix);
  const body = map.elements.find(element => element.label === "Visible draft")!;
  await page.locator('[aria-label="Visible draft"]').evaluate(node => node.style.visibility = "hidden");
  const result = await inputs.pressAgentKey("fixture", {targetRef:body.targetRef,key:"Delete",selectText:"unchanged",effect:"editDraft"});
  await inputQueue;
  assert.equal(result.ok, false);
  assert.equal(result.error?.kind, "target_not_visible");
  assert.equal(await page.locator('[aria-label="Visible draft"]').inputValue(), "unchanged");
  const typed = await inputs.typeIntoAgentElement("fixture", {targetRef:body.targetRef,text:"incorrect",effect:"editDraft",verification:"fast"});
  await inputQueue; assert.equal(typed.ok, false);
  assert.equal(await page.locator('[aria-label="Visible draft"]').inputValue(), "unchanged");
}]);

cases.push(["direction aliases select the same seven characters and activation aliases retain effect guards", async () => {
  await page.setContent(`<textarea aria-label="Draft">聚餐，晚上八点前结束</textarea><form action="https://example.invalid/send" onsubmit="event.preventDefault();window.sent=(window.sent||0)+1"><button type="submit">Send</button></form>`);
  const map = await observe();
  const body = map.elements.find(element => element.label === "Draft")!;
  for (const key of ["Shift+Left", "shift+left", "Shift+ArrowLeft"]) {
    const end = await inputs.pressAgentKey("fixture", {targetRef:body.targetRef,key:"End",effect:"editDraft"});
    await inputQueue; assert(end.ok, JSON.stringify(end));
    const result = await inputs.pressAgentKey("fixture", {targetRef:body.targetRef,key,repeat:7,effect:"editDraft"});
    await inputQueue; assert(result.ok, JSON.stringify(result));
    assert.equal(await page.locator('textarea').evaluate(node => node.value.slice(node.selectionStart, node.selectionEnd)), "晚上八点前结束");
  }
  const button = map.elements.find(element => element.label === "Send")!;
  assert.equal(button.formAction, "https://example.invalid/send");
  for (const key of ["return", "ENTER", "space"]) {
    const result = await inputs.pressAgentKey("fixture", {targetRef:button.targetRef,key,effect:"editDraft"});
    await inputQueue;
    assert.equal(result.ok, false, JSON.stringify(result));
    assert.equal(result.error?.kind, "browserActionEffectConflict");
  }
  assert.equal(await page.evaluate('window.sent || 0'), 0);
}]);


cases.push(["form metadata survives the map without treating typing and ordinary controls as submission", async () => {
  await page.setContent(`<form id="compose" action="https://example.invalid/send" method="post" onsubmit="event.preventDefault();window.sent=(window.sent||0)+1"><input aria-label="Recipient" autocomplete="email"><input aria-label="Password" type="password" autocomplete="current-password"><input aria-label="Save copy" type="checkbox"><button type="button" onclick="window.formatted=true">Format</button><button type="submit">Send</button><button type="submit" formaction="https://example.invalid/schedule">Schedule</button></form><a href="https://identity.example/authorize?client_id=test&amp;redirect_uri=https%3A%2F%2Fexample.invalid">Sign in</a>`);
  const map = await observe();
  const recipient = map.elements.find(element => element.label === "Recipient")!;
  assert.deepEqual(recipient.autocompleteTokens, ["email"]);
  assert.equal(recipient.formAction, undefined);
  const secret = map.elements.find(element => element.label === "Password")!;
  assert.equal(secret.secure, false, "about:blank is not an HTTPS document");
  assert.equal(secret.inputType, "password");
  assert.equal(map.elements.find(element => element.label === "Send")?.formAction, "https://example.invalid/send");
  assert.equal(map.elements.find(element => element.label === "Schedule")?.formAction, "https://example.invalid/schedule");
  assert.match(map.elements.find(element => element.label === "Sign in")?.destinationUrl ?? "", /client_id=test/);
  const typed = await inputs.typeIntoAgentElement("fixture", {targetRef:recipient.targetRef,text:"hello@example.invalid",effect:"editDraft",verification:"fast"});
  await inputQueue; assert(typed.ok, JSON.stringify(typed));
  for (const name of ["Save copy", "Format"]) {
    const element = map.elements.find(element => element.label === name)!;
    assert.equal(element.formAction, undefined);
    const clicked = await actions.actOnAgentElement("fixture", {targetRef:element.targetRef,interaction:"click",effect:"editDraft",verification:"fast"});
    await inputQueue; assert(clicked.ok, JSON.stringify(clicked));
  }
  assert.equal(await page.locator('[aria-label="Recipient"]').inputValue(), "hello@example.invalid");
  assert.equal(await page.evaluate('window.sent || 0'), 0);
}]);

cases.push(["native input clears click-initialized placeholder and emits one trusted input", async () => {
  await page.setContent(`<div contenteditable="true" role="textbox" aria-label="Composer" style="width:480px;height:100px;color:gray">说点儿什么吧</div><script>(()=>{
    const field=document.querySelector('[contenteditable]'); window.events=[];
    field.addEventListener('click',()=>{if(field.textContent==='说点儿什么吧'){field.replaceChildren();field.style.color='black';}});
    for(const type of ['click','beforeinput','input','change'])field.addEventListener(type,e=>window.events.push({type:e.type,trusted:e.isTrusted}));
  })()</script>`);
  const field = (await observe()).elements.find(e => e.label === "Composer")!;
  const result = await inputs.typeIntoAgentElement("fixture", { targetRef: field.targetRef, text: "真实输入：晚上八点前结束", verification:"fast" });
  assert(result.ok, JSON.stringify(result));
  assert.equal(await page.locator('[contenteditable]').innerText(), "真实输入：晚上八点前结束");
  assert.deepEqual(await page.evaluate('window.events'), [{type:"click",trusted:true},{type:"beforeinput",trusted:true},{type:"input",trusted:true}]);
  assert.equal(result.inputInsertionMethod, "chromium.insertText");
}]);

cases.push(["editor descendants stay content while nested controls remain independently operable", async () => {
  await page.setContent(`<div role="textbox" aria-label="Draft" contenteditable="true" style="width:500px;min-height:220px">Hello<div><br></div><div><b>Bold</b> and <i>italic</i></div><div><u>Underlined</u></div><button contenteditable="false" onclick="window.nestedClicks=(window.nestedClicks||0)+1">Nested action</button><a href="#reference">Reference</a><span role="button" tabindex="0">Mention</span></div>`);
  const map = await observe();
  assert.deepEqual(map.elements.filter(e=>e.editable).map(e=>e.label), ['Draft']);
  assert.equal(map.elements.length, 4, map.mapAppendix);
  for (const label of ['Nested action','Reference','Mention']) assert(map.elements.some(e=>e.label===label),map.mapAppendix);
  const button=map.elements.find(e=>e.label==='Nested action')!;
  const clicked=await actions.actOnAgentElement('fixture',{targetRef:button.targetRef,interaction:'click',effect:'editDraft',verification:'fast'});
  assert(clicked.ok,JSON.stringify(clicked));assert.equal(await page.evaluate('window.nestedClicks'),1);
}]);

cases.push(["native multiline input verifies retained text even when the page owns input events", async () => {
  for (const mode of ['plain','stop-propagation','handled-beforeinput']) {
    await page.setContent(`<input aria-label="Subject"><div role="textbox" aria-label="Draft" contenteditable="true" style="width:500px;min-height:260px"></div><script>
      if (${JSON.stringify(mode)}==='stop-propagation') document.addEventListener('input',e=>{if(e.target.isContentEditable)e.stopImmediatePropagation();},true);
      if (${JSON.stringify(mode)}==='handled-beforeinput') document.addEventListener('beforeinput',e=>{if(e.target.isContentEditable){e.preventDefault();e.target.textContent=e.data;}},true);
    </script>`);
    const map=await observe(), field=map.elements.find(e=>e.label==='Draft')!, subject=map.elements.find(e=>e.label==='Subject')!;
    const text='你好，\n\n这是一封测试草稿。\n1. 内容一\n2. 内容二\n\n祝好';
    const result=await inputs.typeIntoAgentElement('fixture',{text:'',fields:[{targetRef:subject.targetRef,text:'测试主题'},{targetRef:field.targetRef,text}],verification:'fast'});
    assert(result.ok,mode+': '+JSON.stringify(result));
    const {browserEditableTextRuntime}=await import('../src/main/workbench-browser/view-manager-runtime/agent-editable-runtime.ts');
    assert.equal(await page.evaluate(`(${browserEditableTextRuntime})(document.querySelector('[contenteditable]'))`),text);
    assert.deepEqual((await observe()).elements.filter(e=>e.editable).map(e=>e.label).sort(),['Draft','Subject']);
  }
}]);

cases.push(["input reports transformed text and preserves line boundaries, without repeating writes", async () => {
  for (const mode of ['flatten','truncate','cancel']) {
    await page.setContent(`<textarea aria-label="Draft" ${mode==='truncate'?'maxlength="3"':''}></textarea><script>window.writes=0;document.querySelector('textarea').addEventListener('beforeinput',e=>{window.writes++;${mode==='cancel'?'e.preventDefault();':''}});${mode==='flatten'?"document.querySelector('textarea').oninput=e=>e.target.value=e.target.value.replace(/\\n/g,'');":''}</script>`);
    const field=(await observe()).elements.find(e=>e.label==='Draft')!;
    const result=await inputs.typeIntoAgentElement('fixture',{targetRef:field.targetRef,text:'ab\ncd',verification:'fast'});
    assert.equal(result.ok,false,JSON.stringify(result));
    assert.equal(result.inputEvidence?.valueMatches,false);
    assert.equal(result.inputValuePreview,await page.locator('textarea').inputValue());
    assert.equal(await page.evaluate('window.writes'),1);
  }
  await page.setContent(`<div contenteditable="true" role="textbox" aria-label="Draft" style="width:500px;height:100px" oninput="this.textContent=this.textContent.replace(/\\n/g,'')"></div>`);
  const field=(await observe()).elements.find(e=>e.label==='Draft')!;
  const result=await inputs.typeIntoAgentElement('fixture',{targetRef:field.targetRef,text:'ab\ncd',verification:'fast'});
  assert.equal(result.ok,false,JSON.stringify(result));
  assert.equal(result.inputEvidence?.valueMatches,false);
}]);

cases.push(["rich text replacement preserves paragraph and inline break selection offsets", async () => {
  for (const html of ['<div>Alpha</div><div>Beta</div><div>Gamma</div>', '<p>Alpha</p><p>Beta</p><p>Gamma</p>', '<span>Alpha<br></span>Beta<br>Gamma', 'Alpha<br>Beta<br>Gamma']) {
    await page.setContent(`<div contenteditable="true" role="textbox" aria-label="Draft" style="width:500px;min-height:180px">${html}</div>`);
    const field=(await observe()).elements.find(e=>e.label==='Draft')!;
    await page.evaluate(() => {
      const editor=document.querySelector('[contenteditable]') as HTMLElement; editor.focus();
      const walk=document.createTreeWalker(editor,NodeFilter.SHOW_TEXT), texts:Node[]=[];
      while(walk.nextNode()) texts.push(walk.currentNode);
      const range=document.createRange();range.setStart(texts[1],0);range.setEnd(texts[2],2);
      const selection=getSelection()!;selection.removeAllRanges();selection.addRange(range);
    });
    const result=await inputs.typeIntoAgentElement('fixture',{targetRef:field.targetRef,text:'New',clear:false,verification:'fast'});
    assert(result.ok,html+': '+JSON.stringify(result));
    assert.equal(result.inputValuePreview,'Alpha\nNewmma');
    assert.equal(await page.locator('[contenteditable]').textContent(),'AlphaNewmma');
  }
}]);

cases.push(["native input follows a click-created editor only inside the addressed field", async () => {
  for (const unrelated of [false,true]) {
    await page.setContent(`<div contenteditable="true" role="textbox" aria-label="Composer" style="width:480px;height:100px">写点什么</div><textarea aria-label="Other" style="position:absolute;left:800px;top:300px"></textarea><script>(()=>{
      const shell=document.querySelector('[contenteditable]'); shell.onclick=()=>{
        if(${unrelated}) {document.querySelector('textarea').focus();return;}
        const field=document.createElement('textarea');field.setAttribute('aria-label','Real composer');field.style.cssText='width:480px;height:100px';shell.replaceWith(field);field.focus();
      };
    })()</script>`);
    const field = (await observe()).elements.find(e=>e.label === "Composer")!;
    const result = await inputs.typeIntoAgentElement("fixture", {targetRef:field.targetRef,text:"发布草稿",verification:"fast"});
    assert.equal(result.ok,!unrelated,JSON.stringify(result));
    assert.equal(await page.locator('[aria-label="Other"]').inputValue(), "");
    if (!unrelated) assert.equal(await page.locator('[aria-label="Real composer"]').inputValue(), "发布草稿");
  }
}]);

cases.push(["native input respects beforeinput rejection, maxlength and renderer replacement", async () => {
  for (const handler of ["event.preventDefault()", "", "this.outerHTML='<textarea aria-label=Composer></textarea>'"]) {
    await page.setContent(`<textarea aria-label="Composer" ${handler ? '' : 'maxlength="3"'} ${handler.startsWith('event') ? 'onbeforeinput' : 'oninput'}="${handler.replaceAll('"','&quot;')}"></textarea>`);
    const field = (await observe()).elements.find(e=>e.label === "Composer")!;
    const result = await inputs.typeIntoAgentElement("fixture", {targetRef:field.targetRef,text:"must not claim success",verification:"fast"});
    assert.equal(result.ok,false,JSON.stringify(result));
    assert.equal(await page.locator('textarea').inputValue(), handler ? "" : "mus");
  }
}]);

cases.push(["native input clears a field, preserves undo and does not emit premature change", async () => {
  await page.setContent(`<textarea aria-label="Composer" onchange="window.changes=(window.changes||0)+1">old text</textarea>`);
  const field = (await observe()).elements.find(e=>e.label === "Composer")!;
  const typed = await inputs.typeIntoAgentElement("fixture", {targetRef:field.targetRef,text:"new text",clear:true,verification:"fast"});
  assert(typed.ok,JSON.stringify(typed));
  assert.equal(await page.evaluate('window.changes||0'),0);
  await inputs.pressAgentKey("fixture",{targetRef:field.targetRef,key:"Control+z",effect:"editDraft"}); await inputQueue;
  assert.equal(await page.locator('textarea').inputValue(),"old text");
  const cleared = await inputs.typeIntoAgentElement("fixture",{targetRef:field.targetRef,text:"",clear:true,verification:"fast"});
  assert(cleared.ok,JSON.stringify(cleared));
  assert.equal(await page.locator('textarea').inputValue(),"");
}]);

cases.push(["page reads include nested iframe bodies and exclude hidden or clipped frames", async () => {
  await page.setContent(`<p>Outer navigation</p><iframe id="shown" style="width:400px;height:180px" srcdoc='<p>Published QQ Space post</p><iframe srcdoc="Nested reply"></iframe>'></iframe><section hidden><iframe srcdoc='Hidden frame secret'></iframe></section><div style="height:1px;overflow:hidden"><iframe style="margin-top:80px" srcdoc='Clipped frame secret'></iframe></div>`);
  await page.frameLocator('#shown').getByText('Published QQ Space post').waitFor();
  await page.frameLocator('#shown').frameLocator('iframe').getByText('Nested reply').waitFor();
  const read = await page.evaluate(buildVisiblePageReadScript("viewport",6000));
  assert(read.text.includes('Published QQ Space post') && read.text.includes('Nested reply'),JSON.stringify(read));
  assert(!read.text.includes('Hidden frame secret') && !read.text.includes('Clipped frame secret'),JSON.stringify(read));
  const full = await page.evaluate(buildVisiblePageReadScript("full",6000));
  assert(full.text.includes('Clipped frame secret') && !full.text.includes('Hidden frame secret'),JSON.stringify(full));
}]);

cases.push(["native input is reverified after rendering without a map and Tab focus remains usable", async () => {
  await page.setContent(`<textarea aria-label="First"></textarea><textarea aria-label="Second"></textarea>`);
  const focused = await inputs.focusAgentPage("fixture",{direction:"next",steps:1}); await inputQueue;
  assert(focused.ok,JSON.stringify(focused));
  const typed = await inputs.typeIntoAgentElement("fixture",{text:"From Tab",verification:"fast"});
  assert(typed.ok,JSON.stringify(typed));assert.equal(await page.locator('[aria-label="First"]').inputValue(),"From Tab");
  await page.goto('about:blank');
  await page.setContent(`<textarea aria-label="Composer" oninput="requestAnimationFrame(()=>this.value='')"></textarea>`);
  const field = (await observe()).elements.find(e=>e.label==="Composer")!;
  const result = await inputs.typeIntoAgentElement("fixture",{targetRef:field.targetRef,text:"Transient input",verification:"fast"});
  assert.equal(result.ok,false,JSON.stringify(result));
  assert.equal(result.inputValuePreview, "", "the failed write returns the actual empty value, not its earlier success preview");
  assert.equal(result.inputEvidence?.valueMatches, false);
  assert.equal(result.targetRef, field.targetRef);
  assert.equal(await page.locator('textarea').inputValue(),"");
}]);

cases.push(["cross-origin frame reads use native contexts and viewport clipping", async () => {
  await page.route('http://lyra-read-parent.test/**',route=>route.fulfill({contentType:'text/html',body:`<p>Outer navigation</p><iframe id="feed" style="width:400px;height:900px" src="http://lyra-read-child.test/feed"></iframe><iframe hidden id="hidden" src="http://lyra-read-child.test/hidden"></iframe><iframe src="http://lyra-read-child.test/second"></iframe><iframe src="http://lyra-read-child.test/third"></iframe>`}));
  await page.route('http://lyra-read-child.test/**',route=>route.fulfill({contentType:'text/html',body:route.request().url().includes('hidden') ? 'Hidden remote secret' : route.request().url().includes('second') ? 'Second anonymous frame' : route.request().url().includes('third') ? 'Third anonymous frame' : '<p>Remote published post</p><p style="margin-top:780px">Offscreen remote footer</p>'}));
  try {
    await page.goto('http://lyra-read-parent.test/');
    await page.frameLocator('#feed').getByText('Remote published post').waitFor();
    const entries = page.frames().map((pw,index)=>({pw, frameTreeNodeId:index+1,url:pw.url(),name:pw.name(),origin:new URL(pw.url()).origin,
      isDestroyed:()=>false,executeJavaScript:(script:string)=>pw.evaluate(script).catch(error=>{if(process.env.LYRA_TEST_DEBUG)console.error(pw.url(),error);throw error;}),parent:null as any,top:null as any,frames:[] as any[],framesInSubtree:[] as any[]}));
    for(const entry of entries) {
      entry.parent=entries.find(candidate=>candidate.pw===entry.pw.parentFrame())??null;
      entry.top=entries[0];entry.frames=entries.filter(candidate=>candidate.pw.parentFrame()===entry.pw);
    }
    for(const entry of entries) { const collect=(node:any):any[]=>[node,...node.frames.flatMap(collect)];entry.framesInSubtree=collect(entry); }
    const readTarget={...target,webContents:{...target.webContents,mainFrame:entries[0]}};
    const {createBrowserFrameTextReader}=await import('../src/main/workbench-browser/view-manager-runtime/agent-frame-text.ts');
    const read=createBrowserFrameTextReader(async (...args)=>{const graph=await engine.buildBrowserAgentSemanticFrameGraph(...args);if(process.env.LYRA_TEST_DEBUG)console.log(JSON.stringify(graph.frames));return graph;});
    const visible=await read(readTarget as never,'viewport',6000,8000);
    assert(visible.text.includes('Remote published post'),JSON.stringify(visible));
    assert(!visible.text.includes('Hidden remote secret')&&!visible.text.includes('Offscreen remote footer'),JSON.stringify(visible));
    assert.equal(visible.truncated,false,JSON.stringify(visible));
    const full=await read(readTarget as never,'full',6000,8000);
    assert(full.text.includes('Offscreen remote footer')&&!full.text.includes('Hidden remote secret'),JSON.stringify(full));
    assert(full.text.includes('Second anonymous frame')&&full.text.includes('Third anonymous frame'),JSON.stringify(full));
    assert(full.waitState?.coverage?.scanComplete && full.waitState.textFingerprint,JSON.stringify(full));
    await page.evaluate(()=>{const p=document.createElement('p');p.textContent='Old context '.repeat(1000);document.body.prepend(p)});
    const bounded=await read(readTarget as never,'full',512,8000,true,'Third anonymous frame');
    assert(bounded.truncated && bounded.text.length<=512,JSON.stringify(bounded));
    assert(bounded.waitState?.coverage?.scanComplete && bounded.waitState.textFingerprint,JSON.stringify(bounded));
    assert(bounded.waitState.textMatch,'main document output budget prevented scanning embedded frames');
    await page.frameLocator('#feed').locator('p').last().evaluate(node=>node.textContent='Updated remote footer');
    const changed=await read(readTarget as never,'full',512,8000,true);
    assert.notEqual(changed.waitState?.textFingerprint,bounded.waitState.textFingerprint);

  } finally {
    await page.unroute('http://lyra-read-parent.test/**');await page.unroute('http://lyra-read-child.test/**');
  }
}]);

cases.push(["native input activates a lazy textbox shell before sending any text", async () => {
  await page.setContent(`<div role="textbox" aria-label="Lazy composer" tabindex="0" style="width:480px;height:100px" onclick="this.contentEditable='true';this.textContent='';this.focus()">Click to write</div>`);
  const field = (await observe()).elements.find(e=>e.label === "Lazy composer")!;
  assert(field);
  const result = await inputs.typeIntoAgentElement("fixture",{targetRef:field.targetRef,text:"Initialized draft",verification:"fast"});
  assert(result.ok,JSON.stringify(result));
  assert.equal(await page.locator('[role=textbox]').innerText(),"Initialized draft");
}]);

cases.push(["segmented code entry preserves automatic focus and supports both input entry points", async () => {
  await page.setContent(`<form><div style="display:flex;gap:12px">${Array.from({length:8},(_,i)=>`<input aria-label="User code ${i}" maxlength="1" style="width:40px;height:40px">`).join('')}</div><button>Continue</button></form>
    <script>document.querySelectorAll('input').forEach((node,i,all)=>{node.addEventListener('input',()=>{if(node.value.length===1)all[i+1]?.focus()});node.addEventListener('focus',()=>node.select());});</script>`);
  for (const mode of ['direct','fields','individual']) {
    await page.locator('input').evaluateAll(nodes=>nodes.forEach(node=>node.value=''));
    const map=await observe(), fields=map.elements.filter(node=>node.tagName==='input');
    assert.equal(fields.length,8);
    const request=mode==='direct'?{targetRef:fields[0].targetRef,text:'ABCD-EFGH',clear:true}
      :{text:'',fields:mode==='fields'?[{targetRef:fields[0].targetRef,text:'ABCD-EFGH',clear:true}]
        :fields.map((node,i)=>({targetRef:node.targetRef,text:'ABCDEFGH'[i],clear:true}))};
    const result=await inputs.typeIntoAgentElement('fixture',{...request,verification:'fast'});await inputQueue;
    assert(result.ok,JSON.stringify(result));
    assert.equal(await page.locator('input').evaluateAll(nodes=>nodes.map(node=>node.value).join('')),'ABCDEFGH');
  }
}]);

cases.push(["verification instructions survive placeholder names and validity is separate from insertion", async()=>{
  await page.setContent(`<form><p>Enter the verification code sent to your email.</p><input placeholder="XXXXXXXX" pattern="[0-9]{8}" required><button>Verify</button></form>`);
  let map=await observe(); const field=map.elements.find(node=>node.tagName==='input')!;
  assert(presentBrowserMap(map,{query:'Enter the verification code'}).includes(field.targetRef));
  const wrong=await inputs.typeIntoAgentElement('fixture',{targetRef:field.targetRef,text:'123456',clear:true,verification:'fast'});await inputQueue;
  assert(wrong.ok);assert.equal(wrong.inputValidation?.valid,false,JSON.stringify(wrong));
  const right=await inputs.typeIntoAgentElement('fixture',{targetRef:field.targetRef,text:'12345678',clear:true,verification:'fast'});await inputQueue;
  assert(right.ok);assert.equal(right.inputValidation?.valid,true,JSON.stringify(right));
}]);

cases.push(["observing an offscreen authorization button never activates it",async()=>{
  await page.setContent(`<main style="height:1200px"><div style="height:1000px"></div><button onclick="window.authorized=(window.authorized||0)+1">Authorize</button></main>`);
  const map=await observe(), button=map.elements.find(node=>node.label==='Authorize')!;
  const invalid=await actions.actOnAgentElement('fixture',{targetRef:button.targetRef,interaction:'click',effect:'observe',verification:'fast'});await inputQueue;
  assert.equal(invalid.ok,false);assert.equal(await page.evaluate('window.authorized||0'),0);
  const hover=await actions.actOnAgentElement('fixture',{targetRef:button.targetRef,interaction:'hover',effect:'observe',verification:'fast'});await inputQueue;
  assert(hover.ok,JSON.stringify(hover));assert.equal(await page.evaluate('window.authorized||0'),0);
}]);

cases.push(["native input prepares the requested field through a brief focus redirection without duplicate text",async()=>{
  await page.setContent(`<input aria-label="First"><input aria-label="Second"><script>const [a,b]=document.querySelectorAll('input');window.ready=false;b.onfocus=()=>{if(!window.ready){a.focus();setTimeout(()=>window.ready=true,50)}};</script>`);
  const map=await observe(), second=map.elements.find(node=>node.label==='Second')!;
  const result=await inputs.typeIntoAgentElement('fixture',{targetRef:second.targetRef,text:'AB',clear:true,verification:'fast'});await inputQueue;
  assert(result.ok,JSON.stringify(result));assert.equal(await page.locator('input').first().inputValue(),'');assert.equal(await page.locator('input').nth(1).inputValue(),'AB');
}]);

cases.push(["AX reveals before testing enabled state, and hover never activates a disabled control",async()=>{
  for (const interaction of ['hover','click'] as const) {
    axSnapshotStore.invalidate('fixture','live');
    await page.setContent(`<div style="height:1400px"></div><button disabled id="target" onclick="window.clicks=(window.clicks||0)+1">Continue</button><script>new IntersectionObserver(entries=>{if(entries[0].isIntersecting)document.querySelector('button').disabled=false}).observe(document.querySelector('button'))</script>`);
    const map=await ax.axMapAgentPage('fixture',{}), node=map.nodes.find(n=>n.name==='Continue')!;
    const result=await ax.axActOnNode('fixture',{axRef:node.axRef,interaction,effect:interaction==='hover'?'observe':'editDraft'});await inputQueue;
    assert(result.ok,JSON.stringify(result));assert.equal(await page.evaluate('window.clicks||0'),interaction==='hover'?0:1);
  }
  axSnapshotStore.invalidate('fixture','live');
  await page.setContent('<button disabled>Help on disabled control</button>');
  const map=await ax.axMapAgentPage('fixture',{}), node=map.nodes.find(n=>n.name==='Help on disabled control')!;
  assert((await ax.axActOnNode('fixture',{axRef:node.axRef,interaction:'hover',effect:'observe'})).ok);
}]);

cases.push(["learned tooltip names survive elapsed time offscreen but invalidate on semantic changes", async () => {
  await page.setContent(`<button id="action" aria-expanded="false" style="width:32px;height:32px"></button><div style="height:3000px"></div>
    <script>const node=document.querySelector('button'); let tip;
    node.onmouseenter=()=>{tip=document.createElement('div');tip.role='tooltip';tip.style='position:fixed;left:8px;top:50px';tip.textContent=node.getAttribute('aria-expanded')==='true'?'Collapse collection':'Expand collection';document.body.append(tip)};
    node.onmouseleave=()=>tip?.remove();</script>`);
  await page.mouse.move(900,600);
  const before=await observe(), target=before.elements.find(e=>e.label==='Expand collection')!;
  assert(target,before.mapAppendix);
  await page.evaluate(()=>{const now=Date.now;Date.now=()=>now()+90_000;window.scrollTo(0,2000)});
  const offscreen=await observe();
  assert.equal(offscreen.elements.find(e=>e.targetRef===target.targetRef)?.label,'Expand collection');
  await page.locator('#action').evaluate(node=>node.setAttribute('aria-expanded','true'));
  const changed=await observe();
  assert.notEqual(changed.elements.find(e=>e.targetRef===target.targetRef)?.label,'Expand collection','stale state reused a name');
  await page.evaluate(()=>window.scrollTo(0,0));
  assert((await observe()).elements.some(e=>e.label==='Collapse collection'));
  await page.locator('#action').evaluate(node=>node.replaceWith(node.cloneNode(true)));
  assert(!(await observe()).elements.some(e=>e.label==='Collapse collection'),'replacement inherited old tooltip');
}]);

cases.push(["full text waits detect changing offscreen suffix and return bounded recent content", async () => {
  await page.setContent(`<p>Expected result near beginning</p><div>${'Old conversation '.repeat(800)}</div><div id="answer" style="position:absolute;top:2000px">First partial result</div>`);
  const read=()=>page.evaluate(buildVisiblePageReadScript('full',512,undefined,undefined,undefined,true,'Expected result near beginning'));
  const before=await read();
  assert(before.truncated && before.waitState.coverage.scanComplete);
  assert(before.text.includes('First partial result') && before.waitState.textMatch);
  await page.locator('#answer').evaluate(node=>node.textContent='Updated result beyond the viewport and output prefix');
  const after=await read();
  assert.notEqual(after.waitState.textFingerprint,before.waitState.textFingerprint);
  assert(after.waitState.coverage.startChar>0 && after.text.length<=512);
  const reader={readAgentPage:async(_tabId:string,request:{scope?:'viewport'|'full';textTail?:boolean;waitText?:string})=>{
    const raw=await page.evaluate(buildVisiblePageReadScript(request.scope!,512,undefined,undefined,undefined,request.textTail,request.waitText));
    return {...raw,content:raw.text};
  }} as unknown as Parameters<typeof waitForLumenPage>[0];
  const stable=await waitForLumenPage(reader,'fixture',{targetMode:'live',until:'textStable',idleMs:30,timeoutMs:1500});
  assert(stable.matched,'a complete scan with a bounded output could never become stable');
  const found=await waitForLumenPage(reader,'fixture',{targetMode:'live',until:'textContains',text:'Expected result near beginning',idleMs:20,timeoutMs:1500});
  assert(found.matched,'an expected result outside the returned excerpt was ignored');
  const viewport=await page.evaluate(buildVisiblePageReadScript('viewport',512));
  assert.equal(viewport.waitState.coverage.scope,'viewport');
  assert(!viewport.text.includes('Updated result'));
}]);

cases.push(["nested same-origin busy frames remain pending even when their text pauses", async()=>{
  await page.setContent(`<p>Host is ready</p><iframe srcdoc='<main aria-busy="true">Partial embedded response</main>'></iframe>`);
  await page.frameLocator('iframe').locator('main').waitFor();
  const busy=await page.evaluate(buildVisiblePageReadScript('full',512));
  assert(busy.waitState.busy && busy.text.includes('Partial embedded response'));
  await page.frameLocator('iframe').locator('main').evaluate(node=>node.setAttribute('aria-busy','false'));
  assert.equal((await page.evaluate(buildVisiblePageReadScript('full',512))).waitState.busy,false);
}]);

const responseReader = {
  readAgentPage: async (_tabId: string, request: {waitOperationId?: string; responseStateOnly?: boolean}) => {
    const response = await readResponseWatch(target as never,request.waitOperationId!,1000);
    const raw = request.responseStateOnly && response.status !== 'complete' ? {text:'',truncated:false}
      : await page.evaluate(buildVisiblePageReadScript('full',6000,undefined,undefined,undefined,true));
    return {...raw,content:raw.text,waitState:{readyState:'complete',busy:response.status==='streaming',response}};
  }
} as unknown as Parameters<typeof waitForLumenPage>[0];
const responseWait = (operationId: string, timeoutMs=2000) => waitForLumenPage(responseReader,'fixture',{
  targetMode:'live',until:'responseComplete',operationId,timeoutMs,idleMs:40
});
const responseFixture = async () => {
  await page.setContent(`<main><div id="old">Old answer <button>Copy</button></div><div id="answers"></div>
    <form onsubmit="return false"><textarea aria-label="Message"></textarea><button type="button" id="send" aria-controls="answers">Send</button></form></main>
    <script>window.sent=0;send.onclick=()=>{
      if(send.textContent!=='Send') throw Error('A reply was interrupted');
      window.sent++;send.textContent='Stop';document.querySelector('textarea').value='';
      const output=document.createElement('p');answers.append(output);
      output.textContent='First part';
      setTimeout(()=>{output.textContent='Complete answer '+window.sent;send.textContent='Send';window.finishedAt=Date.now();},250);
    };</script>`);
  const mapped=await observe();
  return {input:mapped.elements.find(e=>e.editable)!,send:mapped.elements.find(e=>e.label==='Send')!};
};

cases.push(['response continuity: three sends reuse targets without input/action remaps',async()=>{
  const refs=await responseFixture();
  const original=frame.executeJavaScript;
  let maps=0;
  frame.executeJavaScript=(script:string)=>{if(script.includes('MAX_LIGHTWEIGHT_SCAN_NODES'))maps++;return original(script);};
  try {
    for(let round=1;round<=3;round++) {
      const typed=await inputs.typeIntoAgentElement('fixture',{targetMode:'live',targetRef:refs.input.targetRef,text:'Question '+round,clear:true,effect:'editDraft',verification:'fast'});
      assert(typed.ok,JSON.stringify(typed));assert(typed.inputValidation?.valid);
      const sent=await actions.actOnAgentElement('fixture',{targetMode:'live',targetRef:refs.send.targetRef,interaction:'click',effect:'communicate',verification:'fast',awaitResponse:true});
      assert(sent.ok && sent.responseWatch,JSON.stringify(sent));
      const result=await responseWait(sent.responseWatch!.operationId);
      assert(result.matched,JSON.stringify(result));assert(result.content.content.includes('Complete answer '+round));
      const delay=await page.evaluate(()=>Date.now()-(window as any).finishedAt);
      assert(delay<1000,`Reply recognition took ${delay}ms after the rendered answer finished`);
    }
    assert.equal(maps,0,'known input/submit targets triggered full control collection');
    assert.equal(await page.evaluate(()=>(window as any).sent),3);
  } finally {frame.executeJavaScript=original;}
}]);

cases.push(['response continuity: completion between model calls is retained',async()=>{
  const refs=await responseFixture();
  await page.evaluate(armResponseWatchScript('early',refs.send.targetRef));
  await page.locator('#send').click();await page.waitForTimeout(600);
  const start=performance.now();const result=await responseWait('early');
  assert(result.matched,JSON.stringify(result));assert(performance.now()-start<500);
}]);

cases.push(['response continuity: a long text pause while Stop exists stays pending',async()=>{
  const refs=await responseFixture();
  await page.evaluate(armResponseWatchScript('paused',refs.send.targetRef));
  await page.evaluate(()=>{document.querySelector('#send')!.textContent='Stop';document.querySelector('#answers')!.innerHTML='<p>A partial answer</p>';});
  const result=await responseWait('paused',800);
  assert(!result.matched);assert.equal(result.content.waitState?.response?.status,'streaming');
}]);

cases.push(['response continuity: old Copy and unrelated background activity do not complete a send',async()=>{
  const refs=await responseFixture();
  await page.evaluate(()=>{const aside=document.createElement('aside');aside.innerHTML='<button>Stop</button><p aria-busy="true">Background</p>';document.body.append(aside);});
  await page.evaluate(armResponseWatchScript('unrelated',refs.send.targetRef));
  await page.evaluate(()=>{document.querySelector('aside')!.remove();});
  const result=await responseWait('unrelated',650);
  assert(!result.matched);assert.equal(result.content.waitState?.response?.status,'pending');
}]);

cases.push(['response continuity: synchronous busy cycle with new output is retained',async()=>{
  const refs=await responseFixture();
  await page.evaluate(armResponseWatchScript('busy',refs.send.targetRef));
  await page.evaluate(()=>{const answer=document.querySelector('#answers')!;answer.setAttribute('aria-busy','true');answer.textContent='Rendered result';answer.setAttribute('aria-busy','false');});
  const result=await responseWait('busy');assert(result.matched,JSON.stringify(result));
}]);

cases.push(['response continuity: unrelated busy region in the same main cannot finish a send',async()=>{
  const refs=await responseFixture();
  await page.evaluate(()=>{const unrelated=document.createElement('div');unrelated.id='unrelated';document.querySelector('main')!.append(unrelated);});
  await page.evaluate(armResponseWatchScript('other-busy',refs.send.targetRef));
  await page.evaluate(()=>{const unrelated=document.querySelector('#unrelated')!;unrelated.setAttribute('aria-busy','true');unrelated.textContent='Background result';unrelated.setAttribute('aria-busy','false');});
  assert(!(await responseWait('other-busy',650)).matched);
}]);

cases.push(['response continuity: related busy and stop signals form one response cycle',async()=>{
  const refs=await responseFixture();
  await page.evaluate(armResponseWatchScript('combined',refs.send.targetRef));
  await page.evaluate(()=>{document.querySelector('#send')!.textContent='Stop';const answer=document.querySelector('#answers')!;answer.setAttribute('aria-busy','true');answer.textContent='Partial answer';});
  await page.waitForTimeout(40);
  await page.evaluate(()=>{document.querySelector('#send')!.textContent='Send';const answer=document.querySelector('#answers')!;answer.textContent='Complete combined answer';answer.setAttribute('aria-busy','false');});
  assert((await responseWait('combined')).matched);
}]);

cases.push(['response continuity: competing operations and navigation invalidate old watches',async()=>{
  const refs=await responseFixture();
  await page.evaluate(armResponseWatchScript('old-op',refs.send.targetRef));
  await page.evaluate(armResponseWatchScript('new-op',refs.send.targetRef));
  const old=await responseWait('old-op');assert(!old.matched);assert.equal(old.content.waitState?.response?.status,'superseded');
  await page.goto('about:blank');
  assert.equal((await readResponseWatch(target as never,'new-op',1000)).status,'unknown');
}]);

cases.push(['response continuity: user echo without response is not completion',async()=>{
  const refs=await responseFixture();
  await inputs.typeIntoAgentElement('fixture',{targetRef:refs.input.targetRef,targetMode:'live',text:'My exact question',effect:'editDraft',verification:'fast'});
  await page.evaluate(armResponseWatchScript('echo',refs.send.targetRef));
  await page.evaluate(()=>{document.querySelector('#send')!.textContent='Stop';document.querySelector('#answers')!.innerHTML='<p>My exact question</p>';});
  await page.waitForTimeout(50);await page.evaluate(()=>document.querySelector('#send')!.textContent='Send');
  assert(!(await responseWait('echo',800)).matched);
}]);

let failures = 0;
try {
  for (const [name, run] of cases) {
    if (process.env.LYRA_TEST_CASE && !name.includes(process.env.LYRA_TEST_CASE)) continue;
    await page.goto("about:blank");
    const start = performance.now();
    try { await run(); console.log(JSON.stringify({ name, passed: true, ms: performance.now() - start })); }
    catch (error) { failures++; console.log(JSON.stringify({ name, passed: false, error: String(error) })); }
  }
} finally { await browser.close(); }
if (failures) process.exitCode = 1;
