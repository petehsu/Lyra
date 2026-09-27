import { EventEmitter } from "node:events";
import { describe, expect, test, vi } from "vitest";
import type { BrowserWindow, WebContents } from "electron";
import { createWorkbenchBrowserSharedDebuggerSession } from "../debugger";
import { createWorkspaceFocusIsolation, focusBrowserPageForInput } from "../workspace-focus-isolation";

const deferred = () => {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return {promise,resolve};
};
const contents = () => {
  let attached = false;
  const debuggerApi = Object.assign(new EventEmitter(), {
    isAttached: () => attached,
    attach: vi.fn(() => { attached = true; }),
    detach: vi.fn(() => { attached = false; debuggerApi.emit("detach",{},"target_closed"); }),
    sendCommand: vi.fn(async (_method: string, _params?: object) => ({}))
  });
  const wc = Object.assign(new EventEmitter(), {
    isDestroyed: vi.fn(() => false), getURL: () => "https://fixture.test",
    focus: vi.fn(), debugger: debuggerApi
  });
  const shared = createWorkbenchBrowserSharedDebuggerSession({
    tabId:"fixture",webContents:wc as unknown as WebContents,readPageAddress:wc.getURL
  });
  return {wc,shared,surface:{webContents:wc as unknown as WebContents,acquire:shared.acquire}};
};
const fixture = () => {
  const shell = contents(), page = contents(), other = contents();
  const window = Object.assign(new EventEmitter(), {
    webContents:shell.wc, isDestroyed:()=>false, isFocused:vi.fn(()=>true),
    isVisible:vi.fn(()=>true), isMinimized:vi.fn(()=>false)
  });
  const onError = vi.fn();
  const controller = createWorkspaceFocusIsolation({onError});
  return {shell,page,other,window,controller,onError,
    sync:(surfaces=[page.surface])=>controller.sync(window as unknown as BrowserWindow,surfaces)};
};

describe("workspace document focus isolation", () => {
  test("retains both visible panes and shell without native focus or repeated CDP work", async () => {
    const f = fixture();
    await f.sync([f.page.surface,f.other.surface]);
    await f.sync([f.page.surface,f.other.surface]);
    for (const target of [f.page,f.other,f.shell]) {
      await focusBrowserPageForInput(target.surface.webContents);
      expect(target.wc.focus).not.toHaveBeenCalled();
      expect(target.wc.debugger.sendCommand.mock.calls).toEqual([["Emulation.setFocusEmulationEnabled",{enabled:true},undefined]]);
    }
    await f.controller.dispose();
  });

  test("hidden pages release their lease while another debugger consumer stays attached", async () => {
    const f = fixture();
    const audit = await f.page.shared.acquire();
    await f.sync([f.page.surface,f.other.surface]);
    await f.sync([f.other.surface]);
    expect(f.page.wc.debugger.sendCommand).toHaveBeenLastCalledWith("Emulation.setFocusEmulationEnabled",{enabled:false},undefined);
    expect(f.page.wc.debugger.isAttached()).toBe(true);
    expect(f.other.wc.debugger.sendCommand).toHaveBeenCalledTimes(1);
    await f.controller.dispose(); await audit.close();
    expect(f.page.shared.hasActiveClients()).toBe(false);
  });

  test("window blur/hide/minimize suspend emulation and restore re-enables it", async () => {
    const f = fixture();
    await f.sync();
    for (const [flag,event] of [[f.window.isFocused,"blur"],[f.window.isVisible,"hide"],[f.window.isMinimized,"minimize"]] as const) {
      flag.mockReturnValue(event === "minimize"); f.window.emit(event); await f.sync();
      expect(f.page.shared.hasActiveClients()).toBe(false);
      expect(f.shell.wc.debugger.isAttached()).toBe(false);
      flag.mockReturnValue(event !== "minimize"); f.window.emit("focus"); await f.sync();
      expect(f.page.wc.debugger.sendCommand).toHaveBeenLastCalledWith("Emulation.setFocusEmulationEnabled",{enabled:true},undefined);
    }
    await f.controller.dispose();
    expect(f.window.listenerCount("focus")).toBe(0);
    expect(f.page.wc.listenerCount("destroyed")).toBe(0);
  });

  test("a tab hidden while acquisition is pending is never enabled", async () => {
    const f = fixture(), gate = deferred();
    const surface = {...f.page.surface,acquire:async()=>{await gate.promise;return f.page.shared.acquire();}};
    const enable = f.sync([surface]);
    const hide = f.sync([]);
    gate.resolve(); await Promise.all([enable,hide]);
    expect(f.page.wc.debugger.sendCommand).not.toHaveBeenCalled();
    expect(f.page.shared.hasActiveClients()).toBe(false);
    await f.controller.dispose();
  });

  test("pending enable is undone if the tab closes or the controller disposes", async () => {
    const f = fixture(), gate = deferred();
    f.page.wc.debugger.sendCommand.mockImplementationOnce(async()=>{await gate.promise;return {};});
    const enable = f.sync();
    await vi.waitFor(()=>expect(f.page.wc.debugger.sendCommand).toHaveBeenCalled());
    const dispose = f.controller.dispose();
    gate.resolve(); await Promise.all([enable,dispose]);
    expect(f.page.wc.debugger.sendCommand).toHaveBeenLastCalledWith("Emulation.setFocusEmulationEnabled",{enabled:false},undefined);
    expect(f.page.shared.hasActiveClients()).toBe(false);
  });

  test("unexpected debugger detachment is recovered before the next agent input", async () => {
    const f = fixture();
    await f.sync();
    f.page.wc.debugger.detach();
    await focusBrowserPageForInput(f.page.surface.webContents);
    expect(f.page.wc.debugger.attach).toHaveBeenCalledTimes(2);
    expect(f.page.wc.focus).not.toHaveBeenCalled();
    expect(f.page.wc.debugger.sendCommand).toHaveBeenCalledTimes(2);
    await f.controller.dispose();
  });

  test("unsupported protocol reports the failure and preserves normal input", async () => {
    const f = fixture();
    f.page.wc.debugger.sendCommand.mockRejectedValue(new Error("unsupported"));
    await f.sync();
    await focusBrowserPageForInput(f.page.surface.webContents);
    expect(f.page.wc.focus).toHaveBeenCalledOnce();
    expect(f.onError).toHaveBeenCalledOnce();
    expect(f.page.shared.hasActiveClients()).toBe(false);
    await f.controller.dispose();
  });
});
