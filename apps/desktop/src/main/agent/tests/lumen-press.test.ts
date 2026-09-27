import { afterEach, expect, test, vi } from "vitest";
vi.mock("electron", () => ({ BrowserWindow: {} }));
import { createLumenToolHost } from "../lumen-tool-host";

afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
});

test.each([
  [{}, "fast"],
  [{ verification: "fast" }, "fast"],
  [{ verification: "full" }, "full"],
  [{ verification: "none" }, "none"],
  [{ verify: "fast" }, "fast"]
])("press forwards verification through the actual tool entry: %j", async (payload, expected) => {
  vi.useFakeTimers();
  const pressAgentKey = vi.fn(async () => ({ ok: true, message: "activeCandidate=Paris", afterObservationId: "after-key" }));
  const { handlers } = createLumenToolHost({
    getBrowserBridge: () => ({ pressAgentKey }),
    tabResolver: { resolveBrowserAgentTabId: async () => "fixture" },
    storageRoot: "/tmp"
  } as unknown as Parameters<typeof createLumenToolHost>[0]);
  const result = await handlers["lyraLumen.press"]!({ key: "ArrowDown", ...payload });
  expect(pressAgentKey).toHaveBeenCalledWith("fixture", { key: "ArrowDown", targetMode: "live", verification: expected });
  expect(result).toMatchObject({ message: "activeCandidate=Paris", afterObservationId: "after-key" });
});

test("selection and repeat reach the production input controller", async () => {
  vi.useFakeTimers();
  const pressAgentKey = vi.fn(async () => ({ ok: true }));
  const { handlers } = createLumenToolHost({
    getBrowserBridge: () => ({ pressAgentKey }), tabResolver: { resolveBrowserAgentTabId: async () => "fixture" }, storageRoot: "/tmp"
  } as unknown as Parameters<typeof createLumenToolHost>[0]);
  await handlers["lyraLumen.press"]!({ key: "Control+b", targetRef: "lumen:body", selectText: " Budget: 500 ", occurrence: 2 });
  expect(pressAgentKey).toHaveBeenCalledWith("fixture", expect.objectContaining({ selectText: " Budget: 500 ", occurrence: 2 }));
});

test("sessions keep their selected browser tab despite another session changing the active tab", async () => {
  vi.useFakeTimers();
  const pressAgentKey = vi.fn(async (tabId: string) => ({ ok: true, tabId }));
  const { handlers } = createLumenToolHost({
    getBrowserBridge: () => ({ pressAgentKey }),
    tabResolver: { resolveBrowserAgentTabId: async (payload: {tabId?: string}) => payload.tabId ?? "unrelated-active-tab" }, storageRoot: "/tmp"
  } as unknown as Parameters<typeof createLumenToolHost>[0]);
  const press = (session: string, tabId?: string) => handlers["lyraLumen.press"]!({
    key: "ArrowLeft", runtimeCancellation: { sessionId: session }, ...(tabId === undefined ? {} : {tabId})
  });
  await press("a", "gmail");
  await press("b", "other-site");
  await press("a");
  expect(pressAgentKey.mock.calls.at(-1)?.[0]).toBe("gmail");
  await press("b");
  expect(pressAgentKey.mock.calls.at(-1)?.[0]).toBe("other-site");
  await press("a", "explicit-override");
  expect(pressAgentKey.mock.calls.at(-1)?.[0]).toBe("explicit-override");
});


test.each(["target_not_visible", "selection_ambiguous", "lyraLumenTimeout"])("action failure %s does not append unrelated historical page errors", async kind => {
  const failure = { ok: false, error: { kind, message: "Action could not be confirmed" }, nextRecommendedAction: "lyra_lumen.read" };
  const auditAgentPageDiagnostics = vi.fn(async () => ({ diagnostics: [{ message: "old preload failure".repeat(1000) }], summary: "old page errors" }));
  const { handlers } = createLumenToolHost({
    getBrowserBridge: () => ({ pressAgentKey: async () => failure, auditAgentPageDiagnostics }),
    tabResolver: { resolveBrowserAgentTabId: async () => "fixture" }, storageRoot: "/tmp"
  } as unknown as Parameters<typeof createLumenToolHost>[0]);
  const result = await handlers["lyraLumen.press"]!({ key: "Control+b", targetRef: "lumen:body" });
  expect(result).toMatchObject({ ok: false, error: failure.error, nextRecommendedAction: "lyra_lumen.read" });
  expect(result).not.toHaveProperty("diagnostics");
  expect(auditAgentPageDiagnostics).not.toHaveBeenCalled();
});
