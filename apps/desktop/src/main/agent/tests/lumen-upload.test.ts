import { expect, test, vi } from "vitest";
vi.mock("electron", () => ({ BrowserWindow: {} }));
import { createLumenToolHost } from "../lumen-tool-host";
import { createLumenSessionPages } from "../lumen-session-pages";
import { nextRecommendedActionAfterFastLumenAction } from "../lumen-tool-host-helpers";
const setup = () => {
  const uploadAgentFiles = vi.fn(async () => ({ ok: true, status: "filesSelected", uploadCompletion: "notVerified" }));
  const host = createLumenToolHost({ getBrowserBridge: () => ({ uploadAgentFiles }),
    tabResolver: { resolveBrowserAgentTabId: async () => "mail" }, storageRoot: "/tmp" } as never);
  return { uploadAgentFiles, upload: host.handlers["lyraLumen.upload"]! };
};
test("upload keeps explicit files and upload effect at the host boundary", async () => {
  const tool = setup();
  expect(await tool.upload({ files: ["/tmp/file.txt"], targetRef: "lumen:attachment", effect: "upload" }))
    .toMatchObject({ ok: true, status: "filesSelected", uploadCompletion: "notVerified" });
  expect(tool.uploadAgentFiles).toHaveBeenCalledWith("mail", expect.objectContaining({
    files: ["/tmp/file.txt"], targetRef: "lumen:attachment", effect: "upload"
  }));
});
test.each(["observe", "editDraft", undefined])("upload cannot be downgraded to %s", async effect => {
  const tool = setup();
  expect(await tool.upload({ files: ["/tmp/file.txt"], effect })).toMatchObject({ ok: false });
  expect(tool.uploadAgentFiles).not.toHaveBeenCalled();
});
test("a chooser stays on its original task tab after switching pages", () => {
  const pages = createLumenSessionPages(), task = { runtimeCancellation: { sessionId: "task" } };
  pages.remember(task, { ok: true, tabId: "mail", fileChooser: { chooserId: "chooser:one" } });
  pages.remember(task, { ok: true, tabId: "other" });
  expect(pages.prepare("lyraLumen.upload", { ...task, chooserId: "chooser:one" })).toMatchObject({ tabId: "mail" });
  expect(() => pages.prepare("lyraLumen.upload", { ...task, chooserId: "chooser:one", tabId: "other" })).toThrow("different tabs");
});
test("pending chooser takes precedence over generic read-after-click advice", () => {
  expect(nextRecommendedActionAfterFastLumenAction({ ok: true, fileChooser: { supported: true } } as never)).toBe("browser_upload");
});
