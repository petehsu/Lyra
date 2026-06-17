import { vi } from "vitest";

import type { WorkbenchStateSnapshot } from "../../../shared/desktop-bridge";
import type { WorkbenchStateIpcBridge } from "../../workbench-state/service";

const createEmptyWorkbenchStateSnapshot = (): WorkbenchStateSnapshot => ({
  preferences: null,
  "workspace-tabs": null,
  "browser-session": null,
  "browser-history": null,
  "ai-panel-tabs": null,
  "terminal-dock": null,
  notifications: null,
  layout: null,
  location: null
});

export const createWorkbenchStateMock = (
  overrides: Partial<WorkbenchStateIpcBridge> = {}
): WorkbenchStateIpcBridge => ({
  dispose: vi.fn(),
  flush: vi.fn(async () => undefined),
  snapshot: vi.fn(() => createEmptyWorkbenchStateSnapshot()),
  readState: vi.fn(() => null),
  readStateAsync: vi.fn(async () => null),
  writeState: vi.fn(),
  writeStateAsync: vi.fn(async () => undefined),
  removeState: vi.fn(),
  removeStateAsync: vi.fn(async () => undefined),
  subscribe: vi.fn(() => vi.fn()),
  ...overrides
});