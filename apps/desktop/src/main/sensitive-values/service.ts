import { ipcMain } from "electron";

import {
  LYRA_CHANNELS,
  type LyraSensitiveValueRevealRequest,
  type LyraSensitiveValueRevealResponse
} from "../../shared/desktop-bridge";
import { isLyraSensitiveValueRef } from "../../shared/sensitive-value";
import type { LoginManagerIpcBridge } from "../login-manager";

type SensitiveValuesIpcBridgeParams = {
  readonly loginManager: LoginManagerIpcBridge;
};

export type SensitiveValuesIpcBridge = {
  readonly dispose: () => void;
  readonly revealToUser: (
    request: LyraSensitiveValueRevealRequest
  ) => Promise<LyraSensitiveValueRevealResponse>;
};

const normalizeRevealRequest = (
  request: unknown
): LyraSensitiveValueRevealRequest => {
  if (request === null || typeof request !== "object" || Array.isArray(request)) {
    throw new Error("Sensitive value reveal request must be an object.");
  }
  const record = request as Partial<LyraSensitiveValueRevealRequest>;
  if (!isLyraSensitiveValueRef(record.ref)) {
    throw new Error("Sensitive value reveal request must include a valid Lyra sensitive value ref.");
  }
  return {
    ref: record.ref,
    ...(typeof record.reason === "string" && record.reason.trim().length > 0
      ? { reason: record.reason.trim() }
      : {})
  };
};

export const createSensitiveValuesIpcBridge = ({
  loginManager
}: SensitiveValuesIpcBridgeParams): SensitiveValuesIpcBridge => {
  const revealToUser = async (
    request: LyraSensitiveValueRevealRequest
  ): Promise<LyraSensitiveValueRevealResponse> => {
    const normalized = normalizeRevealRequest(request);
    const ref = normalized.ref;

    if (
      ref.owner === "login-manager"
      && ref.ownerRef.kind === "login-manager-credential"
      && ref.valueKind === "password"
      && ref.capabilities.includes("reveal_to_user")
    ) {
      const revealed = loginManager.revealCredential({
        credentialId: ref.ownerRef.credentialId,
        reason: normalized.reason ?? "user-reveal-sensitive-value"
      });
      return {
        refId: ref.id,
        value: revealed.password
      };
    }

    throw new Error(`Unsupported sensitive value ref: ${ref.id}`);
  };

  ipcMain.handle(LYRA_CHANNELS.sensitiveValuesRevealToUser, async (_event, request: unknown) =>
    await revealToUser(normalizeRevealRequest(request)));

  return {
    dispose: () => {
      ipcMain.removeHandler(LYRA_CHANNELS.sensitiveValuesRevealToUser);
    },
    revealToUser
  };
};
