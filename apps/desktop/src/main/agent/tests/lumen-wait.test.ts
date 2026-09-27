import { afterEach, expect, test, vi } from "vitest";

vi.mock("electron", () => ({ BrowserWindow: {} }));
import { createLumenToolHost } from "../lumen-tool-host";
import { waitForLumenPage } from "../lumen-page-wait";

test("a ready navigation destination ends a guessed intermediate-text wait without claiming success", async () => {
  vi.useFakeTimers();
  const readAgentPage = vi.fn(async () => ({ ...sample("Signed in home"), url: "https://example.test/home" }));
  const pending = waitForLumenPage({readAgentPage} as never, 'tab', {
    targetMode:'live', until:'textContains', text:'Choose an account',
    navigationFromUrl:'https://example.test/login', timeoutMs:10000, idleMs:100
  });
  await vi.runAllTimersAsync();
  expect(await pending).toMatchObject({matched:false, stopReason:'navigationChanged', elapsedMs:100});
  expect(readAgentPage).toHaveBeenCalledTimes(2);
});

afterEach(() => vi.useRealTimers());
const wait = async (samples: Record<string, unknown>[], args: Record<string, unknown> = {}, baseline?: {content: string; truncated?: boolean; tabId?: string; maxChars?: number; scope?: "full" | "viewport"}) => {
  vi.useFakeTimers();
  let index = 0;
  const readAgentPage = vi.fn(async () => samples[Math.min(index++, samples.length - 1)]);
  const handlers = createLumenToolHost({
    getBrowserBridge: () => ({ readAgentPage, scrollAgentPage: async () => ({ok:true}), showAgentActivity: async () => {} }),
    tabResolver: { resolveBrowserAgentTabId: async (payload: {tabId?: string}) => payload.tabId ?? "fixture" }, storageRoot: "/tmp"
  } as unknown as Parameters<typeof createLumenToolHost>[0]).handlers;
  if (baseline) {
    readAgentPage.mockResolvedValueOnce({ content: baseline.content, truncated: baseline.truncated === true });
    const read = await handlers["lyraLumen.read"]!({tabId: baseline.tabId ?? "fixture", strategy:"focus", scope:baseline.scope, maxChars:baseline.maxChars});
    expect(read).toMatchObject({ok:true});
    readAgentPage.mockClear();
  }
  const pending = handlers["lyraLumen.wait"]!({ tabId:"fixture", timeoutMs: 1500, idleMs: 20, ...args });
  await vi.runAllTimersAsync();
  return { result: await pending, readAgentPage };
};
const sample = (content: string, state = {}) => ({
  content, truncated: false, waitState: { readyState: "complete", busy: false, ...state }
});

test("empty text cannot satisfy textStable", async () => {
  const { result } = await wait([sample("")]);
  expect(result).toMatchObject({ matched: false, completion: "unknown", readStatus: "empty" });
});

test("unchanging text while aria-busy stays true is not finished", async () => {
  const { result } = await wait([sample("Partial answer", { busy: true })]);
  expect(result).toMatchObject({ matched: false, completion: "unknown" });
});

test("text stability is explicitly reported as a heuristic, not answer completion", async () => {
  const { result } = await wait([sample("A visible answer")]);
  expect(result).toMatchObject({ matched: true, completion: "unknown", content: "A visible answer" });
});

test("loadIdle requires actual loaded document state, not unchanged text", async () => {
  const { result } = await wait([sample("Loading", { readyState: "loading" })], { until: "loadIdle" });
  expect(result).toMatchObject({ matched: false });
});

test("truncated text cannot establish stability of the unseen remainder", async () => {
  const { result } = await wait([{ ...sample("Static prefix"), truncated: true }]);
  expect(result).toMatchObject({ matched: false, completion: "unknown" });
});

test("textChanged can compare against text observed before submission", async () => {
  const { result } = await wait([sample("New response")], { until: "textChanged", previousText: "Old response" }, {content:"Old response"});
  expect(result).toMatchObject({ matched: true, completion: "conditionMet" });
});

test.each([
  {previousText:"Authorize",baseline:{content:"Header Authorize GitHub CLI Footer"}},
  {previousText:"Old",baseline:{content:"Old",truncated:true}},
  {previousText:"Old",baseline:{content:"Old",tabId:"other"}},
  {previousText:"Old",baseline:{content:"Old",maxChars:6000},maxChars:512}
])("textChanged rejects snippets, incomplete text, other pages and mismatched scopes: %j",async({previousText,baseline,...args})=>{
  const {result,readAgentPage}=await wait([sample("Header Authorize GitHub CLI Footer")],{until:"textChanged",previousText,...args},baseline);
  expect(result).toMatchObject({ok:false});
  expect(readAgentPage).not.toHaveBeenCalled();
});

test("textChanged cannot report a truncated result as a proven change",async()=>{
  const {result}=await wait([{...sample("Prefix"),truncated:true}],{until:"textChanged",previousText:"Full text"},{content:"Full text"});
  expect(result).toMatchObject({matched:false});
});

test("an observed empty page is a valid pre-action baseline",async()=>{
  const {result}=await wait([sample("Loaded")],{until:"textChanged",previousText:""},{content:""});
  expect(result).toMatchObject({matched:true});
});

test("targetEnabled waits through a disabled ready control", async () => {
  const { result, readAgentPage } = await wait([
    sample("Working", { target: { visible: true, enabled: false } }),
    sample("Done", { target: { visible: true, enabled: true } })
  ], { until: "targetEnabled", targetRef: "lumen:send" });
  expect(result).toMatchObject({ matched: true, content: "Done" });
  expect(readAgentPage).toHaveBeenCalledTimes(2);
});

test("an observed stop control must disappear before targetHidden matches", async () => {
  const { result, readAgentPage } = await wait([
    sample("Partial", { target: { visible: true, enabled: true } }),
    sample("Full answer", { target: { visible: false, enabled: false } })
  ], { until: "targetHidden", targetRef: "lumen:stop" });
  expect(result).toMatchObject({ matched: true, completion: "conditionMet", content: "Full answer" });
  expect(readAgentPage).toHaveBeenCalledWith("fixture", expect.objectContaining({ waitTargetRef: "lumen:stop" }));
});

test.each([{ until: "textContains" }, { until: "targetHidden" }, { until: "typo" }])(
  "invalid wait request fails before polling: %j", async args => {
    const { result, readAgentPage } = await wait([sample("unchanged")], args);
    expect(result).toMatchObject({ ok: false });
    expect(readAgentPage).not.toHaveBeenCalled();
  }
);

test("post-action textChanged without a baseline fails before polling",async()=>{
  const {result,readAgentPage}=await wait([sample("Authorize GitHub CLI")],{until:"textChanged",timeoutMs:30000});
  expect(result).toMatchObject({ok:false});expect(readAgentPage).not.toHaveBeenCalled();
});

test("transient frame timeout stays inside the wait budget",async()=>{
  vi.useFakeTimers();
  const readAgentPage=vi.fn().mockRejectedValueOnce(new Error("frame script timed out after 4000ms")).mockResolvedValue(sample("Device connected"));
  const {handlers}=createLumenToolHost({getBrowserBridge:()=>({readAgentPage,showAgentActivity:async()=>{}}) as never,
    tabResolver:{resolveBrowserAgentTabId:async()=>"fixture"} as never,storageRoot:"/tmp"});
  const pending=handlers["lyraLumen.wait"]!({until:"textContains",text:"Device connected",timeoutMs:10000});
  await vi.runAllTimersAsync();
  expect(await pending).toMatchObject({matched:true});expect(readAgentPage).toHaveBeenCalledTimes(2);
});


test("targetEnabled reveals once before polling and never clicks",async()=>{
  vi.useFakeTimers();
  let visible = false;
  const scrollAgentPage=vi.fn(async()=>{visible=true;return {ok:true};});
  const readAgentPage=vi.fn(async()=>sample("Authorize",{target:{visible,enabled:visible}}));
  const actOnAgentElement=vi.fn();
  const {handlers}=createLumenToolHost({getBrowserBridge:()=>({scrollAgentPage,readAgentPage,actOnAgentElement,showAgentActivity:async()=>{}}) as never,
    tabResolver:{resolveBrowserAgentTabId:async()=>"fixture"} as never,storageRoot:"/tmp"});
  const pending=handlers["lyraLumen.wait"]!({until:"targetEnabled",targetRef:"lumen:authorize",timeoutMs:1500});
  await vi.runAllTimersAsync();
  expect(await pending).toMatchObject({matched:true});
  expect(scrollAgentPage).toHaveBeenCalledTimes(1);expect(actOnAgentElement).not.toHaveBeenCalled();
});


test("full scan fingerprint detects a changing remainder beyond a truncated excerpt",async()=>{
  const snapshots=["one","two","three","three"].map(textFingerprint=>({...sample("same excerpt",{textFingerprint,coverage:{scope:"full",scanComplete:true}}),truncated:true}));
  const {result,readAgentPage}=await wait(snapshots);
  expect(result).toMatchObject({matched:true,completion:"unknown",scope:"full",truncated:true});
  expect(readAgentPage).toHaveBeenCalledTimes(4);
  expect(readAgentPage).toHaveBeenCalledWith("fixture",expect.objectContaining({scope:"full",textTail:true}));
});

test("an unresolved embedded frame never proves text stability",async()=>{
  const {result}=await wait([sample("Main frame",{textFingerprint:"unchanged-main-frame",coverage:{scope:"full",scanComplete:false}})]);
  expect(result).toMatchObject({matched:false});
});

test("textContains can match rendered text beyond the bounded excerpt",async()=>{
  const {result}=await wait([sample("Recent text",{textMatch:true})],{until:"textContains",text:"Earlier result"});
  expect(result).toMatchObject({matched:true,completion:"conditionMet"});
});

test("wait returns the final controls once without another agent map call",async()=>{
  vi.useFakeTimers();
  const readAgentPage=vi.fn(async()=>sample("Finished"));
  const observeAgentPage=vi.fn(async()=>({elements:[],url:"https://example.test/",activeElementId:null}));
  const {handlers}=createLumenToolHost({getBrowserBridge:()=>({readAgentPage,observeAgentPage,showAgentActivity:async()=>{}}) as never,
    tabResolver:{resolveBrowserAgentTabId:async()=>"fixture"} as never,storageRoot:"/tmp"});
  const pending=handlers["lyraLumen.wait"]!({until:"textContains",text:"Finished",timeoutMs:1500});
  await vi.runAllTimersAsync();
  expect(await pending).toMatchObject({matched:true,nextRecommendedAction:"use_returned_state",mapAppendix:expect.stringContaining("Index:")});
  expect(observeAgentPage).toHaveBeenCalledTimes(1);
});


test("textChanged preserves its baseline scope instead of comparing viewport with full document",async()=>{
  const {result,readAgentPage}=await wait([sample("New full document")],{until:"textChanged",previousText:"Old full document"},{content:"Old full document",scope:"full"});
  expect(result).toMatchObject({matched:true,scope:"full"});
  expect(readAgentPage).toHaveBeenCalledWith("fixture",expect.objectContaining({scope:"full",textTail:false}));
  const mismatch=await wait([sample("New")],{until:"textChanged",previousText:"Old",scope:"viewport"},{content:"Old",scope:"full"});
  expect(mismatch.result).toMatchObject({ok:false});expect(mismatch.readAgentPage).not.toHaveBeenCalled();
});
