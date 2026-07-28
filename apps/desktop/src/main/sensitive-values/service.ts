import { ipcMain, safeStorage } from "electron";
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import {
  LYRA_CHANNELS,
  type LyraSensitiveValueDeleteRequest,
  type LyraSensitiveValueRevealRequest,
  type LyraSensitiveValueRevealResponse,
  type LyraSensitiveValueStoreRequest,
  type LyraSensitiveValueStoreResponse
} from "../../shared/desktop-bridge";
import {
  createOpaqueSensitiveValueRef,
  isLyraSensitiveValueRef,
  type LyraSensitiveValueCapability,
  type LyraSensitiveValueKind,
  type LyraSensitiveValueOwner
} from "../../shared/sensitive-value";
import type { LoginManagerIpcBridge } from "../login-manager";

type SensitiveValuesIpcBridgeParams = {
  readonly loginManager: LoginManagerIpcBridge;
};

export type SensitiveValuesIpcBridge = {
  readonly dispose: () => void;
  readonly store: (
    request: LyraSensitiveValueStoreRequest
  ) => Promise<LyraSensitiveValueStoreResponse>;
  readonly delete: (
    request: LyraSensitiveValueDeleteRequest
  ) => Promise<{ readonly deleted: boolean }>;
  readonly revealToUser: (
    request: LyraSensitiveValueRevealRequest
  ) => Promise<LyraSensitiveValueRevealResponse>;
  readonly resolveForAgentFill: (
    ref: import("../../shared/sensitive-value").LyraSensitiveValueRef
  ) => Promise<string>;
};

type StoredSensitiveValue = {
  readonly id: string;
  readonly owner: LyraSensitiveValueOwner;
  readonly valueKind: LyraSensitiveValueKind;
  readonly label: string;
  readonly description?: string;
  readonly ciphertextBase64: string;
  readonly capabilities: readonly LyraSensitiveValueCapability[];
  readonly createdAt: string;
  readonly updatedAt: string;
};

type SensitiveValuesStore = {
  readonly values: readonly StoredSensitiveValue[];
};

const SENSITIVE_VALUES_PATH = join(homedir(), ".lyra", "agent", "sensitive-values.json");

const readStore = (): SensitiveValuesStore => {
  if (!existsSync(SENSITIVE_VALUES_PATH)) {
    return { values: [] };
  }
  const parsed = JSON.parse(readFileSync(SENSITIVE_VALUES_PATH, "utf8")) as Partial<SensitiveValuesStore>;
  return {
    values: Array.isArray(parsed.values)
      ? parsed.values.filter((value): value is StoredSensitiveValue =>
        value !== null
        && typeof value === "object"
        && typeof value.id === "string"
        && typeof value.owner === "string"
        && typeof value.valueKind === "string"
        && typeof value.label === "string"
        && typeof value.ciphertextBase64 === "string"
        && Array.isArray(value.capabilities)
        && typeof value.createdAt === "string"
        && typeof value.updatedAt === "string")
      : []
  };
};

const writeStore = (store: SensitiveValuesStore): void => {
  mkdirSync(join(homedir(), ".lyra", "agent"), { recursive: true });
  writeFileSync(SENSITIVE_VALUES_PATH, `${JSON.stringify(store, null, 2)}\n`);
};

const encryptValue = (value: string): string => {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error("Electron safeStorage encryption is not available.");
  }
  return safeStorage.encryptString(value).toString("base64");
};

const decryptValue = (ciphertextBase64: string): string => {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error("Electron safeStorage encryption is not available.");
  }
  return safeStorage.decryptString(Buffer.from(ciphertextBase64, "base64"));
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
  const store = async (
    request: LyraSensitiveValueStoreRequest
  ): Promise<LyraSensitiveValueStoreResponse> => {
    if (request === null || typeof request !== "object" || Array.isArray(request)) {
      throw new Error("Sensitive value store request must be an object.");
    }
    const value = typeof request.value === "string" ? request.value : "";
    const label = typeof request.label === "string" ? request.label.trim() : "";
    if (value.length === 0) {
      throw new Error("Sensitive value cannot be empty.");
    }
    if (label.length === 0) {
      throw new Error("Sensitive value label is required.");
    }
    const now = new Date().toISOString();
    const id = `${Date.now()}-${randomUUID()}`;
    const owner = request.owner ?? "system";
    const valueKind = request.valueKind ?? "credential";
    const capabilities = request.capabilities ?? ["list_metadata", "use"];
    const record: StoredSensitiveValue = {
      id,
      owner,
      valueKind,
      label,
      ...(typeof request.description === "string" && request.description.trim().length > 0
        ? { description: request.description.trim() }
        : {}),
      ciphertextBase64: encryptValue(value),
      capabilities,
      createdAt: now,
      updatedAt: now
    };
    const current = readStore();
    writeStore({ values: [...current.values, record] });
    return {
      ref: createOpaqueSensitiveValueRef({
        id,
        owner,
        valueKind,
        label,
        ...(record.description === undefined ? {} : { description: record.description }),
        displayHint: "••••••••",
        ownerName: "sensitive-values",
        capabilities
      })
    };
  };

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

    const ownerRef = ref.ownerRef;
    if (
      ownerRef.kind === "opaque"
      && ownerRef.owner === "sensitive-values"
      && (
        ref.capabilities.includes("reveal_to_user")
        || (
          ref.owner === "system"
          && ref.valueKind === "credential"
          && ref.capabilities.includes("use")
        )
      )
    ) {
      const current = readStore();
      const record = current.values.find((entry) => entry.id === ownerRef.valueId);
      if (record === undefined || record.owner !== ref.owner) {
        throw new Error(`Sensitive value not found: ${ref.id}`);
      }
      return {
        refId: ref.id,
        value: decryptValue(record.ciphertextBase64)
      };
    }

    throw new Error(`Unsupported sensitive value ref: ${ref.id}`);
  };

  ipcMain.handle(LYRA_CHANNELS.sensitiveValuesRevealToUser, async (_event, request: unknown) =>
    await revealToUser(normalizeRevealRequest(request)));
  ipcMain.handle(LYRA_CHANNELS.sensitiveValuesStore, async (_event, request: unknown) =>
    await store(request as LyraSensitiveValueStoreRequest));

  const resolveForAgentFill = async (
    ref: import("../../shared/sensitive-value").LyraSensitiveValueRef
  ): Promise<string> => {
    if (!isLyraSensitiveValueRef(ref)) {
      throw new Error("Invalid sensitive value ref.");
    }
    if (!ref.capabilities.includes("fill") && !ref.capabilities.includes("use")) {
      throw new Error("Sensitive value ref is not authorized for fill/use.");
    }
    if (
      ref.owner === "login-manager"
      && ref.ownerRef.kind === "login-manager-credential"
      && ref.valueKind === "password"
    ) {
      const revealed = loginManager.revealCredential({
        credentialId: ref.ownerRef.credentialId,
        reason: "agent-fill-sensitive-value"
      });
      return revealed.password;
    }
    const current = readStore();
    const recordId = ref.ownerRef.kind === "opaque" ? ref.ownerRef.valueId : ref.id;
    const record = current.values.find((entry) => entry.id === recordId);
    if (record === undefined) {
      throw new Error(`Sensitive value not found: ${ref.id}`);
    }
    return decryptValue(record.ciphertextBase64);
  };

  const deleteValue = async (
    request: LyraSensitiveValueDeleteRequest
  ): Promise<{ readonly deleted: boolean }> => {
    if (!isLyraSensitiveValueRef(request.ref)) {
      throw new Error("Invalid sensitive value ref.");
    }
    const ref = request.ref;
    const current = readStore();
    const recordId = ref.ownerRef.kind === "opaque" ? ref.ownerRef.valueId : ref.id;
    const before = current.values.length;
    const filtered = current.values.filter((entry) => entry.id !== recordId);
    if (filtered.length === before) {
      return { deleted: false };
    }
    writeStore({ values: filtered });
    return { deleted: true };
  };

  ipcMain.handle(LYRA_CHANNELS.sensitiveValuesDelete, async (_event, request: unknown) =>
    await deleteValue(request as LyraSensitiveValueDeleteRequest));

  return {
    dispose: () => {
      ipcMain.removeHandler(LYRA_CHANNELS.sensitiveValuesRevealToUser);
      ipcMain.removeHandler(LYRA_CHANNELS.sensitiveValuesStore);
      ipcMain.removeHandler(LYRA_CHANNELS.sensitiveValuesDelete);
    },
    store,
    delete: deleteValue,
    revealToUser,
    resolveForAgentFill
  };
};
