import type { LyraAppManifest } from "@lyra/capability-protocol";

import type {
  BrowserUseAgentRunRequest,
  BrowserUseNavigateRequest,
  BrowserUsePageActionRequest,
  BrowserUsePageExtractRequest,
  BrowserUsePageStateRequest,
  BrowserUsePrepareSessionRequest,
  BrowserUseWaitRequest,
} from "../../../shared/browser-use";
import type { BrowserUseService } from "../../browser-use/types";
import type { CapabilityRegistry } from "../registry";

const APP_ID = "browser-use";

const asRecord = (value: unknown): Record<string, unknown> => {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  return value as Record<string, unknown>;
};

const readString = (value: unknown): string | undefined =>
  typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;

const readBoolean = (value: unknown): boolean | undefined =>
  typeof value === "boolean" ? value : undefined;

const readNumber = (value: unknown): number | undefined =>
  typeof value === "number" && Number.isFinite(value) ? value : undefined;

const safeActionKinds = ["hover", "scroll"];
const mutateActionKinds = ["click", "dblclick", "rightclick", "type", "input", "keys", "select"];
const navigateKinds = ["open", "back", "close", "switch", "close_tab"];

export const registerBrowserUseCapabilities = (
  registry: CapabilityRegistry,
  service: BrowserUseService,
): LyraAppManifest => {
  registry.register(
    {
      id: "browser_use.session.prepare",
      domain: "browser",
      kind: "resource",
      title: "Prepare browser-use Session",
      appId: APP_ID,
      operation: "session.prepare",
      description: "Prepare a browser_use session. Use current_tab for the current visible Lyra page, or managed for a dedicated browser-use browser session.",
      permissions: ["browser:read"],
      risk: "read",
      approvalMode: "auto",
      aiExposure: "full",
      inputSchema: {
        type: "object",
        properties: {
          mode: { type: "string", enum: ["current_tab", "managed"] },
          authMode: { type: "string", enum: ["isolated", "prompt_real_profile"] },
          tabId: { type: "string" },
          headed: { type: "boolean" },
          profileName: { type: "string" },
          reuseSessionId: { type: "string" },
        },
        additionalProperties: false,
      },
      outputSchema: { type: "object" },
    },
    async (request) => {
      const payload = asRecord(request.payload);
      const mode = readString(payload.mode) as "current_tab" | "managed" | undefined;
      const authMode = readString(payload.authMode) as "isolated" | "prompt_real_profile" | undefined;
      const tabId = readString(payload.tabId);
      const headed = readBoolean(payload.headed);
      const profileName = readString(payload.profileName);
      const reuseSessionId = readString(payload.reuseSessionId);
      const nextRequest: BrowserUsePrepareSessionRequest = {
        ...(mode === undefined ? {} : { mode }),
        ...(authMode === undefined ? {} : { authMode }),
        ...(tabId === undefined ? {} : { tabId }),
        ...(headed === undefined ? {} : { headed }),
        ...(profileName === undefined ? {} : { profileName }),
        ...(reuseSessionId === undefined ? {} : { reuseSessionId }),
      };
      return await service.prepareSession(nextRequest);
    }
  );

  registry.register(
    {
      id: "browser_use.page.state",
      domain: "browser",
      kind: "resource",
      title: "Read browser-use Page State",
      appId: APP_ID,
      operation: "page.state",
      description: "Read a browser_use page state representation, including indexed interactive elements when available.",
      permissions: ["browser:read"],
      risk: "read",
      approvalMode: "auto",
      aiExposure: "full",
      inputSchema: {
        type: "object",
        required: ["sessionId"],
        properties: { sessionId: { type: "string" } },
        additionalProperties: false,
      },
      outputSchema: { type: "object" },
    },
    async (request) => {
      const payload = asRecord(request.payload);
      const sessionId = readString(payload.sessionId);
      if (sessionId === undefined) {
        throw new Error("sessionId is required");
      }
      const nextRequest: BrowserUsePageStateRequest = { sessionId };
      return await service.readPageState(nextRequest);
    }
  );

  registry.register(
    {
      id: "browser_use.page.extract",
      domain: "browser",
      kind: "resource",
      title: "Extract browser-use Page Data",
      appId: APP_ID,
      operation: "page.extract",
      description: "Extract title, HTML, text, values, attributes, or bounding boxes from a browser_use session.",
      permissions: ["browser:read"],
      risk: "read",
      approvalMode: "auto",
      aiExposure: "full",
      inputSchema: {
        type: "object",
        required: ["sessionId", "kind"],
        properties: {
          sessionId: { type: "string" },
          kind: { type: "string", enum: ["title", "html", "text", "value", "attributes", "bbox"] },
          selector: { type: "string" },
          elementIndex: { type: "number" },
        },
        additionalProperties: false,
      },
      outputSchema: { type: "object" },
    },
    async (request) => {
      const payload = asRecord(request.payload);
      const sessionId = readString(payload.sessionId);
      const kind = readString(payload.kind);
      if (sessionId === undefined || kind === undefined) {
        throw new Error("sessionId and kind are required");
      }
      const elementIndex = readNumber(payload.elementIndex);
      const selector = readString(payload.selector);
      const nextRequest: BrowserUsePageExtractRequest = kind === "title"
        ? { sessionId, kind: "title" }
        : kind === "html"
          ? { sessionId, kind: "html", ...(selector === undefined ? {} : { selector }) }
          : { sessionId, kind: kind as "text" | "value" | "attributes" | "bbox", elementIndex: Math.round(elementIndex ?? 0) };
      return await service.extractPage(nextRequest);
    }
  );

  registry.register(
    {
      id: "browser_use.page.safe",
      domain: "browser",
      kind: "action",
      title: "Run Safe browser-use Page Action",
      appId: APP_ID,
      operation: "page.safe",
      description: "Run a low-risk browser_use page action such as hover or scroll.",
      permissions: ["browser:read"],
      risk: "read",
      approvalMode: "auto",
      aiExposure: "full",
      inputSchema: {
        type: "object",
        required: ["sessionId", "kind"],
        properties: {
          sessionId: { type: "string" },
          kind: { type: "string", enum: ["hover", "scroll"] },
          elementIndex: { type: "number" },
          x: { type: "number" },
          y: { type: "number" },
          direction: { type: "string", enum: ["up", "down"] },
          amount: { type: "number" },
        },
        additionalProperties: false,
      },
      outputSchema: { type: "object" },
    },
    async (request) => {
      const payload = asRecord(request.payload);
      const sessionId = readString(payload.sessionId);
      const kind = readString(payload.kind);
      if (sessionId === undefined || kind === undefined || !safeActionKinds.includes(kind)) {
        throw new Error("sessionId and valid kind are required");
      }
      const nextRequest: BrowserUsePageActionRequest = kind === "scroll"
        ? {
            sessionId,
            kind: "scroll",
            ...(readString(payload.direction) === undefined ? {} : { direction: readString(payload.direction) as "up" | "down" }),
            ...(readNumber(payload.amount) === undefined ? {} : { amount: readNumber(payload.amount)! }),
          }
        : {
            sessionId,
            kind: "hover",
            elementIndex: Math.round(readNumber(payload.elementIndex) ?? 0),
          };
      return await service.runSafeAction(nextRequest);
    }
  );

  registry.register(
    {
      id: "browser_use.page.mutate",
      domain: "browser",
      kind: "action",
      title: "Run Mutating browser-use Page Action",
      appId: APP_ID,
      operation: "page.mutate",
      description: "Run a browser_use page mutation such as click, input, type, keys, or select.",
      permissions: ["browser:read", "browser:mutate"],
      risk: "write",
      approvalMode: "ask",
      aiExposure: "full",
      inputSchema: {
        type: "object",
        required: ["sessionId", "kind"],
        properties: {
          sessionId: { type: "string" },
          kind: { type: "string", enum: ["click", "dblclick", "rightclick", "type", "input", "keys", "select"] },
          elementIndex: { type: "number" },
          x: { type: "number" },
          y: { type: "number" },
          text: { type: "string" },
          keys: { type: "string" },
          value: { type: "string" },
        },
        additionalProperties: false,
      },
      outputSchema: { type: "object" },
    },
    async (request) => {
      const payload = asRecord(request.payload);
      const sessionId = readString(payload.sessionId);
      const kind = readString(payload.kind);
      if (sessionId === undefined || kind === undefined || !mutateActionKinds.includes(kind)) {
        throw new Error("sessionId and valid kind are required");
      }
      let nextRequest: BrowserUsePageActionRequest;
      if (kind === "click") {
        nextRequest = {
          sessionId,
          kind: "click",
          ...(readNumber(payload.elementIndex) === undefined ? {} : { elementIndex: Math.round(readNumber(payload.elementIndex)!) }),
          ...(readNumber(payload.x) === undefined ? {} : { x: readNumber(payload.x)! }),
          ...(readNumber(payload.y) === undefined ? {} : { y: readNumber(payload.y)! }),
        };
      } else if (kind === "dblclick" || kind === "rightclick") {
        nextRequest = {
          sessionId,
          kind: kind as "dblclick" | "rightclick",
          elementIndex: Math.round(readNumber(payload.elementIndex) ?? 0),
        };
      } else if (kind === "type") {
        nextRequest = {
          sessionId,
          kind: "type",
          text: readString(payload.text) ?? "",
        };
      } else if (kind === "input") {
        nextRequest = {
          sessionId,
          kind: "input",
          elementIndex: Math.round(readNumber(payload.elementIndex) ?? 0),
          text: readString(payload.text) ?? "",
        };
      } else if (kind === "keys") {
        nextRequest = {
          sessionId,
          kind: "keys",
          keys: readString(payload.keys) ?? "",
        };
      } else {
        nextRequest = {
          sessionId,
          kind: "select",
          elementIndex: Math.round(readNumber(payload.elementIndex) ?? 0),
          value: readString(payload.value) ?? "",
        };
      }
      return await service.runMutateAction(nextRequest);
    }
  );

  registry.register(
    {
      id: "browser_use.page.navigate",
      domain: "browser",
      kind: "action",
      title: "Navigate browser-use Session",
      appId: APP_ID,
      operation: "page.navigate",
      description: "Navigate, go back, or switch tabs within a browser_use session.",
      permissions: ["browser:navigate", "network:http"],
      risk: "network",
      approvalMode: "ask",
      aiExposure: "full",
      inputSchema: {
        type: "object",
        required: ["sessionId", "kind"],
        properties: {
          sessionId: { type: "string" },
          kind: { type: "string", enum: ["open", "back", "close", "switch", "close_tab"] },
          url: { type: "string" },
          tabIndex: { type: "number" },
        },
        additionalProperties: false,
      },
      outputSchema: { type: "object" },
    },
    async (request) => {
      const payload = asRecord(request.payload);
      const sessionId = readString(payload.sessionId);
      const kind = readString(payload.kind);
      if (sessionId === undefined || kind === undefined || !navigateKinds.includes(kind)) {
        throw new Error("sessionId and valid kind are required");
      }
      const nextRequest: BrowserUseNavigateRequest = kind === "open"
        ? { sessionId, kind: "open", url: readString(payload.url) ?? "" }
        : kind === "switch" || kind === "close_tab"
          ? { sessionId, kind: kind as "switch" | "close_tab", tabIndex: Math.round(readNumber(payload.tabIndex) ?? 0) }
          : { sessionId, kind: kind as "back" | "close" };
      return await service.runNavigateAction(nextRequest);
    }
  );

  registry.register(
    {
      id: "browser_use.page.wait",
      domain: "browser",
      kind: "resource",
      title: "Wait in browser-use Session",
      appId: APP_ID,
      operation: "page.wait",
      description: "Wait for selector or text conditions in a browser_use session.",
      permissions: ["browser:read"],
      risk: "read",
      approvalMode: "auto",
      aiExposure: "full",
      inputSchema: {
        type: "object",
        required: ["sessionId", "kind"],
        properties: {
          sessionId: { type: "string" },
          kind: { type: "string", enum: ["selector", "text"] },
          selector: { type: "string" },
          text: { type: "string" },
          timeoutMs: { type: "number" },
          state: { type: "string", enum: ["attached", "detached", "visible", "hidden"] },
        },
        additionalProperties: false,
      },
      outputSchema: { type: "object" },
    },
    async (request) => {
      const payload = asRecord(request.payload);
      const sessionId = readString(payload.sessionId);
      const kind = readString(payload.kind);
      if (sessionId === undefined || kind === undefined) {
        throw new Error("sessionId and kind are required");
      }
      const nextRequest: BrowserUseWaitRequest = kind === "selector"
        ? {
            sessionId,
            kind: "selector",
            selector: readString(payload.selector) ?? "",
            ...(readNumber(payload.timeoutMs) === undefined ? {} : { timeoutMs: readNumber(payload.timeoutMs)! }),
            ...(readString(payload.state) === undefined ? {} : { state: readString(payload.state) as "attached" | "detached" | "visible" | "hidden" }),
          }
        : {
            sessionId,
            kind: "text",
            text: readString(payload.text) ?? "",
            ...(readNumber(payload.timeoutMs) === undefined ? {} : { timeoutMs: readNumber(payload.timeoutMs)! }),
          };
      return await service.waitForPage(nextRequest);
    }
  );

  registry.register(
    {
      id: "browser_use.agent.run",
      domain: "browser",
      kind: "action",
      title: "Run Bounded browser-use Agent Task",
      appId: APP_ID,
      operation: "agent.run",
      description: "Run a bounded browser_use agent task inside an already prepared browser_use session.",
      permissions: ["browser:read", "browser:navigate", "network:http"],
      risk: "network",
      approvalMode: "ask",
      aiExposure: "full",
      inputSchema: {
        type: "object",
        required: ["sessionId", "task"],
        properties: {
          sessionId: { type: "string" },
          task: { type: "string" },
          maxSteps: { type: "number" },
          model: { type: "string" },
        },
        additionalProperties: false,
      },
      outputSchema: { type: "object" },
    },
    async (request) => {
      const payload = asRecord(request.payload);
      const sessionId = readString(payload.sessionId);
      const task = readString(payload.task);
      if (sessionId === undefined || task === undefined) {
        throw new Error("sessionId and task are required");
      }
      const maxSteps = readNumber(payload.maxSteps);
      const model = readString(payload.model);
      const nextRequest: BrowserUseAgentRunRequest = {
        sessionId,
        task,
        ...(maxSteps === undefined ? {} : { maxSteps: Math.round(maxSteps) }),
        ...(model === undefined ? {} : { model }),
      };
      return await service.runAgentTask(nextRequest);
    }
  );

  return {
    id: APP_ID,
    title: "browser-use",
    version: "0.1.0",
    source: "builtin",
    description: "Parallel browser-use automation surface for Lyra.",
    permissions: ["browser:read", "browser:navigate", "browser:mutate", "network:http"],
    capabilities: [
      "browser_use.session.prepare",
      "browser_use.page.state",
      "browser_use.page.extract",
      "browser_use.page.safe",
      "browser_use.page.mutate",
      "browser_use.page.navigate",
      "browser_use.page.wait",
      "browser_use.agent.run",
    ],
    compatibility: {},
    contributes: { surfaces: ["workspace"] },
  };
};
