import { expect, test, vi } from "vitest";
vi.mock("electron",()=>({BrowserWindow:{}}));
import { createLumenSessionPages } from "../lumen-session-pages";
import { createLumenToolHost } from "../lumen-tool-host";
const context=(sessionId="a")=>({runtimeCancellation:{sessionId}});

test("a mapped target retains its owning tab when the task visits mail",()=>{
  const pages=createLumenSessionPages(), task=context();
  pages.remember(task,{tabId:"verify",url:"https://identity.test/verify",elements:[{targetRef:"lumen:code"}]});
  pages.remember(task,{tabId:"mail",url:"https://mail.test/"});
  expect(pages.prepare("lyraLumen.type",{...task,targetRef:"lumen:code"})).toMatchObject({tabId:"verify"});
  expect(pages.prepare("lyraLumen.read",task)).toMatchObject({tabId:"verify"});
  expect(()=>pages.prepare("lyraLumen.type",{...task,targetRef:"lumen:code",tabId:"mail"})).toThrow("different tabs");
  expect(pages.prepare("lyraLumen.navigate",{...task,url:"https://third.test"})).not.toHaveProperty("tabId");
  expect(pages.prepare("lyraLumen.read",context("b"))).not.toHaveProperty("tabId");
});

test("bulk input cannot span different pages",()=>{
  const pages=createLumenSessionPages(), task=context();
  pages.remember(task,{tabId:"a",elements:[{targetRef:"lumen:a"}]});
  pages.remember(task,{tabId:"b",elements:[{targetRef:"lumen:b"}]});
  expect(()=>pages.prepare("lyraLumen.type",{...task,fields:[{targetRef:"lumen:a"},{targetRef:"lumen:b"}]})).toThrow("different tabs");
});

test("navigation opens another task tab, explicit tab replaces, and newTab overrides explicit tab",async()=>{
  const navigateAgentPage=vi.fn(async(tabId:string,{url}:{url:string})=>({tabId,address:url,title:url}));
  const pressAgentKey=vi.fn(async(tabId:string)=>({ok:true,tabId}));
  const host=createLumenToolHost({getBrowserBridge:()=>({navigateAgentPage,pressAgentKey}) as never,
    tabResolver:{resolveBrowserAgentTabId:async(payload:{tabId?:string})=>payload.tabId??"foreground"} as never,storageRoot:"/tmp"}).handlers;
  const navigate=(args:object)=>host["lyraLumen.navigate"]!({...context(),effect:"navigate",...args}) as Promise<Record<string,unknown>>;
  await navigate({url:"https://id.test/verify",tabId:"verify"});
  const mail=await navigate({url:"https://mail.test/"});
  expect(mail.tabId).not.toBe("verify");
  expect(navigateAgentPage.mock.calls[1]?.[0]).not.toBe("foreground");
  expect((await navigate({url:"https://mail.test/"})).tabId).toBe(mail.tabId);
  await host["lyraLumen.press"]!({...context(),tabId:"verify",key:"Tab"});
  const second=await navigate({url:"https://id.test/help",newTab:true,tabId:"verify"});
  expect(second.tabId).not.toBe("verify");
  const replace=await navigate({url:"https://id.test/verify",tabId:"verify"});
  expect(replace.tabId).toBe("verify");
  expect(replace.message).toContain(String(mail.tabId));
});

test("missing selected page reports alternatives without redirecting an action",async()=>{
  const pressAgentKey=vi.fn(async(_tabId:string)=>{throw new Error("Live browser page is not materialized: closed");});
  const host=createLumenToolHost({getBrowserBridge:()=>({pressAgentKey}) as never,
    tabResolver:{resolveBrowserAgentTabId:async()=>"closed",listBrowserPageTabs:async()=>[{tabId:"other",title:"Other"}]} as never,storageRoot:"/tmp"}).handlers;
  const result=await host["lyraLumen.press"]!({...context(),tabId:"closed",key:"Enter"});
  expect(result).toMatchObject({ok:false,error:{kind:"browserTabUnavailable"},pageCandidates:[{tabId:"other"}]});
  expect(pressAgentKey).toHaveBeenCalledTimes(1);
  expect(pressAgentKey.mock.calls[0]?.[0]).toBe("closed");
});

test("isolated task pages do not require a matching live workbench tab",async()=>{
  const navigateAgentPage=vi.fn(async(tabId:string,{url}:{url:string})=>({tabId,address:url}));
  const pressAgentKey=vi.fn(async(tabId:string)=>({ok:true,tabId}));
  const host=createLumenToolHost({getBrowserBridge:()=>({navigateAgentPage,pressAgentKey}) as never,
    tabResolver:{resolveBrowserAgentTabId:async()=>{throw new Error("Unknown Workbench tab");},listBrowserPageTabs:async()=>[]} as never,storageRoot:"/tmp"}).handlers;
  const task={...context(),targetMode:"isolated"};
  const first=await host["lyraLumen.navigate"]!({...task,url:"https://isolated.test"}) as {tabId:string};
  expect(await host["lyraLumen.press"]!({...task,key:"Tab"})).toMatchObject({ok:true,tabId:first.tabId});
  expect(await host["lyraLumen.navigate"]!({...task,url:"https://isolated.test"})).toMatchObject({ok:true,tabId:first.tabId});
  expect(await host["lyraLumen.press"]!({...task,targetMode:"live",tabId:first.tabId,key:"Tab"})).toMatchObject({ok:false});
  expect(pressAgentKey).toHaveBeenCalledTimes(1);
});


test("drag endpoints cannot cross tabs and a dialog retains its tab after switching",()=>{
  const pages=createLumenSessionPages(),task=context();
  pages.remember(task,{ok:true,tabId:"a",elements:[{targetRef:"lumen:a"}],status:"dialogPending",dialog:{id:"dialog:a"}});
  pages.remember(task,{ok:true,tabId:"b",elements:[{targetRef:"lumen:b"}]});
  expect(()=>pages.prepare("lyraLumen.drag",{...task,targetRef:"lumen:a",toTargetRef:"lumen:b"})).toThrow("different tabs");
  expect(pages.prepare("lyraLumen.dialog",{...task,dialogId:"dialog:a"})).toMatchObject({tabId:"a"});
});
