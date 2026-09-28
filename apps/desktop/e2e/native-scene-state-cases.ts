import assert from "node:assert/strict";
import type { WebContents } from "electron";

const panel = (
  rows: number,
  columns: number,
  named = false,
) => `<style>body{margin:30px}#surface{display:grid;grid-template-columns:repeat(${columns},36px);width:${columns * 36}px;height:${rows * 36}px;background:#ddd}button.cell{height:36px;width:36px;padding:0;background:transparent;border:1px solid #555}.cell .disc{display:block;margin:5px;width:24px;height:24px;border-radius:50%;background:transparent}.cell.active .disc{background:#e000c0}.cell.pending .disc{background:#1e70cc}</style><div id=surface></div><p id=status>Ready</p><script>window.inputs=[];
for(let r=1;r<=${rows};r++)for(let c=1;c<=${columns};c++){
const b=document.createElement('button');b.className='cell';${named ? `b.setAttribute('aria-label','Item '+r+','+c);` : ""}b.innerHTML='<span class=disc></span>';
b.onclick=e=>{inputs.push([r,c,e.isTrusted]);b.classList.add('active');b.setAttribute('aria-pressed','true');status.textContent='Updated '+r+','+c;};surface.append(b);}</script>`;

export const runSceneStateCases = async ({
  load,
  see,
  act,
  map,
  domAct,
  wc,
  check,
  captures,
}: {
  load: (html: string) => Promise<void>;
  see: (extra?: object) => Promise<any>;
  act: (scene: any, extra: object) => Promise<any>;
  map: (extra?: object) => Promise<any>;
  domAct: (extra: object) => Promise<any>;
  wc: WebContents;
  check: (name: string) => void;
  captures: () => number;
}) => {
  await load(
    panel(9, 11) +
      `<button id=begin onclick="surface.style.display='grid';this.remove()">Begin</button><script>surface.style.display="none"</script>`,
  );
  const menu = await map();
  const start = menu.elements.find((e: any) => e.label === "Begin");
  assert(start);
  const opened = await domAct({
    targetRef: start.targetRef,
    interaction: "click",
    effect: "editDraft",
  });
  assert(opened.scene, JSON.stringify(opened));
  assert.equal(opened.scene.rendered.structures[0].columns, 11);
  check(
    "a semantic action that opens an anonymous surface returns the structure immediately, without another map",
  );
  await load(
    `<button id=hide onclick="frame.style.display='none';window.hidden=true">Hide frame</button><iframe id=frame srcdoc="<button>Framed control</button>"></iframe><iframe style="display:none" srcdoc="<button>Hidden ad</button>"></iframe>`,
  );
  let frameView = await see();
  assert(frameView.ok, JSON.stringify(frameView));
  assert(
    frameView.scene.coverage.skippedFrames.some(
      (f: any) => f.reason === "not_visible",
    ),
  );
  const hideMark = frameView.scene.rendered.objects.find(
    (m: any) => m.name === "Hide frame",
  ).mark;
  const hidden = await act(frameView, { captureId: undefined, mark: hideMark });
  assert(hidden.ok && hidden.observation, JSON.stringify(hidden));
  assert.equal(await wc.executeJavaScript("window.hidden"), true);
  assert(hidden.observation.scene.coverage.skippedFrames.length >= 2);
  check(
    "hidden and newly hidden iframes do not abort the page image or discard delivered input receipts",
  );
  await load(
    `<style>#moving{position:absolute;left:40px;top:100px;transition:transform .12s}</style><button id=moving onclick="this.style.transform='translateX(120px)'">Move</button>`,
  );
  const movingView = await see();
  const movingMark = movingView.scene.rendered.objects.find(
    (m: any) => m.name === "Move",
  ).mark;
  const moved = await act(movingView, {
    captureId: undefined,
    mark: movingMark,
  });
  assert(moved.ok && moved.observation, JSON.stringify(moved));
  assert.equal(
    Math.round(await wc.executeJavaScript("moving.getBoundingClientRect().x")),
    160,
  );
  assert(moved.observationWait.basis.includes("finite DOM animations"));
  check(
    "post-input images wait within a budget for finite layout animation instead of exposing half-moved controls",
  );
  await load(panel(9, 11));
  const before = captures();
  const started = performance.now();
  let observation = await map();
  assert(observation.scene, JSON.stringify(observation));
  let grid = observation.scene.marks.find((m: any) => m.grid);
  assert.equal(grid.grid.rows, 9);
  assert.equal(grid.grid.columns, 11);
  assert.equal(captures(), before);
  assert(!observation.imageArtifact);
  assert(!observation.mapAppendix.includes("unnamed button"));
  assert.equal(
    Object.values(observation.scene.rendered.structures[0].counts).reduce(
      (a: any, b: any) => a + b,
      0,
    ),
    99,
  );
  check(
    "ordinary map compresses a rectangular anonymous control panel without screenshots or lost positions",
  );
  let result = await act(observation, {
    captureId: undefined,
    mark: grid.mark,
    at: { anchor: "center" },
  });
  assert(result.ok, JSON.stringify(result));
  assert(!result.imageArtifact);
  assert.equal(captures(), before);
  assert.deepEqual(await wc.executeJavaScript("inputs"), [[5, 6, true]]);
  observation = result.observation;
  let state = observation.scene.rendered.structures[0];
  assert.equal(state.changedCount, 1);
  assert.deepEqual(
    state.exceptions.map((c: any) => [c.row, c.column]),
    [[5, 6]],
  );
  const descriptor =
    observation.scene.rendered.states[state.exceptions[0].state];
  assert.equal(descriptor.attributes.pressed, "true");
  assert(
    descriptor.layers.some((l: any) => l.background === "rgb(224, 0, 192)"),
  );
  check(
    "implicit task observation and center deliver trusted input; descendant paint and native state return together",
  );
  result = await act(observation, {
    captureId: undefined,
    mark: grid.mark,
    at: { anchor: "lastInput", direction: "right", steps: 2 },
  });
  assert(result.ok, JSON.stringify(result));
  assert.deepEqual(await wc.executeJavaScript("inputs.at(-1)"), [5, 8, true]);
  observation = result.observation;
  await wc.executeJavaScript(
    "surface.style.transform='scale(.8)';surface.style.marginLeft='90px'",
  );
  result = await act(observation, {
    captureId: undefined,
    mark: grid.mark,
    at: { anchor: { row: 5, column: 8 }, direction: "upLeft" },
  });
  assert(result.ok, JSON.stringify(result));
  assert.deepEqual(await wc.executeJavaScript("inputs.at(-1)"), [4, 7, true]);
  observation = result.observation;
  console.log(
    JSON.stringify({
      metric: "map_and_three_structured_inputs_ms",
      elapsed: performance.now() - started,
    }),
  );
  check(
    "anchor-relative input follows live movement without model pixel arithmetic or new maps",
  );
  result = await act(observation, {
    captureId: undefined,
    steps: [
      { interaction: "click", mark: grid.mark, at: { anchor: "center" } },
      {
        interaction: "click",
        mark: grid.mark,
        at: { anchor: "lastInput", direction: "up", steps: 200 },
      },
    ],
    observe: "none",
  });
  assert.equal(result.ok, false);
  assert.equal(await wc.executeJavaScript("inputs.length"), 3);
  check(
    "invalid later relative destination rejects the complete sequence before mutation",
  );
  result = await act(observation, {
    captureId: undefined,
    point: { x: 60, y: 60 },
    observe: "none",
  });
  assert.equal(result.ok, false);
  assert.equal(await wc.executeJavaScript("inputs.length"), 3);
  check("raw image points never inherit an implicit structure observation");
  result = await act(observation, {
    agentSessionId: "other-task",
    mark: grid.mark,
    cell: { row: 1, column: 1 },
    observe: "none",
  });
  assert.equal(result.reason, "capture_wrong_task");
  result = await act(observation, {
    agentSessionId: "other-task",
    captureId: undefined,
    mark: grid.mark,
    cell: { row: 1, column: 1 },
    observe: "none",
  });
  assert.equal(result.ok, false);
  assert.equal(await wc.executeJavaScript("inputs.length"), 3);
  check(
    "another task cannot use either an explicit or implicit observation it has not received",
  );
  const textState = await see({
    representation: "structure",
    region: grid.mark,
    cell: { row: 4, column: 7 },
    modelSupportsImageInput: false,
  });
  assert(
    textState.scene && !textState.imageArtifact,
    JSON.stringify(textState),
  );
  const textAction = await act(textState, {
    captureId: undefined,
    modelSupportsImageInput: false,
    mark: grid.mark,
    at: { anchor: "lastInput", direction: "down" },
  });
  assert(
    textAction.ok && !textAction.imageArtifact,
    JSON.stringify(textAction),
  );
  assert.deepEqual(await wc.executeJavaScript("inputs.at(-1)"), [5, 7, true]);
  check(
    "text-only models can inspect focused structure and execute marked input without a visual fallback detour",
  );
  const older = textState;
  const refreshed = await see({
    representation: "structure",
    region: grid.mark,
  });
  const fromOlder = await act(older, {
    mark: grid.mark,
    cell: { row: 2, column: 2 },
    observe: "structure",
  });
  assert(fromOlder.ok, JSON.stringify(fromOlder));
  const continued = await act(refreshed, {
    captureId: undefined,
    mark: grid.mark,
    at: { anchor: "lastInput", direction: "right" },
    observe: "structure",
  });
  assert(continued.ok, JSON.stringify(continued));
  assert.deepEqual(await wc.executeJavaScript("inputs.at(-1)"), [2, 3, true]);
  check(
    "executing a still-valid older observation updates the task input anchor used by its next observation",
  );
  // Query remains backed by the uncompressed registry, including unnamed cells.
  const query = await map({ query: "button" });
  assert(query.elements.length > 0);
  assert(!query.scene);
  const ref = query.elements[0].targetRef;
  const exact = await map({ query: ref });
  assert(exact.elements.some((e: any) => e.targetRef === ref));
  check(
    "presentation grouping never removes exact target queries from the complete map",
  );

  await load(panel(4, 6));
  observation = await map();
  grid = observation.scene.marks.find((m: any) => m.grid);
  result = await act(observation, {
    captureId: undefined,
    mark: grid.mark,
    at: { anchor: "center" },
    observe: "none",
  });
  assert.equal(result.ok, false);
  assert.equal(await wc.executeJavaScript("inputs.length"), 0);
  check(
    "even-dimensional center is explicitly ambiguous and never rounded into a click",
  );
  await load(panel(3, 3));
  observation = await map();
  assert(observation.scene, JSON.stringify(observation));
  assert.equal(observation.scene.marks.find((m: any) => m.grid).grid.points, 9);
  check(
    "small repeated interfaces use the same structure path as large panels",
  );
  await load(panel(9, 11, true));
  observation = await map();
  assert(!observation.scene);
  assert(observation.mapAppendix.includes("Item"));
  check(
    "named controls keep their direct semantic map instead of being replaced by anonymous spatial groups",
  );

  await load(
    '<input aria-label="Title"><button onclick="window.saved=true">Save</button>',
  );
  const ordinaryBefore = captures();
  observation = await map();
  assert(!observation.scene);
  assert.equal(captures(), ordinaryBefore);
  check("ordinary forms incur neither scene extraction nor screenshots");
  await load(
    '<canvas id=c width=300 height=160 tabindex=0 style="background:tan"></canvas><script>window.hits=[];c.onclick=e=>{hits.push([e.offsetX,e.offsetY,e.isTrusted]);};</script>',
  );
  observation = await map();
  assert(observation.scene, JSON.stringify(observation));
  grid = observation.scene.marks.find((m: any) => m.role === "canvas");
  assert.equal(observation.scene.rendered.structures.length, 0);
  result = await act(observation, {
    captureId: undefined,
    mark: grid.mark,
    at: { anchor: "center" },
  });
  assert(result.ok, JSON.stringify(result));
  assert.deepEqual(await wc.executeJavaScript("hits"), [[150, 80, true]]);
  check(
    "the shared scene also addresses unstructured canvas bounds without fabricating interior objects",
  );
  observation = await see();
  result = await act(observation, {
    captureId: undefined,
    mark: observation.scene.marks[0].mark,
    at: { anchor: "center" },
  });
  assert(result.ok, JSON.stringify(result));
  assert(result.imageArtifact);
  check(
    "visual observation keeps automatic returned images and accepts the same center anchor",
  );
  // Navigation without clearing the store simulates the user changing this tab.
  await wc.loadURL(
    'data:text/html,<button onclick="window.hit=true">New document</button>',
  );
  result = await act(observation, {
    captureId: undefined,
    mark: observation.scene.marks[0].mark,
    observe: "none",
  });
  assert.equal(result.ok, false);
  assert.equal(result.dispatched, false);
  assert.equal(await wc.executeJavaScript("!!window.hit"), false);
  check(
    "implicit binding retains the observed document and cannot click a newly navigated page",
  );
};
