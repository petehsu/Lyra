// Production numbered screenshots and trusted Chromium input. No model or website API shortcuts.
import { app, BrowserWindow } from "electron";
import assert from "node:assert/strict";
import {
  mkdtempSync,
  existsSync,
  readFileSync,
  rmSync,
  mkdirSync,
  writeFileSync,
  copyFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createBrowserAgentObservationEngine } from "../src/main/workbench-browser/view-manager-runtime/agent-observation-engine";
import { createBrowserAgentStateStore } from "../src/main/workbench-browser/view-manager-runtime/agent-state-store";
import { createBrowserAgentInteractionExecutor } from "../src/main/workbench-browser/view-manager-runtime/agent-interaction-executor";
import { createBrowserAgentFocusInputController } from "../src/main/workbench-browser/view-manager-runtime/agent-focus-input-controller";
import { createSurfaceDrag } from "../src/main/workbench-browser/view-manager-runtime/surface-drag";
import { createVisualSceneController } from "../src/main/workbench-browser/view-manager-runtime/visual-scene-controller";
import { createSnapshotProvider } from "../src/main/workbench-browser/view-manager-runtime/snapshot-provider";
import {
  browserAgentOperationContext,
  trackBrowserOperation,
  cancelBrowserOperations,
} from "../src/main/workbench-browser/agent-operation-context";
import { createLumenToolHost } from "../src/main/agent/lumen-tool-host";
import { runVisualGridCases } from "./native-visual-grid-cases";
import { runSceneStateCases } from "./native-scene-state-cases";
import { runVisualContinuityCases } from "./native-visual-continuity-cases";
import { runSceneRecoveryCases } from "./native-scene-recovery-cases";

const profile = mkdtempSync(join(tmpdir(), "lyra-visual-"));
app.setPath("userData", profile);
app.disableHardwareAcceleration();
app.commandLine.appendSwitch("disable-smooth-scrolling");
app.commandLine.appendSwitch("ozone-platform", "x11");
const run = async () => {
  await app.whenReady();
  const win = new BrowserWindow({
    show: false,
    width: 1000,
    height: 750,
    webPreferences: {
      contextIsolation: true,
      sandbox: true,
      backgroundThrottling: false,
    },
  });
  win.show();
  const wc = win.webContents;
  wc.on("console-message", (_e, details) => {
    if (details.level === "error") console.error("PAGE", details.message);
  });
  wc.debugger.attach("1.3");
  const target = {
    tabId: "fixture",
    targetMode: "live",
    address: "",
    isLoading: false,
    browserMode: {
      targetMode: "live",
      visibleFollow: false,
      authState: "liveProfile",
    },
    webContents: wc,
  };
  const stateStore = createBrowserAgentStateStore();
  const host = {
    stateStore,
    resolveBrowserAgentTarget: async () => target,
    openDebuggerSessionForTarget: async () => ({
      sendCommand: (method: string, params: object) =>
        wc.debugger.sendCommand(method, params),
      subscribe: (listener: (event: unknown) => void) => {
        const onMessage = (_event: unknown, method: string, params: unknown) =>
          listener({ kind: "message", method, params });
        wc.debugger.on("message", onMessage);
        return () => wc.debugger.off("message", onMessage);
      },
      close: async () => {},
    }),
    publishBrowserAgentActivity: async () => {},
    readPageDiagnostics: () => [],
    rememberBrowserRestoreState: () => {},
    updateRuntimeState: () => {},
    assertSharedControlCanContinue: () => {},
    recordFollowAction: () => {},
    markSyntheticInput: () => {},
    findFrameInWebContents: (_wc: unknown, id: number) =>
      wc.mainFrame.framesInSubtree.find(
        (frame) => frame.frameTreeNodeId === id,
      ),
    readAgentViewportState: async () =>
      wc.executeJavaScript(
        "({width:innerWidth,height:innerHeight,scrollX,scrollY})",
      ),
    sendAgentInputEvent: (_target: unknown, event: Electron.InputEvent) =>
      wc.sendInputEvent(event),
  };
  const engine = createBrowserAgentObservationEngine(host as never);
  const findAgentElement = async (
    _tab: string,
    request: { targetRef?: string },
  ) => ({
    element:
      stateStore
        .readBrowserAgentCacheEntry("fixture", "live")
        ?.elements.find((e) => e.targetRef === request.targetRef) ?? null,
  });
  const actions = createBrowserAgentInteractionExecutor({
    ...host,
    findAgentElement,
    observeAgentPage: engine.observeAgentPage,
  } as never);
  const inputs = createBrowserAgentFocusInputController({
    ...host,
    ...actions,
    findAgentElement,
    observeAgentPage: engine.observeAgentPage,
  } as never);
  const drag = createSurfaceDrag({
    ...host,
    find: async (tabId, ref) =>
      (await findAgentElement(tabId, { targetRef: ref })).element,
    observe: () =>
      engine.observeAgentPage("fixture", {
        strategy: "interactiveOnly",
        suppressActivity: true,
      }),
  } as never);
  const provider = createSnapshotProvider({
    entries: new Map(),
    requireEntry: () => ({
      webContents: wc,
      runtime: { isVisible: true, isLoading: false },
    }),
    readLiveViewBounds: () => ({ x: 0, y: 0, ...win.getContentBounds() }),
    readIsolatedViewBounds: () => win.getContentBounds(),
  } as never);
  let captureCount = 0;
  const visual = createVisualSceneController({
    ...host,
    ...provider,
    captureTargetPage: async (
      ...args: Parameters<typeof provider.captureTargetPage>
    ) => {
      captureCount++;
      return provider.captureTargetPage(...args);
    },
    stateStore,
    observe: engine.observeAgentPage,
    act: actions.actOnAgentElement,
    type: inputs.typeIntoAgentElement,
    press: inputs.pressAgentKey,
    drag,
  } as never);
  const bridge = {
    ...actions,
    ...inputs,
    observeAgentPage: engine.observeAgentPage,
    describeAgentScene: visual.describe,
    captureVisualScene: visual.capture,
    actOnAgentVisualScene: visual.act,
  };
  const tools = createLumenToolHost({
    getBrowserBridge: () => bridge,
    tabResolver: { resolveBrowserAgentTabId: async () => "fixture" },
    storageRoot: profile,
  } as never).handlers;
  const output = process.env.LYRA_VISUAL_TEST_OUTPUT ?? "/tmp/lyra-visual-test";
  mkdirSync(output, { recursive: true });
  const load = async (html: string) => {
    stateStore.invalidateBrowserAgentTargets("fixture", "live");
    visual.clear("fixture");
    await win.loadURL(
      "data:text/html;charset=utf-8," + encodeURIComponent(html),
    );
  };
  const see = async (extra: object = {}) =>
    (await tools["lyraLumen.see"]!({ effect: "observe", ...extra })) as any;
  const map = async (extra: object = {}) =>
    (await tools["lyraLumen.map"]!({ effect: "observe", ...extra })) as any;
  const act = async (scene: any, extra: object) =>
    (await tools["lyraLumen.vact"]!({
      captureId: scene.captureId ?? scene.scene?.captureId,
      effect: "editDraft",
      ...extra,
    })) as any;
  const markByLabel = (image: any, label: string) => {
    const ref = stateStore
      .readBrowserAgentCacheEntry("fixture", "live")!
      .elements.find((e) => e.label === label)?.targetRef;
    assert(ref, "missing map target " + label);
    // The test correlates observed refs; production only receives short marks.
    const index = stateStore
      .readBrowserAgentCacheEntry("fixture", "live")!
      .elements.filter((e) => e.visibility?.offscreen !== true)
      .find((e) => e.targetRef === ref)!;
    const match = image.scene.marks.find(
      (m: any) =>
        Math.abs(m.bounds.x - index.bounds.x) < 2 &&
        Math.abs(m.bounds.y - index.bounds.y) < 2,
    );
    assert(match, "missing mark " + label);
    return match.mark;
  };
  let count = 0;
  const check = (name: string) => {
    count++;
    console.log(JSON.stringify({ passed: true, name }));
  };
  try {
    await runSceneRecoveryCases({load,see,act,map,wc,check});
    if (process.env.LYRA_VISUAL_LIVE_URL) {
      await win.loadURL(process.env.LYRA_VISUAL_LIVE_URL);
      await new Promise((resolve) => setTimeout(resolve, 800));
      let observed = await see();
      copyFileSync(
        observed.imageArtifact.path,
        join(output, "live-before.png"),
      );
      writeFileSync(
        join(output, "live-before.json"),
        JSON.stringify(observed.scene, null, 2),
      );
      const started = performance.now();
      const keys = JSON.parse(
        process.env.LYRA_VISUAL_LIVE_KEYS ?? "[]",
      ) as string[];
      for (let i = 0; i < keys.length; i++) {
        const result = await act(observed, {
          captureId: undefined,
          interaction: "press",
          key: keys[i],
          observe: "image",
        });
        assert(result.ok, JSON.stringify(result));
        writeFileSync(
          join(output, `live-receipt-${i + 1}.json`),
          JSON.stringify({ ...result, imageArtifact: undefined }, null, 2),
        );
        assert(result.observation, JSON.stringify(result));
        observed = result.observation;
        writeFileSync(
          join(output, `live-key-${i + 1}.json`),
          JSON.stringify(result.observation.scene, null, 2),
        );
        copyFileSync(
          result.imageArtifact.path,
          join(output, `live-key-${i + 1}.png`),
        );
      }
      console.log(
        JSON.stringify({
          completed: true,
          keys,
          elapsedMs: performance.now() - started,
          output,
        }),
      );
      return;
    }
    if (process.env.LYRA_VISUAL_LIVE_GRID === "1") {
      await win.loadURL("https://wuziqi.bmcx.com/");
      await new Promise((resolve) => setTimeout(resolve, 500));
      let scene = await see();
      if (
        !stateStore
          .readBrowserAgentCacheEntry("fixture", "live")
          ?.elements.some(
            (element) =>
              element.label === "开始" && !element.visibility?.covered,
          )
      ) {
        const names =
          stateStore
            .readBrowserAgentCacheEntry("fixture", "live")
            ?.elements.map((element) => element.label) ?? [];
        console.log(JSON.stringify({ liveMenuNames: names }));
        const name = ["新的游戏", "新游戏", "开始新的游戏", "开始游戏"].find(
          (label) => names.includes(label),
        );
        assert(name, JSON.stringify(names));
        const opened = await act(scene, {
          mark: markByLabel(scene, name),
          interaction: "click",
        });
        assert(opened.ok, JSON.stringify(opened));
        await new Promise((resolve) => setTimeout(resolve, 500));
        scene = await see();
      }
      copyFileSync(scene.imageArtifact.path, join(output, "live-settings.png"));
      if (process.env.LYRA_VISUAL_LIVE_OUTCOME === "1") {
        const configured=await act(scene,{mark:markByLabel(scene,"双人轮流对战"),interaction:"click"});
        assert(configured.ok,JSON.stringify(configured));
        scene=configured.observation;
      }
      writeFileSync(
        join(output, "live-settings.json"),
        JSON.stringify(
          {
            scene: scene.scene,
            start: stateStore
              .readBrowserAgentCacheEntry("fixture", "live")
              ?.elements.filter((element) => element.label.includes("开始"))
              .map((element) => ({
                bounds: element.bounds,
                role: element.role,
                label: element.label,
              })),
          },
          null,
          2,
        ),
      );
      const start = await act(scene, {
        mark: markByLabel(scene, "开始"),
        interaction: "click",
      });
      assert(start.ok, JSON.stringify(start));
      await new Promise((resolve) => setTimeout(resolve, 350));
      scene = await see();
      copyFileSync(
        scene.imageArtifact.path,
        join(output, "live-grid-before.png"),
      );
      writeFileSync(
        join(output, "live-scene.json"),
        JSON.stringify(scene.scene, null, 2),
      );
      const grid = scene.scene.marks.find((mark: any) => mark.grid);
      assert(grid, JSON.stringify(scene.scene));
      assert.equal(grid.grid.rows, 15);
      assert.equal(grid.grid.columns, 15);
      if (process.env.LYRA_VISUAL_LIVE_OUTCOME === "1") {
        // Deterministic UI mechanics replay: both sides, no game API/solver.
        // This verifies the original outcome surface, not autonomous model play.
        const started=performance.now();
        let current=await map();
        const region=current.scene.marks.find((m:any)=>m.grid);
        for(const [row,column] of [[8,4],[1,1],[8,5],[1,2],[8,6],[1,3],[8,7],[1,4],[8,8]]) {
          const result=await act(current,{captureId:undefined,mark:region.mark,cell:{row,column}});
          assert(result.ok,JSON.stringify(result));
          assert(result.observation,JSON.stringify(result));
          current=result.observation;
        }
        const terminal=await see();
        copyFileSync(terminal.imageArtifact.path,join(output,"live-outcome.png"));
        writeFileSync(join(output,"live-outcome.json"),JSON.stringify(terminal.scene,null,2));
        const surface=terminal.scene.marks.find((m:any)=>m.interactionEvidence==='occluding-hit-surface');
        assert(surface,JSON.stringify(terminal.scene));
        const dismissed=await act(terminal,{captureId:undefined,mark:surface.mark,observe:'image'});
        assert(dismissed.ok&&dismissed.observation,JSON.stringify(dismissed));
        const pageText=dismissed.observation.scene.pageText;
        assert(/Won|赢/.test(pageText),pageText);
        copyFileSync(dismissed.imageArtifact.path,join(output,'live-result.png'));
        console.log(JSON.stringify({completed:true,mechanicsOnly:true,elapsedMs:performance.now()-started,pageText,output}));
        return;
      }
      if (process.env.LYRA_VISUAL_LIVE_STRUCTURE === "1") {
        const before = captureCount,
          started = performance.now();
        const mapped = await map();
        assert(mapped.scene, JSON.stringify(mapped));
        const board = mapped.scene.marks.find((m: any) => m.grid);
        assert(board);
        const result = await act(mapped, {
          captureId: undefined,
          mark: board.mark,
          at: { anchor: "center" },
        });
        assert(result.ok, JSON.stringify(result));
        assert(!result.imageArtifact);
        assert.equal(captureCount, before);
        writeFileSync(
          join(output, "live-structure.json"),
          JSON.stringify(result, null, 2),
        );
        const elapsedMs = performance.now() - started;
        const verification = await see();
        copyFileSync(
          verification.imageArtifact.path,
          join(output, "live-structure-after.png"),
        );
        console.log(
          JSON.stringify({
            completed: true,
            elapsedMs,
            structure: result.observation.scene.rendered,
            output,
          }),
        );
        return;
      }
      if (process.env.LYRA_VISUAL_LIVE_INTERACTIVE === "1") {
        // Manual visual QA uses the same production bridge, in a fresh profile.
        // Only explicit commands are accepted; the harness never reads game state.
        console.log(JSON.stringify({ ready: true, output }));
        for (let index = 1; index <= 10; index++) {
          const command = join(output, `command-${index}.json`);
          const deadline = Date.now() + 90000;
          while (!existsSync(command) && Date.now() < deadline)
            await new Promise((resolve) => setTimeout(resolve, 100));
          assert(existsSync(command), "Live visual QA command timed out");
          const request = JSON.parse(readFileSync(command, "utf8"));
          if (request.done) break;
          const result = request.see
            ? await see(request.see)
            : await act(scene, { mark: grid.mark, ...request });
          assert(result.ok, JSON.stringify(result));
          scene = request.see ? result : result.observation;
          copyFileSync(
            result.imageArtifact.path,
            join(output, `live-step-${index}.png`),
          );
          writeFileSync(
            join(output, `live-step-${index}.json`),
            JSON.stringify(
              { scene: scene.scene, wait: result.observationWait },
              null,
              2,
            ),
          );
          console.log(JSON.stringify({ step: index, ok: result.ok }));
        }
        console.log(JSON.stringify({ completed: true, output }));
        return;
      }
      const move = await act(scene, {
        mark: grid.mark,
        cell: { row: 8, column: 8 },
        interaction: "click",
      });
      assert(move.ok, JSON.stringify(move));
      copyFileSync(
        move.imageArtifact.path,
        join(output, "live-grid-after.png"),
      );
      console.log(
        JSON.stringify({
          passed: true,
          name: "original website uses a complete row/column grid and a real center click",
          grid: grid.grid,
          totalMarks: scene.scene.marks.length,
        }),
      );
      console.log(JSON.stringify({ completed: true, passedCases: 1, output }));
      return;
    }
    if (process.env.LYRA_SCENE_STATE_ONLY === "1") {
      await runSceneStateCases({
        load,
        see,
        act,
        map,
        wc,
        check,
        captures: () => captureCount,
        domAct: (extra) => tools["lyraLumen.act"]!(extra),
      });
      console.log(JSON.stringify({ completed: true, cases: count, output }));
      return;
    }
    if (process.env.LYRA_VISUAL_GRIDS_ONLY === "1") {
      await runVisualGridCases({ load, see, act, wc, output, check });
      await runVisualContinuityCases({ load, see, act, wc, output, check });
      console.log(
        JSON.stringify({ completed: true, passedCases: count, output }),
      );
      return;
    }
    await load(
      `<style>button,input{margin:20px;padding:14px}</style><button id=a onclick="window.clicked=(window.clicked||0)+1;window.trusted=event.isTrusted">Move me</button><button id=b>Other</button><input aria-label="Message">`,
    );
    let image = await see();
    assert(image.ok, JSON.stringify(image));
    assert.equal(image.scene.marks.length, 3);
    assert(image.imageArtifact.path);
    check("see returns numbered real controls and a model image artifact");
    const original = markByLabel(image, "Move me");
    await wc.executeJavaScript(`a.style.marginLeft='230px'`);
    let result = await act(image, {
      mark: original,
      interaction: "click",
      observe: "none",
    });
    assert(result.ok, JSON.stringify(result));
    assert.equal(await wc.executeJavaScript("window.clicked"), 1);
    assert.equal(await wc.executeJavaScript("window.trusted"), true);
    const refreshed = await see();
    assert.equal(markByLabel(refreshed, "Move me"), original);
    check(
      "stable mark relocates the original real control after layout movement",
    );
    await wc.executeJavaScript(`a.textContent='Different record'`);
    result = await act(image, {
      mark: original,
      interaction: "click",
      observe: "none",
    });
    assert.equal(result.ok, false);
    assert.equal(await wc.executeJavaScript("window.clicked"), 1);
    check("recycled node with changed identity rejects the old image mark");

    await load(
      `<input aria-label="Message" id=msg><button id=send onclick="window.sent=msg.value;msg.value=''">Send</button>`,
    );
    image = await see();
    const input = markByLabel(image, "Message"),
      send = markByLabel(image, "Send");
    result = await act(image, {
      interaction: "sequence",
      effect: "communicate",
      steps: [
        { interaction: "type", mark: input, text: "连续输入" },
        { interaction: "click", mark: send },
      ],
      observe: "none",
    });
    assert(result.ok, JSON.stringify(result));
    assert.equal(result.completed, 2);
    assert.equal(await wc.executeJavaScript("window.sent"), "连续输入");
    check(
      "one explicit sequence types into a real editor and sends exactly once",
    );
    result = await act(image, {
      interaction: "sequence",
      steps: [{ interaction: "click", mark: send }, { interaction: "bogus" }],
      observe: "none",
    });
    assert.equal(result.ok, false);
    assert.equal(await wc.executeJavaScript("window.sent"), "连续输入");
    check("invalid later step rejects the entire sequence before execution");
    await wc.executeJavaScript(
      `const cover=document.createElement('div');cover.style='position:fixed;inset:0;background:white';document.body.append(cover)`,
    );
    result = await act(image, {
      mark: send,
      interaction: "click",
      observe: "none",
    });
    assert.equal(result.ok, false);
    check("covered real control is not activated through an old mark");

    await load(`<style>canvas{margin:30px;border:0;background:#e8bf7b}</style><canvas id=board width=540 height=540 tabindex=0></canvas><p id=status>Black to play</p><script>
      const ctx=board.getContext('2d');ctx.strokeStyle='#333';for(let i=0;i<15;i++){const p=18+i*36;ctx.beginPath();ctx.moveTo(p,18);ctx.lineTo(p,522);ctx.stroke();ctx.beginPath();ctx.moveTo(18,p);ctx.lineTo(522,p);ctx.stroke();}
      window.moves=[];board.onclick=e=>{const r=board.getBoundingClientRect(),x=Math.round((e.clientX-r.x-18)/36),y=Math.round((e.clientY-r.y-18)/36);if(moves.some(m=>m.x===x&&m.y===y))return;moves.push({x,y,trusted:e.isTrusted});ctx.beginPath();ctx.arc(18+x*36,18+y*36,13,0,Math.PI*2);ctx.fill();status.textContent=moves.length+' black stones';};
      window.paths=[];board.onpointerdown=e=>{board.setPointerCapture(e.pointerId);window.held=true;paths.push(['down',e.clientX,e.clientY]);};board.onpointermove=e=>{if(e.buttons)paths.push(['move',e.clientX,e.clientY]);};board.onpointerup=e=>{window.held=false;paths.push(['up',e.clientX,e.clientY]);};
      window.keys=[];addEventListener('keydown',e=>keys.push(['down',e.key,performance.now()]));addEventListener('keyup',e=>keys.push(['up',e.key,performance.now()]));
    </script>`);
    image = await see();
    let boardMark = image.scene.marks.find(
      (m: any) => m.kind === "region" && m.role === "canvas",
    ).mark;
    const started = performance.now();
    for (let i = 0; i < 5; i++) {
      result = await act(image, {
        mark: boardMark,
        position: { x: (18 + (3 + i) * 36) / 540, y: (18 + 7 * 36) / 540 },
        interaction: "click",
      });
      assert(result.ok, JSON.stringify(result));
      assert(result.observation?.scene);
      assert(result.imageArtifact, "action result did not attach image");
      image = result.observation;
      assert(image.scene.marks.some((m: any) => m.mark === boardMark));
    }
    assert.deepEqual(
      await wc.executeJavaScript("moves.map(m=>[m.x,m.y,m.trusted])"),
      [
        [3, 7, true],
        [4, 7, true],
        [5, 7, true],
        [6, 7, true],
        [7, 7, true],
      ],
    );
    writeFileSync(join(output, "gomoku.png"), (await wc.capturePage()).toPNG());
    console.log(
      JSON.stringify({
        metric: "five_canvas_moves_and_returned_images_ms",
        elapsed: performance.now() - started,
      }),
    );
    check(
      "five canvas board placements use native clicks and return the next numbered image in every action",
    );
    const crop = await see({ region: boardMark });
    assert(crop.width < 1000);
    assert(crop.scene.marks.some((m: any) => m.mark === boardMark));
    check("region close-up preserves marks and image coordinate geometry");
    result = await act(crop, {
      mark: boardMark,
      interaction: "drag",
      path: [
        { x: 0.1, y: 0.1 },
        { x: 0.7, y: 0.1 },
        { x: 0.7, y: 0.7 },
        { x: 0.2, y: 0.8 },
      ],
      durationMs: 320,
      observe: "none",
    });
    assert(result.ok, JSON.stringify(result));
    const path = await wc.executeJavaScript("paths");
    assert(path.filter((p: any) => p[0] === "move").length >= 12);
    assert.equal(await wc.executeJavaScript("held"), false);
    check(
      "continuous curved drag emits intermediate native moves and releases",
    );
    result = await act(crop, {
      interaction: "press",
      key: "ArrowRight",
      holdMs: 180,
      observe: "none",
    });
    assert(result.ok, JSON.stringify(result));
    let keys = await wc.executeJavaScript("keys");
    assert(keys.at(-1)[2] - keys.at(-2)[2] >= 160);
    check("timed game key holds produce actual keydown and keyup");
    const operation = trackBrowserOperation("visual-cancel-test");
    const pending = browserAgentOperationContext.run(
      {
        sessionId: "agent-session-default",
        turnId: "visual-cancel-test",
        signal: operation.controller.signal,
      },
      () =>
        visual.act("fixture", {
          captureId: crop.scene.captureId,
          interaction: "press",
          key: "ArrowLeft",
          holdMs: 1500,
          effect: "editDraft",
          observe: "none",
        }),
    );
    setTimeout(() => cancelBrowserOperations("visual-cancel-test"), 120);
    result = await pending;
    operation.dispose();
    assert.equal(result.ok, false);
    keys = await wc.executeJavaScript("keys");
    assert.equal(keys.at(-1)[0], "up");
    assert.equal(keys.at(-1)[1], "ArrowLeft");
    check("turn cancellation interrupts a hold and always releases the key");
    const pointerOperation = trackBrowserOperation("visual-drag-cancel");
    const dragPending = browserAgentOperationContext.run(
      {
        sessionId: "agent-session-default",
        turnId: "visual-drag-cancel",
        signal: pointerOperation.controller.signal,
      },
      () =>
        visual.act("fixture", {
          captureId: crop.scene.captureId,
          mark: boardMark,
          interaction: "drag",
          path: [
            { x: 0.2, y: 0.3 },
            { x: 0.8, y: 0.8 },
          ],
          durationMs: 1500,
          effect: "editDraft",
          observe: "none",
        }),
    );
    setTimeout(() => cancelBrowserOperations("visual-drag-cancel"), 200);
    result = await dragPending;
    pointerOperation.dispose();
    assert.equal(result.ok, false);
    assert.equal(await wc.executeJavaScript("held"), false);
    check("turn cancellation interrupts a drag and releases pointer capture");
    result = await visual.act("foreign", {
      captureId: crop.scene.captureId,
      mark: boardMark,
      interaction: "click",
      effect: "editDraft",
      observe: "none",
    });
    assert.equal(result.ok, false);
    check("capture identity cannot cross tabs");
    await win.loadURL("data:text/html,<button>New document</button>");
    result = await act(crop, {
      mark: boardMark,
      interaction: "click",
      observe: "none",
    });
    assert.equal(result.ok, false);
    check(
      "navigation rejects old visual marks even at identical viewport dimensions",
    );

    await load(
      `<style>button{width:40px;height:30px;margin:4px}</style>${Array.from({ length: 100 }, (_, i) => `<button>${i}</button>`).join("")}`,
    );
    image = await see({ maxMarks: 20 });
    assert.equal(image.scene.marks.length, 20);
    assert(image.scene.unmarkedCount > 0);
    assert.equal(image.scene.nextOffset, 20);
    const second = await see({ offset: 20, maxMarks: 20 });
    assert(
      !second.scene.marks.some((m: any) =>
        image.scene.marks.some((first: any) => first.mark === m.mark),
      ),
    );
    check(
      "crowded scenes page visible marks without renumbering or losing the rest",
    );
    writeFileSync(
      join(output, "numbered.png"),
      Buffer.from(
        (await visual.capture("fixture", { maxMarks: 80 })).imageBase64,
        "base64",
      ),
    );
    const before = image;
    await wc.executeJavaScript(
      `document.body.innerHTML='<button>Replacement</button>'`,
    );
    result = await act(before, {
      mark: before.scene.marks[0].mark,
      interaction: "click",
      observe: "none",
    });
    assert.equal(result.ok, false);
    check("detached objects never rebound to replacement markup");

    win.setContentSize(2400, 1200);
    wc.setZoomFactor(1.25);
    await load(
      `<style>body{margin:0}canvas{position:absolute;left:250px;top:120px;background:#f2ca84}</style><canvas id=c width=800 height=400></canvas><script>window.hits=[];c.onclick=e=>{const r=c.getBoundingClientRect();hits.push([Math.round(e.clientX-r.x),Math.round(e.clientY-r.y),e.isTrusted]);};</script>`,
    );
    image = await see();
    assert(
      image.downsampled,
      JSON.stringify({ width: image.width, frame: image.visualFrame }),
    );
    const canvas = image.scene.marks.find((m: any) => m.role === "canvas");
    result = await act(image, {
      interaction: "click",
      point: {
        x: canvas.bounds.x + canvas.bounds.width * 0.3,
        y: canvas.bounds.y + canvas.bounds.height * 0.4,
      },
      observe: "none",
    });
    assert(result.ok, JSON.stringify(result));
    assert.deepEqual(await wc.executeJavaScript("hits"), [[240, 160, true]]);
    check(
      "downsampled high-DPI screenshot pixels map to the exact CSS input point",
    );
    result = await act(image, {
      interaction: "click",
      point: { x: canvas.bounds.x + 20, y: canvas.bounds.y + 20 },
      observe: "none",
    });
    assert.equal(result.ok, false);
    check("raw pixel coordinates cannot be replayed from a consumed image");
    image = await see({ region: canvas.mark });
    const cropped = image.scene.marks.find((m: any) => m.mark === canvas.mark);
    result = await act(image, {
      interaction: "click",
      point: {
        x: cropped.bounds.x + cropped.bounds.width * 0.7,
        y: cropped.bounds.y + cropped.bounds.height * 0.8,
      },
      observe: "none",
    });
    assert(result.ok, JSON.stringify(result));
    assert.deepEqual(await wc.executeJavaScript("hits.at(-1)"), [
      560,
      320,
      true,
    ]);
    check("cropped image coordinates preserve both origin and scale");
    image = await see();
    await wc.executeJavaScript(`c.getContext('2d').fillRect(100,100,70,70)`);
    result = await act(image, {
      interaction: "click",
      point: { x: canvas.bounds.x + 20, y: canvas.bounds.y + 20 },
      observe: "none",
    });
    assert.equal(result.ok, true, JSON.stringify(result));
    check(
      "pixel changes elsewhere in a canvas do not invalidate a stable raw input target",
    );
    image = await see();
    await wc.executeJavaScript(`c.getContext('2d').fillRect(0,0,80,80)`);
    result = await act(image, {
      interaction: "click", point: { x: canvas.bounds.x + 20, y: canvas.bounds.y + 20 }, observe: "none",
    });
    assert.equal(result.ok, false);
    assert.equal(result.reason, "image_content_changed");
    check("pixel-only changes at the intended canvas location still reject stale raw input");
    wc.setZoomFactor(1);
    win.setContentSize(1000, 718);

    await load(
      `<iframe style="margin:60px;width:400px;height:200px" srcdoc="<canvas id=c width=260 height=150 style='background:tan'></canvas><script>c.onclick=e=>window.clicked=e.isTrusted</script>"></iframe><div id=shadow></div><script>shadow.attachShadow({mode:'closed'}).innerHTML='<button onclick="window.shadowHit=event.isTrusted">Shadow action</button>';</script>`,
    );
    image = await see();
    const framed = image.scene.marks.find((m: any) => m.role === "canvas");
    assert(framed);
    result = await act(image, {
      mark: framed.mark,
      position: { x: 0.2, y: 0.2 },
      interaction: "click",
      observe: "none",
    });
    assert(result.ok, JSON.stringify(result));
    assert.equal(
      await wc.executeJavaScript(
        'document.querySelector("iframe").contentWindow.clicked',
      ),
      true,
    );
    check(
      "numbered canvas inside an iframe receives correctly translated trusted input",
    );
    const shadowMark = image.scene.marks.find((m: any) => m.role === "button");
    assert(shadowMark);
    result = await act(image, {
      mark: shadowMark.mark,
      interaction: "click",
      observe: "none",
    });
    assert(result.ok, JSON.stringify(result));
    assert.equal(await wc.executeJavaScript("window.shadowHit"), true);
    check("numbered real controls work inside a closed shadow root");

    await load(
      `<div id=host></div><script>host.attachShadow({mode:'closed'}).innerHTML='<input aria-label="Closed editor"><button onclick="window.saved=this.previousElementSibling.value">Save</button>';</script>`,
    );
    image = await see();
    const editor = image.scene.marks.find((m: any) => m.role === "input"),
      save = image.scene.marks.find((m: any) => m.role === "button");
    assert(editor && save);
    result = await act(image, {
      effect: "editDraft",
      interaction: "sequence",
      steps: [
        { interaction: "type", mark: editor.mark, text: "Shadow draft" },
        { interaction: "click", mark: save.mark },
      ],
      observe: "none",
    });
    assert(result.ok, JSON.stringify(result));
    assert.equal(await wc.executeJavaScript("window.saved"), "Shadow draft");
    check(
      "closed-root editor and button share the same numbered input sequence",
    );

    await load(
      `<input id=other aria-label="Other editor"><canvas id=game tabindex=0 width=200 height=100 style="background:tan"></canvas><script>window.keyTarget=null;window.keyTrusted=false;window.clicks=0;game.onkeydown=e=>{keyTarget=e.target.id;keyTrusted=e.isTrusted;};game.onclick=()=>clicks++;other.focus();</script>`,
    );
    image = await see();
    result = await act(image, {
      mark: image.scene.marks.find((m: any) => m.role === "canvas").mark,
      interaction: "press",
      key: "ArrowRight",
      holdMs: 80,
      observe: "none",
    });
    assert(result.ok, JSON.stringify(result));
    assert.deepEqual(
      await wc.executeJavaScript("[keyTarget,keyTrusted,clicks]"),
      ["game", true, 0],
    );
    check("held keys focus the marked game region without an accidental click");

    const blockedStorage = join(profile, "blocked-storage");
    writeFileSync(blockedStorage, "not a directory");
    const failingStorageTools = createLumenToolHost({
      getBrowserBridge: () => bridge,
      tabResolver: { resolveBrowserAgentTabId: async () => "fixture" },
      storageRoot: blockedStorage,
    } as never).handlers;
    result = (await failingStorageTools["lyraLumen.vact"]!({
      captureId: image.scene.captureId,
      mark: image.scene.marks.find((m: any) => m.role === "canvas").mark,
      interaction: "click",
      effect: "editDraft",
      observe: "image",
    })) as any;
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.equal(result.completed, 1);
    assert(result.observationError);
    assert(!JSON.stringify(result).includes("imageBase64"));
    assert.equal(await wc.executeJavaScript("clicks"), 1);
    check(
      "image storage failure preserves the completed action and never replays input",
    );

    await load(
      `<button id=first onclick="document.querySelector('#second').textContent='Other target';window.firstCount=(window.firstCount||0)+1">First</button><button id=second onclick="window.second=true">Second</button>`,
    );
    image = await see();
    result = await act(image, {
      interaction: "sequence",
      steps: [
        { interaction: "click", mark: markByLabel(image, "First") },
        { interaction: "click", mark: markByLabel(image, "Second") },
      ],
      observe: "none",
    });
    assert.equal(result.ok, false);
    assert.equal(result.completed, 1);
    assert.equal(await wc.executeJavaScript("window.firstCount"), 1);
    assert.equal(await wc.executeJavaScript("window.second===true"), false);
    check(
      "a changed later target stops the sequence and preserves its completed count",
    );

    await load(
      `<button id=a style="width:100px;height:60px">Start</button><button id=b style="margin-left:200px;width:100px;height:60px">End</button><script>window.motion=[];window.downAt=0;window.upAt=0;a.onpointerdown=e=>{downAt=performance.now();a.setPointerCapture(e.pointerId);};a.onpointermove=e=>{if(e.buttons)motion.push(e.clientX);};a.onpointerup=()=>upAt=performance.now();</script>`,
    );
    image = await see();
    result = await act(image, {
      mark: markByLabel(image, "Start"),
      toMark: markByLabel(image, "End"),
      interaction: "drag",
      durationMs: 180,
      holdMs: 60,
      observe: "none",
    });
    assert(result.ok, JSON.stringify(result));
    const motion = await wc.executeJavaScript(
      "({duration:upAt-downAt,motion})",
    );
    assert(motion.duration >= 220, JSON.stringify(motion));
    assert(motion.motion.length > 4, JSON.stringify(motion));
    check(
      "duration and hold are honored for continuous drags between real controls",
    );
    await load(
      `<div id=scroller role=application style="width:400px;height:300px;overflow:auto"><div style="width:1000px;height:1000px;background:tan"></div></div><script>window.wheel=null;scroller.addEventListener('wheel',e=>wheel=[e.deltaX,e.deltaY,e.isTrusted]);</script>`,
    );
    image = await see();
    result = await act(image, {
      mark: image.scene.marks.find((m: any) => m.role === "application").mark,
      interaction: "scroll",
      scrollDx: 200,
    });
    assert(result.ok, JSON.stringify(result));
    assert.deepEqual(await wc.executeJavaScript("wheel"), [200, 0, true]);
    assert.equal(await wc.executeJavaScript("scroller.scrollTop"), 0);
    check(
      "horizontal-only region scroll does not add an unintended vertical wheel",
    );
    await runSceneStateCases({
      load,
      see,
      act,
      map,
      wc,
      check,
      captures: () => captureCount,
      domAct: (extra) => tools["lyraLumen.act"]!(extra),
    });
    await runVisualGridCases({ load, see, act, wc, output, check });
    await runVisualContinuityCases({ load, see, act, wc, output, check });
    console.log(
      JSON.stringify({ completed: true, passedCases: count, output }),
    );
  } finally {
    visual.dispose();
    win.destroy();
  }
};
run()
  .then(
    () => app.exit(0),
    (error) => {
      console.error(error);
      app.exit(1);
    },
  )
  .finally(() => rmSync(profile, { recursive: true, force: true }));
