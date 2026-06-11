import { ipcMain, type BrowserWindow } from "electron";

import {
  LYRA_CHANNELS,
  type SoftwareCapabilitiesQueryRequest,
  type SoftwareCapabilitiesQueryResult
} from "../../shared/desktop-bridge";
import type { AgentHostCapabilityHandlers } from "./host-payload";
import { normalizePayload } from "./host-payload";

type PendingSoftwareCapabilityRequest = {
  readonly resolve: (value: unknown) => void;
  readonly reject: (error: Error) => void;
  readonly timer: ReturnType<typeof setTimeout>;
};

const createSoftwareCapabilityRequestId = (): string =>
  `software-capability-${Date.now()}-${Math.random().toString(16).slice(2)}`;

const createSoftwareCapabilityRendererClient = ({
  getWindow,
  timeoutMs = 5_000
}: {
  readonly getWindow: () => BrowserWindow | null;
  readonly timeoutMs?: number;
}) => {
  const pending = new Map<string, PendingSoftwareCapabilityRequest>();

  ipcMain.handle(
    LYRA_CHANNELS.softwareCapabilitiesQueryResult,
    (_event, result: SoftwareCapabilitiesQueryResult) => {
      const pendingRequest = pending.get(result.requestId);
      if (pendingRequest === undefined) {
        return null;
      }
      pending.delete(result.requestId);
      clearTimeout(pendingRequest.timer);
      if (result.ok) {
        pendingRequest.resolve(result.result);
      } else {
        pendingRequest.reject(
          new Error(result.error?.message ?? "software capability query failed")
        );
      }
      return null;
    }
  );

  const sendQuery = async (
    method: SoftwareCapabilitiesQueryRequest["method"],
    payload: object
  ): Promise<unknown> => {
    const window = getWindow();
    if (window === null || window.isDestroyed()) {
      throw new Error("Renderer window is unavailable for software capabilities.");
    }

    const requestId = createSoftwareCapabilityRequestId();
    const query = { requestId, method, payload } as SoftwareCapabilitiesQueryRequest;
    const promise = new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(requestId);
        reject(new Error("Renderer software capability query timed out."));
      }, timeoutMs);
      pending.set(requestId, { resolve, reject, timer });
    });

    window.webContents.send(LYRA_CHANNELS.softwareCapabilitiesQuery, query);
    return await promise;
  };

  return {
    dispose: () => {
      ipcMain.removeHandler(LYRA_CHANNELS.softwareCapabilitiesQueryResult);
      for (const pendingRequest of pending.values()) {
        clearTimeout(pendingRequest.timer);
        pendingRequest.reject(new Error("Renderer software capability bridge disposed."));
      }
      pending.clear();
    },
    listCapabilities: async (payload: object) =>
      await sendQuery("software.listCapabilities", payload),
    inspectCapability: async (payload: object) =>
      await sendQuery("software.inspectCapability", payload),
    readState: async (payload: object) =>
      await sendQuery("software.readState", payload),
    invokeCapability: async (payload: object) =>
      await sendQuery("software.invokeCapability", payload)
  };
};

const normalizeSoftwarePayload = (payload: unknown): Record<string, unknown> => {
  const request = normalizePayload(payload);
  const capabilityId =
    typeof request.capabilityId === "string" && request.capabilityId.trim().length > 0
      ? request.capabilityId.trim()
      : undefined;
  const actionId =
    typeof request.actionId === "string" && request.actionId.trim().length > 0
      ? request.actionId.trim()
      : capabilityId;
  return {
    ...request,
    ...(capabilityId === undefined ? {} : { capabilityId }),
    ...(actionId === undefined ? {} : { actionId })
  };
};


export const createSoftwareCapabilityHost = ({
  getWindow
}: {
  readonly getWindow: () => BrowserWindow | null;
}): {
  readonly handlers: AgentHostCapabilityHandlers;
  readonly dispose: () => void;
} => {
  const client = createSoftwareCapabilityRendererClient({ getWindow });
  return {
    handlers: {
      "software.listCapabilities": async (payload: unknown) =>
        await client.listCapabilities(normalizePayload(payload)),
      "software.inspectCapability": async (payload: unknown) =>
        await client.inspectCapability(normalizeSoftwarePayload(payload)),
      "software.readState": async (payload: unknown) =>
        await client.readState(normalizeSoftwarePayload(payload)),
      "software.invokeCapability": async (payload: unknown) =>
        await client.invokeCapability(normalizeSoftwarePayload(payload))
    },
    dispose: client.dispose
  };
};
