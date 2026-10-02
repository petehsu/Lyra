import { expect, test, vi } from "vitest";

vi.mock("electron", () => ({ BrowserWindow: {} }));
import { createLumenToolHost } from "../lumen-tool-host";

const host = (readAgentPage: ReturnType<typeof vi.fn>, findAgentPage = vi.fn()) => createLumenToolHost({
  getBrowserBridge: () => ({ readAgentPage, findAgentPage, readPageState: () => null }),
  tabResolver: { resolveBrowserAgentTabId: async () => "fixture" }, storageRoot: "/tmp"
} as unknown as Parameters<typeof createLumenToolHost>[0]).handlers;

test.each([
  {}, { scope: "full" }, { strategy: "domFallback", scope: "full" },
  { instruction: "Read the latest answer" }, { schema: { type: "object" }, scope: "full" }
])("read errors stay errors across tool entry paths: %j", async payload => {
  const read = vi.fn().mockRejectedValue(new Error("Renderer context was destroyed during navigation"));
  const result = await host(read)["lyraLumen.read"]!(payload);
  expect(result).toMatchObject({ ok: false, error: { message: "Renderer context was destroyed during navigation" } });
  expect(read).toHaveBeenCalledTimes(1);
});

test("a successful empty read is explicitly distinguished from returned text", async () => {
  const read = vi.fn().mockResolvedValue({ content: "", totalChars: 0, truncated: false });
  const result = await host(read)["lyraLumen.read"]!({});
  expect(result).toMatchObject({ ok: true, content: "", readStatus: "empty" });
});

test("a missing text search explains how to locate a field without claiming it is empty", async () => {
  const find = vi.fn().mockResolvedValue({ ok: true, matches: [], totalMatches: 0 });
  const read = vi.fn();
  const result = await host(read, find)["lyraLumen.read"]!({ query: "Message Body" });
  expect(result).toMatchObject({ ok: true, matches: [] });
  expect((result as { message: string }).message).toContain("map(query)");
  expect((result as { message: string }).message).toContain("does not mean that field is empty or missing");
  expect(read).not.toHaveBeenCalled();
  expect(find).toHaveBeenCalledOnce();
});

test("schema hints do not claim HTML inspection or dictate the user's final reply", async () => {
  const result=await host(vi.fn().mockResolvedValue({content:"Visible outcome",truncated:false}))["lyraLumen.read"]!({instruction:"Describe the overlay HTML",schema:{type:"object"}});
  expect(result).toMatchObject({ok:true,content:"Visible outcome",extractionMode:"renderedText",schemaApplied:false});
  expect((result as { message: string }).message).toContain("were not executed");
});
