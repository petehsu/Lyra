import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { nativeImage, type WebContents } from "electron";
import { buildAgentCursorOverlayScript } from "../src/main/workbench-browser/agent-cursor-overlay";

export const runSceneRecoveryCases = async ({
  load,
  see,
  act,
  map,
  wc,
  check,
}: {
  load: (html: string) => Promise<void>;
  see: (extra?: object) => Promise<any>;
  act: (scene: any, extra: object) => Promise<any>;
  map: (extra?: object) => Promise<any>;
  wc: WebContents;
  check: (name: string) => void;
}) => {
  const fixture = `<style>body{margin:0}button{position:absolute;left:100px;top:150px;width:180px;height:50px}#ticker{position:absolute;left:600px;top:30px;width:80px;height:80px;background:red}</style><button id=target>Continue</button><div id=ticker></div><script>window.hits=[];target.onclick=e=>hits.push(e.isTrusted)</script>`;
  await load(fixture);
  const clean = await see();
  await wc.executeJavaScript(
    buildAgentCursorOverlayScript({
      action: "observe",
      durationMs: 60000,
      hold: true,
      cursor: { x: 155, y: 175 },
      thought: "Lyra presentation, not website content",
    }),
  );
  const withCursor = await see();
  assert.equal(withCursor.scene.pageText.includes("Lyra presentation"), false);
  assert(
    nativeImage
      .createFromBuffer(readFileSync(clean.imageArtifact.path))
      .toBitmap()
      .equals(
        nativeImage
          .createFromBuffer(readFileSync(withCursor.imageArtifact.path))
          .toBitmap(),
      ),
  );
  assert.equal(
    await wc.executeJavaScript(
      "!!document.getElementById('__lyra_agent_page_cursor__')",
    ),
    true,
  );
  check(
    "own animated cursor/thought is absent from captured pixels and text but remains visible to the user",
  );
  await wc.executeJavaScript("ticker.style.background='blue'");
  const clicked = await act(withCursor, {
    point: { x: 150, y: 175 },
    observe: "none",
  });
  assert.equal(clicked.ok, true, JSON.stringify(clicked));
  assert.deepEqual(await wc.executeJavaScript("hits"), [true]);
  check(
    "a coordinate click survives unrelated page paint changes and the owned cursor animation",
  );

  for (const [change, reason] of [
    ["target.outerHTML=target.outerHTML", "image_target_changed"],
    [
      "const layer=document.createElement('div');layer.style='position:fixed;inset:0;opacity:0';document.body.append(layer)",
      "image_target_changed",
    ],
    ["target.style.background='magenta'", "image_content_changed"],
    ["target.style.left='120px'", "image_target_changed"],
  ]) {
    await load(fixture);
    const observed = await see();
    await wc.executeJavaScript(change);
    const result = await act(observed, {
      point: { x: 150, y: 175 },
      observe: "none",
    });
    assert.equal(result.ok, false, JSON.stringify(result));
    assert.equal(result.reason, reason);
    assert.deepEqual(await wc.executeJavaScript("hits"), []);
  }
  check(
    "replaced identical targets, invisible interceptors, local repaint and moved targets reject raw input before dispatch",
  );

  await load(
    `<style>body{margin:0}iframe{position:absolute;left:50px;top:50px;width:350px;height:200px;border:5px solid black}</style><iframe srcdoc="<style>body{margin:0}button{position:absolute;left:30px;top:40px;width:100px;height:50px}</style><button onclick='window.hits=(window.hits||0)+1'>Continue</button>"></iframe>`,
  );
  const framed = await see();
  const frameClick = await act(framed, {
    point: { x: 120, y: 115 },
    observe: "none",
  });
  assert.equal(frameClick.ok, true, JSON.stringify(frameClick));
  assert.equal(
    await wc.mainFrame.frames[0]!.executeJavaScript("window.hits"),
    1,
  );
  const beforeReplacement = await see();
  await wc.mainFrame.frames[0]!.executeJavaScript(
    "document.querySelector('button').outerHTML=document.querySelector('button').outerHTML",
  );
  const replacedFrameClick = await act(beforeReplacement, {
    point: { x: 120, y: 115 },
    observe: "none",
  });
  assert.equal(
    replacedFrameClick.ok,
    false,
    JSON.stringify(replacedFrameClick),
  );
  assert.equal(replacedFrameClick.reason, "image_target_changed");
  assert.equal(
    await wc.mainFrame.frames[0]!.executeJavaScript("window.hits"),
    1,
  );
  check(
    "raw coordinates validate the real iframe target and reject an identical replacement before input",
  );

  const panel = `<style>body{margin:20px}#panel{display:grid;grid-template-columns:repeat(5,40px);width:200px}button{width:40px;height:40px}#cover{position:fixed;inset:0;background:#ddd;display:grid;place-items:center}#card{background:white;padding:35px}</style><div id=panel></div><p id=message>Idle</p><script>
    window.hits=[];for(let i=0;i<25;i++){const b=document.createElement('button');b.onclick=e=>{hits.push(e.isTrusted);b.setAttribute('aria-pressed','true');panel.setAttribute('aria-busy','true');message.textContent='Working';setTimeout(()=>{panel.children[24].setAttribute('aria-pressed','true');panel.setAttribute('aria-busy','false');message.textContent='Completed';},160)};panel.append(b)}
  </script>`;
  await load(panel);
  let observed = await map();
  let grid = observed.scene.marks.find((m: any) => m.grid);
  let result = await act(observed, {
    captureId: undefined,
    mark: grid.mark,
    cell: { row: 1, column: 1 },
    observe: "auto",
  });
  assert(
    result.ok && result.observation.scene && !result.imageArtifact,
    JSON.stringify(result),
  );
  assert(result.observation.scene.pageText.includes("Completed"));
  assert.equal(result.observationWait.status, "quiet");
  assert.equal(result.observationWait.completion, undefined);
  assert.deepEqual(await wc.executeJavaScript("hits"), [true]);
  check(
    "auto on a structure scene observes asynchronous DOM changes without screenshots or another map",
  );

  await load(panel.replace(",160)", ",650)"));
  observed = await map();
  grid = observed.scene.marks.find((m: any) => m.grid);
  result = await act(observed, {
    captureId: undefined,
    mark: grid.mark,
    cell: { row: 1, column: 1 },
    after: { until: "textContains", text: "Completed", timeoutMs: 2000 },
  });
  assert.equal(
    result.observationWait.completion,
    "conditionMet",
    JSON.stringify(result),
  );
  assert(result.observation.scene.pageText.includes("Completed"));
  assert.deepEqual(await wc.executeJavaScript("hits"), [true]);
  check(
    "explicit after condition returns the async result with a single trusted input",
  );
  result = await act(result.observation, {
    captureId: undefined,
    mark: grid.mark,
    cell: { row: 1, column: 2 },
    after: { until: "textContains", text: "Never appears", timeoutMs: 200 },
  });
  assert.equal(result.ok, true);
  assert.equal(result.observationWait.matched, false);
  assert.equal(result.observationWait.completion, "unknown");
  assert.deepEqual(await wc.executeJavaScript("hits"), [true, true]);
  check(
    "an unmet after condition retains the successful input receipt and never resends it",
  );

  await load(
    panel.replace("<p id=message>Idle</p>", "<p id=message>Completed</p>") +
      `<script>for(const b of panel.children)b.onclick=e=>hits.push(e.isTrusted)</script>`,
  );
  observed = await map();
  grid = observed.scene.marks.find((m: any) => m.grid);
  result = await act(observed, {
    captureId: undefined,
    mark: grid.mark,
    cell: { row: 1, column: 1 },
    after: { until: "textContains", text: "Completed", timeoutMs: 300 },
  });
  assert.equal(result.ok, true);
  assert.equal(result.observationWait.wasAlreadySatisfied, true);
  assert.equal(result.observationWait.matched, false);
  assert.equal(result.observationWait.completion, "unknown");
  assert.deepEqual(await wc.executeJavaScript("hits"), [true]);
  check(
    "unchanged pre-existing result text never claims a new async response completed",
  );

  await load(
    panel +
      `<script>for(const b of panel.children)b.onclick=e=>{hits.push(e.isTrusted);const cover=document.createElement('div');cover.id='cover';cover.innerHTML='<div id=card><p>Completed result</p></div>';document.body.append(cover)};
    document.addEventListener('pointerup',e=>{if(e.target.closest('#cover')){window.dismissed=e.isTrusted;document.getElementById('cover').remove()}})</script>`,
  );
  observed = await map();
  grid = observed.scene.marks.find((m: any) => m.grid);
  result = await act(observed, {
    captureId: undefined,
    mark: grid.mark,
    cell: { row: 1, column: 1 },
  });
  assert(result.ok && result.observation, JSON.stringify(result));
  const overlay = result.observation.scene.marks.find(
    (m: any) => m.interactionEvidence === "occluding-hit-surface",
  );
  assert(overlay, JSON.stringify(result.observation.scene));
  const overlayMap = await map();
  assert(
    overlayMap.scene.marks.some(
      (m: any) => m.interactionEvidence === "occluding-hit-surface",
    ),
  );
  const dismissed = await act(result.observation, {
    captureId: undefined,
    mark: overlay.mark,
    observe: "structure",
  });
  assert(dismissed.ok, JSON.stringify(dismissed));
  assert.equal(await wc.executeJavaScript("window.dismissed"), true);
  check(
    "a new delegated-event overlay has a real hit-surface mark in both action receipt and ordinary map, and trusted input dismisses it",
  );
};
