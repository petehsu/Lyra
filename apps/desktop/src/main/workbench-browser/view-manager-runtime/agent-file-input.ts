import { access, stat } from "node:fs/promises";
import { constants } from "node:fs";
import { basename, isAbsolute } from "node:path";
import type { WorkbenchBrowserDebuggerSession } from "../types";

export type BrowserUploadRequest = {
  readonly files: readonly string[];
  readonly targetRef?: string;
  readonly chooserId?: string;
  readonly effect: "upload";
  readonly targetMode?: "live" | "isolated";
  readonly timeoutMs?: number;
};
export type UploadFile = { path: string; name: string; size: number };

export class BrowserUploadError extends Error {
  constructor(readonly kind: string, message: string) { super(message); }
}

export const validateUploadFiles = async (paths: readonly string[]): Promise<UploadFile[]> => {
  if (!Array.isArray(paths) || paths.length === 0 || paths.length > 100) {
    throw new BrowserUploadError("invalidFiles", "Provide 1–100 explicit absolute local file paths.");
  }
  if (new Set(paths).size !== paths.length) throw new BrowserUploadError("duplicateFiles", "Each file path must appear once.");
  return Promise.all(paths.map(async path => {
    if (typeof path !== "string" || !isAbsolute(path) || path.includes("\0")) {
      throw new BrowserUploadError("invalidFilePath", "Upload requires absolute local paths, not URLs or page-supplied filenames.");
    }
    try {
      const info = await stat(path);
      if (!info.isFile()) throw new BrowserUploadError("notRegularFile", `Select an individual file: ${path}`);
      await access(path, constants.R_OK);
      return { path, name: basename(path), size: info.size };
    } catch (error) {
      if (error instanceof BrowserUploadError) throw error;
      throw new BrowserUploadError("fileUnavailable", `Cannot read local file: ${path}`);
    }
  }));
};

export const callFileInput = async <T>(session: WorkbenchBrowserDebuggerSession, objectId: string, sessionId: string | undefined,
  functionDeclaration: string, args: readonly unknown[] = []): Promise<T> => {
  const response = await session.sendCommand("Runtime.callFunctionOn", {
    objectId, functionDeclaration, arguments: args.map(value => ({ value })), returnByValue: true
  }, sessionId);
  if (response.exceptionDetails) throw new BrowserUploadError("fileInputChanged", "The upload control is no longer available. Map the page before retrying.");
  return (response.result as { value: T }).value;
};

export const readFileInput = `function() {
  return { connected: this.isConnected, fileInput: this.tagName === 'INPUT' && this.type === 'file',
    disabled: this.matches(':disabled') || !!this.closest('[inert]'), multiple: this.multiple,
    directory: this.webkitdirectory, accept: this.accept,
    files: Array.from(this.files || [], f => ({name:f.name, size:f.size})) };
}`;

// Observe native selection before page handlers reset/remove the input. No
// synthetic change event or File object is used to pretend an upload happened.
export const armFileReceipt = `function(key) {
  const node=this, view=this.ownerDocument.defaultView, roots=[view,this.getRootNode()];
  const state={files:null, roots, listener:event=>{if(event.target===node && event.isTrusted)
    state.files=Array.from(node.files || [], f=>({name:f.name,size:f.size}));}};
  this[key]=state;for(const root of roots){root.addEventListener('input',state.listener,true);root.addEventListener('change',state.listener,true);}
}`;
export const finishFileReceipt = `function(key) {
  const state=this[key];
  if(state){for(const root of state.roots){root.removeEventListener('input',state.listener,true);root.removeEventListener('change',state.listener,true);}delete this[key];}
  return {connected:this.isConnected, files:state?.files || Array.from(this.files || [],f=>({name:f.name,size:f.size}))};
}`;
