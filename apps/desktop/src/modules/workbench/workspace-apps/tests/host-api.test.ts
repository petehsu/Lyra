import { describe, expect, test, vi } from "vitest";

import { CORE_HOST_COMMANDS, CORE_HOST_EVENTS, createLyraHostBus } from "../host-api";

describe("Lyra Host API bus", () => {
  test("routes versioned Core commands through the host boundary", async () => {
    const bus = createLyraHostBus();
    const handler = vi.fn(async (input) => ({ received: input }));
    bus.registerCoreCommand(CORE_HOST_COMMANDS.openResource, handler);
    const host = bus.createHost({ moduleId: "lyra.files" });

    await expect(host.executeCommand(CORE_HOST_COMMANDS.openResource, { path: "/tmp/a" }))
      .resolves.toEqual({ received: { path: "/tmp/a" } });
    expect(handler).toHaveBeenCalledOnce();
  });

  test("rejects cross-module registration and duplicate ownership", () => {
    const bus = createLyraHostBus();
    const files = bus.createHost({ moduleId: "lyra.files" });
    expect(() => files.registerCommand("lyra.editor.open", async () => null))
      .toThrow("another module's contribution");
    files.registerCommand("lyra.files.open", async () => null);
    expect(() => files.registerCommand("lyra.files.open", async () => null))
      .toThrow("already registered");
  });

  test("enforces capability grants at invocation time", async () => {
    const bus = createLyraHostBus();
    bus.registerCoreCapability("lyra.core.files.read", async () => "ok", "files:read");
    const denied = bus.createHost({ moduleId: "lyra.notifications" });
    const allowed = bus.createHost({
      moduleId: "lyra.files",
      allowedCapabilities: new Set(["files:read"])
    });

    await expect(denied.invokeCapability("lyra.core.files.read", null))
      .rejects.toThrow("not granted");
    await expect(allowed.invokeCapability("lyra.core.files.read", null)).resolves.toBe("ok");
  });

  test("lets trusted Core execute an activated module command contribution", async () => {
    const bus = createLyraHostBus();
    const files = bus.createHost({ moduleId: "lyra.files" });
    files.registerCommand("lyra.files.refresh", async (input) => ({ refreshed: input }));

    await expect(bus.executeRegisteredCommand("lyra.files.refresh", { path: "/workspace" }))
      .resolves.toEqual({ refreshed: { path: "/workspace" } });
    await expect(bus.executeRegisteredCommand("lyra.files.missing", null))
      .rejects.toThrow("unavailable");
    files.dispose();
    await expect(bus.executeRegisteredCommand("lyra.files.refresh", null))
      .rejects.toThrow("unavailable");
  });

  test("stops dispatch after the Core bus is disposed", async () => {
    const bus = createLyraHostBus();
    bus.registerCoreCommand(CORE_HOST_COMMANDS.notify, async () => null);
    const host = bus.createHost({ moduleId: "lyra.notifications" });
    bus.dispose();
    await expect(host.executeCommand(CORE_HOST_COMMANDS.notify, null))
      .rejects.toThrow("disposed");
  });

  test("delivers permission-checked JSON events and disposes subscriptions", async () => {
    const bus = createLyraHostBus();
    const event = bus.registerCoreEvent(
      CORE_HOST_EVENTS.notificationsChanged,
      "notifications:read"
    );
    const denied = bus.createHost({ moduleId: "lyra.files" });
    expect(() => denied.subscribeEvent(CORE_HOST_EVENTS.notificationsChanged, async () => {}))
      .toThrow("not granted");

    const listener = vi.fn(async () => undefined);
    const allowed = bus.createHost({
      moduleId: "lyra.notifications",
      allowedCapabilities: new Set(["notifications:read"])
    });
    const subscription = allowed.subscribeEvent(CORE_HOST_EVENTS.notificationsChanged, listener);
    await event.emit({ unread: 2 });
    expect(listener).toHaveBeenCalledWith({ unread: 2 });
    subscription.dispose();
    await event.emit({ unread: 0 });
    expect(listener).toHaveBeenCalledOnce();
  });
});
