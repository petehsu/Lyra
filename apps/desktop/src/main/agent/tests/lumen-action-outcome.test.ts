import { afterEach, expect, test, vi } from "vitest";
vi.mock("electron", () => ({ BrowserWindow: {} }));
import { createLumenToolHost } from "../lumen-tool-host";

afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); });

test.each([true, false])("tool entry preserves whole-surface outcome when clicked node is unchanged (settled=%s)", async settled => {
  vi.useFakeTimers();
  const result = { ok: true, afterObservationId: "after-menu", pageChanged: true,
    elementDiff: { changed: [], noObservableChange: true },
    surfaceChange: { changed: true, settled, addedTargetRefs: ["lumen:delete"], removedTargetRefs: [], updatedTargetRefs: [], contextChanged: false },
    message: "Observed after click on Latest conversation: Added Delete" };
  const actOnAgentElement = vi.fn(async () => result);
  const { handlers } = createLumenToolHost({
    getBrowserBridge: () => ({ actOnAgentElement }),
    tabResolver: { resolveBrowserAgentTabId: async () => "fixture" }, storageRoot: "/tmp"
  } as unknown as Parameters<typeof createLumenToolHost>[0]);
  const actual = await handlers["lyraLumen.act"]!({ targetRef: "lumen:more", interaction: "click" });
  expect(actual).toMatchObject({ ...result, nextRecommendedAction: settled ? "continue_with_cached_targets" : "lyra_lumen.wait" });
  expect(actOnAgentElement).toHaveBeenCalledTimes(1);
});

test.each([
  [{}, "viewport"], [{ scope: "full" }, "full"],
  [{ scope: "viewport", instruction: "Read the confirmation" }, "viewport"],
  [{ scope: "full", instruction: "Read the page" }, "full"]
])("read forwards scope and length through all tool paths: %j", async (payload, scope) => {
  vi.useFakeTimers();
  const readAgentPage = vi.fn(async () => ({ content: "Dialog text", truncated: false }));
  const { handlers } = createLumenToolHost({
    getBrowserBridge: () => ({ readAgentPage }),
    tabResolver: { resolveBrowserAgentTabId: async () => "fixture" }, storageRoot: "/tmp"
  } as unknown as Parameters<typeof createLumenToolHost>[0]);
  await handlers["lyraLumen.read"]!({ ...payload, maxChars: 1200 });
  expect(readAgentPage).toHaveBeenCalledWith("fixture", expect.objectContaining({ scope, maxChars: 1200 }));
});


test("unchanged settled surface is not a completed action",async()=>{
  const {nextRecommendedActionAfterFastLumenAction}=await import("../lumen-tool-host-helpers");
  expect(nextRecommendedActionAfterFastLumenAction({ok:true,afterObservationId:"same",
    surfaceChange:{changed:false,settled:true},elementDiff:{noObservableChange:true,changed:[]}})).toBe("lyra_lumen.read");
});

test.each([{}, {scope:"full"}, {instruction:"Read this step"}])("read preserves page identity even with a shared heading: %j",async args=>{
  const {handlers}=createLumenToolHost({getBrowserBridge:()=>({readAgentPage:async()=>({content:"Device Activation",url:"https://example.test/login/device/account",title:"Activate",truncated:false})}),
    tabResolver:{resolveBrowserAgentTabId:async()=>"fixture"},storageRoot:"/tmp"} as never);
  expect(await handlers["lyraLumen.read"]!(args)).toMatchObject({url:"https://example.test/login/device/account",title:"Activate",content:"Device Activation"});
});


test("observe without an explicit gesture is rejected before dispatch, while hover stays observational",async()=>{
  const actOnAgentElement=vi.fn(async()=>({ok:true}));
  const {handlers}=createLumenToolHost({getBrowserBridge:()=>({actOnAgentElement}),
    tabResolver:{resolveBrowserAgentTabId:async()=>"fixture"},storageRoot:"/tmp"} as never);
  expect(await handlers["lyraLumen.act"]!({targetRef:"lumen:menu",effect:"observe"})).toMatchObject({ok:false});
  expect(actOnAgentElement).not.toHaveBeenCalled();
  expect(await handlers["lyraLumen.act"]!({targetRef:"lumen:menu",effect:"observe",interaction:"hover"})).toMatchObject({ok:true});
  expect(actOnAgentElement).toHaveBeenCalledWith("fixture",expect.objectContaining({effect:"observe",interaction:"hover"}));
});


test.each(["focus","typo",""])("unknown gesture %j never becomes a click",async interaction=>{
  const actOnAgentElement=vi.fn();
  const {handlers}=createLumenToolHost({getBrowserBridge:()=>({actOnAgentElement}),
    tabResolver:{resolveBrowserAgentTabId:async()=>"fixture"},storageRoot:"/tmp"} as never);
  expect(await handlers["lyraLumen.act"]!({targetRef:"lumen:submit",effect:"communicate",interaction})).toMatchObject({ok:false});
  expect(actOnAgentElement).not.toHaveBeenCalled();
});
