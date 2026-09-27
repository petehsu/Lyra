import { afterEach, expect, test, vi } from "vitest";
vi.mock("electron", () => ({ BrowserWindow: {} }));
import { createLumenToolHost } from "../lumen-tool-host";

afterEach(() => vi.useRealTimers());
const setup = () => {
  const responseWatch = {operationId:"operation-1",targetRef:"lumen:send",status:"pending",startedAt:Date.now(),evidence:[]};
  const typeIntoAgentElement = vi.fn(async()=>({ok:true,tabId:"fixture",inputValidation:{valid:true}}));
  const actOnAgentElement = vi.fn(async()=>({ok:true,tabId:"fixture",responseWatch}));
  const readAgentPage = vi.fn(async()=>({content:"The new answer",truncated:false,
    waitState:{readyState:"complete",busy:false,response:{...responseWatch,status:"complete"}}}));
  const observeAgentPage = vi.fn();
  const browser={typeIntoAgentElement,actOnAgentElement,readAgentPage,observeAgentPage,showAgentActivity:vi.fn()};
  const {handlers}=createLumenToolHost({getBrowserBridge:()=>browser as never,storageRoot:"/tmp",
    tabResolver:{resolveBrowserAgentTabId:async(payload:{tabId?:string})=>payload.tabId??"fixture"} as never});
  return {handlers,...browser};
};
const send={targetRef:"lumen:input",text:"Question",thenClick:"lumen:send",effect:"communicate",awaitResponse:true};

test("compound send returns its reply without a follow-up map or second submit",async()=>{
  const host=setup();
  const result=await host.handlers["lyraLumen.type"]!(send);
  expect(result).toMatchObject({ok:true,matched:true,completion:"conditionMet",response:"The new answer",nextRecommendedAction:"use_returned_state"});
  expect(host.typeIntoAgentElement).toHaveBeenCalledTimes(1);
  expect(host.actOnAgentElement).toHaveBeenCalledTimes(1);
  expect(host.actOnAgentElement).toHaveBeenCalledWith("fixture",expect.objectContaining({awaitResponse:true}));
  expect(host.readAgentPage).toHaveBeenCalledWith("fixture",expect.objectContaining({waitOperationId:"operation-1",responseStateOnly:true}));
  expect(host.observeAgentPage).not.toHaveBeenCalled();
});

test("a response read failure preserves the send receipt and never resends",async()=>{
  const host=setup();host.readAgentPage.mockRejectedValue(new Error("Frame was closed"));
  const result=await host.handlers["lyraLumen.type"]!(send);
  expect(result).toMatchObject({ok:true,completion:"unknown",responseError:expect.stringContaining("Frame was closed")});
  expect(host.actOnAgentElement).toHaveBeenCalledTimes(1);
});

test.each([{...send,effect:"editDraft"},{...send,thenClick:undefined},{...send,effect:"purchase"}])("invalid response request fails before writing: %j",async args=>{
  const host=setup();expect(await host.handlers["lyraLumen.type"]!(args)).toMatchObject({ok:false});
  expect(host.typeIntoAgentElement).not.toHaveBeenCalled();expect(host.actOnAgentElement).not.toHaveBeenCalled();
});

test("the default wait resumes this task's send and skips the completed response map",async()=>{
  const host=setup();
  await host.handlers["lyraLumen.type"]!({...send,awaitResponse:false});
  const result=await host.handlers["lyraLumen.wait"]!({tabId:"fixture"});
  expect(result).toMatchObject({until:"responseComplete",matched:true,completion:"conditionMet",content:"The new answer",nextRecommendedAction:"use_returned_state"});
  expect(host.observeAgentPage).not.toHaveBeenCalled();
  expect(await host.handlers["lyraLumen.wait"]!({until:"responseComplete",tabId:"fixture"})).toMatchObject({ok:false});
});

test("a later edit cannot inherit the previous send's completed response",async()=>{
  const host=setup();await host.handlers["lyraLumen.type"]!({...send,awaitResponse:false});
  await host.handlers["lyraLumen.type"]!({targetRef:"lumen:input",text:"New draft",effect:"editDraft"});
  expect(await host.handlers["lyraLumen.wait"]!({until:"responseComplete",tabId:"fixture"})).toMatchObject({ok:false});
});

test("another tab cannot reuse a response observation",async()=>{
  const host=setup();await host.handlers["lyraLumen.type"]!({...send,awaitResponse:false});
  expect(await host.handlers["lyraLumen.wait"]!({tabId:"other",until:"responseComplete"})).toMatchObject({ok:false});
  expect(host.readAgentPage).not.toHaveBeenCalled();
});

test("another task on the same tab cannot reuse the send observation",async()=>{
  const host=setup();await host.handlers["lyraLumen.type"]!({...send,awaitResponse:false,agentSessionId:"task-a"});
  expect(await host.handlers["lyraLumen.wait"]!({tabId:"fixture",until:"responseComplete",agentSessionId:"task-b"})).toMatchObject({ok:false});
  expect(host.readAgentPage).not.toHaveBeenCalled();
});

test("waiting never adopts an unrelated operation even if its status is complete",async()=>{
  vi.useFakeTimers();const host=setup();
  await host.handlers["lyraLumen.type"]!({...send,awaitResponse:false});
  host.readAgentPage.mockResolvedValue({content:"Unrelated answer",truncated:false,waitState:{readyState:"complete",busy:false,
    response:{operationId:"unrelated",targetRef:"lumen:send",status:"complete",startedAt:0,evidence:[]}}});
  const result=await host.handlers["lyraLumen.wait"]!({until:"responseComplete",timeoutMs:1000});
  expect(result).toMatchObject({matched:false,completion:"unknown"});
});
