import { expect, test } from "vitest";
import { createLumenMapPager } from "../lumen-map-pager";
import type { WorkbenchBrowserAgentObservation } from "../../workbench-browser/types";

const source = () => ({url:"https://example.test", activeElementId:null, elements:Array.from({length:240},(_,id)=>({
  id,targetRef:`lumen:${id}`,frameRef:"main",tagName:"button",role:"button",label:`Feed row ${id}`,bounds:{x:0,y:0,width:100,height:30},disabled:false,editable:false
}))} as unknown as WorkbenchBrowserAgentObservation);
const cursorOf = (text: string) => /Next cursor=([^\s]+)/.exec(text)?.[1];

test("paging retains every original control while the feed changes and stays within budget", () => {
  const pager = createLumenMapPager(), observation = source();
  const first = pager.start("session/live/tab",observation,{});
  const refs = (text: string) => [...text.matchAll(/targetRef=(lumen:\d+)\]/g)].map(match=>match[1]!);
  const seen = refs(first.mapAppendix);
  let cursor = cursorOf(first.mapAppendix);
  (observation.elements[0] as {label:string}).label = "Renamed after observation";
  (observation.elements as unknown[]).splice(1,30);
  while(cursor) {
    const page = pager.next("session/live/tab",{cursor});
    expect(page.mapAppendix.length).toBeLessThanOrEqual(6000);
    expect(page.observation.elements).toHaveLength(240);
    seen.push(...refs(page.mapAppendix)); cursor = cursorOf(page.mapAppendix);
  }
  expect(seen).toHaveLength(240); expect(new Set(seen).size).toBe(240);
  const fresh = pager.start("session/live/tab",observation,{});
  expect(fresh.observation.elements).toHaveLength(210);
});

test("cursors do not cross tabs, sessions, filters, navigation or their lifetime", () => {
  const pager = createLumenMapPager();
  const first = pager.start("session/live/tab",source(),{query:"Feed"},1000);
  const cursor = cursorOf(first.mapAppendix)!;
  for (const [key,query,url,now] of [
    ["other/live/tab","Feed",undefined,1001], ["session/live/other","Feed",undefined,1001],
    ["session/live/tab","Other",undefined,1001], ["session/live/tab","Feed","https://other.test",1001],
    ["session/live/tab","Feed",undefined,301001]
  ] as const) expect(()=>pager.next(key,{query,cursor},url,now)).toThrow("Map snapshot expired");
});

test("bounded cache evicts old snapshots instead of retaining arbitrary page histories",()=>{
  const pager = createLumenMapPager(), first = pager.start("tab",source(),{},1000);
  const cursor = cursorOf(first.mapAppendix)!;
  for(let i=0;i<16;i++) pager.start(`tab-${i}`,source(),{},1001+i);
  expect(()=>pager.next("tab",{cursor},undefined,1100)).toThrow("Map snapshot expired");
});

test("tool pagination reads metadata once and never recollects the changing page", async () => {
  const { vi } = await import("vitest");
  const { createLumenToolHost } = await import("../lumen-tool-host");
  const observation = {...source(),kind:"lyraLumenMap",tabId:"tab",blockedRegions:[],warnings:[]};
  const observeAgentPage = vi.fn().mockResolvedValue(observation);
  const readAgentPreviewPage = vi.fn().mockResolvedValue({url:observation.url});
  const bridge={observeAgentPage,readAgentPreviewPage};
  const {handlers}=createLumenToolHost({getBrowserBridge:()=>bridge as never,storageRoot:"/tmp/lyra-pager-test",tabResolver:{resolveBrowserAgentTabId:async()=>"tab"} as never});
  const first=await handlers["lyraLumen.map"]!({agentSessionId:"one"}) as {mapAppendix:string};
  const cursor=cursorOf(first.mapAppendix)!; expect(cursor).toBeTruthy();
  (observation.elements as unknown[]).splice(0,20);
  const second=await handlers["lyraLumen.map"]!({agentSessionId:"one",cursor}) as {mapAppendix:string};
  expect(second.mapAppendix).toContain("240 observed controls");
  expect(observeAgentPage).toHaveBeenCalledTimes(1); expect(readAgentPreviewPage).toHaveBeenCalledTimes(1);
  const foreign=await handlers["lyraLumen.map"]!({agentSessionId:"two",cursor});
  expect(foreign).toMatchObject({ok:false});expect(observeAgentPage).toHaveBeenCalledTimes(1);
});


test("compact wait maps keep a valid cursor and the same budget for subsequent pages",()=>{
  const pager=createLumenMapPager();
  let page=pager.start("task/live/tab",source(),{},1000,3000), count=0;
  for (;;) {
    expect(page.mapAppendix.length).toBeLessThan(3200);
    count+=[...page.mapAppendix.matchAll(/targetRef=lumen:\d+\]/g)].length;
    const cursor=cursorOf(page.mapAppendix);if(!cursor)break;
    page=pager.next("task/live/tab",{cursor},undefined,1001);
  }
  expect(count).toBe(240);
});
