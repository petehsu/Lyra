import { expect, test, vi } from "vitest";
import { browserAgentOperationContext } from "../agent-operation-context";
import { createBrowserNativeDialogs } from "../view-manager-runtime/agent-native-dialog";

const fixture = () => {
  let listener: (event: unknown) => void = () => {};
  let resume: (result: object) => void = () => {};
  const close = vi.fn(async () => {});
  const sendCommand = vi.fn(async (method: string) => {
    if (method === "Page.handleJavaScriptDialog") {
      listener({kind:"message", method:"Page.javascriptDialogClosed", params:{}});
      resume({ok:true, originalResult:true});
    }
    return {};
  });
  const dialogs = createBrowserNativeDialogs({
    resolveBrowserAgentTarget: async () => ({}),
    openDebuggerSessionForTarget: async () => ({sendCommand, close,
      subscribe: (callback: typeof listener) => {listener=callback; return () => {listener=()=>{};};}}),
    assertSharedControlCanContinue: () => {}
  } as never);
  const start = (type = "confirm") => browserAgentOperationContext.run({sessionId:"owner"}, () =>
    dialogs.capture("tab", {effect:"delete"}, async () => {
      const action = new Promise<object>(resolve => {resume=resolve;});
      listener({kind:"message",method:"Page.javascriptDialogOpening",params:{type,message:"Delete?"}});
      return action;
    })) as Promise<any>;
  const handle = (dialogId: string, extra: object = {}, sessionId = "owner", tab = "tab") =>
    browserAgentOperationContext.run({sessionId}, () => dialogs.handle(tab, {dialogId,accept:true,effect:"delete",...extra}));
  return {dialogs,start,handle,sendCommand,close};
};

test("native dialogs cannot cross task, tab, effect, or prompt boundaries", async () => {
  const f=fixture();
  try {
    const pending=await f.start();
    expect(pending.status).toBe("dialogPending");
    const id=pending.dialog.id;
    await expect(f.handle(id,{},"other")).rejects.toThrow("belongs to this task");
    await expect(f.handle(id,{},"owner","other-tab")).rejects.toThrow("belongs to this task");
    await expect(f.handle(id,{effect:"editDraft"})).rejects.toThrow("retain");
    await expect(f.handle(id,{promptText:"no"})).rejects.toThrow("only for a prompt");
    expect(f.sendCommand.mock.calls.filter(([method])=>method==="Page.handleJavaScriptDialog")).toHaveLength(0);
    const hidden=browserAgentOperationContext.run({sessionId:"other"},()=>f.dialogs.peek("tab","live"));
    expect(hidden).not.toHaveProperty("dialog");
    expect(await f.handle(id)).toMatchObject({ok:true,originalResult:true,dialogAccepted:true});
    await expect(f.handle(id)).rejects.toThrow("belongs to this task");
    expect(f.close).toHaveBeenCalledTimes(1);
  } finally {f.dialogs.dispose();}
});

test("dialog dismissal does not require authorizing its original consequence", async () => {
  const f=fixture();
  try {
    const pending=await f.start();
    expect(await f.handle(pending.dialog.id,{accept:false,effect:"editDraft"})).toMatchObject({dialogAccepted:false});
  } finally {f.dialogs.dispose();}
});

test("disposing a paused controller dismisses the dialog and releases ownership", async () => {
  const f=fixture();
  const pending=await f.start();
  f.dialogs.dispose();
  expect(f.dialogs.peek("tab","live")).toBeUndefined();
  await expect(f.handle(pending.dialog.id)).rejects.toThrow("belongs to this task");
  expect(f.sendCommand).toHaveBeenCalledWith("Page.handleJavaScriptDialog",{accept:false});
  expect(f.close).toHaveBeenCalledTimes(1);
});
