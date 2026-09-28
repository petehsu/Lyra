import assert from "node:assert/strict";
import { copyFileSync } from "node:fs";
import { join } from "node:path";
import { nativeImage } from "electron";
import type { runVisualGridCases } from "./native-visual-grid-cases";
import { createVisualSceneStore } from "../src/main/workbench-browser/view-manager-runtime/visual-scene-store";

export const runVisualContinuityCases = async ({
  load,
  see,
  act,
  wc,
  output,
  check,
}: Parameters<typeof runVisualGridCases>[0]) => {
  await load(`<style>body{margin:10px}canvas{background:#deb878}</style><div id=status>Your turn</div><canvas id=board width=675 height=675></canvas><script>
  const c=board.getContext('2d');window.receipts=[];
  for(let i=0;i<15;i++){let p=23+i*45;c.beginPath();c.moveTo(23,p);c.lineTo(653,p);c.moveTo(p,23);c.lineTo(p,653);c.stroke();}
  function stone(r,k,color){c.fillStyle=color;c.beginPath();c.arc(23+(k-1)*45,23+(r-1)*45,17,0,Math.PI*2);c.fill();}
  stone(8,8,'#111');stone(9,9,'#111');stone(7,7,'#ddd');stone(7,9,'#ddd');
  board.onclick=e=>{const b=board.getBoundingClientRect();const r=Math.round(((e.clientY-b.y)*675/b.height-23)/45)+1,k=Math.round(((e.clientX-b.x)*675/b.width-23)/45)+1;
    receipts.push([r,k,e.isTrusted]);stone(r,k,'#111');stone(6,8,'#ddd');};
  </script>`);
  let image = await see(),
    grid = image.scene.marks.find((m: any) => m.grid);
  assert(grid, JSON.stringify(image.scene));
  let result = await act(image, {
    mark: grid.mark,
    cell: { row: 7, column: 8 },
    interaction: "click",
  });
  assert(result.ok, JSON.stringify(result));
  let scene = result.observation.scene;
  assert.equal(scene.lastAction.targetPixelsChanged, true);
  assert.deepEqual(
    scene.evidence.regions.find((r: any) => r.mark === grid.mark).changedCells,
    [
      { row: 6, column: 8 },
      { row: 7, column: 8 },
    ],
  );
  assert.match(scene.pageText, /Your turn/);
  copyFileSync(
    result.imageArtifact.path,
    join(output, "continuity-third-move.png"),
  );
  check(
    "third move reports its own changed location and a second response, alongside visible turn text",
  );
  image = result.observation;
  result = await act(image, {
    mark: grid.mark,
    cell: { row: 7, column: 8 },
    interaction: "click",
    settleTimeoutMs: 0,
  });
  assert.equal(result.observation.scene.lastAction.targetPixelsChanged, false);
  assert.equal(
    result.observation.scene.evidence.regions[0].comparison,
    "unchanged",
  );
  check(
    "repeating an unchanged input produces unchanged evidence without claiming failure or success",
  );
  await wc.executeJavaScript(
    "board.style.width='285px';board.style.height='285px'",
  );
  image = await see();
  assert.equal(image.scene.evidence.regions[0].comparison, "geometry_changed");
  grid = image.scene.marks.find((m: any) => m.grid);
  image = await see({ region: grid.mark });
  assert(
    image.width >= 850,
    JSON.stringify({ width: image.width, view: image.scene.view }),
  );
  assert(image.scene.view.magnification > 2);
  check(
    "a 285px region is genuinely enlarged without zooming or reflowing the webpage",
  );
  image = await see({
    region: grid.mark,
    cell: { row: 7, column: 8 },
    zoom: 4,
  });
  assert.deepEqual(image.scene.view.cell, { row: 7, column: 8 });
  assert.equal(image.scene.view.magnification, 4);
  grid = image.scene.marks.find((m: any) => m.grid);
  copyFileSync(image.imageArtifact.path, join(output, "continuity-detail.png"));
  // Convert the known visible line geometry into image coordinates, including crop and gutter.
  const point = {
    x: grid.bounds.x + ((23 + 7 * 45) / 675) * grid.bounds.width,
    y: grid.bounds.y + ((23 + 6 * 45) / 675) * grid.bounds.height,
  };
  const bytes = nativeImage.createFromPath(image.imageArtifact.path).toBitmap();
  const at = (Math.round(point.y) * image.width + Math.round(point.x)) * 4;
  assert(
    bytes[at]! < 50 && bytes[at + 1]! < 50 && bytes[at + 2]! < 50,
    "outline must not cover the observed object center",
  );
  result = await act(image, { point, interaction: "click", observe: "none" });
  assert(result.ok, JSON.stringify(result));
  assert.deepEqual(await wc.executeJavaScript("receipts.at(-1)"), [7, 8, true]);
  check(
    "enlarged five-cell detail keeps global axes and raw image input maps to the same real cell",
  );
  assert.match(
    JSON.stringify(
      await see({ region: grid.mark, cell: { row: 99, column: 1 } }),
    ),
    /outside/,
  );
  assert.match(
    JSON.stringify(await see({ region: grid.mark, zoom: 10 })),
    /zoom must/,
  );
  check(
    "host forwards and validates detail addresses and zoom instead of silently ignoring them",
  );
  await load(
    '<canvas id="paint" width="640" height="400" style="background:white"></canvas>',
  );
  image = await see();
  await wc.executeJavaScript("paint.getContext('2d').fillRect(200,180,16,16)");
  const changed = await see();
  assert.equal(changed.scene.evidence.regions[0].comparison, "changed");
  assert.notEqual(
    changed.scene.evidence.fingerprint,
    image.scene.evidence.fingerprint,
  );
  check(
    "a small stroke on a large unstructured canvas is detected without a board-specific classifier",
  );
  let time = 0;
  const store = createVisualSceneStore(() => time);
  store.remember("tab\0live", { captureId: "capture" } as never, {} as never);
  assert.equal(
    store.inspect("capture", "other\0live").reason,
    "capture_wrong_page",
  );
  time = 300001;
  assert.equal(store.inspect("capture", "tab\0live").reason, "capture_expired");
  assert.equal(store.inspect("capture", "tab\0live").ageMs, 300001);
  assert.equal(store.read("capture", "tab\0live"), undefined);
  assert.equal(
    store.inspect("missing", "tab\0live").reason,
    "capture_unknown_or_evicted",
  );
  check(
    "expiry, page mismatch and missing capture have distinct recovery reasons",
  );
};
