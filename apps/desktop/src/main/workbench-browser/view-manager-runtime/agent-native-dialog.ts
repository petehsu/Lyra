import { randomUUID } from "node:crypto";
import { browserAgentOperationContext } from "../agent-operation-context";
import type { BrowserActionEffect, WorkbenchBrowserAgentModeRequest, WorkbenchBrowserDebuggerSession } from "../types";
import type { WorkbenchBrowserAgentControllerHost } from "./agent-controller-types";

type Mode = "live" | "isolated";
export type NativeDialogRequest = WorkbenchBrowserAgentModeRequest & {
  readonly dialogId: string;
  readonly accept: boolean;
  readonly promptText?: string;
  readonly effect: BrowserActionEffect;
};
type Dialog = { id:string; type:string; message:string; url:string; defaultPrompt:string };
type Operation = {
  owner:string; tabId:string; mode:Mode; effect?:BrowserActionEffect | undefined;
  session:WorkbenchBrowserDebuggerSession; dialog?:Dialog | undefined;
  settled:boolean; result?:object | undefined; error?:unknown; cleanup:()=>Promise<void>;
  changed:Set<()=>void>; handling:boolean;
};
type Host = Pick<WorkbenchBrowserAgentControllerHost,"resolveBrowserAgentTarget"|"openDebuggerSessionForTarget"|"assertSharedControlCanContinue">;
const owner = () => browserAgentOperationContext.getStore()?.sessionId ?? "";
const key = (tabId:string,mode:Mode) => `${mode}:${tabId}`;

/** Keep the browser's synchronous dialog semantics. Return its real message to
 * the agent; accepting is a separate, explicit decision against an opaque ID. */
export const createBrowserNativeDialogs = (host:Host) => {
  const operations = new Map<string,Operation>();
  const starting = new Set<string>();
  const signal = (op:Operation) => {for(const wake of op.changed) wake();op.changed.clear();};
  const envelope = (op:Operation) => ({ok:true,kind:"lyraLumenDialogPending",tabId:op.tabId,targetMode:op.mode,
    status:"dialogPending",dialog:op.dialog,completion:"unknown",nextRecommendedAction:"browser_dialog",
    message:"The browser is paused at this native dialog. Read its message, then accept or dismiss its dialogId explicitly. Do not repeat the triggering action or request DOM maps while it is open."});
  const peek = (tabId:string,mode:Mode) => {
    const op=operations.get(key(tabId,mode));
    if (!op?.dialog) return undefined;
    return op.owner===owner()?envelope(op):{ok:false,kind:"lyraLumenDialogPending",tabId,error:{kind:"dialogOwnedByAnotherTask",message:"Another task owns this page's pending dialog."}};
  };
  const wait = async (op:Operation):Promise<object> => {
    while(!op.settled && !op.dialog) await new Promise<void>(resolve=>op.changed.add(resolve));
    if(op.dialog) return envelope(op);
    if(op.error !== undefined) throw op.error;
    return op.result ?? {ok:false,message:"Browser operation ended without a result"};
  };
  const capture = async <T extends object>(tabId:string,request:WorkbenchBrowserAgentModeRequest & {effect?:BrowserActionEffect | undefined},action:()=>Promise<T>):Promise<T> => {
    const mode=request.targetMode??"live", id=key(tabId,mode);
    if(operations.has(id) || starting.has(id)) throw new Error("A browser input or native dialog is already active on this tab");
    starting.add(id);
    let session:WorkbenchBrowserDebuggerSession;
    try {
      const target=await host.resolveBrowserAgentTarget(tabId,request,undefined);
      session=await host.openDebuggerSessionForTarget(target);
    } finally {starting.delete(id);}
    let unsubscribe=()=>{},timer:ReturnType<typeof setTimeout>|undefined,closed=false;
    const op:Operation={owner:owner(),tabId,mode,effect:request.effect,session,settled:false,changed:new Set(),handling:false,cleanup:async()=>{
      if(closed)return;closed=true;clearTimeout(timer);unsubscribe();
      if(operations.get(id)===op)operations.delete(id);
      await session.close().catch(()=>{});
    }};
    operations.set(id,op);
    try {
      unsubscribe=session.subscribe(event=>{
        if(event.kind==="detached") {op.error=new Error("Browser detached during native dialog");op.settled=true;signal(op);void op.cleanup();return;}
        if(event.method==="Page.javascriptDialogOpening") {
          const params=event.params as Record<string,unknown>;
          op.dialog={id:`dialog:${randomUUID()}`,type:String(params.type??"unknown"),message:String(params.message??""),url:String(params.url??""),defaultPrompt:String(params.defaultPrompt??"")};
          signal(op);
          clearTimeout(timer);timer=setTimeout(()=>{void session.sendCommand("Page.handleJavaScriptDialog",{accept:false}).catch(()=>{});},120_000);timer.unref();
        } else if(event.method==="Page.javascriptDialogClosed") {op.dialog=undefined;clearTimeout(timer);signal(op);if(op.settled)void op.cleanup();}
      });
      await session.sendCommand("Page.enable");
      // Observe rejection even after the caller received the pending-dialog
      // receipt, so there is no unhandled background promise or replay.
      void action().then(result=>{op.result=result;},error=>{op.error=error;}).finally(()=>{op.settled=true;signal(op);if(!op.dialog)void op.cleanup();});
      return await wait(op) as T;
    } catch(error) {await op.cleanup();throw error;}
  };
  const handle = async (tabId:string,request:NativeDialogRequest):Promise<Record<string,unknown>> => {
    const mode=request.targetMode??"live",op=operations.get(key(tabId,mode));
    if(!op?.dialog || op.dialog.id!==request.dialogId || op.owner!==owner()) throw new Error("No matching native dialog belongs to this task and tab");
    if(op.handling) throw new Error("This dialog is already being handled; do not replay");
    if(request.accept && request.effect!==op.effect) throw new Error("Accepting the dialog must retain the triggering action's declared effect");
    if(request.promptText!==undefined && op.dialog.type!=="prompt") throw new Error("promptText is valid only for a prompt dialog");
    if(mode==="live")host.assertSharedControlCanContinue(tabId);
    op.handling=true;
    try {
      const dialog=op.dialog;op.dialog=undefined;
      try {await op.session.sendCommand("Page.handleJavaScriptDialog",{accept:request.accept,...(request.promptText===undefined?{}:{promptText:request.promptText})});}
      catch(error) {op.dialog=dialog;throw error;}
      const result=await wait(op);
      return {...result,handledDialogId:dialog.id,dialogAccepted:request.accept};
    } finally {op.handling=false;}
  };
  const dispose = () => {for(const op of operations.values()) {if(op.dialog)void op.session.sendCommand("Page.handleJavaScriptDialog",{accept:false}).catch(()=>{});op.error=new Error("Browser dialog controller disposed");op.settled=true;op.dialog=undefined;signal(op);void op.cleanup();}};
  return {capture,peek,handle,dispose};
};
