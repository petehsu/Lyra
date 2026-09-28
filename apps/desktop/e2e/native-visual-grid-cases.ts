import assert from "node:assert/strict";
import { copyFileSync } from "node:fs";
import { join } from "node:path";
import type { WebContents } from "electron";

const domBoard = `<style>body{margin:45px}#board{display:grid;grid-template-columns:repeat(15,30px);width:450px;height:450px;background:tan}
button.cell{width:30px;height:30px;border:1px solid #777;padding:0;background:transparent;color:black;font-size:22px}</style>
<div id=board></div><button id=reset>Reset</button><script>
window.moves=[];
for(let row=1;row<=15;row++)for(let column=1;column<=15;column++){
const button=document.createElement('button');button.className='cell';button.setAttribute('aria-label','Position '+row+','+column);
button.onclick=e=>{moves.push([row,column,e.isTrusted]);button.textContent='●';};board.append(button);
}
</script>`;

const canvasBoard = (
  rows = 15,
  columns = 15,
) => `<style>body{margin:45px}canvas{background:#deb878}</style><canvas id=board width=540 height=510></canvas><script>
const ctx=board.getContext('2d');window.moves=[];
function draw(rows,columns){ctx.clearRect(0,0,540,510);ctx.strokeStyle='#333';window.rows=rows;window.columns=columns;
for(let r=0;r<rows;r++){const y=23+r*464/(rows-1);ctx.beginPath();ctx.moveTo(27,y);ctx.lineTo(513,y);ctx.stroke();}
for(let c=0;c<columns;c++){const x=27+c*486/(columns-1);ctx.beginPath();ctx.moveTo(x,23);ctx.lineTo(x,487);ctx.stroke();}}
draw(${rows},${columns});board.onclick=e=>{const b=board.getBoundingClientRect(),x=(e.clientX-b.x)*540/b.width,y=(e.clientY-b.y)*510/b.height;
const row=Math.round((y-23)*(rows-1)/464)+1,column=Math.round((x-27)*(columns-1)/486)+1;
moves.push([row,column,e.isTrusted]);ctx.beginPath();ctx.arc(x,y,10,0,Math.PI*2);ctx.fill();};
</script>`;

export const runVisualGridCases = async ({
  load,
  see,
  act,
  wc,
  output,
  check,
}: {
  load: (html: string) => Promise<void>;
  see: (extra?: object) => Promise<any>;
  act: (scene: any, extra: object) => Promise<any>;
  wc: WebContents;
  output: string;
  check: (name: string) => void;
}) => {
  await load(domBoard);
  let image = await see();
  let grid = image.scene.marks.find((mark: any) => mark.grid);
  assert(grid, JSON.stringify(image.scene));
  assert.equal(grid.grid.source, "dom");
  assert.equal(grid.grid.rows, 15);
  assert.equal(grid.grid.columns, 15);
  assert.equal(grid.grid.points, 225);
  assert.equal(image.scene.unmarkedCount, 0);
  assert(image.scene.marks.length <= 3, JSON.stringify(image.scene));
  copyFileSync(image.imageArtifact.path, join(output, "grid-dom-overview.png"));
  check(
    "225 real controls have one complete grid address without pagination or per-cell labels",
  );
  const originalMark = grid.mark;
  for (const cell of [
    { row: 1, column: 1 },
    { row: 1, column: 15 },
    { row: 8, column: 8 },
    { row: 15, column: 1 },
    { row: 15, column: 15 },
  ]) {
    const result = await act(image, {
      mark: grid.mark,
      cell,
      interaction: "click",
    });
    assert(result.ok, JSON.stringify(result));
    assert(result.imageArtifact);
    image = result.observation;
    grid = image.scene.marks.find((mark: any) => mark.grid);
    assert.equal(grid.mark, originalMark);
  }
  assert.deepEqual(await wc.executeJavaScript("moves"), [
    [1, 1, true],
    [1, 15, true],
    [8, 8, true],
    [15, 1, true],
    [15, 15, true],
  ]);
  check(
    "DOM grid corners and center receive trusted clicks and keep their region identity after changes",
  );
  await wc.executeJavaScript(
    "board.style.marginLeft='120px';board.style.transform='scale(.8)';board.style.transformOrigin='top left'",
  );
  let result = await act(image, {
    mark: grid.mark,
    cell: { row: 2, column: 14 },
    interaction: "click",
  });
  assert(result.ok, JSON.stringify(result));
  assert.deepEqual(await wc.executeJavaScript("moves.at(-1)"), [2, 14, true]);
  image = result.observation;
  check(
    "unchanged DOM grid geometry follows live movement and uniform scaling",
  );
  result = await act(image, {
    interaction: "sequence",
    steps: [
      { mark: grid.mark, cell: { row: 3, column: 3 }, interaction: "click" },
      { mark: grid.mark, cell: { row: 16, column: 3 }, interaction: "click" },
    ],
  });
  assert.equal(result.ok, false);
  assert.equal(await wc.executeJavaScript("moves.length"), 6);
  check(
    "an invalid later grid address rejects a whole sequence before any click",
  );
  await wc.executeJavaScript("board.children[10].remove()");
  result = await act(image, {
    mark: grid.mark,
    cell: { row: 3, column: 3 },
    interaction: "click",
    observe: "none",
  });
  assert.equal(result.ok, false);
  assert.equal(result.completed, 0);
  assert.equal(result.dispatched, false);
  assert.equal(await wc.executeJavaScript("moves.length"), 6);
  image = await see();
  assert(!image.scene.marks.some((mark: any) => mark.grid));
  check(
    "a missing or reflowed cell invalidates the old grid and never invents a complete rectangle",
  );

  await load(
    `<style>td{padding:0}button{width:36px;height:36px}table{border-spacing:0}</style><table><tbody>${Array.from({ length: 5 }, () => "<tr>" + Array.from({ length: 5 }, (_, i) => `<td><button onclick="this.textContent='X';window.clicks=(window.clicks||0)+1">${i + 1}</button></td>`).join("") + "</tr>").join("")}</tbody></table>`,
  );
  image = await see();
  grid = image.scene.marks.find((mark: any) => mark.grid);
  assert(grid, JSON.stringify(image.scene));
  result = await act(image, {
    interaction: "sequence",
    steps: [
      { mark: grid.mark, cell: { row: 1, column: 1 }, interaction: "click" },
      { mark: grid.mark, cell: { row: 1, column: 2 }, interaction: "click" },
    ],
    observe: "none",
  });
  assert(result.ok, JSON.stringify(result));
  assert.equal(await wc.executeJavaScript("window.clicks"), 2);
  check(
    "a planned grid sequence does not invalidate sibling cells when row text changes",
  );

  await wc.executeJavaScript(`window.dragReceipt=[];window.heldMoves=0;
    document.addEventListener('pointerdown',e=>{e.target.setPointerCapture(e.pointerId);const b=document.querySelector('tbody').getBoundingClientRect();
      dragReceipt.push([Math.floor((e.clientY-b.y)/36)+1,Math.floor((e.clientX-b.x)/36)+1,e.isTrusted]);});
    document.addEventListener('pointermove',e=>{if(e.buttons)heldMoves++;});
    document.addEventListener('pointerup',e=>{const b=document.querySelector('tbody').getBoundingClientRect();
      dragReceipt.push([Math.floor((e.clientY-b.y)/36)+1,Math.floor((e.clientX-b.x)/36)+1,e.isTrusted,e.buttons]);});`);
  image = await see();
  grid = image.scene.marks.find((mark: any) => mark.grid);
  result = await act(image, {
    mark: grid.mark,
    cell: { row: 2, column: 1 },
    toCell: { row: 4, column: 5 },
    interaction: "drag",
    durationMs: 160,
    observe: "none",
  });
  assert(result.ok, JSON.stringify(result));
  assert.deepEqual(await wc.executeJavaScript("dragReceipt"), [
    [2, 1, true],
    [4, 5, true, 0],
  ]);
  assert(await wc.executeJavaScript("heldMoves >= 3"));
  check(
    "grid cell-to-cell drag emits a continuous trusted path and releases at the destination",
  );

  await load(canvasBoard());
  image = await see();
  copyFileSync(
    image.imageArtifact.path,
    join(output, "grid-canvas-initial.png"),
  );
  grid = image.scene.marks.find((mark: any) => mark.grid);
  assert(grid, JSON.stringify(image.scene));
  assert.equal(grid.grid.source, "image-lines");
  assert.equal(grid.grid.rows, 15);
  assert.equal(grid.grid.columns, 15);
  copyFileSync(
    image.imageArtifact.path,
    join(output, "grid-canvas-overview.png"),
  );
  const started = performance.now();
  for (const cell of [
    { row: 1, column: 1 },
    { row: 8, column: 9 },
    { row: 15, column: 15 },
  ]) {
    result = await act(image, { mark: grid.mark, cell, interaction: "click" });
    assert(result.ok, JSON.stringify(result));
    image = result.observation;
    assert(
      image.scene.marks.some(
        (mark: any) => mark.mark === grid.mark && mark.grid?.rows === 15,
      ),
    );
  }
  assert.deepEqual(await wc.executeJavaScript("moves"), [
    [1, 1, true],
    [8, 9, true],
    [15, 15, true],
  ]);
  console.log(
    JSON.stringify({
      metric: "three_image_grid_moves_and_observations_ms",
      elapsed: performance.now() - started,
    }),
  );
  copyFileSync(
    result.imageArtifact.path,
    join(output, "grid-canvas-played.png"),
  );
  check(
    "canvas line geometry resolves three row/column clicks with margins and unequal axis spacing",
  );
  await wc.executeJavaScript("draw(19,19)");
  result = await act(image, {
    mark: grid.mark,
    cell: { row: 8, column: 9 },
    interaction: "click",
  });
  assert.equal(result.ok, false);
  assert.equal(result.dispatched, false);
  assert.equal(await wc.executeJavaScript("moves.length"), 3);
  assert.equal(
    result.observation.scene.marks.find((mark: any) => mark.grid)?.grid.rows,
    19,
  );
  check(
    "a canvas grid-size change rejects old coordinates and returns newly detected axes",
  );

  await load(canvasBoard(9, 13));
  image = await see();
  grid = image.scene.marks.find((mark: any) => mark.grid);
  assert.equal(grid.grid.rows, 9);
  assert.equal(grid.grid.columns, 13);
  result = await act(image, {
    mark: grid.mark,
    cell: { row: 9, column: 13 },
    interaction: "click",
    observe: "none",
  });
  assert(result.ok, JSON.stringify(result));
  assert.deepEqual(await wc.executeJavaScript("moves.at(-1)"), [9, 13, true]);
  check(
    "rectangular non-Gomoku grids are inferred from pixels without fixed dimensions",
  );
  await wc.executeJavaScript("board.style.marginLeft='800px'");
  image = await see();
  assert(!image.scene.marks.some((mark: any) => mark.grid));
  check("a clipped canvas cannot be mislabeled as a smaller complete grid");
  await load(
    '<canvas width=450 height=450 id=board></canvas><script>const c=board.getContext("2d");c.fillStyle="tan";c.fillRect(0,0,450,450);c.strokeRect(20,20,400,400);</script>',
  );
  image = await see();
  assert(!image.scene.marks.some((mark: any) => mark.grid));
  assert(image.scene.marks.some((mark: any) => mark.kind === "region"));
  check(
    "unconfirmed image structure retains ordinary region coordinates instead of guessed row/column targets",
  );

  await load(
    canvasBoard() +
      `<script>board.addEventListener('click',()=>{
    board.setAttribute('aria-busy','true');setTimeout(()=>{ctx.fillStyle='white';ctx.beginPath();ctx.arc(27+486/2,23+464/2,10,0,Math.PI*2);ctx.fill();board.removeAttribute('aria-busy');},350);
  });</script>`,
  );
  image = await see();
  grid = image.scene.marks.find((mark: any) => mark.grid);
  result = await act(image, {
    mark: grid.mark,
    cell: { row: 3, column: 3 },
    interaction: "click",
  });
  assert(result.ok, JSON.stringify(result));
  assert.equal(result.observationWait.status, "quiet");
  assert(result.observationWait.elapsedMs >= 350);
  assert.equal(
    await wc.executeJavaScript("board.hasAttribute('aria-busy')"),
    false,
  );
  check(
    "a bounded grid paint wait captures a delayed visible response and respects aria-busy",
  );
  await wc.executeJavaScript("board.setAttribute('aria-busy','true')");
  result = await act(result.observation, {
    mark: grid.mark,
    cell: { row: 4, column: 4 },
    interaction: "click",
    settleTimeoutMs: 100,
  });
  assert(result.ok, JSON.stringify(result));
  assert.equal(result.observationWait.status, "budget_exhausted");
  assert.equal(await wc.executeJavaScript("moves.length"), 2);
  check(
    "paint wait timeout preserves the delivered move instead of retrying or claiming completion",
  );

  await load(
    '<div style="position:relative;width:140px;height:60px">Start<button aria-label="Start" style="position:absolute;inset:0;width:100%;height:100%;opacity:0" onclick="window.trusted=event.isTrusted"></button></div>',
  );
  image = await see();
  const transparent = image.scene.marks.find(
    (mark: any) => mark.role === "button",
  );
  assert(transparent, JSON.stringify(image.scene));
  result = await act(image, {
    mark: transparent.mark,
    interaction: "click",
    observe: "none",
  });
  assert(result.ok, JSON.stringify(result));
  assert.equal(await wc.executeJavaScript("window.trusted"), true);
  check(
    "a transparent native overlay control remains a real hit target for its visible widget",
  );
};
